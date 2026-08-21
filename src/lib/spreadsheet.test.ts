import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { ImportRow, WatchtowerRecord } from "../types";
import { parseSpreadsheetFile, parseSpreadsheetText, recordsToCsv, summarizeImport, templateCsv, validateImportRows } from "./spreadsheet";

const existingRecord: WatchtowerRecord = {
  id: "existing-1",
  title: "Existing story",
  topic: "Research",
  plannedDate: "2026-08-15",
  wordCount: 900,
  hasImages: true,
  length: "Long",
  status: "Ready",
  owner: "Content team",
  url: "",
  notes: "",
  score: 93,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

describe("spreadsheet imports", () => {
  it("accepts valid rows and normalizes dates", () => {
    const rows: ImportRow[] = [
      {
        title: "New student profile",
        topic: "Students",
        plannedDate: "August 20, 2026",
        wordCount: "875",
        images: "Yes",
        status: "Draft",
        owner: "Editorial"
      }
    ];

    const results = validateImportRows(rows, []);

    expect(results[0]).toMatchObject({ valid: true, duplicate: false, errors: [] });
    expect(results[0].record?.plannedDate).toBe("2026-08-20");
    expect(results[0].record?.score).toBeGreaterThan(0);
  });

  it("flags invalid fields without blocking other valid rows", () => {
    const rows: ImportRow[] = [
      {
        title: "",
        topic: "",
        plannedDate: "not-a-date",
        wordCount: "-3",
        images: "maybe",
        status: "Done"
      },
      {
        title: "Valid community update",
        topic: "Community",
        plannedDate: "2026-09-12",
        wordCount: "760",
        images: "No",
        status: "Ready"
      }
    ];

    const results = validateImportRows(rows, []);
    const summary = summarizeImport(results);

    expect(results[0].valid).toBe(false);
    expect(results[0].errors.join(" ")).toContain("Title is required.");
    expect(results[1].valid).toBe(true);
    expect(summary).toMatchObject({ totalRows: 2, importedRows: 1, skippedRows: 1, invalidRows: 1 });
  });

  it("detects duplicates against existing records and the same upload", () => {
    const duplicateRows: ImportRow[] = [
      {
        title: "Existing story",
        topic: "Research",
        plannedDate: "2026-08-15",
        wordCount: "900",
        images: "Yes",
        status: "Ready"
      },
      {
        title: "Same upload story",
        topic: "Health",
        plannedDate: "2026-09-01",
        wordCount: "700",
        images: "Yes",
        status: "Draft"
      },
      {
        title: "Same upload story",
        topic: "Health",
        plannedDate: "2026-09-01",
        wordCount: "700",
        images: "Yes",
        status: "Draft"
      }
    ];

    const results = validateImportRows(duplicateRows, [existingRecord]);

    expect(results[0]).toMatchObject({ valid: false, duplicate: true });
    expect(results[1]).toMatchObject({ valid: true, duplicate: false });
    expect(results[2]).toMatchObject({ valid: false, duplicate: true });
  });

  it("exports CSV safely and provides a usable template", () => {
    const csv = recordsToCsv([
      {
        ...existingRecord,
        title: 'Story with "quotes"',
        notes: "Contains, punctuation"
      }
    ]);

    expect(csv).toContain('"Story with ""quotes"""');
    expect(csv).toContain('"Contains, punctuation"');
    expect(templateCsv().split("\n")[0]).toContain("30-day Pageviews");
  });

  it("parses the ASU grouped 30-day and 90-day workbook layout", () => {
    const text = [
      "Source,,,,,,,30 day visits,,,,,90 day visits,,,,",
      "Original From Content Calendar,Publication Date,News URL,Contain Images in Between,Long(L) or Short(S),Word Count,SRA,Users,Sessions,Pageviews,Session Eng. Time,Bounce Rate,Users,Sessions,Pageviews,Session Eng. Time,Bounce Rate",
      "Intermittent fasting shows promise,5/28/2024,news.asu.edu/20240528-health-and-medicine-intermittent-fasting-shows-promise,Yes,S,993,Health,\"5,599\",\"6,084\",\"6,844\",0:00:24,71.40%,\"5,763\",\"6,322\",\"7,112\",0:00:25,70.09%"
    ].join("\n");

    const rows = parseSpreadsheetText(text);
    const results = validateImportRows(rows, []);

    expect(results[0].valid).toBe(true);
    expect(results[0].record?.title).toBe("Intermittent fasting shows promise");
    expect(results[0].record?.length).toBe("Short");
    expect(results[0].record?.metrics30?.pageviews).toBe(6844);
    expect(results[0].record?.metrics90?.bounceRate).toBe(70.09);
  });

  it("parses an ASU-style XLSX upload from the Updated sheet", async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Source", "", "", "", "", "", "", "30 day visits", "", "", "", "", "90 day visits"],
      [
        "Original From Content Calendar",
        "Publication Date",
        "News URL",
        "Contain Images in Between",
        "Long(L) or Short(S)",
        "Word Count",
        "SRA",
        "Users",
        "Sessions",
        "Pageviews",
        "Session Eng. Time",
        "Bounce Rate",
        "Users",
        "Sessions",
        "Pageviews",
        "Session Eng. Time",
        "Bounce Rate"
      ],
      [
        "Freshwater is disappearing",
        "7/25/2025",
        "news.asu.edu/20250725-environment-and-sustainability-new-global-study-shows-freshwater-disappearing",
        "Yes",
        "L",
        "1115",
        "",
        "3,582",
        "4,010",
        "4,380",
        "0:00:43",
        "45.29%",
        "7,207",
        "7,842",
        "8,473",
        "0:00:28",
        "63.61%"
      ]
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Updated");
    const array = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const rows = await parseSpreadsheetFile({
      name: "ASU Story Performance .xlsx",
      arrayBuffer: async () => array
    } as File);
    const results = validateImportRows(rows, []);

    expect(results[0].valid).toBe(true);
    expect(results[0].record?.topic).toBe("Sustainability");
    expect(results[0].record?.metrics30?.sessions).toBe(4010);
    expect(results[0].record?.metrics90?.pageviews).toBe(8473);
  });
});
