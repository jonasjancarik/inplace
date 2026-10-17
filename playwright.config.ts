import { defineConfig, devices } from "@playwright/test";

// Browser tests for the editing script (src/editor/). Each test starts its
// own inplace server on a temporary copy of a document; see e2e/fixtures.ts.
export default defineConfig({
  testDir: "e2e",
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 900 } },
});
