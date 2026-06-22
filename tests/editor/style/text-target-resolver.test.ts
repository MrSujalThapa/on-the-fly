import { describe, expect, it } from "vitest";
import { createTestDocument } from "../dom/test-document.js";
import {
  resolveTextEditTargetAtPoint,
  resolveTextEditTargetForSelection,
} from "../../../src/editor/style/text-target-resolver.js";

describe("text-target-resolver", () => {
  it("resolves nested notification text at click point", () => {
    const { document, root } = createTestDocument(`
      <main>
        <div id="card" style="padding:8px">
          <span id="note">LinkedIn notification</span>
        </div>
      </main>
    `);
    const card = root.querySelector("#card") as HTMLElement;
    const note = root.querySelector("#note") as HTMLElement;

    note.getBoundingClientRect = () =>
      ({ x: 20, y: 20, width: 180, height: 18, top: 20, left: 20, right: 200, bottom: 38 }) as DOMRect;

    document.elementsFromPoint = () => [note, card, root];

    const result = resolveTextEditTargetAtPoint(document, 30, 25, card, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.element.textContent).toContain("LinkedIn notification");
    }
  });

  it("promotes an inline link click to the whole paragraph-like text block", () => {
    const { document, root } = createTestDocument(`
      <main>
        <div id="card">
          <p id="note">Someone at <a id="company">Radical Ventures</a> viewed your profile.</p>
        </div>
      </main>
    `);
    const card = root.querySelector("#card") as HTMLElement;
    const note = root.querySelector("#note") as HTMLElement;
    const company = root.querySelector("#company") as HTMLElement;

    company.getBoundingClientRect = () =>
      ({ x: 80, y: 20, width: 120, height: 18, top: 20, left: 80, right: 200, bottom: 38 }) as DOMRect;

    document.elementsFromPoint = () => [company, note, card, root];

    const result = resolveTextEditTargetAtPoint(document, 100, 25, card, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.element).toBe(note);
      expect(result.originalElement).toBe(company);
      expect(result.reason).toBe("inline-promoted-to-block");
      expect(result.element.textContent).toContain("Radical Ventures");
      expect(result.element.textContent).toContain("viewed your profile");
    }
  });

  it("promotes a selected inline span to a coherent text block", () => {
    const { document, root } = createTestDocument(`
      <main>
        <p id="note">Your update from <span id="source">Radical Ventures</span> is ready.</p>
      </main>
    `);
    const note = root.querySelector("#note") as HTMLElement;
    const source = root.querySelector("#source") as HTMLElement;

    const result = resolveTextEditTargetForSelection(document, source, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.element).toBe(note);
      expect(result.reason).toBe("inline-promoted-to-block");
    }
  });
});
