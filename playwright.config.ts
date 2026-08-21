import { defineConfig, devices } from "@playwright/test";

const nodeBin = "/Users/smitpatel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const pnpmBin =
  "/Users/smitpatel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: {
    command: `"${nodeBin}" "${pnpmBin}" dev`,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
