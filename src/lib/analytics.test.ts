import { describe, expect, it, vi } from "vitest";
import { sanitizeAnalyticsParams, trackEvent } from "./analytics";

describe("analytics", () => {
  it("removes sensitive fields before sending GA4 params", () => {
    const sanitized = sanitizeAnalyticsParams({
      feature: "records",
      email: "person@example.com",
      record_id: "abc123",
      notes: "private note",
      count: 4,
      long_value: "x".repeat(90),
      ok: true
    });

    expect(sanitized).toEqual({ feature: "records", count: 4, ok: true });
  });

  it("ignores events outside the approved product-event list", () => {
    window.gtag = vi.fn();
    trackEvent("raw_content_submitted", { feature: "bad" });

    expect(window.gtag).not.toHaveBeenCalled();
  });
});
