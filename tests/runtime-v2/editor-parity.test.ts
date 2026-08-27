import { describe, expect, it } from "vitest";
import { OTF_DETACH_ATTR } from "../../src/editor/dom/managed-detach.js";
import { OTF_MANAGED_ATTR } from "../../src/editor/dom/types.js";
import type { IntendedRect } from "../../src/runtime-v2/placement-engine.js";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { createOperationExecutor } from "../../src/runtime-v2/create-operation-executor.js";
import { createOperationLedger } from "../../src/runtime-v2/create-operation-ledger.js";
import { createPlacementEngine } from "../../src/runtime-v2/create-placement-engine.js";
import { createVisualModel } from "../../src/runtime-v2/create-visual-model.js";
import { projectCanonicalCheckpoint } from "../../src/runtime-v2/canonical-checkpoint.js";
import { normalizeSelection, type RuntimeVirtualGroup } from "../../src/runtime-v2/runtime-selection.js";
import type { VisualModel } from "../../src/runtime-v2/visual-model.js";
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
  it("toggles the toolbar with plain T even without a selection, but not while typing", () => {
    const { document, root } = createTestDocument(`<button id="a">Target</button><input id="field">`);
    const target = byId(root, "a");
    const field = byId(root, "field");
    layoutManagedElement(target, { x: 10, y: 10, width: 80, height: 30 });
    const runtime = createEditorRuntime(document);
    runtime.start();
    const visible: boolean[] = [];
    runtime.overlays.setToolbarVisible = (value) => { visible.push(value); };
    document.defaultView?.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(visible.at(-1)).toBe(true);
    runtime.select(target);
    expect(visible.at(-1)).toBe(true);
    runtime.clearSelection();
    expect(visible.at(-1)).toBe(true);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(visible.at(-1)).toBe(true);
    document.defaultView?.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(visible.at(-1)).toBe(false);
    runtime.stop();
  });

  it("does not apply editor delete while a text-entry control is focused", () => {
    const { document, root } = createTestDocument(`<button id="a">Target</button><textarea id="field">abc</textarea>`);
    const target = byId(root, "a");
    const field = byId(root, "field");
    layoutManagedElement(target, { x: 10, y: 10, width: 80, height: 30 });
    const runtime = createEditorRuntime(document);
    runtime.start();
    runtime.select(target);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(target.style.display).not.toBe("none");
    document.defaultView?.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(target.style.display).toBe("none");
    runtime.stop();
  });

  it("resolves one wrapped image for crop and rejects ambiguous media", () => {
    const { document, root } = createTestDocument(`<div id="one"><span><img id="image"></span></div><div id="many"><img><img></div>`);
    const one = byId(root, "one"); const image = byId(root, "image"); const many = byId(root, "many");
    layoutManagedElement(one, { x: 0, y: 0, width: 100, height: 100 });
    layoutManagedElement(image, { x: 0, y: 0, width: 100, height: 100 });
    layoutManagedElement(many, { x: 120, y: 0, width: 100, height: 100 });
    const runtime = createEditorRuntime(document);
    runtime.select(one);
    expect(runtime.cropSelection({ top: 5, right: 5, bottom: 5, left: 5 }).ok).toBe(true);
    expect(image.getAttribute("data-otf-crop")).not.toBeNull();
    runtime.select(many);
    expect(runtime.cropSelection({ top: 5, right: 5, bottom: 5, left: 5 }).ok).toBe(false);
  });

  it("scopes container backgrounds to self and text color to its text subtree", () => {
    const { document, root } = createTestDocument(`<section id="card"><span id="name">Name</span><p id="copy">Description</p></section>`);
    const card = byId(root, "card"); const name = byId(root, "name"); const copy = byId(root, "copy");
    layoutManagedElement(card, { x: 0, y: 0, width: 200, height: 100 });
    const runtime = createEditorRuntime(document);
    runtime.select(card);
    expect(runtime.styleSelection(new Map([["backgroundColor", "red"], ["color", "white"]])).ok).toBe(true);
    expect(card.style.backgroundColor).toBe("red");
    expect(card.style.color).toBe("");
    expect(name.style.color).toBe("white");
    expect(copy.style.color).toBe("white");
    expect(runtime.undo().ok).toBe(true);
    expect(name.style.color).toBe("");
  });

  it("clears managed backgroundImage when applying a solid fill and undoes both in one step", () => {
    const { document, root } = createTestDocument(`<section id="card">Card</section>`);
    const card = byId(root, "card");
    layoutManagedElement(card, { x: 0, y: 0, width: 200, height: 100 });
    card.style.backgroundColor = "rgb(1, 2, 3)";
    card.style.backgroundImage = "linear-gradient(white, black)";
    const runtime = createEditorRuntime(document);
    runtime.select(card);
    expect(runtime.styleSelection(new Map([["backgroundImage", "linear-gradient(red, blue)"]])).ok).toBe(true);
    expect(runtime.styleSelection(new Map([["backgroundColor", "rgb(0, 128, 0)"]])).ok).toBe(true);
    expect(card.style.backgroundColor).toBe("rgb(0, 128, 0)");
    expect(card.style.backgroundImage).toBe("none");
    expect(runtime.ledger.peekUndoTransaction()).toHaveLength(2);
    expect(runtime.undo().ok).toBe(true);
    expect(card.style.backgroundImage).toContain("linear-gradient");
    expect(runtime.undo().ok).toBe(true);
    expect(card.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(card.style.backgroundImage).toContain("linear-gradient");
  });

  it("keeps a later gradient authoritative after a solid fill", () => {
    const { document, root } = createTestDocument(`<section id="card">Card</section>`);
    const card = byId(root, "card");
    layoutManagedElement(card, { x: 0, y: 0, width: 200, height: 100 });
    const runtime = createEditorRuntime(document);
    runtime.select(card);
    expect(runtime.styleSelection(new Map([["backgroundColor", "red"]])).ok).toBe(true);
    expect(card.style.backgroundImage).toBe("none");
    expect(runtime.styleSelection(new Map([["backgroundImage", "linear-gradient(red, blue)"]])).ok).toBe(true);
    expect(card.style.backgroundImage).toContain("linear-gradient");
    const checkpoint = projectCanonicalCheckpoint(runtime.ledger.activeOperations());
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) return;
    const image = checkpoint.operations.find((operation) => operation.type === "style" && operation.payload.property === "backgroundImage");
    expect(image?.type === "style" ? image.payload.value : "").toContain("linear-gradient");
  });

  it("normalizes formatted text and preserves inline wrapper elements on commit", () => {
    const { document, root } = createTestDocument(`<span id="copy"> Learn   more <strong>about</strong>   Pages </span>`);
    const copy = byId(root, "copy");
    layoutManagedElement(copy, { x: 0, y: 0, width: 200, height: 30 });
    const runtime = createEditorRuntime(document);
    runtime.select(copy);
    expect(runtime.editSelectedText("Learn more about Pages").ok).toBe(true);
    expect(copy.textContent).toBe("Learn more about Pages");
    expect(copy.querySelector("strong")).not.toBeNull();
  });

  it("normalizes stale, duplicate, and group+member atoms canonically", () => {
    const groups = new Map<string, RuntimeVirtualGroup>([
      ["g1", { id: "g1", memberIds: ["a", "b"] }],
    ]);
    expect(normalizeSelection([
      { kind: "node", nodeId: "a" },
      { kind: "group", groupId: "g1" },
      { kind: "node", nodeId: "b" },
      { kind: "group", groupId: "stale" },
    ], groups, "lasso")).toEqual({
      atoms: [{ kind: "group", groupId: "g1" }],
      primary: { kind: "group", groupId: "g1" },
      source: "lasso",
    });
  });

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

  it("keeps exact child selection after an ancestor becomes editor-managed", () => {
    const { document, root } = createTestDocument(`<div id="parent"><button id="child">Child</button></div>`);
    const parent = byId(root, "parent");
    const child = byId(root, "child");
    layoutManagedElement(parent, { x: 10, y: 10, width: 160, height: 80 });
    layoutManagedElement(child, { x: 30, y: 30, width: 70, height: 30 });
    parent.setAttribute(OTF_MANAGED_ATTR, "true");
    document.elementsFromPoint = () => [child, parent];
    const runtime = createEditorRuntime(document);
    expect(runtime.visualModel.pick(40, 40)).toBe(runtime.visualModel.adopt(child));
  });

  it("picks a paintless clone root instead of an underlying host section", () => {
    const { document, root } = createTestDocument(`<section id="source"><button>Host</button></section><div id="clone" data-otf-clone-id="clone-1"><button id="clone-child">Clone</button></div>`);
    const source = byId(root, "source"); const clone = byId(root, "clone"); const child = byId(root, "clone-child");
    layoutManagedElement(source, { x: 0, y: 0, width: 160, height: 80 });
    layoutManagedElement(clone, { x: 0, y: 0, width: 160, height: 80 });
    layoutManagedElement(child, { x: 10, y: 10, width: 60, height: 30 });
    document.elementsFromPoint = () => [child, clone, source];
    const model = createVisualModel(document);
    expect(model.pick(20, 20)).toBe("clone-1");
    expect(model.bind("clone-1")).toBe(clone);
  });

  it("keeps an explicit parent authoritative when clicking its nested child", () => {
    const { document, root } = createTestDocument(`<div id="parent"><button id="child">Child</button></div>`);
    const parent = byId(root, "parent"); const child = byId(root, "child");
    layoutManagedElement(parent, { x: 10, y: 10, width: 160, height: 80 });
    layoutManagedElement(child, { x: 30, y: 30, width: 70, height: 30 });
    document.elementsFromPoint = () => [child, parent];
    const runtime = createEditorRuntime(document);
    runtime.start();
    const parentId = present(runtime.select(parent));
    click(child, 40, 40);
    expect(runtime.selectedNodeIds()).toEqual([parentId]);
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
    for (let index = 0; index < 10; index += 1) expect(runtime.groupSelection()).toBe(first);
    expect(runtime.getGroup(present(first))?.memberIds).toHaveLength(2);
    runtime.clearSelection();
    runtime.select(a);
    expect(runtime.getSelection().atoms).toEqual([{ kind: "group", groupId: first }]);
    runtime.toggleSelection(c);
    document.elementsFromPoint = () => [a, b, c];
    runtime.selectRect({ x: 0, y: 0, width: 150, height: 40 }, "add");
    expect(runtime.getSelection().atoms).toEqual([
      { kind: "group", groupId: first },
      { kind: "node", nodeId: runtime.visualModel.adopt(c) },
    ]);
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

  it("rejects duplicate node IDs and aliased live elements before batch mutation", () => {
    const { document, root } = createTestDocument(`<div id="a">A</div>`);
    const element = byId(root, "a");
    layoutManagedElement(element, { x: 10, y: 10, width: 40, height: 30 });
    const base = createVisualModel(document);
    const adopted = present(base.adopt(element));
    const identity = present(base.durableIdentityOf(adopted));
    const ledger = createOperationLedger();
    const executor = createOperationExecutor({ document, visualModel: base, ledger, placement: createPlacementEngine() });
    const duplicate = executor.executeMoveBatch({ nodeIds: [adopted, adopted], dx: 10, dy: 10, pageKey: "https://example.com/" });
    expect(duplicate).toMatchObject({ ok: false, error: "duplicate_batch_target" });

    const aliased = {
      ...base,
      durableIdentityOf: () => identity,
      resolveNode: (nodeId: string) => ({
        kind: "resolved" as const,
        nodeId,
        element,
        identity,
        evidence: { strategy: "live-cache" as const, candidateCount: 1, cssPathMatched: true, structureShifted: false, matchedKeys: [] },
      }),
    } satisfies VisualModel;
    const aliasExecutor = createOperationExecutor({ document, visualModel: aliased, ledger, placement: createPlacementEngine() });
    const result = aliasExecutor.executeMoveBatch({ nodeIds: ["alias-a", "alias-b"], dx: 10, dy: 10, pageKey: "https://example.com/" });
    expect(result).toMatchObject({ ok: false, error: "duplicate_live_element" });
    expect(ledger.activeOperations()).toHaveLength(0);
  });

  it("projects a valid checkpoint after repeated regroup and movement", () => {
    const { document, root } = createTestDocument(`<div id="a">A</div><div id="b">B</div><div id="c">C</div>`);
    const a = byId(root, "a"); const b = byId(root, "b"); const c = byId(root, "c");
    [a, b, c].forEach((element, index) => {
      layoutManagedElement(element, { x: index * 60, y: 10, width: 40, height: 30 });
    });
    const runtime = createEditorRuntime(document);
    runtime.select(a); runtime.toggleSelection(b); runtime.groupSelection();
    expect(runtime.moveSelection(20, 10).ok).toBe(true);
    runtime.toggleSelection(c); runtime.groupSelection();
    expect(runtime.moveSelection(15, 5).ok).toBe(true);
    const checkpoint = projectCanonicalCheckpoint(runtime.ledger.activeOperations());
    expect(checkpoint.ok).toBe(true);
    if (checkpoint.ok) expect(checkpoint.operations).toHaveLength(3);
  });

  it("copies immutable current selection without dirtying the ledger", () => {
    const { document, root } = createTestDocument(`<button id="a">A</button>`);
    const a = byId(root, "a");
    layoutManagedElement(a, { x: 10, y: 20, width: 80, height: 30 });
    const runtime = createEditorRuntime(document);
    runtime.select(a);
    expect(runtime.moveSelection(25, 15).ok).toBe(true);
    runtime.ledger.markPersisted();
    expect(runtime.copySelection()).toBe(true);
    expect(runtime.ledger.isDirty()).toBe(false);
    expect(runtime.ledger.activeOperations()).toHaveLength(1);
  });

  it("deletes a group atomically and restores it with one undo/redo", () => {
    const { document, root } = createTestDocument(`<button id="a">A</button><button id="b">B</button>`);
    const a = byId(root, "a"); const b = byId(root, "b");
    layoutManagedElement(a, { x: 10, y: 20, width: 80, height: 30 });
    layoutManagedElement(b, { x: 110, y: 20, width: 80, height: 30 });
    const runtime = createEditorRuntime(document);
    runtime.select(a); runtime.toggleSelection(b); runtime.groupSelection();
    expect(runtime.deleteSelection().ok).toBe(true);
    expect(runtime.ledger.peekUndoTransaction()).toHaveLength(2);
    expect(a.style.display).toBe("none");
    expect(b.style.display).toBe("none");
    expect(runtime.undo().ok).toBe(true);
    expect(a.style.display).not.toBe("none");
    expect(b.style.display).not.toBe("none");
    expect(runtime.redo().ok).toBe(true);
    expect(a.style.display).toBe("none");
    expect(b.style.display).toBe("none");
  });

  it("mutation reconciliation does not replace the undo snapshot", () => {
    const { document, root } = createTestDocument(`<article id="profile">Profile</article>`);
    const profile = byId(root, "profile");
    layoutManagedElement(profile, { x: 10, y: 20, width: 180, height: 120 });
    const runtime = createEditorRuntime(document);
    runtime.select(profile);
    expect(runtime.deleteSelection().ok).toBe(true);
    runtime.lifecycle.onDomInvalidated();
    expect(runtime.undo().ok).toBe(true);
    expect(profile.style.display).not.toBe("none");
  });

  it("deletes an attached nested selection only once", () => {
    const { document, root } = createTestDocument(`<section id="p"><button id="c">C</button></section>`);
    const parent = byId(root, "p"); const child = byId(root, "c");
    layoutManagedElement(parent, { x: 0, y: 0, width: 120, height: 80 });
    layoutManagedElement(child, { x: 10, y: 10, width: 40, height: 20 });
    const runtime = createEditorRuntime(document);
    runtime.select(parent); runtime.toggleSelection(child);
    expect(runtime.deleteSelection().ok).toBe(true);
    expect(runtime.ledger.peekUndoTransaction()).toHaveLength(1);
  });

  it("canonicalizes freeform hits onto an explicit group and ignores tiny overlap", () => {
    const { document, root } = createTestDocument(`<button id="a">A</button><button id="b">B</button><button id="c">C</button>`);
    const a = byId(root, "a"); const b = byId(root, "b"); const c = byId(root, "c");
    layoutManagedElement(a, { x: 0, y: 0, width: 40, height: 30 });
    layoutManagedElement(b, { x: 60, y: 0, width: 40, height: 30 });
    layoutManagedElement(c, { x: 200, y: 0, width: 80, height: 60 });
    document.elementsFromPoint = (x) => x < 50 ? [a] : x < 110 ? [b] : [c];
    const runtime = createEditorRuntime(document);
    runtime.select(a); runtime.toggleSelection(b);
    const groupId = present(runtime.groupSelection());
    runtime.clearSelection();
    runtime.selectPolygon([{ x: -2, y: -2 }, { x: 50, y: -2 }, { x: 50, y: 40 }, { x: -2, y: 40 }], "replace");
    expect(runtime.getSelection().atoms).toEqual([{ kind: "group", groupId }]);
    runtime.clearSelection();
    runtime.selectPolygon([{ x: 198, y: -1 }, { x: 202, y: -1 }, { x: 202, y: 3 }, { x: 198, y: 3 }], "replace");
    expect(runtime.selectedNodeIds()).toEqual([]);
  });

  it("arms freeform so a page drag selects then exits without starting MOVE", () => {
    const { document, root } = createTestDocument(`<button id="a">A</button><button id="b">B</button>`);
    const a = byId(root, "a"); const b = byId(root, "b");
    layoutManagedElement(a, { x: 10, y: 10, width: 40, height: 30 });
    layoutManagedElement(b, { x: 80, y: 10, width: 40, height: 30 });
    document.elementsFromPoint = (x) => x < 60 ? [a] : [b];
    const runtime = createEditorRuntime(document);
    runtime.start();
    runtime.select(a);
    const before = a.getBoundingClientRect().x;
    runtime.armLasso("freeform");
    pointer(a, "pointerdown", 20, 20);
    pointer(a, "pointermove", 40, 40);
    pointer(a, "pointermove", 120, 40);
    pointer(a, "pointermove", 120, 8);
    pointer(a, "pointerup", 20, 8);
    expect(runtime.selectedNodeIds()).toEqual([runtime.visualModel.adopt(a), runtime.visualModel.adopt(b)]);
    expect(a.getBoundingClientRect().x).toBe(before);
    expect(runtime.ledger.isDirty()).toBe(false);
    pointer(a, "pointerdown", 20, 20);
    pointer(a, "pointermove", 50, 20);
    pointer(a, "pointerup", 50, 20);
    expect(a.getBoundingClientRect().x).not.toBe(before);
    runtime.stop();
  });
});
