import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createSign } from "node:crypto";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_PORT = 8787;
const DEFAULT_ALLOWED_ORIGIN = "http://127.0.0.1:5173";
const DEFAULT_MODEL = "gpt-5-mini";
const MAX_BODY_BYTES = 80 * 1024;
const DEFAULT_MAX_DRAFT_CHARS = 16000;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_GA4_PROPERTY_ID = "315631542";

const recommendationCategories = new Set(["Headline", "Readability", "Structure", "Performance", "Editorial"]);
const recommendationPriorities = new Set(["High", "Medium", "Low"]);
const readinessLabels = new Set(["Ready", "Needs edits", "Needs major work"]);

function loadEnvFile(fileName) {
  const filePath = resolve(ROOT_DIR, fileName);
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const port = intEnv("AI_REVIEW_PORT", DEFAULT_PORT, 1024, 65535);
const allowedOrigin = process.env.AI_REVIEW_ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
const maxDraftChars = intEnv("AI_REVIEW_MAX_DRAFT_CHARS", DEFAULT_MAX_DRAFT_CHARS, 2000, 30000);
const timeoutMs = intEnv("AI_REVIEW_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 5000, 60000);
const ga4PropertyId = process.env.GA4_PROPERTY_ID || DEFAULT_GA4_PROPERTY_ID;
let googleAccessToken = null;

function corsHeaders(origin) {
  const allowOrigin = origin === allowedOrigin || (!origin && allowedOrigin.startsWith("http://127.0.0.1")) ? allowedOrigin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function sanitizeText(value, limit = 4000) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/\b\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]")
    .replace(/\b\d{10}\b/g, "[id removed]")
    .replace(/\b[A-Z]{2,}\d{2,}\b/g, "[identifier removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid request payload");
  const input = payload.input;
  const local = payload.localReview;
  if (!input || typeof input !== "object") throw new Error("Missing input");
  if (!local || typeof local !== "object") throw new Error("Missing local review");
  const title = sanitizeText(input.title, 220);
  const draftText = sanitizeText(input.draftText, maxDraftChars);
  if (!draftText || draftText.split(/\s+/).length < 20) throw new Error("Draft text is too short for AI review");

  return {
    input: {
      title,
      topic: sanitizeText(input.topic, 80) || "General",
      plannedDate: sanitizeText(input.plannedDate, 40),
      wordCount: clampNumber(input.wordCount, 0, 50000, 0),
      hasImages: Boolean(input.hasImages),
      length: input.length === "Long" ? "Long" : "Short",
      draftText,
      truncated: String(input.draftText || "").length > maxDraftChars
    },
    localReview: {
      readinessScore: clampNumber(local.readinessScore, 0, 100, 0),
      readinessLabel: readinessLabels.has(local.readinessLabel) ? local.readinessLabel : "Needs edits",
      summary: sanitizeText(local.summary, 800),
      stats: local.stats || {},
      headlineScore: clampNumber(local.headlineScore, 0, 10, 0),
      headlineFeedback: sanitizeText(local.headlineFeedback, 400),
      prediction: {
        pred30: clampNumber(local.prediction?.pred30, 0, 100000000, 0),
        pred90: clampNumber(local.prediction?.pred90, 0, 100000000, 0),
        className: ["High", "Medium", "Low"].includes(local.prediction?.className) ? local.prediction.className : "Medium",
        confidence: clampNumber(local.prediction?.confidence, 0, 1, 0),
        source: sanitizeText(local.prediction?.source, 80),
        trainingRows: clampNumber(local.prediction?.trainingRows, 0, 1000000, 0),
        drivers: Array.isArray(local.prediction?.drivers) ? local.prediction.drivers.slice(0, 6).map((item) => sanitizeText(item, 180)) : []
      },
      recommendations: Array.isArray(local.recommendations)
        ? local.recommendations.slice(0, 6).map((item) => ({
            category: recommendationCategories.has(item?.category) ? item.category : "Editorial",
            priority: recommendationPriorities.has(item?.priority) ? item.priority : "Medium",
            title: sanitizeText(item?.title, 160),
            detail: sanitizeText(item?.detail, 500),
            impact: sanitizeText(item?.impact, 220)
          }))
        : [],
      checklist: Array.isArray(local.checklist)
        ? local.checklist.slice(0, 8).map((item) => ({
            label: sanitizeText(item?.label, 160),
            done: Boolean(item?.done),
            detail: sanitizeText(item?.detail, 300)
          }))
        : [],
      seo: {
        score: clampNumber(local.seo?.score, 0, 10, 0),
        summary: sanitizeText(local.seo?.summary, 500),
        keywordOpportunities: Array.isArray(local.seo?.keywordOpportunities)
          ? local.seo.keywordOpportunities.slice(0, 6).map((item) => sanitizeText(item, 80))
          : [],
        titleGuidance: sanitizeText(local.seo?.titleGuidance, 300),
        metaDescription: sanitizeText(local.seo?.metaDescription, 180)
      },
      trend: {
        summary: sanitizeText(local.trend?.summary, 500),
        opportunities: Array.isArray(local.trend?.opportunities)
          ? local.trend.opportunities.slice(0, 4).map((item) => sanitizeText(item, 220))
          : [],
        caveat: sanitizeText(local.trend?.caveat, 220)
      },
      rewrite: {
        leadRewrite: sanitizeText(local.rewrite?.leadRewrite, 700),
        simplify: Array.isArray(local.rewrite?.simplify)
          ? local.rewrite.simplify.slice(0, 5).map((item) => sanitizeText(item, 220))
          : [],
        concreteEdits: Array.isArray(local.rewrite?.concreteEdits)
          ? local.rewrite.concreteEdits.slice(0, 6).map((item) => sanitizeText(item, 240))
          : []
      },
      evidence: Array.isArray(local.evidence)
        ? local.evidence.slice(0, 6).map((item) => ({
            label: sanitizeText(item?.label, 80),
            detail: sanitizeText(item?.detail, 260),
            source: ["Historical data", "Draft analysis", "AI inference"].includes(item?.source) ? item.source : "Draft analysis"
          }))
        : []
    }
  };
}

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 500 },
    readinessScore: { type: "integer", minimum: 0, maximum: 100 },
    readinessLabel: { type: "string", enum: ["Ready", "Needs edits", "Needs major work"] },
    headlineScore: { type: "integer", minimum: 0, maximum: 10 },
    headlineFeedback: { type: "string", maxLength: 350 },
    headlineOptions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", maxLength: 140 }
    },
    recommendations: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: ["Headline", "Readability", "Structure", "Performance", "Editorial"] },
          priority: { type: "string", enum: ["High", "Medium", "Low"] },
          title: { type: "string", maxLength: 120 },
          detail: { type: "string", maxLength: 420 },
          impact: { type: "string", maxLength: 180 }
        },
        required: ["category", "priority", "title", "detail", "impact"]
      }
    },
    checklist: {
      type: "array",
      minItems: 5,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string", maxLength: 120 },
          done: { type: "boolean" },
          detail: { type: "string", maxLength: 260 }
        },
        required: ["label", "done", "detail"]
      }
    },
    seo: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 10 },
        summary: { type: "string", maxLength: 500 },
        keywordOpportunities: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: { type: "string", maxLength: 80 }
        },
        titleGuidance: { type: "string", maxLength: 300 },
        metaDescription: { type: "string", maxLength: 180 }
      },
      required: ["score", "summary", "keywordOpportunities", "titleGuidance", "metaDescription"]
    },
    trend: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string", maxLength: 500 },
        opportunities: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string", maxLength: 220 }
        },
        caveat: { type: "string", maxLength: 220 }
      },
      required: ["summary", "opportunities", "caveat"]
    },
    rewrite: {
      type: "object",
      additionalProperties: false,
      properties: {
        leadRewrite: { type: "string", maxLength: 700 },
        simplify: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: { type: "string", maxLength: 220 }
        },
        concreteEdits: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: { type: "string", maxLength: 240 }
        }
      },
      required: ["leadRewrite", "simplify", "concreteEdits"]
    },
    evidence: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string", maxLength: 80 },
          detail: { type: "string", maxLength: 260 },
          source: { type: "string", enum: ["Historical data", "Draft analysis", "AI inference"] }
        },
        required: ["label", "detail", "source"]
      }
    }
  },
  required: [
    "summary",
    "readinessScore",
    "readinessLabel",
    "headlineScore",
    "headlineFeedback",
    "headlineOptions",
    "recommendations",
    "checklist",
    "seo",
    "trend",
    "rewrite",
    "evidence"
  ]
};

