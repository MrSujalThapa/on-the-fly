import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, "..", "..");
const popupHtmlPath = join(rootDir, "src", "popup", "popup.html");
const popupCssPath = join(rootDir, "src", "popup", "popup.css");
const logoPath = join(rootDir, "src", "popup", "logo.png");

function loadPopupDocument(): Document {
  const html = readFileSync(popupHtmlPath, "utf8");
  const css = readFileSync(popupCssPath, "utf8");
  const window = new Window({ innerWidth: 300, innerHeight: 250 });
  window.document.write(html);
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.appendChild(style);
  return window.document as unknown as Document;
}

describe("popup markup", () => {
  it("renders the glass card layout with required controls", () => {
    const document = loadPopupDocument();

    expect(document.querySelector(".extension-card")).toBeTruthy();
    expect(document.querySelector("#popup-root.extension-card")).toBeTruthy();
    expect(document.querySelector("#toggle-button.primary")).toBeTruthy();
    expect(document.querySelector("#clear-page.text-action")).toBeTruthy();
    expect(document.querySelector("#open-options.icon-action")).toBeTruthy();
    expect(document.querySelector("#edit-status")).toBeTruthy();
    expect(document.querySelector("#saved-ops-count")).toBeTruthy();
    expect(document.querySelector("#agent-status")).toBeTruthy();
    expect(document.querySelector("#build-mode")).toBeTruthy();
    expect(document.querySelector(".hero-title")?.textContent).toBe("Do it on the fly");
  });

  it("references the committed popup logo asset", () => {
    const document = loadPopupDocument();
    const logo = document.querySelector<HTMLImageElement>(".logo img");

    expect(logo).toBeTruthy();
    expect(logo?.getAttribute("src")).toBe("logo.png");
    expect(logo?.getAttribute("width")).toBeNull();
    expect(logo?.getAttribute("height")).toBeNull();
    expect(() => readFileSync(logoPath)).not.toThrow();
  });

  it("uses compact transparent popup chrome without outer frame padding", () => {
    const css = readFileSync(popupCssPath, "utf8");
    const html = readFileSync(popupHtmlPath, "utf8");

    expect(css).toContain("--card-width: 300px");
    expect(css).toContain("background: transparent");
    expect(css).toContain("color-scheme: only light");
    expect(css).not.toContain("--popup-width");
    expect(css).not.toContain("width: fit-content");
    expect(css).not.toMatch(/body\s*\{[^}]*padding:\s*10px/s);
    expect(css).toContain("max-width: 24px");
    expect(css).toContain("object-fit: contain");
    expect(css).not.toContain("flex: 1");
    expect(html).toContain('name="color-scheme" content="light"');
  });
});
