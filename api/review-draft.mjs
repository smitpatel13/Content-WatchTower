const DEFAULT_MODEL = "gpt-5-mini";
const MAX_BODY_BYTES = 80 * 1024;
const DEFAULT_MAX_DRAFT_CHARS = 16000;
const DEFAULT_TIMEOUT_MS = 55000;

const recommendationCategories = new Set(["Headline", "Readability", "Structure", "Performance", "Editorial"]);
const recommendationPriorities = new Set(["High", "Medium", "Low"]);
const readinessLabels = new Set(["Ready", "Needs edits", "Needs major work"]);

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
const maxDraftChars = intEnv("AI_REVIEW_MAX_DRAFT_CHARS", DEFAULT_MAX_DRAFT_CHARS, 2000, 30000);
const timeoutMs = intEnv("AI_REVIEW_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 5000, 60000);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const rawBody = await readBody(req);
  return rawBody ? JSON.parse(rawBody) : {};
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
    readinessScore: Math.round(clampNumber(value.readinessScore, 0, 100, 50)),
    readinessLabel: readinessLabels.has(value.readinessLabel) ? value.readinessLabel : "Needs edits",
    headlineScore: Math.round(clampNumber(value.headlineScore, 0, 10, 5)),
    headlineFeedback: sanitizeText(value.headlineFeedback, 350),
    headlineOptions: headlineOptions.slice(0, 5).map((item) => sanitizeText(item, 140)).filter(Boolean),
    recommendations: recommendations
      .slice(0, 6)
      .map((item) => ({
        category: recommendationCategories.has(item?.category) ? item.category : "Editorial",
        priority: recommendationPriorities.has(item?.priority) ? item.priority : "Medium",
        title: sanitizeText(item?.title, 120),
        detail: sanitizeText(item?.detail, 420),
        impact: sanitizeText(item?.impact, 180)
      }))
      .filter((item) => item.title && item.detail),
    checklist: checklist
      .slice(0, 7)
      .map((item) => ({
        label: sanitizeText(item?.label, 120),
        done: Boolean(item?.done),
        detail: sanitizeText(item?.detail, 260)
      }))
      .filter((item) => item.label && item.detail),
    seo: {
      score: Math.round(clampNumber(value.seo?.score, 0, 10, 5)),
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
    evidence: evidence
      .slice(0, 6)
      .map((item) => ({
        label: sanitizeText(item?.label, 80),
        detail: sanitizeText(item?.detail, 260),
        source: ["Historical data", "Draft analysis", "AI inference"].includes(item?.source) ? item.source : "AI inference"
      }))
      .filter((item) => item.label && item.detail)
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
        Authorization: `Bearer ${apiKey}`,
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
        // Keep the generic message.
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

function safeErrorMessage(error) {
  if (error?.name === "AbortError") return "Request timed out";
  const message = String(error?.message || "Request failed").replace(/sk-[A-Za-z0-9_-]+/g, "[secret removed]");
  if (/quota|billing|insufficient|credits/i.test(message)) return "OpenAI billing or quota blocked the AI review.";
  if (/401|api key|unauthorized/i.test(message)) return "OpenAI authentication failed.";
  return message;
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (!String(req.headers["content-type"] || "").includes("application/json")) {
      sendJson(res, 415, { error: "Expected application/json" });
      return;
    }
    const body = await readJsonBody(req);
    const payload = validatePayload(body);
    const review = await callOpenAi(payload);
    sendJson(res, 200, review);
  } catch (error) {
    const status = error?.name === "AbortError" ? 504 : error?.message?.includes("too large") ? 413 : 400;
    sendJson(res, status, { error: safeErrorMessage(error) });
  }
}
