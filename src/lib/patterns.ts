import type { WatchtowerRecord } from "../types";
import { isSampleRecord } from "./sampleData";

export type PatternDateRange = "All" | "Last 90 days" | "Last 12 months";
export type PatternPerformanceBand = "All" | "High" | "Medium" | "Low" | "No performance data";

export interface PatternFilters {
  topic: string;
  sra: string;
  dateRange: PatternDateRange;
  performanceBand: PatternPerformanceBand;
}

export interface PatternGroup {
  label: string;
  records: number;
  median30: number;
  median90: number;
  avgEngagement: number;
  avgBounce: number;
  growth: number;
  share: number;
}

export interface PatternReport {
  records: WatchtowerRecord[];
  performanceRows: WatchtowerRecord[];
  summary: {
    storyCount: number;
    performanceRows: number;
    median30: number;
    median90: number;
    growth: number;
    avgEngagement: number;
    avgBounce: number;
  };
  topics: PatternGroup[];
  sras: PatternGroup[];
  lengths: PatternGroup[];
  images: PatternGroup[];
  weekdays: PatternGroup[];
  months: PatternGroup[];
  topStories: WatchtowerRecord[];
  insights: string[];
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const defaultPatternFilters: PatternFilters = {
  topic: "All",
  sra: "All",
  dateRange: "All",
  performanceBand: "All"
};

function pageviews30(record: WatchtowerRecord): number {
  return Number(record.metrics30?.pageviews || 0);
}

function pageviews90(record: WatchtowerRecord): number {
  return Number(record.metrics90?.pageviews || 0);
}

function median(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function average(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function quantile(values: number[], q: number): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const index = Math.min(clean.length - 1, Math.max(0, (clean.length - 1) * q));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return clean[lower] + (clean[upper] - clean[lower]) * weight;
}

function performanceThresholds(records: WatchtowerRecord[]) {
  const values = records.map(pageviews30).filter((value) => value > 0);
  return {
    high: quantile(values, 0.75),
    medium: quantile(values, 0.45)
  };
}

export function performanceBand(record: WatchtowerRecord, records: WatchtowerRecord[]): PatternPerformanceBand {
  const views = pageviews30(record);
  if (!views) return "No performance data";
  const thresholds = performanceThresholds(records);
  if (views >= thresholds.high) return "High";
  if (views >= thresholds.medium) return "Medium";
  return "Low";
}

function inDateRange(record: WatchtowerRecord, dateRange: PatternDateRange): boolean {
  if (dateRange === "All") return true;
  const date = new Date(`${record.plannedDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (dateRange === "Last 90 days" ? 90 : 365));
  return date >= cutoff;
}

function groupRecords(records: WatchtowerRecord[], labelFor: (record: WatchtowerRecord) => string): PatternGroup[] {
  const total = Math.max(1, records.length);
  const groups = new Map<string, WatchtowerRecord[]>();
  records.forEach((record) => {
    const label = labelFor(record).trim() || "Unlabeled";
    groups.set(label, [...(groups.get(label) || []), record]);
  });

  return [...groups.entries()]
    .map(([label, rows]) => {
      const median30 = median(rows.map(pageviews30));
      const median90 = median(rows.map(pageviews90));
      return {
        label,
        records: rows.length,
        median30,
        median90,
        avgEngagement: average(rows.map((record) => Number(record.metrics30?.engagementSeconds || 0))),
        avgBounce: average(rows.map((record) => Number(record.metrics30?.bounceRate || 0))),
        growth: median30 > 0 && median90 > 0 ? median90 / median30 - 1 : 0,
        share: rows.length / total
      };
    })
    .sort((a, b) => b.median30 - a.median30 || b.records - a.records);
}

function dateLabel(record: WatchtowerRecord, mode: "weekday" | "month"): string {
  const date = new Date(`${record.plannedDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return mode === "weekday" ? weekdays[date.getDay()] : months[date.getMonth()];
}

function insightFor(label: string, group?: PatternGroup): string | undefined {
  if (!group || group.records < 1 || group.median30 <= 0) return undefined;
  return `${label}: ${group.label} is strongest in this view with a median ${Math.round(group.median30).toLocaleString()} 30-day pageviews.`;
}

export function buildPatternReport(records: WatchtowerRecord[], filters: PatternFilters = defaultPatternFilters): PatternReport {
  const dataRecords = records.filter((record) => !isSampleRecord(record));
  const filtered = dataRecords.filter((record) => {
    if (filters.topic !== "All" && record.topic !== filters.topic) return false;
    if (filters.sra !== "All" && (record.sra || "Unlabeled") !== filters.sra) return false;
    if (!inDateRange(record, filters.dateRange)) return false;
    if (filters.performanceBand !== "All" && performanceBand(record, dataRecords) !== filters.performanceBand) return false;
    return true;
  });

  const performanceRows = filtered.filter((record) => pageviews30(record) > 0 || pageviews90(record) > 0);
  const median30 = median(performanceRows.map(pageviews30));
  const median90 = median(performanceRows.map(pageviews90));
  const topics = groupRecords(performanceRows, (record) => record.topic || "Unlabeled");
  const sras = groupRecords(performanceRows, (record) => record.sra || "Unlabeled");
  const lengths = groupRecords(performanceRows, (record) => record.length);
  const images = groupRecords(performanceRows, (record) => (record.hasImages ? "Has images" : "No images"));
  const weekdaysReport = groupRecords(performanceRows, (record) => dateLabel(record, "weekday"));
  const monthsReport = groupRecords(performanceRows, (record) => dateLabel(record, "month"));

  return {
    records: filtered,
    performanceRows,
    summary: {
      storyCount: filtered.length,
      performanceRows: performanceRows.length,
      median30,
      median90,
      growth: median30 > 0 && median90 > 0 ? median90 / median30 - 1 : 0,
      avgEngagement: average(performanceRows.map((record) => Number(record.metrics30?.engagementSeconds || 0))),
      avgBounce: average(performanceRows.map((record) => Number(record.metrics30?.bounceRate || 0)))
    },
    topics,
    sras,
    lengths,
    images,
    weekdays: weekdaysReport,
    months: monthsReport,
    topStories: [...performanceRows].sort((a, b) => pageviews30(b) - pageviews30(a)).slice(0, 5),
    insights: [
      insightFor("Topic pattern", topics[0]),
      insightFor("SRA pattern", sras[0]),
      insightFor("Format pattern", lengths[0]),
      insightFor("Image pattern", images[0]),
      insightFor("Timing pattern", weekdaysReport[0])
    ].filter((item): item is string => Boolean(item))
  };
}
