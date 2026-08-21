import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
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
});
