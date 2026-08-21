import type { RecordStatus, WatchtowerRecord } from "../types";

export const statuses: RecordStatus[] = ["Draft", "Ready", "Published", "Needs review"];

export function computeScore(input: Pick<WatchtowerRecord, "wordCount" | "hasImages" | "status">): number {
  let score = 50;
  if (input.wordCount >= 650 && input.wordCount <= 1300) score += 25;
  else if (input.wordCount >= 450 && input.wordCount <= 1600) score += 12;
  else score -= 8;

  if (input.hasImages) score += 10;
  if (input.status === "Ready") score += 8;
  if (input.status === "Published") score += 12;
  if (input.status === "Needs review") score -= 12;

  return Math.max(0, Math.min(100, score));
}

export function recommendationFor(record: WatchtowerRecord): string {
  if (record.status === "Needs review") return "Review this item before publishing.";
  if (record.wordCount < 650) return "Add more detail so the story has enough depth.";
  if (record.wordCount > 1300) return "Trim the story or improve section breaks.";
  if (!record.hasImages) return "Add one strong image or visual.";
  if (record.score >= 85) return "Ready to share with stakeholders.";
  return "Close to ready. Check headline clarity and timing.";
}

export function statusTone(status: RecordStatus): "neutral" | "success" | "warning" | "danger" {
  if (status === "Published") return "success";
  if (status === "Ready") return "neutral";
  if (status === "Needs review") return "danger";
  return "warning";
}
