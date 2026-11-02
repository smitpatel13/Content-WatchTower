import type { ImportRow, ImportSummary, ImportValidationResult, PerformanceMetrics, RecordStatus, WatchtowerRecord } from "../types";
import { deriveTopicFromUrl } from "./prediction";
import { computeScore, statuses } from "./scoring";

const requiredHeaders = ["Title", "Topic", "Planned Date", "Word Count", "Images", "Status"];
const optionalHeaders = [
  "Length",
  "SRA",
  "Owner",
  "URL",
  "Notes",
  "30-day Users",
  "30-day Sessions",
  "30-day Pageviews",
  "30-day Session Eng. Time",
  "30-day Bounce Rate",
  "90-day Users",
  "90-day Sessions",
  "90-day Pageviews",
  "90-day Session Eng. Time",
  "90-day Bounce Rate"
];
export const allHeaders = [...requiredHeaders, ...optionalHeaders];
export const maxRows = 5000;
const maxFileBytes = 10 * 1024 * 1024;

async function loadExcel() {
  const { default: ExcelJS } = await import("exceljs");
  return ExcelJS;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result);
    if ("text" in value) return cellText(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part: { text?: string }) => part.text || "").join("");
    }
    return "";
  }
  return String(value);
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function canonicalHeader(header: string): string | undefined {
  const normalized = normalizeHeader(header);
  return allHeaders.find((known) => normalizeHeader(known) === normalized);
}

function metricKey(label: string, group: string): keyof ImportRow | undefined {
  const normalized = normalizeHeader(`${group} ${label}`);
  const horizon = normalized.includes("90") ? "90" : normalized.includes("30") ? "30" : "";
  if (!horizon) return undefined;
  if (normalized.includes("pageview")) return `pageviews${horizon}` as keyof ImportRow;
  if (normalized.includes("session eng")) return `engagementTime${horizon}` as keyof ImportRow;
  if (normalized.includes("bounce")) return `bounceRate${horizon}` as keyof ImportRow;
  if (normalized.includes("sessions")) return `sessions${horizon}` as keyof ImportRow;
  if (normalized.includes("users")) return `users${horizon}` as keyof ImportRow;
  return undefined;
}

function canonicalImportKey(header: string, group = ""): keyof ImportRow | undefined {
  const normalized = normalizeHeader(header);
  const metric = metricKey(header, group);
  if (metric) return metric;
  if (["title", "story title", "original from content calendar"].includes(normalized)) return "title";
  if (["topic", "story topic"].includes(normalized)) return "topic";
  if (["planned date", "publication date", "date"].includes(normalized)) return "plannedDate";
  if (normalized === "word count") return "wordCount";
  if (["images", "contain images", "contain images in between"].includes(normalized)) return "images";
  if (normalized === "status") return "status";
  if (["length", "long(l) or short(s)", "long or short"].includes(normalized)) return "length";
  if (normalized === "sra") return "sra";
  if (normalized === "owner") return "owner";
  if (["url", "news url"].includes(normalized)) return "url";
  if (normalized === "notes") return "notes";
  return undefined;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

function headerScore(row: string[]): number {
  const normalized = row.map((cell) => normalizeHeader(String(cell || "")));
  return [
    "title",
    "original from content calendar",
    "publication date",
    "planned date",
    "news url",
    "word count",
    "contain images in between",
    "pageviews"
  ].filter((needle) => normalized.some((cell) => cell.includes(needle))).length;
}

function findHeaderIndex(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 8).forEach((row, index) => {
    const score = headerScore(row);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function rowsToObjects(rows: string[][], sourceSheet = "Upload"): ImportRow[] {
  if (rows.length === 0) return [];
  const headerIndex = findHeaderIndex(rows);
  const groupRow = headerIndex > 0 ? rows[headerIndex - 1] : [];
  let activeGroup = "";
  const groupLabels = rows[headerIndex].map((_, index) => {
    const label = String(groupRow[index] || "").trim();
    if (label) activeGroup = label;
    return activeGroup;
  });
  const headers = rows[headerIndex].map((header, index) => canonicalImportKey(header, groupLabels[index] || ""));

  return rows.slice(headerIndex + 1).map((cells, rowOffset) => {
    const item: Partial<ImportRow> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      item[header] = cells[index] || "";
    });
    const url = String(item.url || "").trim();
    return {
      title: item.title || titleFromUrl(url),
      topic: item.topic || item.sra || deriveTopicFromUrl(url),
      plannedDate: item.plannedDate || dateFromUrl(url),
      wordCount: item.wordCount || "",
      images: item.images || "",
      status: item.status || "",
      length: item.length || "",
      sra: item.sra || "",
      owner: item.owner || "",
      url,
      notes: item.notes || "",
      users30: item.users30,
      sessions30: item.sessions30,
      pageviews30: item.pageviews30,
      engagementTime30: item.engagementTime30,
      bounceRate30: item.bounceRate30,
      users90: item.users90,
      sessions90: item.sessions90,
      pageviews90: item.pageviews90,
      engagementTime90: item.engagementTime90,
      bounceRate90: item.bounceRate90,
      sourceSheet: `${sourceSheet} row ${headerIndex + rowOffset + 2}`
    };
  });
}

export function parseSpreadsheetText(text: string): ImportRow[] {
  return rowsToObjects(parseCsv(text));
}

export async function parseSpreadsheetFile(file: File): Promise<ImportRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.size > maxFileBytes) throw new Error("Upload a file smaller than 10 MB.");
  if (extension === "csv") {
    return parseSpreadsheetText(await file.text());
  }
  if (extension === "xlsx") {
    const ExcelJS = await loadExcel();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const preferredSheet =
      workbook.worksheets.find((sheet) => sheet.name.toLowerCase() === "updated") ||
      workbook.worksheets.find((sheet) => ["original", "comparison"].includes(sheet.name.toLowerCase())) ||
      workbook.worksheets[0];
    if (!preferredSheet) throw new Error("The workbook has no sheets.");
    const rows: string[][] = [];
    preferredSheet.eachRow((row) => {
      const cells = Array.from({ length: row.cellCount }, (_, index) => cellText(row.getCell(index + 1).value));
      if (cells.some(Boolean)) rows.push(cells);
    });
    return rowsToObjects(rows, preferredSheet.name);
  }
  throw new Error("Upload a .csv or .xlsx file.");
}

