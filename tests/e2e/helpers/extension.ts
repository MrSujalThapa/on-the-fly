import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const DIST_DIR = join(ROOT, "dist");
export const FIXTURE_ORIGIN = "http://127.0.0.1:4177";

type ExtensionFixtures = {
  context: BrowserContext;
  extensionWorker: Worker;
  extensionId: string;
};

export const test = base.extend<ExtensionFixtures>({
  // Playwright requires object destructuring even when no fixtures are used.
  // eslint-disable-next-line no-empty-pattern -- required by Playwright fixture API
  context: async ({}, use) => {
    const headed = process.env.E2E_HEADLESS !== "1";
    const userDataDir = mkdtempSync(join(tmpdir(), "otf-e2e-"));
    const args = [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
    ];
    if (!headed) {
      args.unshift("--headless=new");
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: !headed,
      args,
      ignoreDefaultArgs: ["--disable-extensions"],
      viewport: { width: 1280, height: 800 },
    });
    if (context.serviceWorkers().length === 0) {
      await context.waitForEvent("serviceworker", { timeout: 20_000 });
    }
    await use(context);
    await context.close();
  },

  extensionWorker: async ({ context }, use) => {
    const existing = context.serviceWorkers()[0];
    const worker = existing ?? (await context.waitForEvent("serviceworker"));
    await use(worker);
  },

  extensionId: async ({ extensionWorker }, use) => {
    await use(new URL(extensionWorker.url()).host);
  },
});

export { expect } from "@playwright/test";
