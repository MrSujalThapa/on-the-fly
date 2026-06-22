import { describe, expect, it } from "vitest";
import {
  detectEphemeralSurfaces,
  isInsideEphemeralSurface,
} from "../../src/content/ephemeral-surface.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";

describe("ephemeral surface detection", () => {
  it("detects role=menu surfaces", () => {
    const doc = globalThis.document;
    doc.body.innerHTML = `
      <main>
        <div id="menu" role="menu" style="position:absolute; z-index:100">
          <span id="item">Settings</span>
        </div>
      </main>
    `;
    const menu = doc.querySelector("#menu") as HTMLElement;
    layoutElement(menu, { x: 10, y: 40, width: 180, height: 120 });

    const snapshot = detectEphemeralSurfaces({ document: doc });
    expect(snapshot.roots).toContain(menu);
    expect(isInsideEphemeralSurface(doc.querySelector("#item") as Element, doc)).toBe(true);
  });

  it("detects aria-expanded controlled panels", () => {
    const doc = globalThis.document;
    doc.body.innerHTML = `
      <main>
        <button id="trigger" aria-expanded="true" aria-controls="menu">Profile</button>
        <div id="menu" role="menu" style="position:absolute; z-index:100">Item</div>
      </main>
    `;
    const menu = doc.querySelector("#menu") as HTMLElement;
    layoutElement(menu, { x: 10, y: 40, width: 180, height: 120 });

    const snapshot = detectEphemeralSurfaces({ document: doc });
    expect(snapshot.roots).toContain(menu);
  });

  it("returns empty when no floating surfaces are open", () => {
    const doc = globalThis.document;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;

    const snapshot = detectEphemeralSurfaces({ document: doc });
    expect(snapshot.roots).toHaveLength(0);
    expect(isInsideEphemeralSurface(doc.querySelector("#copy") as Element, doc)).toBe(false);
  });
});
