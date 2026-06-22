import { describe, expect, it } from "vitest";
import { createTestDocument } from "../dom/test-document.js";
import { resolveTextEditTargetAtPoint } from "../../../src/editor/style/text-target-resolver.js";

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
});