function normalizeStatus(value: string): RecordStatus | undefined {
  const match = statuses.find((status) => status.toLowerCase() === value.trim().toLowerCase());
  return match;
}

function parseImages(value: string | boolean): boolean | undefined {
  if (typeof value === "boolean") return value;
  const normalized = value.trim().toLowerCase();
  if (["yes", "y", "true", "1", "images"].includes(normalized)) return true;
  if (["no", "n", "false", "0", "none"].includes(normalized)) return false;
  return undefined;
}

function parseNumber(value: string | number | boolean | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === undefined) return undefined;
  const normalized = value.trim().replace(/,/g, "").replace("%", "");
  if (!normalized) return undefined;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function parsePercent(value: string | number | boolean | undefined): number | undefined {
  const number = parseNumber(value);
  if (number === undefined) return undefined;
  return number <= 1 ? number * 100 : number;
}

function parseDuration(value: string | number | boolean | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (!text.includes(":")) return parseNumber(text);
  const parts = text.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

function buildMetrics(row: ImportRow, horizon: "30" | "90"): PerformanceMetrics | undefined {
  const metrics: PerformanceMetrics = {
    users: parseNumber(row[`users${horizon}` as keyof ImportRow] as string | number | undefined),
    sessions: parseNumber(row[`sessions${horizon}` as keyof ImportRow] as string | number | undefined),
    pageviews: parseNumber(row[`pageviews${horizon}` as keyof ImportRow] as string | number | undefined),
    engagementSeconds: parseDuration(row[`engagementTime${horizon}` as keyof ImportRow] as string | number | undefined),
    bounceRate: parsePercent(row[`bounceRate${horizon}` as keyof ImportRow] as string | number | undefined)
  };
  return Object.values(metrics).some((value) => Number.isFinite(value)) ? metrics : undefined;
}

function normalizeLength(value: string | undefined, wordCount: number): "Long" | "Short" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.startsWith("l") || normalized.includes("800+")) return "Long";
  if (normalized.startsWith("s") || normalized.includes("short") || normalized.includes("under")) return "Short";
  return wordCount >= 800 ? "Long" : "Short";
}

