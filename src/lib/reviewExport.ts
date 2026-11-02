import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { DraftReviewInput, DraftReviewResult } from "../types";

const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } });
}

function body(text: string): Paragraph {
  return new Paragraph({ text: text || "Not provided", spacing: { after: 120 } });
}

function labeled(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value || "Not provided")],
    spacing: { after: 120 }
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80 } });
}

function fileNameFor(title: string, reviewedAt: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/g, "") || "draft";
  return `${slug}-review-${reviewedAt.slice(0, 10)}.docx`;
}

export async function createDraftReviewWord(
  input: DraftReviewInput,
  review: DraftReviewResult,
  reviewedAt: string
): Promise<{ blob: Blob; fileName: string }> {
  const reviewedDate = new Date(reviewedAt).toLocaleString();
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: "Content Watchtower", bold: true, size: 34, color: "145C58" })],
      spacing: { after: 80 }
    }),
    new Paragraph({
      children: [new TextRun({ text: "Draft review", bold: true, size: 28 })],
      spacing: { after: 220 }
    }),
    labeled("Story", input.title || "Untitled draft"),
    labeled("Reviewed", reviewedDate),
    labeled("Topic or SRA", input.topic),
    labeled("Planned date", input.plannedDate),
    labeled("Review source", review.source === "ai-model" ? "AI model review" : "Local editorial review"),
    heading("At a glance"),
    labeled("Readiness", `${review.readinessLabel} (${review.readinessScore}/100)`),
    labeled("Predicted 30-day pageviews", `${Math.round(review.prediction.pred30).toLocaleString()} (${review.prediction.className})`),
    labeled("Headline score", `${review.headlineScore}/10`),
    labeled("SEO score", `${review.seo.score}/10`),
    labeled("Draft length", `${review.stats.wordCount.toLocaleString()} words`),
    body(review.summary),
    heading("SEO critique"),
    body(review.seo.summary),
    labeled("Headline guidance", review.seo.titleGuidance),
    labeled("Keyword opportunities", review.seo.keywordOpportunities.join(", ")),
    labeled("Suggested meta description", review.seo.metaDescription),
    heading("Trend angle"),
    body(review.trend.summary),
    ...review.trend.opportunities.map(bullet),
    labeled("Context", review.trend.caveat),
    heading("Concrete draft edits"),
    labeled("Lead direction", review.rewrite.leadRewrite),
    ...review.rewrite.simplify.map((item) => bullet(`Simplify: ${item}`)),
    ...review.rewrite.concreteEdits.map((item) => bullet(`Edit next: ${item}`)),
    heading("Top recommendations"),
    ...review.recommendations.flatMap((item) => [
      labeled(`${item.priority} priority - ${item.category}`, item.title),
      body(item.detail),
      labeled("Why it helps", item.impact)
    ]),
    heading("Headline options"),
    ...review.headlineOptions.map(bullet),
    labeled("Headline feedback", review.headlineFeedback),
    heading("Editor checklist"),
    ...review.checklist.map((item) => bullet(`${item.done ? "Done" : "To check"}: ${item.label}. ${item.detail}`)),
    heading("Evidence signals"),
    ...review.evidence.map((item) => bullet(`${item.source} - ${item.label}: ${item.detail}`)),
    heading("Draft reviewed"),
    ...input.draftText.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).map(body)
  ];

  if (!input.draftText.trim()) children.push(body("No draft text was entered."));

  const document = new Document({
    title: `${input.title || "Untitled draft"} - Content Watchtower review`,
    creator: "Content Watchtower",
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children
    }]
  });
  const blob = await Packer.toBlob(document);
  return { blob: new Blob([blob], { type: WORD_MIME }), fileName: fileNameFor(input.title, reviewedAt) };
}
