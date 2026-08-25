import { describe, expect, it } from "vitest";
import { COMPONENT_DEFINITIONS } from "../../src/editor/create/component-definitions.js";
import {
  CREATED_ELEMENT_KINDS,
  OTF_ELEMENT_ID_ATTR,
} from "../../src/editor/create/created-element.js";
import { unionRectWithPadding } from "../../src/editor/create/placement-geometry.js";
import { renderCreatedElement } from "../../src/editor/create/render-created-element.js";
import { appearanceForFamily, appearanceHasLayoutProps, sampleAppearance } from "../../src/editor/create/sample-appearance.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import { OTF_DETACH_ATTR } from "../../src/editor/dom/managed-detach.js";
import type { CreateElementOperation, EditorOperation, MoveOperation } from "../../src/editor/operations.js";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { projectCanonicalCheckpoint } from "../../src/runtime-v2/canonical-checkpoint.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutManagedElement } from "../editor/measurement/layout-helpers.js";

const CONTROL_KEYS = [
  "fill", "textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "borderColor", "borderWidth", "borderStyle", "borderRadius", "boxShadow", "opacity", "paddingX", "paddingY",
] as const;

function patchRects(document: Document): void {
  const view = document.defaultView as Window & { HTMLElement: typeof HTMLElement };
  view.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const x = Number.parseFloat(this.style.left) || 0;
    const y = Number.parseFloat(this.style.top) || 0;
    const width = Number.parseFloat(this.style.width) || 10;
    const height = Number.parseFloat(this.style.height) || 10;
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
  };
}

function paintAt(document: Document, x: number, y: number): Element[] {
  const hits = Array.from(document.querySelectorAll("*")).filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement)) return false;
    const box = node.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom && box.width > 0;
  });
  hits.sort((left, right) => {
    const z = (node: HTMLElement): number => Number.parseInt(node.style.zIndex || "0", 10) || 0;
    if (z(left) !== z(right)) return z(right) - z(left);
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
  });
  return hits;
}

function createdOp(id: string): CreateElementOperation {
  return {
    id: `create-${id}`, type: "createElement", pageKey: "https://example.com/",
    target: {
      nodeId: id,
      signature: {
        cssPath: `[data-otf-element-id="${id}"]`, tagName: "button", classList: [],
        datasetFingerprint: `otfElementId=${id}`, boundingBoxHint: createEmptyBoundingBoxHint(), identityVersion: 2,
      },
    },
    payload: { elementId: id, kind: "button", rect: { x: 8, y: 8, width: 120, height: 40 }, content: { text: "Button" }, appearance: { fill: "#fff" } },
    createdAt: 1, source: "manual", status: "approved",
  };
}

function createdMove(id: string, dx: number): MoveOperation {
  const target = createdOp(id).target;
  return {
    id: `move-${id}`, type: "move", pageKey: "https://example.com/", target,
    payload: { dx, dy: 0 }, createdAt: 2, source: "manual", status: "approved",
    metadata: { originalRect: { x: 8, y: 8, width: 120, height: 40 }, finalRect: { x: 8 + dx, y: 8, width: 120, height: 40 }, affectedRect: { x: 8 + dx, y: 8, width: 120, height: 40 } },
  };
}