function titleFromUrl(url: string): string {
  const slug = url.trim().replace(/\s+\|\s+ASU News$/i, "").replace(/\/$/, "").split("/").pop() || "";
  return slug.replace(/^\d{8}-/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateFromUrl(url: string): string {
  const match = url.match(/(?:^|\/)(20\d{2})(\d{2})(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function duplicateKey(record: Pick<WatchtowerRecord, "title" | "plannedDate">): string {
  return `${record.title.trim().toLowerCase()}|${record.plannedDate}`;
}

export function validateImportRows(rows: ImportRow[], existingRecords: WatchtowerRecord[]): ImportValidationResult[] {
  const existingKeys = new Set(existingRecords.map(duplicateKey));
  const uploadKeys = new Set<string>();

  return rows.slice(0, maxRows).map((row, index) => {
    const errors: string[] = [];
    const url = String(row.url || "").trim();
    const title = String(row.title || titleFromUrl(url)).trim();
    const topic = String(row.topic || row.sra || deriveTopicFromUrl(url) || "General").trim();
    const plannedDate = String(row.plannedDate || "").trim();
    const metrics30 = buildMetrics(row, "30");
    const metrics90 = buildMetrics(row, "90");
    const hasPerformance = Boolean(metrics30?.pageviews || metrics90?.pageviews);
    const wordCount = parseNumber(row.wordCount) || 0;
    const rawImages = String(row.images || "").trim();
    const parsedImages = parseImages(row.images);
    const hasImages = parsedImages ?? false;
    const rawStatus = String(row.status || "").trim();
    const status = rawStatus ? normalizeStatus(rawStatus) : hasPerformance ? "Published" : "Draft";
    const length = normalizeLength(row.length, wordCount);

    if (!title) errors.push("Title is required.");
    if (!topic) errors.push("Topic is required.");
    if (!plannedDate || Number.isNaN(Date.parse(plannedDate))) errors.push("Planned Date must be a valid date.");
    if (!Number.isFinite(wordCount) || wordCount < 0) errors.push("Word Count must be zero or higher.");
    if (rawImages && parsedImages === undefined) errors.push("Images must be Yes or No.");
    if (!status) errors.push(`Status must be one of: ${statuses.join(", ")}.`);

    const draftRecord: WatchtowerRecord | undefined =
      errors.length === 0 && status
        ? {
            id: crypto.randomUUID(),
            title,
            topic,
            plannedDate: new Date(plannedDate).toISOString().slice(0, 10),
            wordCount,
            hasImages,
            length,
            sra: String(row.sra || "").trim(),
            status,
            owner: String(row.owner || "").trim(),
            url,
            notes: String(row.notes || "").trim(),
            score: 0,
            metrics30,
            metrics90,
            source: "import",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        : undefined;

    if (draftRecord) {
      draftRecord.score = computeScore(draftRecord);
    }

    const key = draftRecord ? duplicateKey(draftRecord) : "";
    const duplicate = Boolean(draftRecord && (existingKeys.has(key) || uploadKeys.has(key)));
    if (draftRecord) uploadKeys.add(key);

    return {
      rowNumber: index + 2,
      row,
      record: draftRecord,
      valid: errors.length === 0 && !duplicate,
      duplicate,
      errors: duplicate ? [...errors, "Duplicate title and planned date."] : errors
    };
  });
}

export function summarizeImport(results: ImportValidationResult[]): ImportSummary {
  const invalidRows = results.filter((row) => row.errors.length > 0 && !row.duplicate).length;
  const duplicateRows = results.filter((row) => row.duplicate).length;
  const importedRows = results.filter((row) => row.valid).length;
  return {
    totalRows: results.length,
    importedRows,
    skippedRows: results.length - importedRows,
    invalidRows,
    duplicateRows
  };
}

function escapeCsv(value: string | number | boolean): string {
  const raw = String(value);
  const text = typeof value === "string" && /^[\s\x00-\x1f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function recordsToCsv(records: WatchtowerRecord[]): string {
  const rows = [
    allHeaders,
    ...records.map((record) => [
      record.title,
      record.topic,
      record.plannedDate,
      record.wordCount,
      record.hasImages ? "Yes" : "No",
      record.status,
      record.length,
      record.sra || "",
      record.owner,
      record.url,
      record.notes,
      record.metrics30?.users || "",
      record.metrics30?.sessions || "",
      record.metrics30?.pageviews || "",
      record.metrics30?.engagementSeconds || "",
      record.metrics30?.bounceRate || "",
      record.metrics90?.users || "",
      record.metrics90?.sessions || "",
      record.metrics90?.pageviews || "",
      record.metrics90?.engagementSeconds || "",
      record.metrics90?.bounceRate || ""
    ])
  ];
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export async function recordsToXlsxBlob(records: WatchtowerRecord[]): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Records");
  worksheet.addRow(allHeaders);
  for (const record of records) {
    worksheet.addRow([
      record.title, record.topic, record.plannedDate, record.wordCount, record.hasImages ? "Yes" : "No",
      record.status, record.length, record.sra || "", record.owner, record.url, record.notes,
      record.metrics30?.users ?? "", record.metrics30?.sessions ?? "", record.metrics30?.pageviews ?? "",
      record.metrics30?.engagementSeconds ?? "", record.metrics30?.bounceRate ?? "",
      record.metrics90?.users ?? "", record.metrics90?.sessions ?? "", record.metrics90?.pageviews ?? "",
      record.metrics90?.engagementSeconds ?? "", record.metrics90?.bounceRate ?? ""
    ]);
  }
  const array = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(array)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function templateCsv(): string {
  return [
    allHeaders.join(","),
    "Example story title,Research,2026-08-15,900,Yes,Published,Long,Research,Content team,https://example.edu/story,Optional note,1200,1380,1500,42,38.5,1600,1840,2050,44,37.2"
  ].join("\n");
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
