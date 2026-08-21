export type RecordStatus = "Draft" | "Ready" | "Published" | "Needs review";

export type NavPage = "dashboard" | "patterns" | "records" | "predict" | "review" | "import" | "export" | "settings";

export interface PerformanceMetrics {
  users?: number;
  sessions?: number;
  pageviews?: number;
  engagementSeconds?: number;
  bounceRate?: number;
}

export interface WatchtowerRecord {
  id: string;
  title: string;
  topic: string;
  plannedDate: string;
  wordCount: number;
  hasImages: boolean;
  length: "Long" | "Short";
  sra?: string;
  status: RecordStatus;
  owner: string;
  url: string;
  notes: string;
  score: number;
  metrics30?: PerformanceMetrics;
  metrics90?: PerformanceMetrics;
  source?: "manual" | "import";
  createdAt: string;
  updatedAt: string;
}

export interface ImportRow {
  title: string;
  topic: string;
  plannedDate: string;
  wordCount: string | number;
  images: string | boolean;
  status: string;
  length?: string;
  sra?: string;
  owner?: string;
  url?: string;
  notes?: string;
  users30?: string | number;
  sessions30?: string | number;
  pageviews30?: string | number;
  engagementTime30?: string | number;
  bounceRate30?: string | number;
  users90?: string | number;
  sessions90?: string | number;
  pageviews90?: string | number;
  engagementTime90?: string | number;
  bounceRate90?: string | number;
  sourceSheet?: string;
}

export interface ImportValidationResult {
  rowNumber: number;
  row: ImportRow;
  record?: WatchtowerRecord;
  valid: boolean;
  duplicate: boolean;
  errors: string[];
}

export interface ImportSummary {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  invalidRows: number;
  duplicateRows: number;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: string;
  summary: ImportSummary;
}

export interface PredictionInput {
  title: string;
  topic: string;
  plannedDate: string;
  wordCount: number;
  hasImages: boolean;
  length: "Long" | "Short";
}

export interface PredictionResult {
  pred30: number;
  pred90: number;
  className: "High" | "Medium" | "Low";
  confidence: number;
  interval: [number, number];
  source: "historical-model" | "baseline";
  trainingRows: number;
  drivers: string[];
  metrics30: PerformanceMetrics;
  metrics90: PerformanceMetrics;
  similarRecords: WatchtowerRecord[];
}

export interface DraftReviewInput extends PredictionInput {
  draftText: string;
}

export interface DraftStats {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  headingCount: number;
  averageSentenceLength: number;
  readingEase: number;
  gradeLevel: number;
}

export interface DraftRecommendation {
  category: "Headline" | "Readability" | "Structure" | "Performance" | "Editorial";
  priority: "High" | "Medium" | "Low";
  title: string;
  detail: string;
  impact: string;
}

export interface EditorChecklistItem {
  label: string;
  done: boolean;
  detail: string;
}

export interface SeoReview {
  score: number;
  summary: string;
  keywordOpportunities: string[];
  titleGuidance: string;
  metaDescription: string;
}

export interface TrendReview {
  summary: string;
  opportunities: string[];
  caveat: string;
}

export interface DraftRewrite {
  leadRewrite: string;
  simplify: string[];
  concreteEdits: string[];
}

export interface PatternEvidence {
  label: string;
  detail: string;
  source: "Historical data" | "Draft analysis" | "AI inference";
}

export interface DraftReviewResult {
  source: "local-editorial-model" | "ai-model";
  readinessScore: number;
  readinessLabel: "Ready" | "Needs edits" | "Needs major work";
  summary: string;
  stats: DraftStats;
  prediction: PredictionResult;
  headlineScore: number;
  headlineFeedback: string;
  headlineOptions: string[];
  recommendations: DraftRecommendation[];
  checklist: EditorChecklistItem[];
  seo: SeoReview;
  trend: TrendReview;
  rewrite: DraftRewrite;
  evidence: PatternEvidence[];
}
