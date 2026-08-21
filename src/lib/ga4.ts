import type { ImportRow } from "../types";

export interface Ga4ImportOptions {
  startDate: string;
  endDate: string;
  pathContains: string;
  limit: number;
}

export interface Ga4ImportResponse {
  propertyId: string;
  rowCount: number;
  importedRows: number;
  rows: ImportRow[];
}

function configuredEndpoint(): string {
  return import.meta.env.VITE_GA4_IMPORT_ENDPOINT || "";
}

function isSafeEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return url.protocol === "https:" || (import.meta.env.DEV && local && url.protocol === "http:");
  } catch {
    return false;
  }
}

export function ga4ImportEnabled(): boolean {
  const endpoint = configuredEndpoint();
  return Boolean(endpoint && isSafeEndpoint(endpoint));
}

export async function fetchGa4ImportRows(options: Ga4ImportOptions): Promise<Ga4ImportResponse> {
  const endpoint = configuredEndpoint();
  if (!endpoint || !isSafeEndpoint(endpoint)) {
    throw new Error("GA4 import endpoint is not configured.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "GA4 import failed.");
  }
  return payload as Ga4ImportResponse;
}
