import type {
  DraftRewrite,
  DraftRecommendation,
  DraftReviewInput,
  DraftReviewResult,
  DraftStats,
  EditorChecklistItem,
  PatternEvidence,
  SeoReview,
  TrendReview,
  WatchtowerRecord
} from "../types";
import { computePrediction, formatNumber } from "./prediction";

function words(text: string): string[] {
  return text.trim().match(/[A-Za-z0-9'’-]+/g) || [];
}

function sentenceList(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 0;
  const groups = cleaned.match(/[aeiouy]+/g)?.length || 1;
  return cleaned.endsWith("e") && groups > 1 ? groups - 1 : groups;
}

function countHeadings(text: string): number {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 72 && !/[.!?]$/.test(line))
    .length;
}

export function analyzeDraftText(text: string): DraftStats {
  const wordList = words(text);
  const sentences = sentenceList(text);
  const paragraphCount = text.split(/\n\s*\n/).filter((paragraph) => words(paragraph).length > 0).length || (text.trim() ? 1 : 0);
  const sentenceCount = Math.max(1, sentences.length || 1);
  const syllables = wordList.reduce((sum, word) => sum + countSyllables(word), 0);
  const wordCount = wordList.length;
  const averageSentenceLength = wordCount / sentenceCount;
  const readingEase =
    wordCount > 0 ? 206.835 - 1.015 * averageSentenceLength - 84.6 * (syllables / Math.max(1, wordCount)) : 0;
  const gradeLevel =
    wordCount > 0 ? 0.39 * averageSentenceLength + 11.8 * (syllables / Math.max(1, wordCount)) - 15.59 : 0;

  return {
    wordCount,
    sentenceCount,
    paragraphCount,
    headingCount: countHeadings(text),
    averageSentenceLength: Math.round(averageSentenceLength * 10) / 10,
    readingEase: Math.round(readingEase * 10) / 10,
    gradeLevel: Math.max(0, Math.round(gradeLevel * 10) / 10)
  };
}

function headlineScore(title: string): { score: number; feedback: string } {
  const titleWords = words(title);
  let score = 4;
  if (titleWords.length >= 6 && titleWords.length <= 14) score += 3;
  if (/\d/.test(title)) score += 0.5;
  if (/\b(new|shows|finds|launches|opens|expands|improves|helps|wins|reveals)\b/i.test(title)) score += 1.5;
  if (/\b(thing|stuff|update|news)\b/i.test(title)) score -= 1;
  if (titleWords.length > 18) score -= 1;
  if (titleWords.length > 0 && titleWords.length < 5) score -= 1.5;
  const rounded = Math.max(1, Math.min(10, Math.round(score)));
  const feedback =
    rounded >= 8
      ? "Strong headline: specific enough for scanning and search."
      : "Make the headline more concrete by naming the outcome, audience, or research finding.";
  return { score: rounded, feedback };
}

function topHistoricalWordCount(records: WatchtowerRecord[]): number {
  const rows = records
    .filter((record) => record.metrics30?.pageviews && record.wordCount > 0)
    .sort((a, b) => Number(b.metrics30?.pageviews || 0) - Number(a.metrics30?.pageviews || 0));
  const top = rows.slice(0, Math.max(5, Math.ceil(rows.length * 0.25)));
  if (!top.length) return 850;
  const values = top.map((record) => record.wordCount).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] || 850;
}

function firstParagraph(text: string): string {
  return text.split(/\n\s*\n/).find((paragraph) => words(paragraph).length > 0)?.trim() || text.trim();
}

function cleanString(value: unknown, fallback: string, limit = 500): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
}

function cleanStringArray(value: unknown, fallback: string[], limit = 5, itemLimit = 180): string[] {
  const source = Array.isArray(value) ? value : fallback;
  const clean = source.map((item) => cleanString(item, "", itemLimit)).filter(Boolean);
  return clean.length ? clean.slice(0, limit) : fallback.slice(0, limit);
}