function buildOpenAiRequest(reviewPayload) {
  return {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an editorial assistant for a university content team. Give practical pre-publication advice for writers and editors. Be specific, concise, respectful, SEO-aware, and evidence-aware. Critique search clarity, reader relevance, technical language, headline strength, lead structure, and concrete next edits. Use the local historical prediction context when provided, but do not claim guaranteed traffic lift. Do not claim real-time trend data, keyword volume, or live search demand unless supplied in the payload. Phrase trend guidance as timely/editorial positioning. Do not invent facts. Do not include private data. Return only the requested JSON shape."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              task: "Review this draft and improve the local rule-based recommendations.",
              reviewPayload
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "watchtower_draft_review",
        strict: true,
        schema: reviewSchema
      }
    },
    max_output_tokens: 5200
  };
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
      if (typeof content?.json === "object") return JSON.stringify(content.json);
    }
  }
  return chunks.join("\n");
}

function normalizeAiReview(value) {
  const recommendations = Array.isArray(value.recommendations) ? value.recommendations : [];
  const headlineOptions = Array.isArray(value.headlineOptions) ? value.headlineOptions : [];
  const checklist = Array.isArray(value.checklist) ? value.checklist : [];
  const seoKeywords = Array.isArray(value.seo?.keywordOpportunities) ? value.seo.keywordOpportunities : [];
  const trendOpportunities = Array.isArray(value.trend?.opportunities) ? value.trend.opportunities : [];
  const simplify = Array.isArray(value.rewrite?.simplify) ? value.rewrite.simplify : [];
  const concreteEdits = Array.isArray(value.rewrite?.concreteEdits) ? value.rewrite.concreteEdits : [];
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  return {
    summary: sanitizeText(value.summary, 500),
    readinessScore: clampNumber(value.readinessScore, 0, 100, 50),
    readinessLabel: readinessLabels.has(value.readinessLabel) ? value.readinessLabel : "Needs edits",
    headlineScore: clampNumber(value.headlineScore, 0, 10, 5),
    headlineFeedback: sanitizeText(value.headlineFeedback, 350),
    headlineOptions: headlineOptions.slice(0, 5).map((item) => sanitizeText(item, 140)).filter(Boolean),
    recommendations: recommendations.slice(0, 6).map((item) => ({
      category: recommendationCategories.has(item?.category) ? item.category : "Editorial",
      priority: recommendationPriorities.has(item?.priority) ? item.priority : "Medium",
      title: sanitizeText(item?.title, 120),
      detail: sanitizeText(item?.detail, 420),
      impact: sanitizeText(item?.impact, 180)
    })).filter((item) => item.title && item.detail),
    checklist: checklist.slice(0, 7).map((item) => ({
      label: sanitizeText(item?.label, 120),
      done: Boolean(item?.done),
      detail: sanitizeText(item?.detail, 260)
    })).filter((item) => item.label && item.detail),
    seo: {
      score: clampNumber(value.seo?.score, 0, 10, 5),
      summary: sanitizeText(value.seo?.summary, 500),
      keywordOpportunities: seoKeywords.slice(0, 6).map((item) => sanitizeText(item, 80)).filter(Boolean),
      titleGuidance: sanitizeText(value.seo?.titleGuidance, 300),
      metaDescription: sanitizeText(value.seo?.metaDescription, 180)
    },
    trend: {
      summary: sanitizeText(value.trend?.summary, 500),
      opportunities: trendOpportunities.slice(0, 4).map((item) => sanitizeText(item, 220)).filter(Boolean),
      caveat: sanitizeText(value.trend?.caveat, 220)
    },
    rewrite: {
      leadRewrite: sanitizeText(value.rewrite?.leadRewrite, 700),
      simplify: simplify.slice(0, 5).map((item) => sanitizeText(item, 220)).filter(Boolean),
      concreteEdits: concreteEdits.slice(0, 6).map((item) => sanitizeText(item, 240)).filter(Boolean)
    },
    evidence: evidence.slice(0, 6).map((item) => ({
      label: sanitizeText(item?.label, 80),
      detail: sanitizeText(item?.detail, 260),
      source: ["Historical data", "Draft analysis", "AI inference"].includes(item?.source) ? item.source : "AI inference"
    })).filter((item) => item.label && item.detail)
  };
}

