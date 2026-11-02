import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows baseline guidance until real performance data is imported", async ({ page }) => {
  await page.getByRole("button", { name: "Predict" }).first().click();
  await expect(page.getByText("Baseline mode")).toBeVisible();
  await expect(page.getByText("Projected from the 30-day estimate")).toBeVisible();
  await page.getByRole("button", { name: "Patterns" }).first().click();
  await expect(page.getByText("0 rows with metrics")).toBeVisible();
});

test("creates a record from the simple form", async ({ page }) => {
  await page.getByRole("button", { name: "New record" }).click();
  await page.getByLabel("Title").fill("Faculty team launches civic data project");
  await page.getByLabel("Topic").fill("Research");
  await page.getByLabel("Planned date").fill("2026-10-08");
  await page.getByLabel("Word count").fill("840");
  await page.getByLabel("Owner or team").fill("Marketing");
  await page.getByRole("button", { name: "Save record" }).click();

  await page.getByRole("button", { name: "Records" }).first().click();
  await expect(page.getByText("Faculty team launches civic data project")).toBeVisible();
});

test("imports a valid CSV row and shows it in records", async ({ page }) => {
  await page.getByRole("button", { name: "Import" }).first().click();
  await page.setInputFiles("#file-upload", "tests/fixtures/watchtower-import.csv");

  await expect(page.getByText("Ready to import")).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await page.getByRole("button", { name: "Predict" }).first().click();
  await expect(page.getByText("Predict performance")).toBeVisible();
  await expect(page.getByText("historical rows")).toBeVisible();
  await page.getByRole("button", { name: "Records" }).first().click();
  await expect(page.getByText("New grant supports robotics lab")).toBeVisible();
});

test("imports an Excel workbook in the browser", async ({ page }) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Updated");
  sheet.addRow(["Title", "Topic", "Planned Date", "Word Count", "Images", "Status"]);
  sheet.addRow(["Excel import story", "Research", "2026-10-08", 840, "Yes", "Published"]);
  const array = await workbook.xlsx.writeBuffer();

  await page.getByRole("button", { name: "Import" }).first().click();
  await page.setInputFiles("#file-upload", {
    name: "stories.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(array)
  });
  await expect(page.getByText("Ready to import")).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await page.getByRole("button", { name: "Records" }).first().click();
  await expect(page.getByText("Excel import story")).toBeVisible();
});

test("reviews a pasted draft and shows recommendations", async ({ page }) => {
  await page.getByRole("button", { name: "Review" }).first().click();
  await page.getByLabel("Story title").fill("ASU research opens new clean energy lab");
  await page.getByLabel("Draft text").fill(
    [
      "ASU researchers opened a new clean energy lab to help communities test better battery systems.",
      "The work could help cities improve resilience and prepare students for emerging technology jobs.",
      "",
      "The team will partner with industry and public agencies. Researchers say the lab gives students hands-on access to tools that are usually difficult to reach."
    ].join("\n")
  );
  await page.getByRole("button", { name: "Review draft" }).click();

  await expect(page.getByText("Top recommendations")).toBeVisible();
  await expect(page.getByText("Editor checklist")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Word" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^asu-research-opens-new-clean-energy-lab-review-\d{4}-\d{2}-\d{2}\.docx$/);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  await page.getByLabel("Story title").fill("A second story");
  await expect(page.getByRole("button", { name: "Download Word" })).toBeHidden();
  await page.getByRole("button", { name: "Review draft" }).click();
  const secondDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Word" }).click();
  const secondDownload = await secondDownloadPromise;
  expect(secondDownload.suggestedFilename()).toMatch(/^a-second-story-review-\d{4}-\d{2}-\d{2}\.docx$/);
});
