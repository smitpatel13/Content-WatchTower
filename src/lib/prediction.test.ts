import { describe, expect, it } from "vitest";
import type { WatchtowerRecord } from "../types";
import { computePrediction, deriveTopicFromUrl, formatDuration } from "./prediction";

function record(partial: Partial<WatchtowerRecord>): WatchtowerRecord {
  return {
    id: partial.id || crypto.randomUUID(),
    title: partial.title || "Story",
    topic: partial.topic || "Research",
    plannedDate: partial.plannedDate || "2026-08-01",
    wordCount: partial.wordCount || 900,
    hasImages: partial.hasImages ?? true,
    length: partial.length || "Long",
    status: partial.status || "Published",
    owner: "",
    url: "",
    notes: "",
    score: 90,
    metrics30: partial.metrics30 || { pageviews: 1000, users: 800, sessions: 900, engagementSeconds: 40, bounceRate: 38 },
    metrics90: partial.metrics90 || { pageviews: 1400, users: 1000, sessions: 1200, engagementSeconds: 42, bounceRate: 37 },
    source: "import",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

describe("prediction model", () => {
  it("derives useful topics from ASU-style URLs", () => {
    expect(deriveTopicFromUrl("news.asu.edu/20250725-environment-and-sustainability-water-story")).toBe("Sustainability");
    expect(deriveTopicFromUrl("")).toBe("General");
  });

  it("computes 30-day and 90-day estimates from historical rows", () => {
    const records = [
      record({ title: "Lab opens", wordCount: 900, metrics30: { pageviews: 1200 }, metrics90: { pageviews: 1800 } }),
      record({ title: "Short note", wordCount: 500, hasImages: false, length: "Short", metrics30: { pageviews: 500 }, metrics90: { pageviews: 700 } }),
      record({ title: "Research feature", wordCount: 1100, metrics30: { pageviews: 1600 }, metrics90: { pageviews: 2300 } }),
      record({ title: "Another lab", wordCount: 850, metrics30: { pageviews: 1000 }, metrics90: { pageviews: 1500 } }),
      record({ title: "Faculty story", wordCount: 980, metrics30: { pageviews: 1300 }, metrics90: { pageviews: 1900 } })
    ];

    const result = computePrediction(
      {
        title: "New research lab opens",
        topic: "Research",
        plannedDate: "2026-08-15",
        wordCount: 950,
        hasImages: true,
        length: "Long"
      },
      records
    );

    expect(result.pred30).toBeGreaterThan(0);
    expect(result.pred90).toBeGreaterThan(result.pred30);
    expect(result.trainingRows).toBe(5);
    expect(result.similarRecords.length).toBeGreaterThan(0);
  });

  it("formats engagement duration for dashboard display", () => {
    expect(formatDuration(84)).toBe("1:24");
  });
});