async function callOpenAi(reviewPayload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildOpenAiRequest(reviewPayload)),
      signal: controller.signal
    });
    const bodyText = await response.text();
    if (!response.ok) {
      let message = `OpenAI request failed with ${response.status}`;
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed?.error?.message) message = parsed.error.message;
      } catch {
        // Keep generic message.
      }
      throw new Error(message);
    }
    const data = JSON.parse(bodyText);
    const outputText = extractOutputText(data);
    if (!outputText) throw new Error("OpenAI returned no structured review");
    try {
      return normalizeAiReview(JSON.parse(outputText));
    } catch {
      throw new Error("OpenAI returned an incomplete structured review. Try again with a shorter draft.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getServiceAccount() {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  }
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) return null;
  const parsed = JSON.parse(readFileSync(resolve(ROOT_DIR, credentialsPath), "utf8"));
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

function ga4CredentialStatus() {
  if (process.env.GA4_ACCESS_TOKEN) return "access-token";
  if (process.env.GA4_SERVICE_ACCOUNT_JSON) return "inline-service-account";
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return "service-account-file";
  return "missing";
}

async function getGoogleAccessToken() {
  if (process.env.GA4_ACCESS_TOKEN) return process.env.GA4_ACCESS_TOKEN;
  if (googleAccessToken && googleAccessToken.expiresAt > Date.now() + 60_000) return googleAccessToken.token;

  const serviceAccount = getServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("GA4 property is configured, but Google read-only credentials are missing.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key, "base64");
  const assertion = `${unsigned}.${signature.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error_description || body?.error || "Google authentication failed.");
  }
  googleAccessToken = {
    token: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000
  };
  return googleAccessToken.token;
}

function isoFromGaDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function isoFromUrl(url) {
  const match = String(url || "").match(/(?:^|\/)(20\d{2})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function titleFromUrl(url) {
  const slug = String(url || "").replace(/\/$/, "").split("/").pop() || "";
  return slug.replace(/^\d{8}-/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Untitled GA4 page";
}

function topicFromText(value) {
  const text = String(value || "").toLowerCase();
  if (/sustainability|climate|water|energy|environment/.test(text)) return "Sustainability";
  if (/health|medicine|medical|nursing|wellness/.test(text)) return "Health";
  if (/technology|engineering|ai|robot|data|cyber/.test(text)) return "Technology";
  if (/student|campus|graduate|degree|class/.test(text)) return "Students";
  if (/business|entrepreneur|economy|market/.test(text)) return "Business";
  if (/research|study|scientist|lab|discovery/.test(text)) return "Research";
  return "General";
}

function emptyGaMetrics() {
  return {
    users: 0,
    sessions: 0,
    pageviews: 0,
    engagementSeconds: 0,
    bounceRateWeight: 0,
    bounceRateSessions: 0
  };
}

function addGaMetrics(target, metrics) {
  target.users += metrics.users;
  target.sessions += metrics.sessions;
  target.pageviews += metrics.pageviews;
  target.engagementSeconds += metrics.engagementSeconds;
  target.bounceRateWeight += metrics.bounceRate * metrics.sessions;
  target.bounceRateSessions += metrics.sessions;
}

function finalizeGaMetrics(metrics) {
  const bounceRate = metrics.bounceRateSessions > 0 ? metrics.bounceRateWeight / metrics.bounceRateSessions : 0;
  return {
    users: Math.round(metrics.users),
    sessions: Math.round(metrics.sessions),
    pageviews: Math.round(metrics.pageviews),
    engagementTime: Math.round(metrics.engagementSeconds),
    bounceRate: Math.round(bounceRate * 10000) / 10000
  };
}

function numberMetric(row, index) {
  return Number(row.metricValues?.[index]?.value || 0);
}

async function runGa4Report({ startDate, endDate, pathContains, limit }) {
  const token = await getGoogleAccessToken();
  const body = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "date" }, { name: "pageLocation" }, { name: "pageTitle" }],
    metrics: [
      { name: "activeUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "userEngagementDuration" },
      { name: "bounceRate" }
    ],
    limit: String(limit)
  };
  if (pathContains) {
    body.dimensionFilter = {
      filter: {
        fieldName: "pageLocation",
        stringFilter: { matchType: "CONTAINS", value: pathContains, caseSensitive: false }
      }
    };
  }

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${ga4PropertyId}:runReport`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "GA4 report request failed.");
  }
  return data;
}

