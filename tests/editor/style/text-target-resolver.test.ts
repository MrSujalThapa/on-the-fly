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

  it("promotes LinkedIn-style inline fragments to the parent notification text span", () => {
    const { document, root } = createTestDocument(`
      <main>
        <span class="nt-card__text--3-line">
          <strong id="name">Sujal Bhattarai</strong>
          <span class="white-space-pre"> </span>
          viewed your profile at
          <strong id="company">Radical Ventures</strong>
        </span>
      </main>
    `);
    const note = root.querySelector(".nt-card__text--3-line") as HTMLElement;
    const company = root.querySelector("#company") as HTMLElement;

    company.getBoundingClientRect = () =>
      ({ x: 180, y: 20, width: 130, height: 18, top: 20, left: 180, right: 310, bottom: 38 }) as DOMRect;
    document.elementsFromPoint = () => [company, note, root];

    const result = resolveTextEditTargetAtPoint(document, 190, 25, note, null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.element).toBe(note);
      expect(result.originalElement).toBe(company);
      expect(result.reason).toBe("inline-promoted-to-block");
      expect(result.element.textContent).toContain("Sujal Bhattarai");
      expect(result.element.textContent).toContain("Radical Ventures");
    }
  });

  it("resolves the first safe text descendant for a selected container", () => {
    const { document, root } = createTestDocument(`
      <main>
        <section id="card">
          <p id="title">Primary title</p>
          <p id="body">Secondary body</p>
        </section>
      </main>
    `);
    const card = root.querySelector("#card") as HTMLElement;
    const title = root.querySelector("#title") as HTMLElement;

    const result = resolveTextEditTargetForSelection(document, card, null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.element).toBe(title);
      expect(result.reason).toBe("first-descendant");
    }
  });
});
