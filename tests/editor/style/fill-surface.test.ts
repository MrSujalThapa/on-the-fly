import { describe, expect, it } from "vitest";
import { applyStyleOperation } from "../../../src/editor/dom/handlers/style-handler.js";
import { ElementSnapshotStore } from "../../../src/editor/dom/element-snapshot.js";
import { resolveFillSurface, setManagedStyleProperty } from "../../../src/editor/style/fill-surface.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutManagedElement } from "../measurement/layout-helpers.js";
import { createStyleOperation } from "../fixtures.js";

function byId(root: ParentNode, id: string): HTMLElement {
  const element = root.querySelector(`#${id}`);
  if (!(element instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return element;
}

describe("fill surface resolver", () => {
  it("uses a painted covering child of a transparent wrapper and leaves pills alone", () => {
    const { root } = createTestDocument(
      `<section id="wrap" style="background-color:transparent"><div id="card" style="background-color:rgb(255,255,255);border-radius:8px"><button id="pill" style="background-color:rgb(10,10,10)">All</button></div></section>`,
    );
    const wrap = byId(root, "wrap");
    const card = byId(root, "card");
    const pill = byId(root, "pill");
    layoutManagedElement(wrap, { x: 0, y: 0, width: 200, height: 80 });
    layoutManagedElement(card, { x: 0, y: 0, width: 200, height: 80 });
    layoutManagedElement(pill, { x: 12, y: 28, width: 48, height: 24 });
    expect(resolveFillSurface(wrap)).toBe(card);
    expect(resolveFillSurface(card)).toBe(card);
    const store = new ElementSnapshotStore();
    applyStyleOperation(wrap, createStyleOperation({ payload: { property: "backgroundColor", value: "rgb(0, 128, 0)" } }), store);
    applyStyleOperation(wrap, createStyleOperation({ payload: { property: "backgroundImage", value: "linear-gradient(red, blue)" } }), store);
    expect(card.style.backgroundColor).toBe("rgb(0, 128, 0)");
    expect(card.style.backgroundImage).toContain("linear-gradient");
    expect(wrap.style.backgroundColor).toBe("transparent");
    expect(wrap.style.backgroundImage).toBe("");
    expect(pill.style.backgroundColor).toBe("rgb(10, 10, 10)");
  });

  it("escalates to important only when author CSS keeps the computed fill unchanged", () => {
    const { root } = createTestDocument(
      `<style>.locked{background-color:rgb(255,255,255)!important}</style><div id="locked" class="locked"></div><div id="plain"></div>`,
    );
    const locked = byId(root, "locked");
    const plain = byId(root, "plain");
    setManagedStyleProperty(locked, "background-color", "rgb(255, 0, 0)");
    setManagedStyleProperty(plain, "background-color", "rgb(255, 0, 0)");
    expect(getComputedStyle(locked).backgroundColor.replace(/\s+/g, "")).toBe("rgb(255,0,0)");
    expect(locked.style.getPropertyPriority("background-color")).toBe("important");
    expect(plain.style.getPropertyPriority("background-color")).toBe("");
  });
});
