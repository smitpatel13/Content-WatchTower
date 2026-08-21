type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

const allowedEvents = new Set([
  "dashboard_viewed",
  "record_created",
  "record_updated",
  "record_deleted",
  "prediction_run",
  "draft_review_run",
  "excel_import_started",
  "excel_import_completed",
  "excel_import_failed",
  "excel_export_completed",
  "filter_applied",
  "search_used",
  "feature_opened"
]);

const blockedKeys = ["name", "email", "student", "asurite", "record_id", "row", "content", "notes", "search", "token"];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function analyticsEnabled(): boolean {
  return Boolean(import.meta.env.VITE_GA_MEASUREMENT_ID);
}

export function sanitizeAnalyticsParams(params: AnalyticsParams = {}): AnalyticsParams {
  return Object.fromEntries(
    Object.entries(params).filter(([key, value]) => {
      const lower = key.toLowerCase();
      if (blockedKeys.some((blocked) => lower.includes(blocked))) return false;
      if (typeof value === "string" && value.length > 80) return false;
      return value !== undefined && value !== null;
    })
  );
}

export function initAnalytics(): void {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (!measurementId || typeof document === "undefined") return;
  if (document.querySelector(`script[data-ga-id="${measurementId}"]`)) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.dataset.gaId = measurementId;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    anonymize_ip: true,
    send_page_view: false
  });
}

export function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (!allowedEvents.has(name)) return;
  if (!analyticsEnabled() || typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, sanitizeAnalyticsParams(params));
}
