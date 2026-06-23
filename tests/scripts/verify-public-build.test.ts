import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, "..", "..");

describe("public build verification", () => {
  it("passes verify:public after build:public", () => {
    execSync("npm run build:public", {
      cwd: rootDir,
      stdio: "pipe",
      env: {
        ...process.env,
        PUBLIC_AGENT_ENABLED: "false",
        PUBLIC_BACKEND_ENABLED: "false",
        LOCAL_DEV_AGENT_ENABLED: "false",
      },
    });

    execSync("npm run verify:public", { cwd: rootDir, stdio: "pipe" });

    const manifest = JSON.parse(
      readFileSync(join(rootDir, "dist", "manifest.json"), "utf8"),
    ) as { permissions?: string[]; host_permissions?: string[] };

    expect(manifest.permissions).toEqual(["storage", "activeTab"]);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(existsSync(join(rootDir, "dist", "content", "content-script.js"))).toBe(true);
  });
});