function uniqueItems(items: string[], limit: number): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function topicLabel(input: DraftReviewInput): string {
  return input.topic && input.topic !== "General" ? input.topic : "this story";
}

function publicInterestAngle(topic: string): string {
  const normalized = topic.toLowerCase();
  if (/health|medicine|wellness/.test(normalized)) return "health access, prevention, patient outcomes, or community well-being";
  if (/sustainability|climate|water|energy|environment/.test(normalized)) return "climate resilience, water, energy costs, or practical community impact";
  if (/technology|engineering|ai|data|cyber/.test(normalized)) return "trust, workforce readiness, responsible technology, or everyday problem solving";
  if (/student|education|learning/.test(normalized)) return "student opportunity, career readiness, affordability, or learning outcomes";
  if (/business|startup|economic/.test(normalized)) return "jobs, entrepreneurship, local economy, or industry need";
  if (/research|science|lab/.test(normalized)) return "what the discovery changes, who benefits, and why the work matters outside the lab";
  return "the reader problem, affected audience, public benefit, or timing hook";
}

function keywordOpportunities(input: DraftReviewInput): string[] {
  const stopWords = new Set(["about", "after", "from", "into", "new", "this", "that", "with", "your", "asu", "the", "and", "for"]);
  const titleKeywords = words(input.title)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 4 && !stopWords.has(word))
    .slice(0, 4);
  const topic = input.topic && input.topic !== "General" ? input.topic.toLowerCase() : "";
  return uniqueItems(
    [
      topic,
      topic ? `${topic} research` : "",
      topic ? `${topic} impact` : "",
      ...titleKeywords,
      "ASU research impact",
      "Arizona State University"
    ],
    6
  );
}

function buildSeoReview(input: DraftReviewInput, stats: DraftStats, headline: { score: number; feedback: string }): SeoReview {
  const keywords = keywordOpportunities(input);
  const titleCount = words(input.title).length;
  let score = headline.score;
  if (keywords.some((keyword) => input.title.toLowerCase().includes(keyword.split(" ")[0]))) score += 1;
  if (stats.wordCount > 250) score += 1;
  if (firstParagraph(input.draftText).length > 0 && words(firstParagraph(input.draftText)).length <= 80) score += 1;
  score = Math.max(1, Math.min(10, Math.round(score)));

  const titleGuidance =
    titleCount === 0
      ? "Add a searchable headline that names the topic, audience, and outcome."
      : titleCount > 16
        ? "Tighten the headline so the main searchable phrase appears earlier."
        : "Keep the searchable topic and reader benefit near the front of the headline.";

  return {
    score,
    summary:
      score >= 8
        ? "The draft has a clear search foundation. Strengthen it by repeating the main topic naturally in the headline, lead, and subheads."
        : "The draft needs a clearer search promise. Make the topic, audience, and public value easier to identify in the headline and opening paragraph.",
    keywordOpportunities: keywords,
    titleGuidance,
    metaDescription: `${input.title.trim() || "ASU story"} connects ${topicLabel(input).toLowerCase()} to ${publicInterestAngle(input.topic)}.`
      .replace(/\s+/g, " ")
      .slice(0, 155)
  };
}

function buildTrendReview(input: DraftReviewInput): TrendReview {
  const angle = publicInterestAngle(input.topic);
  const topic = topicLabel(input);
  return {
    summary: `Frame ${topic.toLowerCase()} around ${angle}. That gives the story a stronger relevance hook before the technical details.`,
    opportunities: uniqueItems(
      [
        `Name the current reader problem or decision this ${topic.toLowerCase()} story helps explain.`,
        "Move the public-impact angle into the headline, deck, or first two paragraphs.",
        "Add a plain-language sentence that connects the work to students, communities, industry, or policy.",
        input.hasImages ? "Use the visual caption to reinforce the timely angle." : "Add a visual that makes the relevance angle easier to understand."
      ],
      4
    ),
    caveat: "This is AI/editorial trend framing until GA4 and Search Console trend data are connected."
  };
}

