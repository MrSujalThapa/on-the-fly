import { describe, expect, it } from "vitest";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { OTFEnvironmentError } from "../../src/runtime-v2/environment/environment-errors.js";
import { MOVE_GEOMETRY_TOLERANCE_PX } from "../../src/runtime-v2/operation-executor.js";
import { unionRects } from "../../src/runtime-v2/runtime-selection.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutManagedElement } from "../editor/measurement/layout-helpers.js";

function patchRects(document: Document): void {
  const view = document.defaultView as Window & { HTMLElement: typeof HTMLElement };
  view.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const x = Number.parseFloat(this.style.left) || 0;
    const y = Number.parseFloat(this.style.top) || 0;
    const width = Number.parseFloat(this.style.width) || Number.parseFloat(this.style.minWidth) || 80;
    const height = Number.parseFloat(this.style.height) || Number.parseFloat(this.style.minHeight) || 24;
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
  };
}

function requireId(value: string | null | undefined): string {
  expect(value).toBeTruthy();
  if (!value) throw new Error("missing_id");
  return value;
}

function geometryOf(element: HTMLElement): { x: number; y: number; width: number; height: number; rotate: number; cx: number; cy: number } {
  const box = element.getBoundingClientRect();
  const raw = element.getAttribute("data-otf-transform");
  const rotate = raw ? (JSON.parse(raw) as { rotate?: number }).rotate ?? 0 : 0;
  return { x: box.x, y: box.y, width: box.width, height: box.height, rotate, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

function expectGeometryNear(
  actual: ReturnType<typeof geometryOf>,
  expected: ReturnType<typeof geometryOf>,
  label: string,
): void {
  expect(Math.abs(actual.x - expected.x), `${label} x`).toBeLessThanOrEqual(MOVE_GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(actual.y - expected.y), `${label} y`).toBeLessThanOrEqual(MOVE_GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(actual.width - expected.width), `${label} width`).toBeLessThanOrEqual(MOVE_GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(actual.height - expected.height), `${label} height`).toBeLessThanOrEqual(MOVE_GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(actual.rotate - expected.rotate), `${label} rotate`).toBeLessThan(0.01);
}

describe("OTFEnvironment v1", () => {
  it("read methods observe without dirtying ledger, selection, or DOM", async () => {
    const { document, root } = createTestDocument(`<button id="a" role="button">Mentions</button>`);
    const target = root.querySelector("#a") as HTMLElement;
    layoutManagedElement(target, { x: 10, y: 10, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const id = requireId(runtime.select(target));
    const env = runtime.environment;
    const before = { cursor: runtime.ledger.cursor, dirty: runtime.ledger.isDirty(), html: target.outerHTML, selection: [...runtime.selectedNodeIds()] };
    const observation = await env.observe({ scope: "selection" });
    const inspected = await env.inspectElement(id);
    const found = await env.findElements({ text: "Mentions" });
    await env.getGeometry(id);
    await env.getComputedStyles(id);
    await env.getSessionState();
    await env.getChanges();
    expect(observation.selection).toEqual([id]);
    expect(inspected.origin).toBe("host");
    expect(found).toContain(id);
    expect(runtime.ledger.cursor).toBe(before.cursor);
    expect(runtime.ledger.isDirty()).toBe(before.dirty);
    expect(target.outerHTML).toBe(before.html);
    expect([...runtime.selectedNodeIds()]).toEqual(before.selection);
    runtime.stop();
  });

  it("maps ElementId to VisualModel and preserves created identity", async () => {
    const { document } = createTestDocument("");
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const created = await runtime.environment.execute({
      type: "create",
      kind: "rectangle",
      rect: { x: 8, y: 8, width: 120, height: 40 },
    });
    expect(created.ok).toBe(true);
    const id = requireId(created.target);
    expect(runtime.visualModel.get(id)).not.toBeNull();
    expect(runtime.visualModel.bind(id)?.getAttribute("data-otf-element-id")).toBe(id);
    expect((await runtime.environment.inspectElement(id)).origin).toBe("created");
    runtime.stop();
  });

  it.each([
    { name: "unresolved", id: "otf-vn-missing", code: "ELEMENT_NOT_FOUND" },
  ] as const)("returns structured $code without silent retargeting ($name)", async ({ id, code }) => {
    const { document, root } = createTestDocument(`<button id="a">Mentions</button><button id="b">My posts</button>`);
    layoutManagedElement(root.querySelector("#a") as HTMLElement, { x: 10, y: 10, width: 80, height: 24 });
    layoutManagedElement(root.querySelector("#b") as HTMLElement, { x: 100, y: 10, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const postsLeft = (root.querySelector("#b") as HTMLElement).getBoundingClientRect().x;
    const result = await runtime.environment.execute({ type: "move", target: id, delta: { x: 40, y: 0 } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(code);
    expect((root.querySelector("#b") as HTMLElement).getBoundingClientRect().x).toBe(postsLeft);
    runtime.stop();
  });

  it("execute uses the shared ledger so UI undo and checkpoint rollback agree", async () => {
    const { document, root } = createTestDocument(`<button id="a">Mentions</button>`);
    const target = root.querySelector("#a") as HTMLElement;
    layoutManagedElement(target, { x: 10, y: 10, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const id = requireId(runtime.select(target));
    const env = runtime.environment;
    const checkpoint = await env.checkpoint("before");
    const ui = runtime.move(id, 12, 0);
    expect(ui.ok).toBe(true);
    const cursorAfterUi = runtime.ledger.cursor;
    runtime.undo();
    const viaEnv = await env.execute({ type: "move", target: id, delta: { x: 12, y: 0 } });
    expect(viaEnv.ok).toBe(true);
    expect(runtime.ledger.cursor).toBe(cursorAfterUi);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.ledger.cursor).toBe(0);
    const styled = await env.execute({ type: "style", target: id, property: "backgroundColor", value: "rgb(255, 0, 0)" });
    expect(styled.ok).toBe(true);
    const rolled = await env.rollback(checkpoint);
    expect(rolled.ok).toBe(true);
    expect(runtime.ledger.cursor).toBe(0);
    expect(await env.getChanges()).toEqual([]);
    runtime.stop();
  });

  it("UI move and environment move produce equivalent committed geometry", async () => {
    const { document, root } = createTestDocument(`<button id="a">Mentions</button><button id="b">Copy</button>`);
    const a = root.querySelector("#a") as HTMLElement;
    const b = root.querySelector("#b") as HTMLElement;
    layoutManagedElement(a, { x: 10, y: 10, width: 80, height: 24 });
    layoutManagedElement(b, { x: 10, y: 50, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const idA = requireId(runtime.select(a));
    expect(runtime.move(idA, 20, 8).ok).toBe(true);
    const afterUi = a.getBoundingClientRect();
    const idB = requireId(runtime.select(b));
    const envMove = await runtime.environment.execute({ type: "move", target: idB, delta: { x: 20, y: 8 } });
    expect(envMove.ok).toBe(true);
    const afterEnv = b.getBoundingClientRect();
    expect(afterEnv.x - 10).toBe(afterUi.x - 10);
    expect(afterEnv.y - 50).toBe(afterUi.y - 10);
    runtime.stop();
  });

  it("multi-target environment resize uses the same union-relative primitive as human resizeSelection", async () => {
    const { document } = createTestDocument("");
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const created = [
      { x: 10, y: 10, width: 40, height: 30 },
      { x: 70, y: 10, width: 40, height: 30 },
      { x: 130, y: 10, width: 40, height: 30 },
      { x: 10, y: 80, width: 40, height: 30 },
    ].map((rect) => {
      const result = runtime.createElement({ kind: "rectangle", rect });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      const id = requireId(result.operation.target.nodeId);
      const element = runtime.visualModel.bind(id);
      expect(element).toBeTruthy();
      if (!element) throw new Error("missing created element");
      return { id, element };
    });
    const [a, b, c, decoy] = created;
    if (!a || !b || !c || !decoy) return;
    const origin = { a: geometryOf(a.element), b: geometryOf(b.element), c: geometryOf(c.element) };
    runtime.select(a.element);
    runtime.toggleSelection(b.element);
    runtime.toggleSelection(c.element);
    const startUnion = unionRects([a, b, c].map((item) => {
      const box = item.element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    expect(startUnion).not.toBeNull();
    if (!startUnion) return;
    const toBounds = { x: startUnion.x, y: startUnion.y, width: startUnion.width + 40, height: startUnion.height + 20 };
    const humanResult = runtime.resizeSelection(toBounds);
    expect(humanResult.ok, humanResult.ok ? "ok" : humanResult.error).toBe(true);
    const human = { a: geometryOf(a.element), b: geometryOf(b.element), c: geometryOf(c.element) };
    expect(runtime.undo().ok).toBe(true);
    const decoyBefore = geometryOf(decoy.element);
    runtime.select(decoy.element);
    const envResult = await runtime.environment.execute({ type: "resize", targets: [a.id, b.id, c.id], toBounds });
    expect(envResult.ok, envResult.error?.message ?? "env resize").toBe(true);
    expectGeometryNear(geometryOf(a.element), human.a, "A");
    expectGeometryNear(geometryOf(b.element), human.b, "B");
    expectGeometryNear(geometryOf(c.element), human.c, "C");
    expectGeometryNear(geometryOf(decoy.element), decoyBefore, "decoy");
    expect(runtime.undo().ok).toBe(true);
    expectGeometryNear(geometryOf(a.element), origin.a, "A after undo");
    expectGeometryNear(geometryOf(b.element), origin.b, "B after undo");
    expectGeometryNear(geometryOf(c.element), origin.c, "C after undo");
    runtime.stop();
  });

  it("multi-target environment rotate uses the same union-center primitive as human rotateSelection", async () => {
    const { document, root } = createTestDocument(
      `<button id="a">A</button><button id="b">B</button><button id="c">C</button><button id="decoy">D</button>`,
    );
    const a = root.querySelector("#a") as HTMLElement;
    const b = root.querySelector("#b") as HTMLElement;
    const c = root.querySelector("#c") as HTMLElement;
    const decoy = root.querySelector("#decoy") as HTMLElement;
    layoutManagedElement(a, { x: 10, y: 10, width: 40, height: 30 });
    layoutManagedElement(b, { x: 70, y: 10, width: 40, height: 30 });
    layoutManagedElement(c, { x: 130, y: 10, width: 40, height: 30 });
    layoutManagedElement(decoy, { x: 10, y: 80, width: 40, height: 30 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const idA = requireId(runtime.select(a));
    const idB = requireId(runtime.toggleSelection(b));
    const idC = requireId(runtime.toggleSelection(c));
    expect(runtime.rotateSelection(30).ok).toBe(true);
    const human = { a: geometryOf(a), b: geometryOf(b), c: geometryOf(c) };
    expect(human.a.rotate).toBe(30);
    expect(human.b.rotate).toBe(30);
    expect(human.c.rotate).toBe(30);
    expect(runtime.undo().ok).toBe(true);
    const decoyBefore = geometryOf(decoy);
    runtime.select(decoy);
    const envResult = await runtime.environment.execute({ type: "rotate", targets: [idA, idB, idC], degrees: 30 });
    expect(envResult.ok).toBe(true);
    expectGeometryNear(geometryOf(a), human.a, "A");
    expectGeometryNear(geometryOf(b), human.b, "B");
    expectGeometryNear(geometryOf(c), human.c, "C");
    expectGeometryNear(geometryOf(decoy), decoyBefore, "decoy");
    expect(runtime.undo().ok).toBe(true);
    expect(geometryOf(a).rotate).toBe(0);
    expect(geometryOf(b).rotate).toBe(0);
    expect(geometryOf(c).rotate).toBe(0);
    runtime.stop();
  });
});

describe("OTFEnvironment query errors", () => {
  it("fails explicitly for unsupported find fields", async () => {
    const { document } = createTestDocument(`<p>Hi</p>`);
    const runtime = createEditorRuntime(document);
    runtime.start();
    await expect(runtime.environment.findElements({ xpath: "//p" } as never)).rejects.toBeInstanceOf(OTFEnvironmentError);
    runtime.stop();
  });
});
