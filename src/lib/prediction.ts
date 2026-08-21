import type { PerformanceMetrics, PredictionInput, PredictionResult, WatchtowerRecord } from "../types";

const topicKeywords: Record<string, string[]> = {
  Research: ["research", "study", "science", "discover", "lab", "experiment", "innovation", "finding", "analysis"],
  Health: ["health", "medical", "medicine", "wellness", "cancer", "disease", "brain", "mental", "care"],
  Community: ["community", "volunteer", "service", "impact", "social", "civic", "partnership"],
  Students: ["student", "undergrad", "graduate", "scholarship", "award", "fellowship", "alumni"],
  Arts: ["arts", "music", "theater", "film", "gallery", "creative", "design", "museum"],
  Sports: ["sport", "athletic", "basketball", "football", "baseball", "soccer", "championship"],
  Business: ["business", "entrepreneur", "startup", "economic", "finance", "industry", "venture"],
  Technology: ["technology", "tech", "engineering", "software", "computer", "digital", "cyber", "robot", "ai", "data"],
  Global: ["global", "international", "world", "foreign", "ambassador", "abroad"],
  Sustainability: ["sustainability", "environment", "climate", "green", "solar", "energy", "carbon", "water", "earth"],
  Education: ["education", "teaching", "learning", "curriculum", "faculty", "professor", "school"]
};

