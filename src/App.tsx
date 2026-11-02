import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Home,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  TrendingUp,
  Upload,
  X
} from "lucide-react";
import type {
  ImportBatch,
  ImportValidationResult,
  DraftReviewInput,
  DraftReviewResult,
  NavPage,
  PatternEvidence,
  PredictionInput,
  PredictionResult,
  RecordStatus,
  WatchtowerRecord
} from "./types";
import { initAnalytics, trackEvent, analyticsEnabled } from "./lib/analytics";
import { computeScore, recommendationFor, statuses, statusTone } from "./lib/scoring";
import { aiReviewEnabled, computeLocalDraftReview, runDraftReview } from "./lib/draftReview";
import { fetchGa4ImportRows, ga4ImportEnabled, type Ga4ImportOptions } from "./lib/ga4";
import {
  buildPatternReport,
  defaultPatternFilters,
  type PatternDateRange,
  type PatternFilters,
  type PatternGroup,
  type PatternPerformanceBand
} from "./lib/patterns";
import { computePrediction, formatDuration, formatNumber, formatPercent } from "./lib/prediction";
import { loadImportHistory, loadRecords, saveImportHistory, saveRecords } from "./lib/storage";
import {
  downloadBlob,
  parseSpreadsheetFile,
  recordsToCsv,
  recordsToXlsxBlob,
  summarizeImport,
  templateCsv,
  validateImportRows
} from "./lib/spreadsheet";

const navItems: Array<{ page: NavPage; label: string; icon: typeof Home }> = [
  { page: "dashboard", label: "Dashboard", icon: Home },
  { page: "patterns", label: "Patterns", icon: TrendingUp },
  { page: "records", label: "Records", icon: FileText },
  { page: "predict", label: "Predict", icon: BarChart3 },
  { page: "review", label: "Review", icon: ClipboardCheck },
  { page: "import", label: "Import", icon: Upload },
  { page: "export", label: "Export", icon: Download },
  { page: "settings", label: "Settings", icon: Settings }
];

const emptyRecord = (): WatchtowerRecord => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    topic: "",
    plannedDate: new Date().toISOString().slice(0, 10),
    wordCount: 800,
    hasImages: true,
    length: "Long",
    status: "Draft",
    owner: "",
    url: "",
    notes: "",
    score: 0,
    source: "manual",
    createdAt: now,
    updatedAt: now
  };
};

const patternDateRanges: PatternDateRange[] = ["All", "Last 90 days", "Last 12 months"];
const patternPerformanceBands: PatternPerformanceBand[] = ["All", "High", "Medium", "Low", "No performance data"];

function persistRecords(records: WatchtowerRecord[], setRecords: (records: WatchtowerRecord[]) => void) {
  setRecords(records);
  saveRecords(records);
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function defaultGa4ImportInput(): Ga4ImportOptions {
  return {
    startDate: isoDaysAgo(365),
    endDate: new Date().toISOString().slice(0, 10),
    pathContains: "news.asu.edu",
    limit: 10000
  };
}

function useFilteredRecords(records: WatchtowerRecord[], search: string, status: string, topic: string, sort: string) {
  return useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = records.filter((record) => {
      const matchesSearch =
        !term ||
        record.title.toLowerCase().includes(term) ||
        record.topic.toLowerCase().includes(term) ||
        record.owner.toLowerCase().includes(term);
      const matchesStatus = status === "All" || record.status === status;
      const matchesTopic = topic === "All" || record.topic === topic;
      return matchesSearch && matchesStatus && matchesTopic;
    });

    return [...filtered].sort((a, b) => {
      if (sort === "Title") return a.title.localeCompare(b.title);
      if (sort === "Score") return b.score - a.score;
      if (sort === "Status") return a.status.localeCompare(b.status);
      return b.plannedDate.localeCompare(a.plannedDate);
    });
  }, [records, search, status, topic, sort]);
}

function Badge({ status }: { status: RecordStatus }) {
  return <span className={`badge badge-${statusTone(status)}`}>{status}</span>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <section className="metric" aria-label={label}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </section>
  );
}

function SourcePill({ source }: { source: PatternEvidence["source"] }) {
  const className = source === "Historical data" ? "source-data" : source === "AI inference" ? "source-ai" : "source-draft";
  return <span className={`source-pill ${className}`}>{source}</span>;
}

