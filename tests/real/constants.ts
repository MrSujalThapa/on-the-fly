import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const REAL_SITE_ROOT = ROOT;
export const REAL_PROFILE_DIR = join(ROOT, ".playwright-real-profile");
export const DIST_DIR = join(ROOT, "dist");
export const REAL_ARTIFACT_DIR = join(ROOT, "test-results", "real");

export const LINKEDIN_HOME = "https://www.linkedin.com/";
export const LINKEDIN_NOTIFICATIONS = "https://www.linkedin.com/notifications/";
export const DEVPOST_HOME = "https://devpost.com/";

export const VIEWPORT = { width: 1440, height: 900 } as const;