describe("created elements", () => {
  it("renders every recipe as a unique managed root", () => {
    const { document } = createTestDocument("");
    const ids = CREATED_ELEMENT_KINDS.map((kind) => {
      const node = renderCreatedElement(document, { elementId: `id-${kind}`, kind, rect: { x: 1, y: 2, width: 80, height: 40 } });
      expect(node.getAttribute(OTF_ELEMENT_ID_ATTR)).toBe(`id-${kind}`);
      expect(node.getAttribute("data-otf-component-kind")).toBe(kind);
      expect(node.getAttribute("data-otf-managed")).toBe("true");
      return node.getAttribute(OTF_ELEMENT_ID_ATTR);
    });
    expect(new Set(ids).size).toBe(CREATED_ELEMENT_KINDS.length);
  });

  it("adopts created targets, keeps identical components distinct, and samples without layout CSS", () => {
    const { document, root } = createTestDocument(`<button id="src" style="background:#0a66c2;color:#fff;border-radius:16px;font-weight:600">Follow</button>`);
    const source = root.querySelector("#src") as HTMLElement;
    layoutManagedElement(source, { x: 10, y: 10, width: 80, height: 28 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const sampled = sampleAppearance(source);
    expect(appearanceHasLayoutProps(sampled)).toBe(false);
    expect(Object.keys(appearanceForFamily(sampled, "control")).every((key) => (CONTROL_KEYS as readonly string[]).includes(key))).toBe(true);
    const first = runtime.createElement({ kind: "button", rect: { x: 40, y: 80, width: 120, height: 40 }, appearance: appearanceForFamily(sampled, "control") });
    const second = runtime.createElement({ kind: "button", rect: { x: 180, y: 80, width: 120, height: 40 }, appearance: appearanceForFamily(sampled, "control") });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok || first.operation.type !== "createElement" || second.operation.type !== "createElement") return;
    expect(first.operation.target.nodeId).not.toBe(second.operation.target.nodeId);
    expect(runtime.visualModel.bind(first.operation.target.nodeId ?? "")?.getAttribute(OTF_ELEMENT_ID_ATTR)).toBe(first.operation.payload.elementId);
    source.style.background = "red";
    expect(first.operation.payload.appearance.fill).not.toBe("red");
    runtime.stop();
  });

  it("replays create before later effects and keeps two created buttons distinct", () => {
    const style: EditorOperation = {
      ...createdMove("btn-a", 12), id: "style-a", type: "style",
      payload: { property: "backgroundColor", value: "#eee" },
    };
    const checkpoint = projectCanonicalCheckpoint([createdMove("btn-a", 12), style, createdOp("btn-b"), createdOp("btn-a")]);
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) return;
    expect(checkpoint.operations.map((operation) => operation.type)).toEqual(["createElement", "createElement", "move", "style"]);
    expect(checkpoint.operations.filter((operation) => operation.type === "createElement").map((operation) => operation.payload.elementId)).toEqual(["btn-a", "btn-b"]);
  });

  it("wraps live union geometry without reparenting host nodes and undoes atomically", () => {
    const { document, root } = createTestDocument(`<button id="a">A</button><button id="b">B</button>`);
    const a = root.querySelector("#a") as HTMLElement;
    const b = root.querySelector("#b") as HTMLElement;
    layoutManagedElement(a, { x: 200, y: 120, width: 40, height: 20 });
    layoutManagedElement(b, { x: 280, y: 140, width: 50, height: 22 });
    const parent = a.parentElement;
    const hostZ = a.style.zIndex;
    patchRects(document);
    document.elementsFromPoint = (x, y) => paintAt(document, x, y);
    const runtime = createEditorRuntime(document);
    runtime.start();
    runtime.select(a);
    runtime.toggleSelection(b);
    const measured = [...runtime.visualModel.measure(runtime.selectedNodeIds()).values()];
    const expected = unionRectWithPadding(measured, 16);
    const wrap = runtime.createContainerAroundSelection();
    expect(wrap.ok).toBe(true);
    const checkpoint = projectCanonicalCheckpoint(runtime.ledger.activeOperations());
    expect(checkpoint.ok).toBe(true);
    if (checkpoint.ok) {
      expect(checkpoint.operations.some((operation) => operation.type === "createElement")).toBe(true);
      expect(checkpoint.operations.some((operation) => operation.type === "group")).toBe(false);
    }
    const container = document.querySelector<HTMLElement>('[data-otf-component-kind="container"]');
    expect(container).not.toBeNull();
    expect(a.parentElement).toBe(parent);
    expect(a.style.zIndex).toBe(hostZ);
    expect(b.style.zIndex).toBe(hostZ);
    expect(runtime.getSelection().atoms).toEqual([{ kind: "node", nodeId: container?.getAttribute(OTF_ELEMENT_ID_ATTR) }]);
    expect(runtime.getGroup("otf-group-1")).toBeNull();
    expect(runtime.groupSelection()).toBeNull();
    expect(runtime.styleSelection(new Map([["backgroundColor", "red"]])).ok).toBe(true);
    expect(container?.style.backgroundColor).toBe("red");
    expect(a.style.backgroundColor).not.toBe("red");
    expect(runtime.undo().ok).toBe(true);
    if (container && expected) {
      const box = container.getBoundingClientRect();
      expect(Math.abs(box.x - expected.x)).toBeLessThan(2);
      expect(Math.abs(box.width - expected.width)).toBeLessThan(2);
    }
    expect(runtime.undo().ok).toBe(true);
    expect(document.querySelector('[data-otf-component-kind="container"]')).toBeNull();
    expect(runtime.redo().ok).toBe(true);
    expect(document.querySelector('[data-otf-component-kind="container"]')).not.toBeNull();
    const hostId = runtime.visualModel.adopt(a);
    expect(hostId && runtime.move(hostId, 12, 0).ok).toBe(true);
    expect(a.parentElement).toBe(parent);
    runtime.stop();
  });

  it("resolves Search internals to the managed root", () => {
    const { document } = createTestDocument("");
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    expect(runtime.createElement({ kind: "search", rect: { x: 20, y: 20, width: 260, height: 42 } }).ok).toBe(true);
    const search = document.querySelector('[data-otf-component-kind="search"]') as HTMLElement;
    const icon = search.querySelector("[data-otf-part]") as HTMLElement;
    document.elementsFromPoint = () => [icon, search, document.body];
    expect(runtime.visualModel.pick(40, 30)).toBe(search.getAttribute(OTF_ELEMENT_ID_ATTR));
    runtime.stop();
  });

  it("exposes text capability only for recipes that have primary copy", () => {
    expect(COMPONENT_DEFINITIONS.button.textCapable).toBe(true);
    expect(COMPONENT_DEFINITIONS.rectangle.textCapable).toBe(false);
  });

  it("created targets stay independent and pick follows paint order", () => {
    const { document, root } = createTestDocument(`<button id="host">Host</button>`);
    const host = root.querySelector("#host") as HTMLElement;
    layoutManagedElement(host, { x: 40, y: 40, width: 120, height: 40 });
    patchRects(document);
    document.elementsFromPoint = (x, y) => paintAt(document, x, y);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const created = runtime.createElement({ kind: "rectangle", rect: { x: 40, y: 40, width: 120, height: 80 } });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const createdId = created.operation.target.nodeId ?? "";
    const createdEl = runtime.visualModel.bind(createdId);
    expect(createdEl?.getAttribute(OTF_DETACH_ATTR)).toBe("true");
    expect(runtime.move(createdId, 24, 0).ok).toBe(true);
    expect(createdEl?.getBoundingClientRect().x).toBe(64);
    expect(runtime.resizeSelection({ x: 64, y: 40, width: 140, height: 90 }).ok).toBe(true);
    expect(createdEl?.getAttribute(OTF_DETACH_ATTR)).toBe("true");
    const hostId = runtime.visualModel.adopt(host);
    expect(hostId).toBeTruthy();
    if (!hostId || !createdEl) return;
    host.style.left = "40px";
    host.style.top = "40px";
    host.style.width = "120px";
    host.style.height = "40px";
    expect(host.getAttribute(OTF_DETACH_ATTR)).not.toBe("true");
    const broughtFront = runtime.layer(hostId, "front");
    expect(broughtFront.ok).toBe(true);
    expect(host.getAttribute(OTF_DETACH_ATTR)).toBe("true");
    expect(runtime.layer(hostId, "back").ok).toBe(true);
    expect(Number.parseInt(host.style.zIndex || "1", 10)).toBeGreaterThanOrEqual(1);
    expect(runtime.move(hostId, 12, 0).ok).toBe(true);
    runtime.select(host);
    const movedHost = host.getBoundingClientRect();
    expect(runtime.resizeSelection({ x: movedHost.x, y: movedHost.y, width: 150, height: 50 }).ok).toBe(true);
    expect(host.getAttribute(OTF_DETACH_ATTR)).toBe("true");
    host.style.zIndex = "2";
    createdEl.style.zIndex = "1";
    document.elementsFromPoint = () => [host, createdEl, document.body];
    expect(runtime.visualModel.pick(80, 50)).toBe(hostId);
    runtime.select(createdEl);
    document.defaultView?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 80, clientY: 50, pointerId: 1 }));
    document.defaultView?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 80, clientY: 50, pointerId: 1 }));
    expect(runtime.selectedNodeIds()[0]).toBe(hostId);
    document.elementsFromPoint = () => [createdEl, host, document.body];
    expect(runtime.visualModel.pick(80, 50)).toBe(createdId);
    runtime.stop();
  });

  it("replays a created element onto a fresh document with the same elementId", () => {
    const { document } = createTestDocument("");
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const created = runtime.createElement({ kind: "button", rect: { x: 40, y: 80, width: 120, height: 40 } });
    expect(created.ok).toBe(true);
    if (!created.ok || created.operation.type !== "createElement") return;
    const operation = created.operation;
    runtime.stop();
    const { document: next } = createTestDocument("");
    patchRects(next);
    const replayed = createEditorRuntime(next).executor.replayOperation(operation);
    expect(replayed.ok).toBe(true);
    const restored = next.querySelector(`[${OTF_ELEMENT_ID_ATTR}="${operation.payload.elementId}"]`);
    expect(restored).not.toBeNull();
    expect(restored?.getAttribute("data-otf-component-kind")).toBe("button");
    expect(restored?.getAttribute(OTF_DETACH_ATTR)).toBe("true");
  });
});