function ga4RowsToImportRows(rows) {
  const pages = new Map();
  for (const row of rows) {
    const date = isoFromGaDate(row.dimensionValues?.[0]?.value);
    const url = row.dimensionValues?.[1]?.value || "";
    const pageTitle = row.dimensionValues?.[2]?.value || "";
    if (!date || !url) continue;
    const key = url.split("#")[0];
    const current =
      pages.get(key) ||
      {
        url: key,
        title: pageTitle || titleFromUrl(key),
        firstSeen: date,
        daily: []
      };
    if (date < current.firstSeen) current.firstSeen = date;
    if (pageTitle && pageTitle.length > current.title.length) current.title = pageTitle;
    current.daily.push({
      date,
      metrics: {
        users: numberMetric(row, 0),
        sessions: numberMetric(row, 1),
        pageviews: numberMetric(row, 2),
        engagementSeconds: numberMetric(row, 3),
        bounceRate: numberMetric(row, 4)
      }
    });
    pages.set(key, current);
  }

  return [...pages.values()]
    .map((page) => {
      const plannedDate = isoFromUrl(page.url) || page.firstSeen;
      const end30 = addDays(plannedDate, 29);
      const end90 = addDays(plannedDate, 89);
      const metrics30 = emptyGaMetrics();
      const metrics90 = emptyGaMetrics();
      for (const item of page.daily) {
        if (item.date >= plannedDate && item.date <= end30) addGaMetrics(metrics30, item.metrics);
        if (item.date >= plannedDate && item.date <= end90) addGaMetrics(metrics90, item.metrics);
      }
      const m30 = finalizeGaMetrics(metrics30);
      const m90 = finalizeGaMetrics(metrics90);
      return {
        title: page.title || titleFromUrl(page.url),
        topic: topicFromText(`${page.title} ${page.url}`),
        plannedDate,
        wordCount: 0,
        images: "",
        status: "Published",
        length: "",
        sra: "",
        owner: "",
        url: page.url,
        notes: `Imported from GA4 property ${ga4PropertyId}. Publication date inferred from ${isoFromUrl(page.url) ? "URL" : "first seen date"}.`,
        users30: m30.users,
        sessions30: m30.sessions,
        pageviews30: m30.pageviews,
        engagementTime30: m30.engagementTime,
        bounceRate30: m30.bounceRate,
        users90: m90.users,
        sessions90: m90.sessions,
        pageviews90: m90.pageviews,
        engagementTime90: m90.engagementTime,
        bounceRate90: m90.bounceRate,
        sourceSheet: "GA4 Data API"
      };
    })
    .filter((row) => Number(row.pageviews30) > 0 || Number(row.pageviews90) > 0);
}

