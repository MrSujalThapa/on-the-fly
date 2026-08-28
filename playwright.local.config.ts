import { defineConfig } from "@playwright/test";

/**
 * Real Chromium with the built extension loaded, driven against a local
 * structural fixture. This is the behavioural acceptance environment used when
 * an authenticated real site is unavailable; happy-dom is never used for it.
 */
export default defineConfig({
  testDir: "./tests/local",
  testMatch: /.*\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/local",
  use: {
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: "node scripts/local-fixture-server.mjs",
    url: "http://127.0.0.1:4188/runtime/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
