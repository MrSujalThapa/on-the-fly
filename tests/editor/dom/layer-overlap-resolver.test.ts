import { describe, expect, it, vi } from "vitest";
import { ElementSnapshotStore } from "../../../src/editor/dom/element-snapshot.js";
import {
  applyLayerToHost,
  inferLayerCommandFromOperation,
  resolveBlockerPaintHost,
  resolveInitialLayerTarget,
  resolveLayerPlan,
  resolveSelectedPaintHost,
} from "../../../src/editor/dom/layer-overlap-resolver.js";
import { FRONT_LAYER } from "../../../src/editor/transform/layer-order.js";
import { createTestDocument } from "./test-document.js";
import { layoutElement, layoutManagedElement } from "../measurement/layout-helpers.js";

function ensureElementsFromPoint(document: Document): void {
  if (typeof document.elementsFromPoint !== "function") {
    document.elementsFromPoint = () => [];
  }
}

function mockElementsFromPoint(
  document: Document,
  resolver: (x: number, y: number) => Element[],
): void {
  ensureElementsFromPoint(document);
  vi.spyOn(document, "elementsFromPoint").mockImplementation((x, y) =>
    resolver(x, y),
  );
}

describe("layer overlap resolver", () => {
  it("uses the selected element as the initial layer target", () => {
    const { root } = createTestDocument(`
      <main><div class="card"><a id="experience">Experience</a></div></main>
    `);
    const experience = root.querySelector("#experience") as HTMLElement;
    expect(resolveInitialLayerTarget(experience)).toBe(experience);
  });

  it("prefers a managed move host over reparenting the selected node", () => {
    const { root } = createTestDocument(`
      <main><div class="card" data-otf-managed="true"><span id="chip">Jobs</span></div></main>
    `);
    const card = root.querySelector(".card") as HTMLElement;
    const chip = root.querySelector("#chip") as HTMLElement;
    expect(resolveInitialLayerTarget(chip)).toBe(card);
  });

  it("bring-forward on a static element plans position:relative and a higher z-index", () => {
    const { document, root } = createTestDocument(`<main><div class="box">A</div></main>`);
    const box = root.querySelector(".box") as HTMLElement;
    layoutElement(box, { x: 20, y: 20, width: 100, height: 40 });
    mockElementsFromPoint(document, () => [box, root, document.body, document.documentElement]);

    const plan = resolveLayerPlan(box, "forward", new ElementSnapshotStore());
    expect(plan.host).toBe(box);
    expect(plan.layer).toBeGreaterThan(1);
    expect(plan.verification).toBe("pass");
  });

  it("lifts the selected-side branch host above a navbar blocker", () => {
    const { document, root } = createTestDocument(`
      <div id="application-outlet">
        <header id="global-nav">Nav</header>
        <aside id="sidebar">
          <div class="profile-card">
            <a id="experience">Experience</a>
          </div>
        </aside>
      </div>
    `);
    const outlet = root.querySelector("#application-outlet") as HTMLElement;
    const navbar = root.querySelector("#global-nav") as HTMLElement;
    const sidebar = root.querySelector("#sidebar") as HTMLElement;
    const experience = root.querySelector("#experience") as HTMLElement;

    outlet.style.transform = "translate(0px)";
    navbar.style.position = "relative";
    navbar.style.zIndex = "100";
    layoutElement(outlet, { x: 0, y: 0, width: 900, height: 700 });
    layoutElement(navbar, { x: 0, y: 0, width: 900, height: 52 });
    layoutElement(sidebar, { x: 0, y: 80, width: 280, height: 420 });
    layoutElement(experience, { x: 20, y: 120, width: 160, height: 28 });
    layoutManagedElement(experience, { x: 20, y: 20, width: 160, height: 28 });
    experience.style.transform = "translate(0px, 0px)";

    mockElementsFromPoint(document, () => [navbar, experience, sidebar, outlet, root, document.body]);

    const plan = resolveLayerPlan(experience, "forward", new ElementSnapshotStore());
    expect(plan.host).not.toBe(outlet);
    expect(plan.host.tagName.toLowerCase()).not.toBe("body");
    expect(plan.host.id).toBe("sidebar");
    expect(plan.layer).toBeGreaterThan(100);
    expect(plan.verification).toBe("pass");
  });

  it("does not choose application-outlet when a smaller host exists", () => {
    const { root } = createTestDocument(`
      <div id="application-outlet">
        <header id="global-nav">Nav</header>
        <aside id="sidebar"><a id="experience">Experience</a></aside>
      </div>
    `);
    const outlet = root.querySelector("#application-outlet") as HTMLElement;
    const navbar = root.querySelector("#global-nav") as HTMLElement;
    const experience = root.querySelector("#experience") as HTMLElement;
    const sidebar = root.querySelector("#sidebar") as HTMLElement;

    layoutElement(outlet, { x: 0, y: 0, width: 900, height: 700 });
    layoutElement(navbar, { x: 0, y: 0, width: 900, height: 52 });
    layoutElement(sidebar, { x: 0, y: 80, width: 280, height: 420 });
    layoutElement(experience, { x: 20, y: 120, width: 160, height: 28 });

    const selectedHost = resolveSelectedPaintHost(experience, navbar);
    expect(selectedHost).not.toBe(outlet);
    expect(selectedHost.tagName.toLowerCase()).not.toBe("html");
    expect(selectedHost.tagName.toLowerCase()).not.toBe("body");
  });

  it("resolves blocker-side paint host to the navbar branch", () => {
    const { root } = createTestDocument(`
      <main>
        <header id="global-nav">Nav</header>
        <aside id="sidebar"><a id="experience">Experience</a></aside>
      </main>
    `);
    const navbar = root.querySelector("#global-nav") as HTMLElement;
    const experience = root.querySelector("#experience") as HTMLElement;
    layoutElement(navbar, { x: 0, y: 0, width: 900, height: 52 });
    layoutElement(experience, { x: 20, y: 120, width: 160, height: 28 });

    expect(resolveBlockerPaintHost(navbar, experience)).toBe(navbar);
  });

  it("infers layer commands from operation metadata", () => {
    expect(inferLayerCommandFromOperation("layer:forward", 4, 3)).toBe("forward");
    expect(inferLayerCommandFromOperation(null, FRONT_LAYER, 1)).toBe("front");
    expect(inferLayerCommandFromOperation(null, 0, 2)).toBe("back");
  });

  it("applyLayerToHost preserves revertable inline position and z-index", () => {
    const { root } = createTestDocument(`<main><div class="box">A</div></main>`);
    const box = root.querySelector(".box") as HTMLElement;
    const store = new ElementSnapshotStore();
    const changes = applyLayerToHost(box, 5, store);
    expect(box.style.position).toBe("relative");
    expect(box.style.zIndex).toBe("5");
    expect(changes.some((change) => change.kind === "position")).toBe(true);
    expect(changes.some((change) => change.kind === "zIndex")).toBe(true);
  });
});
