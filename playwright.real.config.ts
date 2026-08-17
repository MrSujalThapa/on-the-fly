import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/real",
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/real",
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
});