function technicalSimplifications(text: string): string[] {
  const terms = [
    "methodology",
    "framework",
    "utilize",
    "leveraging",
    "scalable",
    "interdisciplinary",
    "translational",
    "computational",
    "infrastructure",
    "optimization",
    "paradigm",
    "algorithmic",
    "stakeholders",
    "implementation",
    "significant"
  ];
  const lower = text.toLowerCase();
  const found = terms
    .filter((term) => lower.includes(term))
    .map((term) => `Explain "${term}" in plain language or replace it with a simpler phrase.`);
  return found.length
    ? found.slice(0, 4)
    : [
        "Look for technical phrases that a general reader may not use and explain why each one matters.",
        "Replace process-heavy wording with the people, problem, or outcome affected by the work."
      ];
}

function buildDraftRewrite(input: DraftReviewInput, stats: DraftStats): DraftRewrite {
  const topic = topicLabel(input).toLowerCase();
  const keywords = keywordOpportunities(input).slice(0, 3).join(", ");
  const leadRewrite =
    stats.wordCount === 0
      ? `Start with who benefits from ${topic}, what changed, and why it matters now.`
      : `${input.title.trim() || "This ASU story"} matters because it connects ${topic} to ${publicInterestAngle(input.topic)}. Lead with that reader value first, then bring in the technical details.`;

  return {
    leadRewrite,
    simplify: technicalSimplifications(input.draftText),
    concreteEdits: uniqueItems(
      [
        "Move the strongest public-impact sentence into the first 45-65 words.",
        keywords ? `Work these phrases in naturally where accurate: ${keywords}.` : "",
        stats.wordCount > 700 && stats.headingCount === 0 ? "Add 2-3 subheads that name the main reader questions." : "",
        input.hasImages ? "Make sure the caption explains the story value, not just who is pictured." : "Add a photo, chart, or visual explainer before publishing.",
        "Close with a forward-looking detail: what happens next, who can use this work, or what question remains."
      ],
      5
    )
  };
}

function buildEvidence(input: DraftReviewInput, stats: DraftStats, records: WatchtowerRecord[], prediction: DraftReviewResult["prediction"]): PatternEvidence[] {
  const evidence: PatternEvidence[] = [
    {
      label: "Prediction basis",
      detail:
        prediction.source === "historical-model"
          ? `Uses ${prediction.trainingRows.toLocaleString()} historical rows with 30-day performance data.`
          : "Uses a baseline estimate until more historical rows are imported.",
      source: "Historical data"
    },
    {
      label: "Draft readability",
      detail: `${stats.wordCount.toLocaleString()} words, grade ${stats.gradeLevel}, average sentence length ${stats.averageSentenceLength} words.`,
      source: "Draft analysis"
    },
    {
      label: "SEO focus",
      detail: `Primary keyword opportunities include ${keywordOpportunities(input).slice(0, 3).join(", ")}.`,
      source: "Draft analysis"
    }
  ];

  prediction.drivers.slice(0, 2).forEach((driver) => {
    evidence.push({ label: "Historical pattern", detail: driver, source: "Historical data" });
  });

  prediction.similarRecords.slice(0, 2).forEach((record) => {
    evidence.push({
      label: "Similar story",
      detail: `${record.title} reached ${formatNumber(record.metrics30?.pageviews)} 30-day pageviews.`,
      source: "Historical data"
    });
  });

  if (!records.some((record) => record.metrics30?.pageviews)) {
    evidence.push({
      label: "Data gap",
      detail: "Import more performance rows before treating recommendations as model-backed.",
      source: "Historical data"
    });
  }

  return evidence.slice(0, 6);
}

const AI_REVIEW_TIMEOUT_MS = 60000;
const MAX_AI_DRAFT_CHARS = 16000;

function sanitizeTextForAi(value: string, limit = 4000): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/\b\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]")
    .replace(/\b\d{10}\b/g, "[id removed]")
    .replace(/\b[A-Z]{2,}\d{2,}\b/g, "[identifier removed]")
    .trim()
    .slice(0, limit);
}

function isSafeAiEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith("/")) return endpoint.startsWith("/api/");
  try {
    const url = new URL(endpoint);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return url.protocol === "https:" || (import.meta.env.DEV && local && url.protocol === "http:");
  } catch {
    return false;
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cleanRecommendations(value: Partial<DraftReviewResult>, fallback: DraftReviewResult): DraftRecommendation[] {
  const source = Array.isArray(value.recommendations) ? value.recommendations : fallback.recommendations;
  return source
    .slice(0, 6)
    .map((item) => ({
      category: ["Headline", "Readability", "Structure", "Performance", "Editorial"].includes(item.category)
        ? item.category
        : "Editorial",
      priority: ["High", "Medium", "Low"].includes(item.priority) ? item.priority : "Medium",
      title: String(item.title || "Review this section").slice(0, 120),
      detail: String(item.detail || "Use editor judgment before publishing.").slice(0, 420),
      impact: String(item.impact || "Supports editorial quality").slice(0, 180)
    }));
}

function cleanSeoReview(value: Partial<SeoReview> | undefined, fallback: SeoReview): SeoReview {
  return {
    score: clamp(value?.score, 0, 10, fallback.score),
    summary: cleanString(value?.summary, fallback.summary, 500),
    keywordOpportunities: cleanStringArray(value?.keywordOpportunities, fallback.keywordOpportunities, 6, 80),
    titleGuidance: cleanString(value?.titleGuidance, fallback.titleGuidance, 300),
    metaDescription: cleanString(value?.metaDescription, fallback.metaDescription, 180)
  };
}

function cleanTrendReview(value: Partial<TrendReview> | undefined, fallback: TrendReview): TrendReview {
  return {
    summary: cleanString(value?.summary, fallback.summary, 500),
    opportunities: cleanStringArray(value?.opportunities, fallback.opportunities, 4, 220),
    caveat: cleanString(value?.caveat, fallback.caveat, 220)
  };
}

function cleanDraftRewrite(value: Partial<DraftRewrite> | undefined, fallback: DraftRewrite): DraftRewrite {
  return {
    leadRewrite: cleanString(value?.leadRewrite, fallback.leadRewrite, 700),
    simplify: cleanStringArray(value?.simplify, fallback.simplify, 5, 220),
    concreteEdits: cleanStringArray(value?.concreteEdits, fallback.concreteEdits, 6, 240)
  };
}

function cleanEvidence(value: unknown, fallback: PatternEvidence[]): PatternEvidence[] {
  const source = Array.isArray(value) ? value : fallback;
  const clean = source
    .slice(0, 6)
    .map((item) => {
      const evidence = item as Partial<PatternEvidence>;
      const evidenceSource = ["Historical data", "Draft analysis", "AI inference"].includes(String(evidence.source))
        ? (evidence.source as PatternEvidence["source"])
        : "Draft analysis";
      return {
        label: cleanString(evidence.label, "Review signal", 80),
        detail: cleanString(evidence.detail, "Use editor judgment before publishing.", 260),
        source: evidenceSource
      };
    })
    .filter((item) => item.label && item.detail);
  return clean.length ? clean : fallback;
}

function mergeAiReview(localReview: DraftReviewResult, aiReview: Partial<DraftReviewResult>): DraftReviewResult {
  const readinessLabel = ["Ready", "Needs edits", "Needs major work"].includes(String(aiReview.readinessLabel))
    ? (aiReview.readinessLabel as DraftReviewResult["readinessLabel"])
    : localReview.readinessLabel;
  const headlineOptions = Array.isArray(aiReview.headlineOptions) && aiReview.headlineOptions.length
    ? aiReview.headlineOptions.slice(0, 5).map((item) => String(item).slice(0, 140))
    : localReview.headlineOptions;
  const checklist = Array.isArray(aiReview.checklist) && aiReview.checklist.length
    ? aiReview.checklist.slice(0, 7).map((item) => ({
        label: String(item.label || "Review item").slice(0, 120),
        done: Boolean(item.done),
        detail: String(item.detail || "Confirm before publication.").slice(0, 260)
      }))
    : localReview.checklist;

  return {
    ...localReview,
    source: "ai-model",
    summary: typeof aiReview.summary === "string" && aiReview.summary.trim() ? aiReview.summary.slice(0, 500) : localReview.summary,
    readinessScore: clamp(aiReview.readinessScore, 0, 100, localReview.readinessScore),
    readinessLabel,
    headlineScore: clamp(aiReview.headlineScore, 0, 10, localReview.headlineScore),
    headlineFeedback:
      typeof aiReview.headlineFeedback === "string" && aiReview.headlineFeedback.trim()
        ? aiReview.headlineFeedback.slice(0, 350)
        : localReview.headlineFeedback,
    headlineOptions,
    recommendations: cleanRecommendations(aiReview, localReview),
    checklist,
    seo: cleanSeoReview(aiReview.seo as Partial<SeoReview> | undefined, localReview.seo),
    trend: cleanTrendReview(aiReview.trend as Partial<TrendReview> | undefined, localReview.trend),
    rewrite: cleanDraftRewrite(aiReview.rewrite as Partial<DraftRewrite> | undefined, localReview.rewrite),
    evidence: cleanEvidence(aiReview.evidence, localReview.evidence),
    prediction: localReview.prediction,
    stats: localReview.stats
  };
}

function buildAiReviewPayload(input: DraftReviewInput, localReview: DraftReviewResult) {
  return {
    input: {
      title: sanitizeTextForAi(input.title, 220),
      topic: sanitizeTextForAi(input.topic, 80),
      plannedDate: input.plannedDate,
      wordCount: input.wordCount,
      hasImages: input.hasImages,
      length: input.length,
      draftText: sanitizeTextForAi(input.draftText, MAX_AI_DRAFT_CHARS)
    },
    localReview: {
      readinessScore: localReview.readinessScore,
      readinessLabel: localReview.readinessLabel,
      summary: localReview.summary,
      stats: localReview.stats,
      headlineScore: localReview.headlineScore,
      headlineFeedback: localReview.headlineFeedback,
      headlineOptions: localReview.headlineOptions,
      recommendations: localReview.recommendations,
      checklist: localReview.checklist,
      seo: localReview.seo,
      trend: localReview.trend,
      rewrite: localReview.rewrite,
      evidence: localReview.evidence,
      prediction: {
        pred30: localReview.prediction.pred30,
        pred90: localReview.prediction.pred90,
        className: localReview.prediction.className,
        confidence: localReview.prediction.confidence,
        source: localReview.prediction.source,
        trainingRows: localReview.prediction.trainingRows,
        drivers: localReview.prediction.drivers
      }
    }
  };
}

function buildHeadlineOptions(input: DraftReviewInput): string[] {
  const title = input.title.trim();
  const topic = input.topic && input.topic !== "General" ? input.topic.toLowerCase() : "the story";
  if (!title) {
    return [
      `New ${topic} story highlights impact for ASU readers`,
      `What to know about this ${topic} development`,
      `How this ${topic} work could affect the wider community`
    ];
  }
  return [
    `${title}: what readers need to know`,
    `How ${title.charAt(0).toLowerCase()}${title.slice(1)} could shape ${topic}`,
    `${title} shows new impact for ASU and beyond`
  ];
}

function addRecommendation(
  list: DraftRecommendation[],
  category: DraftRecommendation["category"],
  priority: DraftRecommendation["priority"],
  title: string,
  detail: string,
  impact: string
) {
  list.push({ category, priority, title, detail, impact });
}

function buildRecommendations(input: DraftReviewInput, stats: DraftStats, records: WatchtowerRecord[]): DraftRecommendation[] {
  const recommendations: DraftRecommendation[] = [];
  const targetWordCount = topHistoricalWordCount(records);
  const leadWords = words(firstParagraph(input.draftText)).length;
  const title = headlineScore(input.title);

  if (!stats.wordCount) {
    addRecommendation(
      recommendations,
      "Editorial",
      "High",
      "Add the draft text",
      "Paste the full draft so the review can evaluate readability, structure, and editorial readiness.",
      "Required before editorial review"
    );
    return recommendations;
  }

  if (title.score < 8) {
    addRecommendation(
      recommendations,
      "Headline",
      "High",
      "Make the headline more specific",
      "Add the concrete finding, benefit, audience, or action. Strong headlines in this workflow are easier to scan and search.",
      "Improves search and click clarity"
    );
  }

  if (stats.readingEase < 50 || stats.averageSentenceLength > 24) {
    addRecommendation(
      recommendations,
      "Readability",
      "High",
      "Simplify dense passages",
      `Average sentence length is ${stats.averageSentenceLength} words and reading ease is ${stats.readingEase}. Break up long sentences and reduce jargon.`,
      "Helps general readers move faster"
    );
  }

  if (leadWords > 85) {
    addRecommendation(
      recommendations,
      "Structure",
      "Medium",
      "Tighten the lead",
      `The opening paragraph is about ${leadWords} words. Try getting the key public impact into the first 45-65 words.`,
      "Improves editor scan time"
    );
  }

  if (stats.wordCount > 700 && stats.headingCount === 0) {
    addRecommendation(
      recommendations,
      "Structure",
      "Medium",
      "Add scannable subheads",
      "Longer stories are easier to edit and read when the main sections are clearly labeled.",
      "Improves readability before review"
    );
  }

  if (!input.hasImages) {
    addRecommendation(
      recommendations,
      "Performance",
      "Medium",
      "Add a visual before publishing",
      "The story is marked as having no images. A photo, chart, or strong visual can make the item easier to promote.",
      "Supports engagement and social packaging"
    );
  }

  if (Math.abs(stats.wordCount - targetWordCount) > 220) {
    const direction = stats.wordCount < targetWordCount ? "expand" : "tighten";
    addRecommendation(
      recommendations,
      "Performance",
      "Low",
      `${direction === "expand" ? "Add useful depth" : "Tighten length"}`,
      `Top historical performers cluster around ${targetWordCount.toLocaleString()} words. This draft is ${stats.wordCount.toLocaleString()} words.`,
      "Aligns draft with historical patterns"
    );
  }

  return recommendations.slice(0, 6);
}

function checklist(input: DraftReviewInput, stats: DraftStats): EditorChecklistItem[] {
  const lead = firstParagraph(input.draftText);
  return [
    {
      label: "Headline names a concrete outcome",
      done: headlineScore(input.title).score >= 8,
      detail: "Specific headlines usually work better for editors, search, and audience scanning."
    },
    {
      label: "Lead explains why readers should care",
      done: /\b(impact|because|helps|means|could|will|community|students|research|health|future)\b/i.test(lead),
      detail: "The first paragraph should quickly explain the value or consequence."
    },
    {
      label: "Draft is readable for a broad audience",
      done: stats.wordCount > 0 && stats.readingEase >= 50 && stats.averageSentenceLength <= 24,
      detail: "Aim for shorter sentences and plain-language explanations where possible."
    },
    {
      label: "Structure supports quick editing",
      done: stats.wordCount < 700 || stats.headingCount > 0 || stats.paragraphCount >= 5,
      detail: "Use clear paragraph breaks and subheads for longer drafts."
    },
    {
      label: "Visual package is ready",
      done: input.hasImages,
      detail: "Confirm photos, captions, charts, or other visuals are ready before public release."
    }
  ];
}

function scoreReadiness(
  input: DraftReviewInput,
  stats: DraftStats,
  recommendations: DraftRecommendation[],
  predictionClass: "High" | "Medium" | "Low"
): number {
  let score = 40;
  const headline = headlineScore(input.title).score;
  score += headline * 2;
  if (stats.wordCount > 0) score += 8;
  if (stats.readingEase >= 60) score += 14;
  else if (stats.readingEase >= 50) score += 10;
  else if (stats.readingEase >= 40) score += 5;
  if (stats.averageSentenceLength <= 22 && stats.wordCount > 0) score += 6;
  if (stats.paragraphCount >= 4) score += 4;
  if (stats.headingCount > 0 || stats.wordCount < 700) score += 4;
  if (input.hasImages) score += 5;
  if (predictionClass === "High") score += 5;
  if (predictionClass === "Low") score -= 5;
  score -= recommendations.filter((item) => item.priority === "High").length * 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function configuredAiEndpoint(): string {
  return import.meta.env.VITE_AI_REVIEW_ENDPOINT || (import.meta.env.PROD ? "/api/review-draft" : "");
}

export function aiReviewEnabled(): boolean {
  const endpoint = configuredAiEndpoint();
  return Boolean(endpoint && isSafeAiEndpoint(endpoint));
}

function safeAiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "AI connector was unavailable.";
  if (error.name === "AbortError") return "AI connector timed out.";
  const message = error.message.replace(/sk-[A-Za-z0-9_-]+/g, "[secret removed]");
  if (/no credits remaining/i.test(message)) return "OpenAI has no credits remaining, so the local editorial review was used.";
  if (/quota|billing|insufficient/i.test(message)) return "OpenAI billing or quota blocked the AI review, so the local editorial review was used.";
  if (/401|api key|unauthorized/i.test(message)) return "OpenAI authentication failed, so the local editorial review was used.";
  return "AI connector was unavailable, so the local editorial review was used.";
}

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error || `AI connector returned ${response.status}`);
  } catch {
    return new Error(`AI connector returned ${response.status}`);
  }
}

