import type { ImportBatch, WatchtowerRecord } from "../types";
import { sampleRecords } from "./sampleData";

const recordsKey = "content-watchtower.records";
const importsKey = "content-watchtower.imports";

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function loadRecords(): WatchtowerRecord[] {
  if (typeof window === "undefined") return sampleRecords;
  const records = safeParse<WatchtowerRecord[]>(window.localStorage.getItem(recordsKey), []).map(normalizeRecord);
  if (records.length) return records;
  window.localStorage.setItem(recordsKey, JSON.stringify(sampleRecords));
  return sampleRecords;
}

function normalizeRecord(record: WatchtowerRecord): WatchtowerRecord {
  return {
    ...record,
    length: record.length || (record.wordCount >= 800 ? "Long" : "Short"),
    sra: record.sra || record.topic,
    source: record.source || "manual"
  };
}

export function saveRecords(records: WatchtowerRecord[]): void {
  window.localStorage.setItem(recordsKey, JSON.stringify(records));
}

export function loadImportHistory(): ImportBatch[] {
  if (typeof window === "undefined") return [];
  return safeParse<ImportBatch[]>(window.localStorage.getItem(importsKey), []);
}

export function saveImportHistory(batches: ImportBatch[]): void {
  window.localStorage.setItem(importsKey, JSON.stringify(batches));
}
