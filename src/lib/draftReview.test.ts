import { describe, expect, it } from "vitest";
import type { DraftReviewInput, WatchtowerRecord } from "../types";
import { analyzeDraftText, computeLocalDraftReview, recommendationImpactText } from "./draftReview";

const baseInput: DraftReviewInput = {
  title: "ASU research opens new clean energy lab",
  topic: "Research",
  plannedDate: "2026-08-15",
  wordCount: 800,
  hasImages: false,
  length: "Long",
  draftText:
    "ASU researchers opened a new clean energy lab to help communities test better battery systems. The work could help cities improve resilience and prepare students for emerging technology jobs.\n\nThe team will partner with industry and public agencies. Researchers say the lab gives students hands-on access to tools that are usually difficult to reach."
};

const historicalRecord: WatchtowerRecord = {
  id: "history-1",
  title: "Research team opens new lab",
  topic: "Research",
  plannedDate: "2026-08-01",
  wordCount: 930,
  hasImages: true,
  length: "Long",
  status: "Published",
  owner: "",
  url: "",
  notes: "",
  score: 90,
  metrics30: { pageviews: 1300, users: 980, sessions: 1140, engagementSeconds: 42, bounceRate: 37 },
  metrics90: { pageviews: 1900, users: 1350, sessions: 1600, engagementSeconds: 44, bounceRate: 36 },
  source: "import",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

describe("draft review", () => {
  it("computes readable draft statistics", () => {
    const stats = analyzeDraftText(baseInput.draftText);

    expect(stats.wordCount).toBeGreaterThan(40);
    expect(stats.sentenceCount).toBeGreaterThan(1);
    expect(stats.readingEase).toBeGreaterThan(0);
  });

  it("returns recommendations, checklist, and prediction context", () => {
    const review = computeLocalDraftReview(baseInput, [historicalRecord]);

    expect(review.readinessScore).toBeGreaterThan(0);
    expect(review.prediction.pred30).toBeGreaterThan(0);
    expect(review.recommendations.some((item) => item.title.includes("visual"))).toBe(true);
    expect(review.checklist.length).toBeGreaterThan(3);
    expect(review.seo.keywordOpportunities.length).toBeGreaterThan(2);
    expect(review.trend.caveat).toContain("GA4");
    expect(review.rewrite.concreteEdits.length).toBeGreaterThan(2);
    expect(review.evidence.some((item) => item.source === "Historical data")).toBe(true);
    expect(recommendationImpactText(review)).toContain("priority");
  });

  it("asks for draft text when review has no draft", () => {
    const review = computeLocalDraftReview({ ...baseInput, draftText: "" }, [historicalRecord]);

    expect(review.readinessLabel).toBe("Needs major work");
    expect(review.recommendations[0].title).toBe("Add the draft text");
  });
});