function validateGa4ImportRequest(payload) {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = String(payload?.startDate || addDays(today, -365)).slice(0, 10);
  const endDate = String(payload?.endDate || today).slice(0, 10);
  if (Number.isNaN(Date.parse(startDate)) || Number.isNaN(Date.parse(endDate))) {
    throw new Error("GA4 start and end dates must be valid dates.");
  }
  if (startDate > endDate) throw new Error("GA4 start date must be before end date.");
  return {
    startDate,
    endDate,
    pathContains: sanitizeText(payload?.pathContains || "news.asu.edu", 180),
    limit: clampNumber(payload?.limit, 100, 50000, intEnv("GA4_IMPORT_LIMIT", 10000, 100, 50000))
  };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const headers = corsHeaders(req.headers.origin);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/healthz") {
      sendJson(
        res,
        200,
        {
          ok: true,
          modelConfigured: Boolean(process.env.OPENAI_API_KEY),
          model,
          ga4: {
            propertyId: ga4PropertyId,
            credentialStatus: ga4CredentialStatus(),
            importReady: ga4CredentialStatus() !== "missing"
          }
        },
        headers
      );
      return;
    }
    if (req.method === "GET" && req.url === "/api/ga4/status") {
      sendJson(
        res,
        200,
        {
          propertyId: ga4PropertyId,
          credentialStatus: ga4CredentialStatus(),
          importReady: ga4CredentialStatus() !== "missing"
        },
        headers
      );
      return;
    }
    if (!["/api/review-draft", "/api/ga4/import"].includes(req.url || "")) {
      sendJson(res, 404, { error: "Not found" }, headers);
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" }, headers);
      return;
    }
    if (req.headers.origin && req.headers.origin !== allowedOrigin) {
      sendJson(res, 403, { error: "Origin not allowed" }, headers);
      return;
    }
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
      sendJson(res, 415, { error: "Expected application/json" }, headers);
      return;
    }
    const rawBody = await readBody(req);
    const parsedBody = JSON.parse(rawBody);
    if (req.url === "/api/ga4/import") {
      const request = validateGa4ImportRequest(parsedBody);
      const report = await runGa4Report(request);
      const rows = ga4RowsToImportRows(report.rows || []);
      sendJson(
        res,
        200,
        {
          propertyId: ga4PropertyId,
          rowCount: report.rowCount || rows.length,
          importedRows: rows.length,
          rows
        },
        headers
      );
      return;
    }
    const payload = validatePayload(parsedBody);
    const review = await callOpenAi(payload);
    sendJson(res, 200, review, headers);
  } catch (error) {
    const status = error?.name === "AbortError" ? 504 : error?.message?.includes("too large") ? 413 : 400;
    const message = status === 504 ? "Request timed out" : error?.message || "Request failed";
    sendJson(res, status, { error: message }, headers);
  } finally {
    console.log(`${req.method} ${req.url} ${Date.now() - started}ms`);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Watchtower AI review server listening on http://127.0.0.1:${port}`);
  console.log(`Allowed origin: ${allowedOrigin}`);
  console.log(`OpenAI model: ${model}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
