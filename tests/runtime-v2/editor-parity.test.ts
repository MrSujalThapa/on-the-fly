import { describe, expect, it } from "vitest";
import { OTF_DETACH_ATTR } from "../../src/editor/dom/managed-detach.js";
import type { IntendedRect } from "../../src/runtime-v2/placement-engine.js";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { createOperationExecutor } from "../../src/runtime-v2/create-operation-executor.js";
import { createOperationLedger } from "../../src/runtime-v2/create-operation-ledger.js";
import { createPlacementEngine } from "../../src/runtime-v2/create-placement-engine.js";
import { createVisualModel } from "../../src/runtime-v2/create-visual-model.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutManagedElement } from "../editor/measurement/layout-helpers.js";

function byId(root: ParentNode, id: string): HTMLElement {
  const element = root.querySelector(`#${id}`);
  if (!(element instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return element;
}

function present<T>(value: T | null): T {
  if (value === null) throw new Error("expected value");
  return value;
}

function mutableRect(element: HTMLElement, initial: IntendedRect): (next: IntendedRect) => void {
  let value = initial;
  element.getBoundingClientRect = () => ({
    ...value,
    top: value.y,
    left: value.x,
    right: value.x + value.width,
    bottom: value.y + value.height,
    toJSON: () => ({}),
  });
  return (next) => { value = next; };
}

function pointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  shiftKey = false,
): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
    pointerId: 1,
    shiftKey,
  }));
}

function click(target: HTMLElement, x: number, y: number, shiftKey = false): void {
  pointer(target, "pointerdown", x, y, shiftKey);
  pointer(target, "pointerup", x, y, shiftKey);
}

