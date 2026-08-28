import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTH_NOT_CONFIGURED_MESSAGE,
  classifyLinkedInSession,
  publicUrl,
  requireAuthenticated,
} from "../real/session-status.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("session classification", () => {
  it("treats LinkedIn login and checkpoint paths as login-required", () => {
    expect(classifyLinkedInSession({
      url: "https://www.linkedin.com/login",
      hasMentionsControl: false,
      hasPasswordField: true,
    })).toBe("login-required");
    expect(classifyLinkedInSession({
      url: "https://www.linkedin.com/checkpoint/challenge/some-id",
      hasMentionsControl: false,
      hasPasswordField: false,
    })).toBe("login-required");
  });

  it("treats a Mentions control as authenticated and fails closed otherwise", () => {
    expect(classifyLinkedInSession({
      url: "https://www.linkedin.com/notifications/",
      hasMentionsControl: true,
      hasPasswordField: false,
    })).toBe("authenticated");
    expect(publicUrl("https://www.linkedin.com/feed/?trk=secret")).toBe("https://www.linkedin.com/feed/");
    expect(() => {
      requireAuthenticated("login-required", "LinkedIn");
    }).toThrow(AUTH_NOT_CONFIGURED_MESSAGE);
  });
});

describe("runtime-v2 exclusive mode", () => {
  it("ships Runtime V2 as the only content entry and never instantiates legacy orchestration", () => {
    const build = readFileSync(join(ROOT, "scripts/build.mjs"), "utf8");
    expect(build).toContain("runtime-v2/content-entry.ts");
    expect(build).not.toContain("content/content-script.ts");
    expect(existsSync(join(ROOT, "src/content/content-script.ts"))).toBe(false);
    const v2Entry = readFileSync(join(ROOT, "src/runtime-v2/content-entry.ts"), "utf8");
    expect(v2Entry).toContain("OTF_RUNTIME_V2_ACTIVE");
    expect(v2Entry).toContain("createEditorRuntime");
    expect(v2Entry).not.toContain("createEditSession");
    expect(v2Entry).not.toContain("DomRuntimeAdapter");
    expect(v2Entry).not.toContain("PageCustomizationController");
  });
});

describe("public build", () => {
  it("produces a Chrome-store-safe bundle with no host permissions", () => {
    execSync("npm run build:public", {
      cwd: ROOT,
      stdio: "pipe",
      env: {
        ...process.env,
        PUBLIC_AGENT_ENABLED: "false",
        PUBLIC_BACKEND_ENABLED: "false",
        LOCAL_DEV_AGENT_ENABLED: "false",
      },
    });
    execSync("npm run verify:public", { cwd: ROOT, stdio: "pipe" });
    const manifest = JSON.parse(readFileSync(join(ROOT, "dist", "manifest.json"), "utf8")) as {
      permissions?: string[];
      host_permissions?: string[];
    };
    expect(manifest.permissions).toEqual(["storage", "activeTab"]);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(existsSync(join(ROOT, "dist", "content", "content-script.js"))).toBe(true);
  });
});
