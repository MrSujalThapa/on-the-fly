import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import { DIST_DIR, REAL_PROFILE_DIR, VIEWPORT } from "./constants.js";

function clearUnpackedExtensionRuntimeCache(profileDir: string): void {
  for (const relative of ["Default/Service Worker", "Default/Extension Scripts", "Default/Extension State"]) {
    rmSync(join(profileDir, relative), { recursive: true, force: true });
  }
}

export function assertRuntimeV2Dist(): string {
  const manifestPath = join(DIST_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Runtime V2 extension build not found at dist/. Run: npm run build:runtime-v2:diagnostics`,
    );
  }
  const contentScript = join(DIST_DIR, "content", "content-script.js");
  if (!existsSync(contentScript)) {
    throw new Error(`Runtime V2 content script missing at dist/content/content-script.js`);
  }
  const source = readFileSync(contentScript, "utf8");
  if (!source.includes("OTF_RUNTIME_V2_ACTIVE")) {
    throw new Error(
      `dist/ is not a Runtime V2 build. Run: npm run build:runtime-v2:diagnostics`,
    );
  }
  return DIST_DIR;
}

export function extensionLaunchArgs(distDir: string): string[] {
  return [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`];
}

export async function launchRealSiteContext(options?: {
  headless?: boolean;
}): Promise<BrowserContext> {
  const distDir = assertRuntimeV2Dist();
  clearUnpackedExtensionRuntimeCache(REAL_PROFILE_DIR);
  const headless = options?.headless === true;
  const args = [...extensionLaunchArgs(distDir)];
  if (headless) {
    args.unshift("--headless=new");
  }

  const context = await chromium.launchPersistentContext(REAL_PROFILE_DIR, {
    headless,
    args,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    acceptDownloads: false,
  });

  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent("serviceworker", { timeout: 20_000 });
  }
  return context;
}