describe("Runtime V2 editor parity", () => {
  it("Shift-click toggles canonical nodes in deterministic order without dirtying the ledger", () => {
    const { document, root } = createTestDocument(`<button id="a">A</button><button id="b">B</button><button id="c">C</button>`);
    const a = byId(root, "a"); const b = byId(root, "b"); const c = byId(root, "c");
    [a, b, c].forEach((element, index) => {
      layoutManagedElement(element, { x: 10 + index * 60, y: 10, width: 50, height: 30 });
    });
    document.elementsFromPoint = (x) => x < 60 ? [a] : x < 120 ? [b] : [c];
    const runtime = createEditorRuntime(document);
    runtime.start();
    click(a, 20, 20);
    click(b, 80, 20, true);
    click(c, 140, 20, true);
    click(b, 80, 20, true);

    const ids = runtime.selectedNodeIds();
    expect(ids).toEqual([runtime.visualModel.adopt(a), runtime.visualModel.adopt(c)]);
    expect(runtime.getSelection().primary).toEqual({ kind: "node", nodeId: runtime.visualModel.adopt(c) });
    expect(runtime.ledger.isDirty()).toBe(false);
    runtime.stop();
  });

  it("lasso returns only canonical IDs and adds to existing selection", () => {
    const { document, root } = createTestDocument(`<article id="a">A</article><article id="b">B</article><article id="c">C</article>`);
    const a = byId(root, "a"); const b = byId(root, "b"); const c = byId(root, "c");
    layoutManagedElement(a, { x: 10, y: 10, width: 40, height: 30 });
    layoutManagedElement(b, { x: 70, y: 10, width: 40, height: 30 });
    layoutManagedElement(c, { x: 130, y: 10, width: 40, height: 30 });
    document.elementsFromPoint = (x) => x < 60 ? [a] : x < 120 ? [b] : [c];
    const runtime = createEditorRuntime(document);
    runtime.select(a);
    runtime.selectRect({ x: 60, y: 0, width: 120, height: 50 }, "add");

    expect(runtime.selectedNodeIds()).toEqual([
      runtime.visualModel.adopt(a),
      runtime.visualModel.adopt(b),
      runtime.visualModel.adopt(c),
    ]);
    for (const id of runtime.selectedNodeIds()) expect(runtime.visualModel.get(id)).not.toBeNull();
    expect(runtime.ledger.isDirty()).toBe(false);
  });

  it("keeps groups flat/disjoint, atomic on click, clear-safe, and ungroupable", () => {
    const { document, root } = createTestDocument(`<div id="a">A</div><div id="b">B</div><div id="c">C</div>`);
    const a = byId(root, "a"); const b = byId(root, "b"); const c = byId(root, "c");
    [a, b, c].forEach((element, index) => {
      layoutManagedElement(element, { x: index * 50, y: 0, width: 40, height: 30 });
    });
    const runtime = createEditorRuntime(document);
    runtime.select(a); runtime.toggleSelection(b);
    const first = runtime.groupSelection();
    expect(first).toBeTruthy();
    runtime.clearSelection();
    runtime.select(a);
    expect(runtime.getSelection().atoms).toEqual([{ kind: "group", groupId: first }]);
    runtime.toggleSelection(c);
    const second = runtime.groupSelection();
    expect(runtime.getGroup(present(first))).toBeNull();
    expect(runtime.getGroup(present(second))?.memberIds).toEqual([
      runtime.visualModel.adopt(a), runtime.visualModel.adopt(b), runtime.visualModel.adopt(c),
    ]);
    expect(runtime.ungroupSelection()).toHaveLength(3);
    expect(runtime.getSelection().atoms.every((atom) => atom.kind === "node")).toBe(true);
    expect(runtime.ledger.isDirty()).toBe(false);
  });

  it("derives group bounds from current live measurements", () => {
    const { document, root } = createTestDocument(`<div id="a">A</div><div id="b">B</div>`);
    const a = root.querySelector("#a") as HTMLElement;
    const b = root.querySelector("#b") as HTMLElement;
    mutableRect(a, { x: 10, y: 20, width: 30, height: 20 });
    const setB = mutableRect(b, { x: 60, y: 40, width: 20, height: 30 });
    const runtime = createEditorRuntime(document);
    runtime.select(a); runtime.toggleSelection(b);
    const groupId = runtime.groupSelection();
    expect(runtime.measureGroup(present(groupId))).toEqual({ x: 10, y: 20, width: 70, height: 50 });
    setB({ x: 160, y: 90, width: 20, height: 30 });
    expect(runtime.measureGroup(present(groupId))).toEqual({ x: 10, y: 20, width: 170, height: 100 });
  });

  it("moves attached parent+child once, but independently placed child separately", () => {
    const run = (independent: boolean): number => {
      const { document, root } = createTestDocument(`<section id="p"><span id="c">Child</span></section>`);
      const parent = root.querySelector("#p") as HTMLElement;
      const child = root.querySelector("#c") as HTMLElement;
      layoutManagedElement(parent, { x: 10, y: 10, width: 120, height: 80 });
      layoutManagedElement(child, { x: 20, y: 20, width: 50, height: 20 });
      const runtime = createEditorRuntime(document);
      runtime.select(parent); runtime.toggleSelection(child);
      if (independent) child.setAttribute(OTF_DETACH_ATTR, "true");
      expect(runtime.moveSelection(25, 10).ok).toBe(true);
      return runtime.ledger.activeOperations().length;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(2);
  });

  it("treats one group move as one undo/redo transaction", () => {
    const { document, root } = createTestDocument(`<div id="a">A</div><div id="b">B</div><div id="c">C</div>`);
    const a = byId(root, "a"); const b = byId(root, "b"); const c = byId(root, "c");
    const nodes = [a, b, c];
    nodes.forEach((element, index) => {
      layoutManagedElement(element, { x: index * 60, y: 10, width: 40, height: 30 });
    });
    const runtime = createEditorRuntime(document);
    const origins = nodes.map((element) => element.getBoundingClientRect());
    runtime.select(a); runtime.toggleSelection(b); runtime.toggleSelection(c);
    runtime.groupSelection();
    expect(runtime.moveSelection(30, 15).ok).toBe(true);
    expect(runtime.ledger.peekUndoTransaction()).toHaveLength(3);
    expect(runtime.undo().ok).toBe(true);
    nodes.forEach((element, index) => {
      expect(element.getBoundingClientRect().x).toBe(origins[index]?.x);
    });
    expect(runtime.ledger.activeOperations()).toHaveLength(0);
    expect(runtime.redo().ok).toBe(true);
    nodes.forEach((element, index) => {
      expect(element.getBoundingClientRect().x).toBe((origins[index]?.x ?? 0) + 30);
    });
    expect(runtime.ledger.activeOperations()).toHaveLength(3);
  });

  it("rolls every member back when a batch member fails verification", () => {
    const { document, root } = createTestDocument(`<div id="good">Good</div><div id="locked" style="transform:none !important">Locked</div>`);
    const good = root.querySelector("#good") as HTMLElement;
    const locked = root.querySelector("#locked") as HTMLElement;
    layoutManagedElement(good, { x: 10, y: 10, width: 40, height: 30 });
    mutableRect(locked, { x: 70, y: 10, width: 40, height: 30 });
    const model = createVisualModel(document);
    const ids = [model.adopt(good), model.adopt(locked)].filter((id): id is string => Boolean(id));
    const ledger = createOperationLedger();
    const executor = createOperationExecutor({ document, visualModel: model, ledger, placement: createPlacementEngine() });
    const before = good.getAttribute("style");
    const result = executor.executeMoveBatch({ nodeIds: ids, dx: 40, dy: 20, pageKey: "https://example.com/" });
    expect(result.ok).toBe(false);
    expect(good.getAttribute("style")).toBe(before);
    expect(ledger.activeOperations()).toHaveLength(0);
  });
});
