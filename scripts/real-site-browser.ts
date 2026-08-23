import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

type SessionStatus = "authenticated" | "login-required" | "unknown";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_DIR = join(ROOT, ".playwright-real-profile");
const DIST_DIR = join(ROOT, "dist");
const LINKEDIN_HOME = "https://www.linkedin.com/";
const LINKEDIN_NOTIFICATIONS = "https://www.linkedin.com/notifications/";
const DEVPOST_HOME = "https://devpost.com/";
const VIEWPORT = { width: 1440, height: 900 };

function printInstructions(): void {
  console.log(`
Sign into LinkedIn and Devpost manually.
Complete MFA manually.
Close Chromium normally when finished.
The dedicated profile will retain the authenticated session.
`);
}

function printSetup(): void {
  console.log(`
Authenticated real-site setup
-----------------------------
1. Runtime V2 diagnostics build is required at dist/.
2. This opens Playwright Chromium with ONLY the On the Fly unpacked extension.
3. It uses the dedicated profile: .playwright-real-profile/
4. Sign into LinkedIn and Devpost yourself. Complete MFA yourself.
5. Do not use your everyday Chrome profile. Close this window when finished.
6. Next: npm run real:verify
7. Then: npm run test:real:v2
`);
}

function assertRuntimeV2Dist(): void {
  const manifestPath = join(DIST_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Runtime V2 extension build not found at dist/. Run: npm run build:runtime-v2:diagnostics");
  }
  const contentScript = join(DIST_DIR, "content", "content-script.js");
  if (!existsSync(contentScript)) {
    throw new Error("Runtime V2 content script missing at dist/content/content-script.js");
  }
  const source = readFileSync(contentScript, "utf8");
  if (!source.includes("OTF_RUNTIME_V2_ACTIVE")) {
    throw new Error("dist/ is not a Runtime V2 build. Run: npm run build:runtime-v2:diagnostics");
  }
}

async function launchContext(): Promise<BrowserContext> {
  assertRuntimeV2Dist();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`],
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: VIEWPORT,
    acceptDownloads: false,
  });
  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent("serviceworker", { timeout: 20_000 });
  }
  return context;
}

async function firstPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
}

function classifyLinkedIn(url: string, hasMentionsControl: boolean, hasPasswordField: boolean): SessionStatus {
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return "unknown";
  }
  if (
    pathname.includes("/login") ||
    pathname.includes("/uas/login") ||
    pathname.includes("/checkpoint/lg") ||
    pathname.includes("/checkpoint/challenges")
  ) {
    return "login-required";
  }
  if (hasPasswordField && !hasMentionsControl) {
    return "login-required";
  }
  if (hasMentionsControl) {
    return "authenticated";
  }
  if (pathname.startsWith("/feed") || pathname.startsWith("/notifications") || pathname.startsWith("/in/")) {
    return "authenticated";
  }
  return "unknown";
}

function classifyDevpost(
  url: string,
  hasInProgressSection: boolean,
  hasPasswordField: boolean,
  hasSignedInNav: boolean,
): SessionStatus {
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return "unknown";
  }
  if (pathname.includes("/users/sign_in") || pathname.includes("/users/sign_up")) {
    return "login-required";
  }
  if (hasPasswordField && !hasSignedInNav && !hasInProgressSection) {
    return "login-required";
  }
  if (hasInProgressSection || hasSignedInNav) {
    return "authenticated";
  }
  if (pathname === "/" || pathname === "/home") {
    return "login-required";
  }
  return "unknown";
}

async function linkedInStatus(page: Page): Promise<SessionStatus> {
  await page.goto(LINKEDIN_NOTIFICATIONS, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const hasPasswordField = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  const mentions = page
    .getByRole("radio", { name: /^Mentions\b/iu })
    .or(page.getByRole("button", { name: /^Mentions\b/iu }))
    .or(page.getByRole("tab", { name: /^Mentions\b/iu }));
  const hasMentionsControl = await mentions.first().isVisible().catch(() => false);
  return classifyLinkedIn(page.url(), hasMentionsControl, hasPasswordField);
}

async function devpostStatus(page: Page): Promise<SessionStatus> {
  await page.goto(DEVPOST_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const hasPasswordField = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  const hasInProgressSection = await page.getByText(/in progress/i).first().isVisible().catch(() => false);
  const navNames = [/portfolio/i, /my hackathons/i, /log out/i, /sign out/i];
  let hasSignedInNav = false;
  for (const name of navNames) {
    if (await page.getByRole("link", { name }).first().isVisible().catch(() => false)) {
      hasSignedInNav = true;
      break;
    }
  }
  return classifyDevpost(page.url(), hasInProgressSection, hasPasswordField, hasSignedInNav);
}

function label(status: SessionStatus): string {
  if (status === "authenticated") {
    return "authenticated";
  }
  if (status === "login-required") {
    return "login required";
  }
  return "unknown — confirm visually with npm run real:browser";
}

async function verify(): Promise<void> {
  const context = await launchContext();
  try {
    const page = await firstPage(context);
    const linkedIn = await linkedInStatus(page);
    const devpost = await devpostStatus(page);
    console.log(`LinkedIn: ${label(linkedIn)}`);
    console.log(`Devpost: ${label(devpost)}`);
    if (linkedIn !== "authenticated" || devpost !== "authenticated") {
      console.log("\nREAL-SITE AUTH: PENDING HUMAN LOGIN");
      console.log("Run npm run real:browser, sign in manually, then retry npm run real:verify.");
      process.exitCode = 1;
      return;
    }
    console.log("\nREAL-SITE AUTH: READY");
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function openBrowser(setup: boolean): Promise<void> {
  if (setup) {
    printSetup();
  }
  const context = await launchContext();
  const page = await firstPage(context);
  await page.goto(LINKEDIN_HOME, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  const second = await context.newPage();
  await second.goto(DEVPOST_HOME, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  printInstructions();
  console.log("Playwright Chromium is open. Close the window when finished.");
  await new Promise<void>((resolve) => {
    context.on("close", () => {
      resolve();
    });
  });
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log("Usage: npm run real:browser | npm run real:setup | npm run real:verify");
  process.exit(0);
}

try {
  if (args.has("--verify")) {
    await verify();
  } else {
    await openBrowser(args.has("--setup"));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "real-site browser failed";
  console.error(message);
  process.exit(1);
}
