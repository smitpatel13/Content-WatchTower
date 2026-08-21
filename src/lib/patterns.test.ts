import { describe, expect, it } from "vitest";
import type { WatchtowerRecord } from "../types";
import { buildPatternReport, defaultPatternFilters, performanceBand } from "./patterns";

const baseRecord: Omit<WatchtowerRecord, "id" | "title" | "topic" | "plannedDate" | "metrics30" | "metrics90"> = {
  wordCount: 900,
  hasImages: true,
  length: "Long",
  sra: "Research",
  status: "Published",
  owner: "",
  url: "",
  notes: "",
  score: 90,
  source: "import",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z"
};

const records: WatchtowerRecord[] = [
  {
    ...baseRecord,
    id: "one",
    title: "Research story with public impact",
    topic: "Research",
    plannedDate: "2026-08-05",
    metrics30: { pageviews: 1200, users: 900, sessions: 1000, engagementSeconds: 45, bounceRate: 38 },
    metrics90: { pageviews: 1800, users: 1200, sessions: 1400, engagementSeconds: 48, bounceRate: 36 }
  },
  {
    ...baseRecord,
    id: "two",
    title: "Student profile",
    topic: "Students",
    sra: "Students",
    plannedDate: "2026-08-06",
    wordCount: 520,
    hasImages: false,
    length: "Short",
    metrics30: { pageviews: 450, users: 350, sessions: 390, engagementSeconds: 28, bounceRate: 55 },
    metrics90: { pageviews: 620, users: 440, sessions: 510, engagementSeconds: 31, bounceRate: 52 }
  },
  {
    ...baseRecord,
    id: "three",
    title: "Health outreach story",
    topic: "Health",
    sra: "Health",
    plannedDate: "2026-08-07",
    metrics30: { pageviews: 2200, users: 1700, sessions: 1900, engagementSeconds: 52, bounceRate: 32 },
    metrics90: { pageviews: 3100, users: 2300, sessions: 2600, engagementSeconds: 54, bounceRate: 31 }
  }
];

describe("pattern reports", () => {
  it("builds summary metrics and group patterns", () => {
    const report = buildPatternReport(records, defaultPatternFilters);

    expect(report.summary.storyCount).toBe(3);
    expect(report.summary.performanceRows).toBe(3);
    expect(report.summary.median30).toBe(1200);
    expect(report.topics[0].label).toBe("Health");
    expect(report.images[0].label).toBe("Has images");
    expect(report.insights.length).toBeGreaterThan(2);
  });

  it("filters by topic and performance band", () => {
    const topicReport = buildPatternReport(records, { ...defaultPatternFilters, topic: "Research" });
    const highReport = buildPatternReport(records, { ...defaultPatternFilters, performanceBand: "High" });

    expect(topicReport.records).toHaveLength(1);
    expect(topicReport.records[0].title).toContain("Research");
    expect(highReport.records.map((record) => record.title)).toContain("Health outreach story");
    expect(performanceBand(records[1], records)).toBe("Low");
  });
});