function InsightList({ items }: { items: string[] }) {
  return (
    <ul className="insight-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function PatternBars({ title, hint, groups, emptyText = "Import performance data to see this pattern." }: { title: string; hint: string; groups: PatternGroup[]; emptyText?: string }) {
  const visible = groups.slice(0, 6);
  const max = Math.max(...visible.map((group) => group.median30), 1);
  return (
    <section className="driver-list pattern-card">
      <div className="pattern-card-heading">
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
      </div>
      {visible.length ? (
        <div className="pattern-bars">
          {visible.map((group) => (
            <div className="pattern-bar-row" key={group.label}>
              <div className="pattern-row-meta">
                <strong>{group.label}</strong>
                <span>
                  {group.records} stories · {formatNumber(group.median30)} median 30-day
                </span>
              </div>
              <div className="pattern-bar-track" aria-hidden="true">
                <span style={{ width: `${Math.max(6, Math.round((group.median30 / max) * 100))}%` }} />
              </div>
              <small>{group.growth > 0 ? `${formatPercent(group.growth * 100)} 30-to-90 growth` : "90-day growth not available"}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{emptyText}</p>
      )}
    </section>
  );
}

function PatternFiltersPanel({
  filters,
  topics,
  sras,
  onChange
}: {
  filters: PatternFilters;
  topics: string[];
  sras: string[];
  onChange: <K extends keyof PatternFilters>(key: K, value: PatternFilters[K]) => void;
}) {
  return (
    <div className="pattern-filter-panel">
      <label>
        Topic
        <select value={filters.topic} onChange={(event) => onChange("topic", event.target.value)}>
          {topics.map((topic) => (
            <option key={topic}>{topic}</option>
          ))}
        </select>
      </label>
      <label>
        SRA
        <select value={filters.sra} onChange={(event) => onChange("sra", event.target.value)}>
          {sras.map((sra) => (
            <option key={sra}>{sra}</option>
          ))}
        </select>
      </label>
      <label>
        Date range
        <select value={filters.dateRange} onChange={(event) => onChange("dateRange", event.target.value as PatternDateRange)}>
          {patternDateRanges.map((range) => (
            <option key={range}>{range}</option>
          ))}
        </select>
      </label>
      <label>
        Performance band
        <select value={filters.performanceBand} onChange={(event) => onChange("performanceBand", event.target.value as PatternPerformanceBand)}>
          {patternPerformanceBands.map((band) => (
            <option key={band}>{band}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PatternsPanel({
  report,
  filters,
  topics,
  sras,
  onChange,
  onImport
}: {
  report: ReturnType<typeof buildPatternReport>;
  filters: PatternFilters;
  topics: string[];
  sras: string[];
  onChange: <K extends keyof PatternFilters>(key: K, value: PatternFilters[K]) => void;
  onImport: () => void;
}) {
  return (
    <section className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Pattern dashboard</h2>
            <p>Explore what has worked in the current content data before changing a draft or forecast.</p>
          </div>
          <div className="model-chip">{report.summary.performanceRows.toLocaleString()} rows with metrics</div>
        </div>
        <PatternFiltersPanel filters={filters} topics={topics} sras={sras} onChange={onChange} />
      </section>

      <div className="metrics-grid">
        <Metric label="Stories in view" value={String(report.summary.storyCount)} hint={`${report.summary.performanceRows} with performance data`} />
        <Metric label="Median 30-day" value={formatNumber(report.summary.median30)} hint="Pageviews" />
        <Metric label="Median 90-day" value={formatNumber(report.summary.median90)} hint={`${formatPercent(report.summary.growth * 100)} growth`} />
        <Metric label="Engagement" value={formatDuration(report.summary.avgEngagement)} hint={`${formatPercent(report.summary.avgBounce)} bounce`} />
      </div>

      {report.summary.performanceRows === 0 ? (
        <section className="empty-state pattern-empty">
          <TrendingUp size={38} aria-hidden="true" />
          <h3>No performance data in this view</h3>
          <p>Import the ASU workbook or GA4 rows to compare topics, formats, timing, and engagement patterns.</p>
          <button className="button primary" onClick={onImport}>
            <Upload size={18} aria-hidden="true" />
            Import data
          </button>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Plain-language insights</h2>
                <p>Fast readout of the strongest patterns in the selected view.</p>
              </div>
            </div>
            <div className="insight-grid">
              {report.insights.map((insight) => (
                <div className="insight-tile" key={insight}>
                  <TrendingUp size={18} aria-hidden="true" />
                  <p>{insight}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="pattern-grid">
            <PatternBars title="Top topics" hint="Which content areas are strongest by median 30-day pageviews." groups={report.topics} />
            <PatternBars title="SRA patterns" hint="A quick read on research-area differences where SRA is available." groups={report.sras} />
            <PatternBars title="Length" hint="Compare long and short story performance in this data view." groups={report.lengths} />
            <PatternBars title="Images" hint="Shows whether visual-backed stories are performing differently." groups={report.images} />
            <PatternBars title="Publish day" hint="Early timing pattern by planned or publication day." groups={report.weekdays} />
            <PatternBars title="Publish month" hint="Seasonality signal from the currently available records." groups={report.months} />
          </div>

          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Top stories in this view</h2>
                <p>Use these as examples when discussing why a pattern may be working.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Story</th>
                    <th>Topic / SRA</th>
                    <th>Format</th>
                    <th>30-day</th>
                    <th>90-day</th>
                    <th>Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topStories.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <strong>{record.title}</strong>
                        <small>{record.plannedDate}</small>
                      </td>
                      <td>
                        {record.topic}
                        <small>{record.sra || "No SRA"}</small>
                      </td>
                      <td>
                        {record.length}
                        <small>{record.hasImages ? "Has images" : "No images"}</small>
                      </td>
                      <td>{formatNumber(record.metrics30?.pageviews)}</td>
                      <td>{formatNumber(record.metrics90?.pageviews)}</td>
                      <td>
                        {formatDuration(record.metrics30?.engagementSeconds)}
                        <small>{formatPercent(record.metrics30?.bounceRate)} bounce</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function RecordForm({
  initial,
  onCancel,
  onSave
}: {
  initial: WatchtowerRecord;
  onCancel: () => void;
  onSave: (record: WatchtowerRecord) => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");

  function update<K extends keyof WatchtowerRecord>(key: K, value: WatchtowerRecord[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return setError("Add a clear title.");
    if (!form.topic.trim()) return setError("Choose or enter a topic.");
    if (!form.plannedDate) return setError("Choose a planned date.");
    if (!Number.isFinite(form.wordCount) || form.wordCount < 0) return setError("Word count must be zero or higher.");
    const now = new Date().toISOString();
    onSave({
      ...form,
      title: form.title.trim(),
      topic: form.topic.trim(),
      owner: form.owner.trim(),
      url: form.url.trim(),
      notes: form.notes.trim(),
      score: computeScore(form),
      updatedAt: now,
      createdAt: form.createdAt || now
    });
  }

  return (
    <form className="record-form" onSubmit={submit}>
      {error ? <div className="error-text">{error}</div> : null}
      <label>
        Title
        <input value={form.title} onChange={(event) => update("title", event.target.value)} />
      </label>
      <div className="two-col">
        <label>
          Topic
          <input value={form.topic} onChange={(event) => update("topic", event.target.value)} />
        </label>
        <label>
          Planned date
          <input type="date" value={form.plannedDate} onChange={(event) => update("plannedDate", event.target.value)} />
        </label>
      </div>
      <div className="four-col">
        <label>
          Word count
          <input
            type="number"
            min="0"
            value={form.wordCount}
            onChange={(event) => update("wordCount", Number(event.target.value))}
          />
        </label>
        <label>
          Length
          <select value={form.length} onChange={(event) => update("length", event.target.value as "Long" | "Short")}>
            <option>Long</option>
            <option>Short</option>
          </select>
        </label>
        <label>
          Images
          <select
            value={form.hasImages ? "Yes" : "No"}
            onChange={(event) => update("hasImages", event.target.value === "Yes")}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={(event) => update("status", event.target.value as RecordStatus)}>
            {statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Owner or team
        <input value={form.owner} onChange={(event) => update("owner", event.target.value)} />
      </label>
      <label>
        URL
        <input value={form.url} onChange={(event) => update("url", event.target.value)} />
      </label>
      <label>
        Notes
        <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} />
      </label>
      <div className="button-row right">
        <button type="button" className="button ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          Save record
        </button>
      </div>
    </form>
  );
}

function App() {
  const [page, setPage] = useState<NavPage>("dashboard");
  const [records, setRecords] = useState<WatchtowerRecord[]>(() => loadRecords());
  const [importHistory, setImportHistory] = useState<ImportBatch[]>(() => loadImportHistory());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [topicFilter, setTopicFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Planned date");
  const [pageIndex, setPageIndex] = useState(1);
  const [patternFilters, setPatternFilters] = useState<PatternFilters>(() => defaultPatternFilters);
  const [editor, setEditor] = useState<WatchtowerRecord | null>(null);
  const [viewer, setViewer] = useState<WatchtowerRecord | null>(null);
  const [importRows, setImportRows] = useState<ImportValidationResult[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [importSourceLabel, setImportSourceLabel] = useState("uploaded spreadsheet");
  const [busy, setBusy] = useState(false);
  const [ga4Busy, setGa4Busy] = useState(false);
  const [ga4Input, setGa4Input] = useState<Ga4ImportOptions>(() => defaultGa4ImportInput());
  const [predictionInput, setPredictionInput] = useState<PredictionInput>({
    title: "",
    topic: "General",
    plannedDate: new Date().toISOString().slice(0, 10),
    wordCount: 800,
    hasImages: true,
    length: "Long"
  });
  const [draftInput, setDraftInput] = useState<DraftReviewInput>({
    title: "",
    topic: "General",
    plannedDate: new Date().toISOString().slice(0, 10),
    wordCount: 800,
    hasImages: true,
    length: "Long",
    draftText: ""
  });
  const [completedReview, setCompletedReview] = useState<{ input: DraftReviewInput; result: DraftReviewResult; reviewedAt: string } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewExportBusy, setReviewExportBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");

  useEffect(() => {
    initAnalytics();
    trackEvent("dashboard_viewed");
  }, []);

  useEffect(() => {
    setPageIndex(1);
  }, [search, statusFilter, topicFilter, sortBy]);

  const topics = useMemo(() => ["All", ...Array.from(new Set(records.map((record) => record.topic))).sort()], [records]);
  const sraOptions = useMemo(
    () => ["All", ...Array.from(new Set(records.map((record) => record.sra || "Unlabeled"))).sort()],
    [records]
  );
  const predictionTopics = useMemo(
    () => Array.from(new Set(records.map((record) => record.sra || record.topic).filter(Boolean))).sort(),
    [records]
  );
  const filteredRecords = useFilteredRecords(records, search, statusFilter, topicFilter, sortBy);
  const prediction = useMemo(() => computePrediction(predictionInput, records), [predictionInput, records]);
  const patternReport = useMemo(() => buildPatternReport(records, patternFilters), [records, patternFilters]);
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const visibleRecords = filteredRecords.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);

  const totals = useMemo(() => {
    const ready = records.filter((record) => record.status === "Ready").length;
    const review = records.filter((record) => record.status === "Needs review").length;
    const avgScore = records.length ? Math.round(records.reduce((sum, record) => sum + record.score, 0) / records.length) : 0;
    return { ready, review, avgScore };
  }, [records]);

  function openPage(nextPage: NavPage) {
    setPage(nextPage);
    trackEvent("feature_opened", { feature: nextPage });
  }

  function saveRecord(record: WatchtowerRecord) {
    const exists = records.some((item) => item.id === record.id);
    const next = exists ? records.map((item) => (item.id === record.id ? record : item)) : [record, ...records];
    persistRecords(next, setRecords);
    setEditor(null);
    trackEvent(exists ? "record_updated" : "record_created", { status: record.status, has_images: record.hasImages });
  }

  function deleteRecord(record: WatchtowerRecord) {
    const confirmed = window.confirm(`Delete "${record.title}"? This cannot be undone.`);
    if (!confirmed) return;
    persistRecords(records.filter((item) => item.id !== record.id), setRecords);
    setViewer(null);
    trackEvent("record_deleted", { status: record.status });
  }

  async function handleFile(file: File) {
    setBusy(true);
    setImportMessage("");
    setImportSourceLabel(file.name || "uploaded spreadsheet");
    trackEvent("excel_import_started", { extension: file.name.split(".").pop() || "unknown" });
    try {
      const rows = await parseSpreadsheetFile(file);
      if (rows.length > 5000) {
        setImportMessage("Only the first 5,000 rows were previewed. Split larger files into smaller imports.");
      }
      const results = validateImportRows(rows, records);
      setImportRows(results);
      trackEvent("excel_import_completed", { preview_rows: results.length });
    } catch (error) {
      setImportRows([]);
      setImportMessage(error instanceof Error ? error.message : "The file could not be read.");
      trackEvent("excel_import_failed", { reason: "parse_error" });
    } finally {
      setBusy(false);
    }
  }

  async function handleGa4Import() {
    setGa4Busy(true);
    setImportMessage("");
    setImportSourceLabel("GA4 property 315631542");
    trackEvent("excel_import_started", { extension: "ga4" });
    try {
      const response = await fetchGa4ImportRows(ga4Input);
      const results = validateImportRows(response.rows, records);
      setImportRows(results);
      setImportMessage(`GA4 returned ${response.importedRows} pages from property ${response.propertyId}. Review the preview before importing.`);
      trackEvent("excel_import_completed", { preview_rows: results.length });
    } catch (error) {
      setImportRows([]);
      setImportMessage(error instanceof Error ? error.message : "GA4 import failed.");
      trackEvent("excel_import_failed", { reason: "ga4_error" });
    } finally {
      setGa4Busy(false);
    }
  }

  function confirmImport() {
    const validRecords = importRows.flatMap((row) => (row.valid && row.record ? [row.record] : []));
    const summary = summarizeImport(importRows);
    persistRecords([...validRecords, ...records], setRecords);
    const batch: ImportBatch = {
      id: crypto.randomUUID(),
      fileName: importSourceLabel,
      importedAt: new Date().toISOString(),
      summary
    };
    const nextHistory = [batch, ...importHistory].slice(0, 10);
    setImportHistory(nextHistory);
    saveImportHistory(nextHistory);
    setImportMessage(`Imported ${summary.importedRows} records. Skipped ${summary.skippedRows}.`);
    setImportRows([]);
    trackEvent("excel_import_completed", {
      imported_rows: summary.importedRows,
      skipped_rows: summary.skippedRows,
      invalid_rows: summary.invalidRows,
      duplicate_rows: summary.duplicateRows
    });
  }

  function exportCsv(recordsToExport = filteredRecords) {
    downloadBlob(new Blob([recordsToCsv(recordsToExport)], { type: "text/csv" }), "content-watchtower-records.csv");
    trackEvent("excel_export_completed", { format: "csv", record_count: recordsToExport.length });
  }

  async function exportXlsx(recordsToExport = filteredRecords) {
    downloadBlob(await recordsToXlsxBlob(recordsToExport), "content-watchtower-records.xlsx");
    trackEvent("excel_export_completed", { format: "xlsx", record_count: recordsToExport.length });
  }

  function updatePredictionInput<K extends keyof PredictionInput>(key: K, value: PredictionInput[K]) {
    setPredictionInput((current) => ({ ...current, [key]: value }));
  }

  function updateDraftInput<K extends keyof DraftReviewInput>(key: K, value: DraftReviewInput[K]) {
    setDraftInput((current) => ({ ...current, [key]: value }));
    setCompletedReview(null);
  }

  function updatePatternFilter<K extends keyof PatternFilters>(key: K, value: PatternFilters[K]) {
    setPatternFilters((current) => ({ ...current, [key]: value }));
  }

  async function handleDraftFile(file: File) {
    setReviewMessage("");
    if (!/\.(txt|md)$/i.test(file.name)) {
      setReviewMessage("Upload a .txt or .md file, or paste text copied from Word.");
      return;
    }
    const text = await file.text();
    updateDraftInput("draftText", text);
    trackEvent("feature_opened", { feature: "draft_file_loaded" });
  }

  async function reviewDraft() {
    const reviewedInput = { ...draftInput };
    setReviewBusy(true);
    setReviewMessage("");
    try {
      const result = await runDraftReview(reviewedInput, records);
      setCompletedReview({ input: reviewedInput, result, reviewedAt: new Date().toISOString() });
      trackEvent("draft_review_run", {
        source: result.source,
        readiness_score: result.readinessScore,
        word_count: result.stats.wordCount,
        training_rows: result.prediction.trainingRows
      });
    } catch (error) {
      const result = computeLocalDraftReview(reviewedInput, records);
      setCompletedReview({ input: reviewedInput, result, reviewedAt: new Date().toISOString() });
      setReviewMessage(error instanceof Error ? error.message : "AI connector was unavailable, so the local editorial review was used.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function downloadReview() {
    if (!completedReview) return;
    setReviewExportBusy(true);
    try {
      const { createDraftReviewWord } = await import("./lib/reviewExport");
      const { blob, fileName } = await createDraftReviewWord(completedReview.input, completedReview.result, completedReview.reviewedAt);
      downloadBlob(blob, fileName);
    } catch {
      setReviewMessage("Could not create the Word file. Please try again.");
    } finally {
      setReviewExportBusy(false);
    }
  }

  const validImportCount = importRows.filter((row) => row.valid).length;
  const importSummary = summarizeImport(importRows);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CW</div>
          <div>
            <strong>Content Watchtower</strong>
            <span>Simple content planning</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.page} className={page === item.page ? "active" : ""} onClick={() => openPage(item.page)}>
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main>
        <header className="hero">
          <div>
            <p className="eyebrow">MVP workspace</p>
            <h1>Content Watchtower</h1>
            <p>Track planned stories, import spreadsheets, spot records that need attention, and export clean reports.</p>
          </div>
          <button className="button primary" onClick={() => setEditor(emptyRecord())}>
            <Plus size={18} aria-hidden="true" />
            New record
          </button>
        </header>

        <div className="mobile-nav" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <button key={item.page} className={page === item.page ? "active" : ""} onClick={() => openPage(item.page)}>
              {item.label}
            </button>
          ))}
        </div>

        {page === "dashboard" ? (
          <section className="page-stack">
            <div className="metrics-grid">
              <Metric label="Total records" value={String(records.length)} hint="Stories in this workspace" />
              <Metric label="Ready" value={String(totals.ready)} hint="Can move forward" />
              <Metric label="Needs review" value={String(totals.review)} hint="Needs attention" />
              <Metric label="Average score" value={`${totals.avgScore}/100`} hint="Simple quality signal" />
            </div>
            <section className="panel split-panel">
              <div>
                <h2>Start here</h2>
                <p>Import a spreadsheet or create one record manually. The table will stay simple and editable.</p>
                <div className="button-row">
	                  <button className="button primary" onClick={() => openPage("import")}>
	                    <Upload size={18} aria-hidden="true" />
	                    Import spreadsheet
	                  </button>
	                  <button className="button" onClick={() => openPage("patterns")}>
	                    <TrendingUp size={18} aria-hidden="true" />
	                    Explore patterns
	                  </button>
	                  <button className="button" onClick={() => openPage("predict")}>
	                    <BarChart3 size={18} aria-hidden="true" />
	                    Predict performance
	                  </button>
                  <button className="button" onClick={() => openPage("review")}>
                    <ClipboardCheck size={18} aria-hidden="true" />
                    Review draft
                  </button>
                  <button className="button" onClick={() => openPage("records")}>
                    View records
                  </button>
                </div>
              </div>
              <div className="activity-list">
                <h3>Recent activity</h3>
                {importHistory.length === 0 ? (
                  <p className="muted">No imports yet.</p>
                ) : (
                  importHistory.slice(0, 3).map((batch) => (
                    <div className="activity" key={batch.id}>
                      <CheckCircle2 size={18} aria-hidden="true" />
                      <span>
                        Imported {batch.summary.importedRows} rows
                        <small>{new Date(batch.importedAt).toLocaleString()}</small>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Newest records</h2>
                  <p>Quick scan of recently planned or imported content.</p>
                </div>
              </div>
              <RecordTable records={records.slice(0, 5)} onView={setViewer} onEdit={setEditor} onDelete={deleteRecord} />
            </section>
          </section>
	        ) : null}
	
	        {page === "patterns" ? (
	          <PatternsPanel
	            report={patternReport}
	            filters={patternFilters}
	            topics={topics}
	            sras={sraOptions}
	            onChange={updatePatternFilter}
	            onImport={() => openPage("import")}
	          />
	        ) : null}
	
	        {page === "records" ? (
	          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Records</h2>
                <p>Search, filter, edit, and keep the content queue clean.</p>
              </div>
              <button className="button primary" onClick={() => setEditor(emptyRecord())}>
                <Plus size={18} aria-hidden="true" />
                Add record
              </button>
            </div>
            <Filters
              search={search}
              setSearch={setSearch}
              status={statusFilter}
              setStatus={setStatusFilter}
              topic={topicFilter}
              setTopic={setTopicFilter}
              sortBy={sortBy}
              setSortBy={setSortBy}
              topics={topics}
              resultCount={filteredRecords.length}
            />
            <RecordTable records={visibleRecords} onView={setViewer} onEdit={setEditor} onDelete={deleteRecord} />
            <div className="pagination">
              <button className="button ghost" disabled={pageIndex <= 1} onClick={() => setPageIndex((current) => current - 1)}>
                Previous
              </button>
              <span>
                Page {pageIndex} of {pageCount}
              </span>
              <button
                className="button ghost"
                disabled={pageIndex >= pageCount}
                onClick={() => setPageIndex((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </section>
        ) : null}

        {page === "predict" ? (
          <PredictionPanel
            input={predictionInput}
            onChange={updatePredictionInput}
            result={prediction}
            topicOptions={predictionTopics.length ? predictionTopics : ["General"]}
            onRun={() =>
              trackEvent("prediction_run", {
                source: prediction.source,
                training_rows: prediction.trainingRows,
                has_images: predictionInput.hasImages
              })
            }
          />
        ) : null}

        {page === "review" ? (
          <DraftReviewPanel
            input={draftInput}
            onChange={updateDraftInput}
            onFile={handleDraftFile}
            onReview={() => void reviewDraft()}
            onDownload={() => void downloadReview()}
            result={completedReview?.result ?? null}
            topicOptions={predictionTopics.length ? predictionTopics : ["General"]}
            busy={reviewBusy}
            exportBusy={reviewExportBusy}
            message={reviewMessage}
            aiConnected={aiReviewEnabled()}
          />
        ) : null}

        {page === "import" ? (
          <section className="page-stack">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Import spreadsheet</h2>
                  <p>Upload the ASU Story Performance workbook or a CSV/XLSX template. Bad rows are shown clearly and skipped.</p>
                </div>
                <button className="button" onClick={() => downloadBlob(new Blob([templateCsv()], { type: "text/csv" }), "content-watchtower-template.csv")}>
                  <FileSpreadsheet size={18} aria-hidden="true" />
                  Download template
                </button>
              </div>
              <div className="drop-zone">
                <Upload size={28} aria-hidden="true" />
                <label htmlFor="file-upload">Choose a .csv or .xlsx file</label>
                <input
                  id="file-upload"
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                <small>Maximum import size: 5,000 rows. Invalid rows will not block valid rows.</small>
              </div>
              {busy ? <div className="notice">Reading file...</div> : null}
              {importMessage ? <div className="notice">{importMessage}</div> : null}
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Import from GA4</h2>
                  <p>Preview page-level GA4 performance before saving it into Watchtower for predictions.</p>
                </div>
                <div className="model-chip">{ga4ImportEnabled() ? "Property 315631542" : "GA4 endpoint missing"}</div>
              </div>
              <div className="two-col">
                <label>
                  Start date
                  <input
                    type="date"
                    value={ga4Input.startDate}
                    onChange={(event) => setGa4Input((current) => ({ ...current, startDate: event.target.value }))}
                  />
                </label>
                <label>
                  End date
                  <input
                    type="date"
                    value={ga4Input.endDate}
                    onChange={(event) => setGa4Input((current) => ({ ...current, endDate: event.target.value }))}
                  />
                </label>
              </div>
              <div className="two-col">
                <label>
                  URL contains
                  <input
                    value={ga4Input.pathContains}
                    onChange={(event) => setGa4Input((current) => ({ ...current, pathContains: event.target.value }))}
                  />
                </label>
                <label>
                  Row limit
                  <input
                    type="number"
                    min={100}
                    max={50000}
                    step={100}
                    value={ga4Input.limit}
                    onChange={(event) => setGa4Input((current) => ({ ...current, limit: Number(event.target.value) }))}
                  />
                </label>
              </div>
              <button className="button primary" disabled={ga4Busy || !ga4ImportEnabled()} onClick={() => void handleGa4Import()}>
                <BarChart3 size={18} aria-hidden="true" />
                {ga4Busy ? "Reading GA4..." : "Preview GA4 import"}
              </button>
              <p className="muted">
                GA4 import uses read-only aggregated page metrics. It does not import user-level data.
              </p>
            </section>

            {importRows.length ? (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Preview and validation</h2>
                    <p>
                      {validImportCount} valid, {importSummary.invalidRows} invalid, {importSummary.duplicateRows} duplicate.
                    </p>
                  </div>
                  <button className="button primary" disabled={validImportCount === 0} onClick={confirmImport}>
                    Confirm import
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 20).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>{String(row.row.title || "-")}</td>
                          <td>{String(row.row.status || "-")}</td>
                          <td className={row.valid ? "ok-text" : "error-text"}>
                            {row.valid ? "Ready to import" : row.errors.join(" ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {page === "export" ? (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Export</h2>
                <p>Export the current filtered records as CSV or XLSX.</p>
              </div>
            </div>
            <Filters
              search={search}
              setSearch={setSearch}
              status={statusFilter}
              setStatus={setStatusFilter}
              topic={topicFilter}
              setTopic={setTopicFilter}
              sortBy={sortBy}
              setSortBy={setSortBy}
              topics={topics}
              resultCount={filteredRecords.length}
            />
            <div className="export-panel">
              <BarChart3 size={36} aria-hidden="true" />
              <h3>{filteredRecords.length} records ready</h3>
              <p>Only summary fields are exported. Analytics events do not include record content.</p>
              <div className="button-row center">
                <button className="button primary" onClick={() => exportCsv()}>
                  Export CSV
                </button>
                <button className="button" onClick={() => void exportXlsx()}>
                  Export XLSX
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {page === "settings" ? (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Settings</h2>
                <p>Only the essentials for this MVP.</p>
              </div>
            </div>
            <div className="settings-grid">
              <div className="setting">
                <h3>Google Analytics 4</h3>
                <p>
                  {analyticsEnabled()
                    ? "GA4 product tracking is configured."
                    : "GA4 product tracking is disabled because no measurement ID is configured."}{" "}
                  {ga4ImportEnabled() ? "GA4 import is pointed at property 315631542." : "GA4 import needs a backend endpoint."}
                </p>
                <div className="connector-slot">
                  <span>Connector slot</span>
                  <code>VITE_GA_MEASUREMENT_ID / VITE_GA4_IMPORT_ENDPOINT</code>
                  <button className="button ghost" disabled>
                    Connect GA4
                  </button>
                </div>
              </div>
              <div className="setting">
                <h3>Spreadsheet format</h3>
                <p>Accepts the ASU workbook plus simple CSV/XLSX templates with title, date, images, length, word count, and metric columns.</p>
              </div>
              <div className="setting">
                <h3>AI review model</h3>
                <p>{aiReviewEnabled() ? "AI review endpoint is configured." : "Draft Review is using the local editorial model until an AI endpoint is configured."}</p>
                <div className="connector-slot">
                  <span>Connector slot</span>
                  <code>VITE_AI_REVIEW_ENDPOINT</code>
                  <button className="button ghost" disabled>
                    Connect AI
                  </button>
                </div>
              </div>
              <div className="setting">
                <h3>Data storage</h3>
                <p>This lightweight MVP stores records in this browser. Move to PostgreSQL before multi-user launch.</p>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {editor ? (
        <Modal title={editor.title ? "Edit record" : "New record"} onClose={() => setEditor(null)}>
          <RecordForm initial={editor} onCancel={() => setEditor(null)} onSave={saveRecord} />
        </Modal>
      ) : null}

      {viewer ? (
        <Modal title="Record details" onClose={() => setViewer(null)}>
          <div className="details">
            <Badge status={viewer.status} />
            <h2>{viewer.title}</h2>
            <p>{recommendationFor(viewer)}</p>
            <dl>
              <div>
                <dt>Topic</dt>
                <dd>{viewer.topic}</dd>
              </div>
              <div>
                <dt>Planned date</dt>
                <dd>{viewer.plannedDate}</dd>
              </div>
              <div>
                <dt>Word count</dt>
                <dd>{viewer.wordCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>{viewer.score}/100</dd>
              </div>
            </dl>
            {viewer.notes ? <p className="note-box">{viewer.notes}</p> : null}
            <div className="button-row right">
              <button className="button danger" onClick={() => deleteRecord(viewer)}>
                Delete
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setEditor(viewer);
                  setViewer(null);
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function DraftReviewPanel({
  input,
  onChange,
  onFile,
  onReview,
  onDownload,
  result,
  topicOptions,
  busy,
  exportBusy,
  message,
  aiConnected
}: {
  input: DraftReviewInput;
  onChange: <K extends keyof DraftReviewInput>(key: K, value: DraftReviewInput[K]) => void;
  onFile: (file: File) => void;
  onReview: () => void;
  onDownload: () => void;
  result: DraftReviewResult | null;
  topicOptions: string[];
  busy: boolean;
  exportBusy: boolean;
  message: string;
  aiConnected: boolean;
}) {
  return (
    <section className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Draft Review</h2>
            <p>Review a draft before it moves to public content.</p>
          </div>
          <div className="model-chip">{aiConnected ? "AI endpoint connected" : "Local review active"}</div>
        </div>
        <div className="review-grid">
          <form className="review-form">
            <label>
              Story title
              <input value={input.title} disabled={busy} onChange={(event) => onChange("title", event.target.value)} />
            </label>
            <div className="two-col">
              <label>
                Topic or SRA
                <select value={input.topic} disabled={busy} onChange={(event) => onChange("topic", event.target.value)}>
                  <option>General</option>
                  {topicOptions
                    .filter((topic) => topic !== "General")
                    .map((topic) => (
                      <option key={topic}>{topic}</option>
                    ))}
                </select>
              </label>
              <label>
                Planned date
                <input type="date" value={input.plannedDate} disabled={busy} onChange={(event) => onChange("plannedDate", event.target.value)} />
              </label>
            </div>
            <div className="two-col">
              <label>
                Length
                <select value={input.length} disabled={busy} onChange={(event) => onChange("length", event.target.value as "Long" | "Short")}>
                  <option>Long</option>
                  <option>Short</option>
                </select>
              </label>
              <label>
                Images
                <select value={input.hasImages ? "Yes" : "No"} disabled={busy} onChange={(event) => onChange("hasImages", event.target.value === "Yes")}>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </label>
            </div>
            <label>
              Draft text
              <textarea
                className="draft-textarea"
                value={input.draftText}
                disabled={busy}
                placeholder="Paste draft text here"
                onChange={(event) => onChange("draftText", event.target.value)}
              />
            </label>
            <div className="upload-inline">
              <label htmlFor="draft-upload">Upload .txt or .md</label>
              <input
                id="draft-upload"
                type="file"
                disabled={busy}
                accept=".txt,.md,text/plain,text/markdown"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
            </div>
            {message ? <div className="notice">{message}</div> : null}
            <button type="button" className="button primary" disabled={busy} onClick={onReview}>
              <ClipboardCheck size={18} aria-hidden="true" />
              {busy ? "Reviewing..." : "Review draft"}
            </button>
          </form>

          {result ? (
            <div className="review-results">
              <div className="review-results-toolbar">
                <button type="button" className="button" onClick={onDownload} disabled={exportBusy} title="Save the feedback and reviewed draft as a Word document">
                  <Download size={18} aria-hidden="true" />
                  {exportBusy ? "Preparing Word..." : "Download Word"}
                </button>
              </div>
              <div className="review-score">
                <span>{result.readinessLabel}</span>
                <strong>{result.readinessScore}/100</strong>
                <small>{result.source === "ai-model" ? "AI model review" : "Local editorial review"}</small>
              </div>
              <p className="note-box">{result.summary}</p>
              <div className="prediction-cards">
                <Metric label="Predicted 30-day" value={formatNumber(result.prediction.pred30)} hint={result.prediction.className} />
                <Metric label="Headline score" value={`${result.headlineScore}/10`} hint={result.headlineFeedback} />
                <Metric label="Word count" value={formatNumber(result.stats.wordCount)} hint={`Grade ${result.stats.gradeLevel}`} />
              </div>

              <div className="review-insight-grid">
                <div className="driver-list insight-block">
                  <div className="insight-heading">
                    <h3>SEO critique</h3>
                    <span>{result.seo.score}/10</span>
                  </div>
                  <p>{result.seo.summary}</p>
                  <div className="keyword-row">
                    {result.seo.keywordOpportunities.map((keyword) => (
                      <span key={keyword}>{keyword}</span>
                    ))}
                  </div>
                  <p className="field-note">{result.seo.titleGuidance}</p>
                  <p className="meta-preview">{result.seo.metaDescription}</p>
                </div>

                <div className="driver-list insight-block">
                  <div className="insight-heading">
                    <h3>Trend angle</h3>
                    <SourcePill source="AI inference" />
                  </div>
                  <p>{result.trend.summary}</p>
                  <InsightList items={result.trend.opportunities} />
                  <p className="field-note">{result.trend.caveat}</p>
                </div>
              </div>

              <div className="driver-list insight-block">
                <h3>Concrete draft edits</h3>
                <div className="rewrite-box">
                  <strong>Lead direction</strong>
                  <p>{result.rewrite.leadRewrite}</p>
                </div>
                <div className="review-columns">
                  <div>
                    <h4>Simplify</h4>
                    <InsightList items={result.rewrite.simplify} />
                  </div>
                  <div>
                    <h4>Edit next</h4>
                    <InsightList items={result.rewrite.concreteEdits} />
                  </div>
                </div>
              </div>

              <div className="driver-list">
                <h3>Top recommendations</h3>
                {result.recommendations.map((item) => (
                  <div className="recommendation" key={`${item.category}-${item.title}`}>
                    <span className={`priority-pill priority-${item.priority.toLowerCase()}`}>{item.priority}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <small>{item.impact}</small>
                    </div>
                  </div>
                ))}
              </div>

              <div className="review-columns">
                <div className="driver-list">
                  <h3>Headline options</h3>
                  {result.headlineOptions.map((headline) => (
                    <p className="headline-option" key={headline}>
                      {headline}
                    </p>
                  ))}
                </div>
                <div className="driver-list">
                  <h3>Editor checklist</h3>
                  {result.checklist.map((item) => (
                    <div className="check-row" key={item.label}>
                      <CheckCircle2 size={17} aria-hidden="true" className={item.done ? "check-ok" : "check-muted"} />
                      <span>
                        {item.label}
                        <small>{item.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="driver-list">
                <h3>Evidence signals</h3>
                <div className="evidence-list">
                  {result.evidence.map((item) => (
                    <div className="evidence-row" key={`${item.source}-${item.label}`}>
                      <SourcePill source={item.source} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state review-empty">
              <ClipboardCheck size={36} aria-hidden="true" />
              <h3>No review yet</h3>
              <p>Paste a draft and run the review to see readiness, SEO critique, recommendations, and checklist items.</p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function PredictionPanel({
  input,
  onChange,
  result,
  topicOptions,
  onRun
}: {
  input: PredictionInput;
  onChange: <K extends keyof PredictionInput>(key: K, value: PredictionInput[K]) => void;
  result: PredictionResult;
  topicOptions: string[];
  onRun: () => void;
}) {
  return (
    <section className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Predict performance</h2>
            <p>Estimate 30-day and 90-day pageviews from the historical workbook you upload.</p>
          </div>
          <div className="model-chip">
            {result.source === "historical-model" ? `${result.trainingRows.toLocaleString()} historical rows` : "Baseline mode"}
          </div>
        </div>
        <div className="prediction-grid">
          <form className="prediction-form">
            <label>
              Story title
              <input value={input.title} onChange={(event) => onChange("title", event.target.value)} />
            </label>
            <label>
              Topic or SRA
              <select value={input.topic} onChange={(event) => onChange("topic", event.target.value)}>
                <option>General</option>
                {topicOptions
                  .filter((topic) => topic !== "General")
                  .map((topic) => (
                    <option key={topic}>{topic}</option>
                  ))}
              </select>
            </label>
            <div className="two-col">
              <label>
                Planned date
                <input type="date" value={input.plannedDate} onChange={(event) => onChange("plannedDate", event.target.value)} />
              </label>
              <label>
                Word count
                <input
                  type="number"
                  min="0"
                  value={input.wordCount}
                  onChange={(event) => onChange("wordCount", Number(event.target.value))}
                />
              </label>
            </div>
            <div className="two-col">
              <label>
                Length
                <select value={input.length} onChange={(event) => onChange("length", event.target.value as "Long" | "Short")}>
                  <option>Long</option>
                  <option>Short</option>
                </select>
              </label>
              <label>
                Images
                <select
                  value={input.hasImages ? "Yes" : "No"}
                  onChange={(event) => onChange("hasImages", event.target.value === "Yes")}
                >
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </label>
            </div>
            <button type="button" className="button primary" onClick={onRun}>
              <BarChart3 size={18} aria-hidden="true" />
              Update prediction
            </button>
          </form>

          <div className="prediction-results">
            <div className="prediction-cards">
              <Metric label="30-day pageviews" value={formatNumber(result.pred30)} hint={`Range ${formatNumber(result.interval[0])}-${formatNumber(result.interval[1])}`} />
              <Metric label="90-day pageviews" value={formatNumber(result.pred90)} hint="Based on historical 90/30 ratio" />
              <Metric label="Performance class" value={result.className} hint={`${Math.round(result.confidence * 100)}% confidence`} />
            </div>
            <div className="notice">
              {result.source === "historical-model"
                ? "Prediction is using historical rows with pageview data from uploaded or sample records."
                : "Import the ASU performance workbook to train this estimate on real history."}
            </div>
            <div className="driver-list">
              <h3>Why this prediction?</h3>
              {result.drivers.length ? (
                result.drivers.map((driver) => (
                  <div className="activity" key={driver}>
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <span>{driver}</span>
                  </div>
                ))
              ) : (
                <p className="muted">Import more historical rows to show stronger drivers.</p>
              )}
            </div>
            <div className="metric-detail-grid">
              <span>30-day users: {formatNumber(result.metrics30.users)}</span>
              <span>30-day sessions: {formatNumber(result.metrics30.sessions)}</span>
              <span>Engagement: {formatDuration(result.metrics30.engagementSeconds)}</span>
              <span>Bounce rate: {formatPercent(result.metrics30.bounceRate)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Similar historical stories</h2>
            <p>Use these as a quick gut-check for the estimate.</p>
          </div>
        </div>
        <RecordTable records={result.similarRecords} onView={() => undefined} onEdit={() => undefined} onDelete={() => undefined} readonly />
      </section>
    </section>
  );
}

function Filters({
  search,
  setSearch,
  status,
  setStatus,
  topic,
  setTopic,
  sortBy,
  setSortBy,
  topics,
  resultCount
}: {
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  topic: string;
  setTopic: (value: string) => void;
  sortBy: string;
  setSortBy: (value: string) => void;
  topics: string[];
  resultCount: number;
}) {
  return (
    <div className="filters">
      <label className="search-box">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search records</span>
        <input
          placeholder="Search title, topic, or owner"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (event.target.value.trim()) trackEvent("search_used", { result_count: resultCount });
          }}
        />
      </label>
      <label>
        Status
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            trackEvent("filter_applied", { filter: "status" });
          }}
        >
          <option>All</option>
          {statuses.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        Topic
        <select
          value={topic}
          onChange={(event) => {
            setTopic(event.target.value);
            trackEvent("filter_applied", { filter: "topic" });
          }}
        >
          {topics.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        Sort
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option>Planned date</option>
          <option>Score</option>
          <option>Status</option>
          <option>Title</option>
        </select>
      </label>
    </div>
  );
}

function RecordTable({
  records,
  onView,
  onEdit,
  onDelete,
  readonly = false
}: {
  records: WatchtowerRecord[];
  onView: (record: WatchtowerRecord) => void;
  onEdit: (record: WatchtowerRecord) => void;
  onDelete: (record: WatchtowerRecord) => void;
  readonly?: boolean;
}) {
  if (records.length === 0) {
    return (
      <div className="empty-state">
        <FileText size={34} aria-hidden="true" />
        <h3>No records found</h3>
        <p>Try a different filter or import a spreadsheet.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Topic</th>
            <th>Planned date</th>
            <th>Status</th>
            <th>Score</th>
            {readonly ? <th>30-day pageviews</th> : <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <strong>{record.title}</strong>
                <small>{recommendationFor(record)}</small>
              </td>
              <td>{record.topic}</td>
              <td>{record.plannedDate}</td>
              <td>
                <Badge status={record.status} />
              </td>
              <td>{record.score}/100</td>
              {readonly ? (
                <td>{formatNumber(record.metrics30?.pageviews)}</td>
              ) : (
                <td>
                  <div className="icon-actions">
                    <button aria-label={`View ${record.title}`} onClick={() => onView(record)}>
                      <FileText size={16} aria-hidden="true" />
                    </button>
                    <button aria-label={`Edit ${record.title}`} onClick={() => onEdit(record)}>
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button aria-label={`Delete ${record.title}`} onClick={() => onDelete(record)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default App;