export function computeLocalDraftReview(input: DraftReviewInput, records: WatchtowerRecord[]): DraftReviewResult {
  const stats = analyzeDraftText(input.draftText);
  const prediction = computePrediction({ ...input, wordCount: stats.wordCount || input.wordCount }, records);
  const recommendations = buildRecommendations(input, stats, records);
  const headline = headlineScore(input.title);
  const readinessScore = scoreReadiness(input, stats, recommendations, prediction.className);
  const readinessLabel =
    readinessScore >= 82 ? "Ready" : readinessScore >= 58 ? "Needs edits" : "Needs major work";
  const seo = buildSeoReview(input, stats, headline);
  const trend = buildTrendReview(input);
  const rewrite = buildDraftRewrite(input, stats);

  return {
    source: "local-editorial-model",
    readinessScore,
    readinessLabel,
    summary:
      readinessLabel === "Ready"
        ? "This draft is close to publication review. Use the checklist for final polish."
        : "This draft can move faster with a few targeted edits before public review.",
    stats,
    prediction,
    headlineScore: headline.score,
    headlineFeedback: headline.feedback,
    headlineOptions: buildHeadlineOptions(input),
    recommendations,
    checklist: checklist(input, stats),
    seo,
    trend,
    rewrite,
    evidence: buildEvidence(input, stats, records, prediction)
  };
}

export async function runDraftReview(input: DraftReviewInput, records: WatchtowerRecord[]): Promise<DraftReviewResult> {
  const localReview = computeLocalDraftReview(input, records);
  const endpoint = configuredAiEndpoint();
  if (!endpoint || !isSafeAiEndpoint(endpoint)) return localReview;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AI_REVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiReviewPayload(input, localReview)),
      signal: controller.signal
    });
    if (!response.ok) throw await responseError(response);
    const aiReview = (await response.json()) as Partial<DraftReviewResult>;
    return mergeAiReview(localReview, aiReview);
  } catch (error) {
    throw new Error(safeAiErrorMessage(error));
  } finally {
    window.clearTimeout(timeout);
  }
}

export function recommendationImpactText(result: DraftReviewResult): string {
  const top = result.recommendations[0];
  if (!top) return `Estimated ${formatNumber(result.prediction.pred30)} 30-day pageviews.`;
  return `${top.priority} priority: ${top.title}`;
}