export function deriveTopicFromUrl(url: string): string {
  const slug = url.trim().split("?")[0].replace(/\/$/, "").split("/").pop()?.toLowerCase().replace(/[-_]/g, " ") || "";
  if (!slug) return "General";
  const words = slug.split(/\s+/);
  const scored = Object.entries(topicKeywords)
    .map(([topic, keywords]) => {
      const score = keywords.reduce((sum, keyword) => {
        const matched = keyword.length <= 3 ? words.includes(keyword) : slug.includes(keyword);
        return matched ? sum + keyword.length : sum;
      }, 0);
      return { topic, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].topic : "General";
}

function pageviews(record: WatchtowerRecord): number {
  return Number(record.metrics30?.pageviews || 0);
}

function median(values: number[]): number {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function mean(values: number[]): number {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function quantile(values: number[], q: number): number {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const index = Math.min(clean.length - 1, Math.max(0, Math.floor((clean.length - 1) * q)));
  return clean[index];
}

function clip(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clippedRatio(numerator: number, denominator: number, low: number, high: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 1;
  return clip(numerator / denominator, low, high);
}

function metricRatio(records: WatchtowerRecord[], horizon: "metrics30" | "metrics90", metric: keyof PerformanceMetrics) {
  const ratios = records
    .map((record) => {
      const pv = record[horizon]?.pageviews;
      const value = record[horizon]?.[metric];
      return pv && value && pv > 0 ? Number(value) / pv : undefined;
    })
    .filter((value): value is number => Number.isFinite(value));
  return median(ratios);
}

function deriveMetrics(records: WatchtowerRecord[], pageviewEstimate: number, horizon: "metrics30" | "metrics90"): PerformanceMetrics {
  const engagementValues = records
    .map((record) => record[horizon]?.engagementSeconds)
    .filter((value): value is number => Number.isFinite(value));
  const bounceValues = records
    .map((record) => record[horizon]?.bounceRate)
    .filter((value): value is number => Number.isFinite(value));

  return {
    users: pageviewEstimate * (metricRatio(records, horizon, "users") || 0.78),
    sessions: pageviewEstimate * (metricRatio(records, horizon, "sessions") || 0.9),
    pageviews: pageviewEstimate,
    engagementSeconds: median(engagementValues) || 35,
    bounceRate: median(bounceValues) || 40
  };
}

function selectTrainingRows(records: WatchtowerRecord[], input: PredictionInput): WatchtowerRecord[] {
  const rows = records.filter((record) => pageviews(record) > 0);
  const topicRows = rows.filter((record) => record.topic === input.topic || record.sra === input.topic);
  return topicRows.length >= 8 ? topicRows : rows;
}

function similarRows(records: WatchtowerRecord[], input: PredictionInput): WatchtowerRecord[] {
  return records
    .filter((record) => pageviews(record) > 0)
    .map((record) => {
      const topicMatch = record.topic === input.topic || record.sra === input.topic ? 0 : 1;
      const imagePenalty = record.hasImages === input.hasImages ? 0 : 0.5;
      const lengthPenalty = record.length === input.length ? 0 : 0.4;
      const wordPenalty = Math.abs((record.wordCount || 800) - input.wordCount) / 1200;
      return { record, score: topicMatch + imagePenalty + lengthPenalty + wordPenalty };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((item) => item.record);
}

export function computePrediction(input: PredictionInput, records: WatchtowerRecord[]): PredictionResult {
  const allRows = records.filter((record) => pageviews(record) > 0);
  const trainingRows = selectTrainingRows(records, input);
  const drivers: string[] = [];
  let pred30 = median(trainingRows.map(pageviews)) || 1000;

  const wordRows = trainingRows.filter((record) => record.wordCount > 0);
  if (wordRows.length >= 5) {
    const highCut = quantile(wordRows.map(pageviews), 0.75);
    const topWordCount = median(wordRows.filter((record) => pageviews(record) >= highCut).map((record) => record.wordCount));
    const lowWordCount = quantile(wordRows.map((record) => record.wordCount), 0.2);
    const highWordCount = quantile(wordRows.map((record) => record.wordCount), 0.8);
    if (input.wordCount < lowWordCount) {
      pred30 *= 0.9;
      drivers.push("Shorter than most historical performers");
    } else if (input.wordCount > highWordCount) {
      pred30 *= 0.96;
      drivers.push("Longer than most historical performers");
    } else {
      const distance = Math.abs(input.wordCount - topWordCount);
      pred30 *= clip(1.08 - (distance / Math.max(topWordCount, 600)) * 0.08, 0.95, 1.08);
      drivers.push(`Word count near the historical sweet spot (${Math.round(topWordCount).toLocaleString()} words)`);
    }
  }

  const imageRows = trainingRows.filter((record) => typeof record.hasImages === "boolean");
  const imageYes = imageRows.filter((record) => record.hasImages).map(pageviews);
  const imageNo = imageRows.filter((record) => !record.hasImages).map(pageviews);
  if (imageYes.length >= 3 && imageNo.length >= 3) {
    const factor = input.hasImages
      ? clippedRatio(mean(imageYes), mean(imageNo), 0.9, 1.18)
      : clippedRatio(mean(imageNo), mean(imageYes), 0.88, 1.1);
    pred30 *= factor;
    drivers.push(input.hasImages ? "Image-backed stories are included in the comparison" : "No images selected");
  } else {
    pred30 *= input.hasImages ? 1.04 : 0.97;
  }

  const longRows = trainingRows.filter((record) => record.length === "Long").map(pageviews);
  const shortRows = trainingRows.filter((record) => record.length === "Short").map(pageviews);
  if (longRows.length >= 3 && shortRows.length >= 3) {
    const factor = input.length === "Long"
      ? clippedRatio(mean(longRows), mean(shortRows), 0.9, 1.15)
      : clippedRatio(mean(shortRows), mean(longRows), 0.88, 1.08);
    pred30 *= factor;
    drivers.push(`${input.length} format compared with similar historical stories`);
  }

  const date = new Date(`${input.plannedDate}T12:00:00`);
  if (!Number.isNaN(date.getTime())) {
    const month = date.getMonth();
    const day = date.getDay();
    const overall = mean(trainingRows.map(pageviews));
    const monthRows = trainingRows.filter((record) => new Date(`${record.plannedDate}T12:00:00`).getMonth() === month);
    const dayRows = trainingRows.filter((record) => new Date(`${record.plannedDate}T12:00:00`).getDay() === day);
    if (monthRows.length >= 3 && overall > 0) pred30 *= clippedRatio(mean(monthRows.map(pageviews)), overall, 0.94, 1.08);
    if (dayRows.length >= 3 && overall > 0) pred30 *= clippedRatio(mean(dayRows.map(pageviews)), overall, 0.9, 1.12);
  }

  const titleWords = input.title.trim().split(/\s+/).filter(Boolean).length;
  if (titleWords > 0 && titleWords < 6) pred30 *= 0.97;
  if (titleWords >= 6 && titleWords <= 12) pred30 *= 1.03;
  if (titleWords > 18) pred30 *= 0.96;

  pred30 = Math.max(100, Math.round(pred30));
  const ratios90 = allRows
    .map((record) =>
      record.metrics30?.pageviews && record.metrics90?.pageviews
        ? record.metrics90.pageviews / record.metrics30.pageviews
        : undefined
    )
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const pred90 = Math.round(pred30 * clip(median(ratios90) || 1.35, 1, 2.5));

  const allPageviews = allRows.map(pageviews);
  const highCut = quantile(allPageviews, 0.75) || 1600;
  const midCut = quantile(allPageviews, 0.45) || 900;
  const className = pred30 >= highCut ? "High" : pred30 >= midCut ? "Medium" : "Low";
  const confidence = allRows.length >= 30 ? 0.78 : allRows.length >= 8 ? 0.58 : 0.42;
  const spread = pred30 * (allRows.length >= 30 ? 0.18 : 0.28);

  return {
    pred30,
    pred90,
    className,
    confidence,
    interval: [Math.max(0, Math.round(pred30 - 1.64 * spread)), Math.round(pred30 + 1.64 * spread)],
    source: allRows.length >= 5 ? "historical-model" : "baseline",
    trainingRows: allRows.length,
    drivers: drivers.slice(0, 4),
    metrics30: deriveMetrics(allRows, pred30, "metrics30"),
    metrics90: deriveMetrics(allRows, pred90, "metrics90"),
    similarRecords: similarRows(allRows, input)
  };
}

export function formatNumber(value?: number): string {
  return Number.isFinite(value) ? Math.round(Number(value)).toLocaleString() : "-";
}

export function formatPercent(value?: number): string {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : "-";
}

export function formatDuration(value?: number): string {
  if (!Number.isFinite(value)) return "-";
  const seconds = Math.max(0, Math.round(Number(value)));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
