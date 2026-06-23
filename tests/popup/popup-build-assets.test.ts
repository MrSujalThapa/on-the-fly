import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, "..", "..");

describe("popup public build assets", () => {
  it("copies popup logo into dist without docs paths", () => {
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

    const popupHtml = readFileSync(join(rootDir, "dist", "popup", "popup.html"), "utf8");
    expect(popupHtml).toContain('src="logo.png"');
    expect(popupHtml).not.toContain("docs/");
    expect(existsSync(join(rootDir, "dist", "popup", "logo.png"))).toBe(true);
  });
});
