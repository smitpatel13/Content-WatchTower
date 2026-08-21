import type { WatchtowerRecord } from "../types";
import { computeScore } from "./scoring";

const now = new Date().toISOString();

export const sampleRecords: WatchtowerRecord[] = [
  {
    id: "sample-1",
    title: "Research team opens new clean energy lab",
    topic: "Research",
    plannedDate: "2026-08-12",
    wordCount: 920,
    hasImages: true,
    length: "Long",
    sra: "Research",
    status: "Ready",
    owner: "Marcomm team",
    url: "https://news.example.edu/research-clean-energy-lab",
    notes: "Strong fit for a feature story.",
    score: computeScore({ wordCount: 920, hasImages: true, status: "Ready" }),
    metrics30: { users: 940, sessions: 1100, pageviews: 1290, engagementSeconds: 42, bounceRate: 38.2 },
    metrics90: { users: 1310, sessions: 1540, pageviews: 1810, engagementSeconds: 44, bounceRate: 36.4 },
    source: "manual",
    createdAt: now,
    updatedAt: now
  },
  {
    id: "sample-2",
    title: "Student startup wins regional innovation award",
    topic: "Students",
    plannedDate: "2026-08-19",
    wordCount: 540,
    hasImages: false,
    length: "Short",
    sra: "Students",
    status: "Needs review",
    owner: "Editorial desk",
    url: "https://news.example.edu/student-startup-award",
    notes: "Needs a visual and stronger lead.",
    score: computeScore({ wordCount: 540, hasImages: false, status: "Needs review" }),
    metrics30: { users: 420, sessions: 510, pageviews: 610, engagementSeconds: 24, bounceRate: 58.5 },
    metrics90: { users: 620, sessions: 760, pageviews: 880, engagementSeconds: 26, bounceRate: 55.1 },
    source: "manual",
    createdAt: now,
    updatedAt: now
  },
  {
    id: "sample-3",
    title: "Community partnership expands health outreach",
    topic: "Health",
    plannedDate: "2026-09-03",
    wordCount: 1180,
    hasImages: true,
    length: "Long",
    sra: "Health",
    status: "Published",
    owner: "Knowledge Enterprise",
    url: "https://news.example.edu/community-health-outreach",
    notes: "Use as a comparison story for future health features.",
    score: computeScore({ wordCount: 1180, hasImages: true, status: "Published" }),
    metrics30: { users: 1380, sessions: 1620, pageviews: 1900, engagementSeconds: 48, bounceRate: 34.2 },
    metrics90: { users: 1910, sessions: 2260, pageviews: 2650, engagementSeconds: 49, bounceRate: 33.7 },
    source: "manual",
    createdAt: now,
    updatedAt: now
  }
];
