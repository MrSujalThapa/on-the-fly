import type { EditorOperation, MoveOperation } from "../../src/editor/operations.js";
import type { ElementSignature } from "../../src/editor/element-signature.js";
import type { TransformTarget } from "../../src/editor/transform/transform-target.js";
import { buildElementSignature } from "../../src/editor/measurement/signature-builder.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import { matchElementBySignatureDetailed } from "../../src/editor/dom/signature-matcher.js";
import { resolveTargetElementDetailed } from "../../src/editor/dom/resolve-target.js";
import {
  OTF_DETACH_ATTR,
} from "../../src/editor/dom/managed-detach.js";
import {
  OTF_CROP_ATTR,
  OTF_INTERACTION_FIXED_ATTR,
  OTF_MANAGED_ATTR,
  OTF_TRANSFORM_ATTR,
  OTF_TRANSFORM_ONLY_ATTR,
} from "../../src/editor/dom/types.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import {
  createTransformController,
  type TransformController,
} from "../../src/content/transform-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import * as storageClient from "../../src/content/storage-client.js";
import { vi } from "vitest";

export const GEOMETRY_TOLERANCE_PX = 1;

export interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowSpec {
  group: string;
  index: number;
  axis: "x" | "y" | "none";
  gap: number;
}

interface LayoutBinding {
  pageRect: GeometryRect;
  flow: FlowSpec | null;
}

export interface PlacementSnapshot {
  rect: GeometryRect;
  transform: string;
  position: string;
  left: string;
  top: string;
  parentTag: string | null;
  parentFixtureId: string | null;
  detached: boolean;
  interactionFixed: boolean;
  transformOnly: boolean;
}

export interface MoveStrategyKind {
  detached: boolean;
  interactionSafeFixed: boolean;
  transformOnly: boolean;
  placementMode: MoveOperation["payload"]["interactionPlacementMode"];
}

function asRect(x: number, y: number, width: number, height: number): GeometryRect {
  return { x, y, width, height };
}

export function rectsClose(
  a: GeometryRect,
  b: GeometryRect,
  tolerance = GEOMETRY_TOLERANCE_PX,
): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

export function intendedRect(origin: GeometryRect, dx: number, dy: number): GeometryRect {
  return { x: origin.x + dx, y: origin.y + dy, width: origin.width, height: origin.height };
}

function isOutOfFlow(element: HTMLElement): boolean {
  const position = element.style.position;
  return (
    !element.isConnected ||
    position === "fixed" ||
    position === "absolute" ||
    element.getAttribute(OTF_DETACH_ATTR) === "true"
  );
}

/**
 * Models viewport geometry for happy-dom. Transform/fixed/absolute placement
 * update the target's box; in-flow siblings collapse when a peer leaves flow.
 */
export class VisualLayoutWorld {
  private readonly bindings = new Map<HTMLElement, LayoutBinding>();
  private scrollX = 0;
  private scrollY = 0;

  constructor(private readonly document: Document) {}

  bind(element: HTMLElement, pageRect: GeometryRect, flow: FlowSpec | null = null): void {
    this.bindings.set(element, { pageRect: { ...pageRect }, flow });
    element.getBoundingClientRect = () => this.toDomRect(this.measure(element));
  }

  flowOf(element: HTMLElement): FlowSpec | null {
    return this.bindings.get(element)?.flow ?? null;
  }

  pageRectOf(element: HTMLElement): GeometryRect | null {
    const binding = this.bindings.get(element);
    return binding ? { ...binding.pageRect } : null;
  }

  setScroll(scrollX: number, scrollY: number): void {
    this.scrollX = scrollX;
    this.scrollY = scrollY;
    const view = this.document.defaultView as { scrollX?: number; scrollY?: number } | null;
    if (view) {
      Object.defineProperty(view, "scrollX", { configurable: true, value: scrollX });
      Object.defineProperty(view, "scrollY", { configurable: true, value: scrollY });
    }
  }

  measure(element: HTMLElement): GeometryRect {
    const binding = this.bindings.get(element);
    if (!binding) {
      const live = element.getBoundingClientRect();
      return asRect(live.x, live.y, live.width, live.height);
    }

    if (isOutOfFlow(element)) {
      return this.measureOutOfFlow(element, binding.pageRect);
    }

    let x = binding.pageRect.x;
    let y = binding.pageRect.y;
    const flow = binding.flow;
    if (flow && flow.axis !== "none") {
      for (const [peer, peerBinding] of this.bindings) {
        if (
          peer === element ||
          !peerBinding.flow ||
          peerBinding.flow.group !== flow.group ||
          peerBinding.flow.index >= flow.index
        ) {
          continue;
        }
        if (!isOutOfFlow(peer)) {
          continue;
        }
        if (flow.axis === "y") {
          y -= peerBinding.pageRect.height + flow.gap;
        } else {
          x -= peerBinding.pageRect.width + flow.gap;
        }
      }
    }

    const translated = applyTranslate(element, x, y, binding.pageRect.width, binding.pageRect.height);
    return asRect(
      translated.x - this.scrollX,
      translated.y - this.scrollY,
      translated.width,
      translated.height,
    );
  }

  stripEditorState(element: HTMLElement): void {
    element.removeAttribute("style");
    element.removeAttribute(OTF_MANAGED_ATTR);
    element.removeAttribute(OTF_TRANSFORM_ATTR);
    element.removeAttribute(OTF_DETACH_ATTR);
    element.removeAttribute(OTF_TRANSFORM_ONLY_ATTR);
    element.removeAttribute(OTF_INTERACTION_FIXED_ATTR);
    element.removeAttribute(OTF_CROP_ATTR);
  }

  private measureOutOfFlow(element: HTMLElement, fallback: GeometryRect): GeometryRect {
    const width = element.style.width ? Number.parseFloat(element.style.width) : fallback.width;
    const height = element.style.height ? Number.parseFloat(element.style.height) : fallback.height;
    const left = element.style.left ? Number.parseFloat(element.style.left) : fallback.x;
    const top = element.style.top ? Number.parseFloat(element.style.top) : fallback.y;
    if (element.style.position === "fixed") {
      return asRect(left, top, width, height);
    }
    return asRect(left - this.scrollX, top - this.scrollY, width, height);
  }

  private toDomRect(rect: GeometryRect): DOMRect {
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

function applyTranslate(
  element: HTMLElement,
  x: number,
  y: number,
  width: number,
  height: number,
): GeometryRect {
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(element.style.transform);
  const dx = match ? Number.parseFloat(match[1] ?? "0") : 0;
  const dy = match ? Number.parseFloat(match[2] ?? "0") : 0;
  const nextWidth = element.style.width ? Number.parseFloat(element.style.width) : width;
  const nextHeight = element.style.height ? Number.parseFloat(element.style.height) : height;
  return asRect(x + dx, y + dy, nextWidth, nextHeight);
}

export function capturePlacement(element: HTMLElement): PlacementSnapshot {
  const parent = element.parentElement;
  return {
    rect: extractBoundingBox(element),
    transform: element.style.transform,
    position: element.style.position,
    left: element.style.left,
    top: element.style.top,
    parentTag: parent?.tagName.toLowerCase() ?? null,
    parentFixtureId: parent?.getAttribute("data-fixture-id") ?? parent?.className ?? null,
    detached: element.getAttribute(OTF_DETACH_ATTR) === "true",
    interactionFixed: element.getAttribute(OTF_INTERACTION_FIXED_ATTR) === "true",
    transformOnly: element.getAttribute(OTF_TRANSFORM_ONLY_ATTR) === "true",
  };
}

export function readMoveStrategy(operation: EditorOperation | undefined): MoveStrategyKind | null {
  if (!operation || operation.type !== "move") {
    return null;
  }
  return {
    detached: operation.payload.detached === true,
    interactionSafeFixed: operation.payload.interactionSafeFixed === true,
    transformOnly: operation.payload.transformOnly === true,
    placementMode: operation.payload.interactionPlacementMode,
  };
}

export function targetFromElement(element: HTMLElement, document: Document): TransformTarget {
  const rect = extractBoundingBox(element);
  const signature = buildElementSignature(element, { root: document });
  return {
    nodeId: signature.idAttr ?? signature.cssPath,
    signature,
    rect,
    element,
  };
}

export function fixtureIdOf(element: HTMLElement): string | null {
  return element.getAttribute("data-fixture-id");
}

export function createRecordingShell(): {
  shell: EditorShell;
  lastOutlines: GeometryRect[];
} {
  const lastOutlines: GeometryRect[] = [];
  const shell = {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => {
      lastOutlines.length = 0;
    },
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: (rects: GeometryRect[]) => {
      lastOutlines.splice(0, lastOutlines.length, ...rects.map((rect) => ({ ...rect })));
    },
  } as unknown as EditorShell;
  return { shell, lastOutlines };
}

export function mockPageOperationStore(): Map<string, EditorOperation[]> {
  const store = new Map<string, EditorOperation[]>();
  vi.spyOn(storageClient, "loadPageOperations").mockImplementation((pageKey) => {
    return Promise.resolve([...(store.get(pageKey) ?? [])]);
  });
  vi.spyOn(storageClient, "replacePageOperations").mockImplementation((pageKey, operations) => {
    store.set(pageKey, [...operations]);
    return Promise.resolve({ ok: true, operationCount: operations.length });
  });
  return store;
}

export interface MoveSession {
  live: PageCustomizationController;
  controller: TransformController;
  lastOutlines: GeometryRect[];
  dispose(): void;
}

export function createMoveSession(document: Document): MoveSession {
  const live = new PageCustomizationController(document);
  const { shell, lastOutlines } = createRecordingShell();
  const controller = createTransformController({
    shell,
    document,
    adapter: live.getAdapter(),
    getPageKey: () => live.getPageKey(),
  });
  return {
    live,
    controller,
    lastOutlines,
    dispose() {
      live.dispose();
    },
  };
}

export function selectAndMove(
  session: MoveSession,
  document: Document,
  element: HTMLElement,
  dx: number,
  dy: number,
): {
  selected: TransformTarget;
  operations: EditorOperation[];
  appliedElement: HTMLElement;
} {
  const selected = targetFromElement(element, document);
  const origin = extractBoundingBox(element);
  session.controller.setSelection({
    targets: [selected],
    outlineRects: [{ ...selected.rect }],
    variant: "node",
    handleTarget: selected,
  });
  session.controller.beginMove(origin.x + 8, origin.y + 8);
  const operations = session.controller.endMove(origin.x + 8 + dx, origin.y + 8 + dy);
  return { selected, operations, appliedElement: element };
}

export function resolveSignature(
  document: Document,
  signature: ElementSignature | undefined,
): ReturnType<typeof matchElementBySignatureDetailed> {
  if (!signature) {
    return {
      element: null,
      diagnostics: {
        resolved: false,
        matchStrategy: "unresolved",
        failureReason: "missing_signature",
      },
    };
  }
  return matchElementBySignatureDetailed(document, signature);
}

export async function saveAndReplay(
  live: PageCustomizationController,
  document: Document,
  operations: EditorOperation[],
  restoreHost: () => void,
): Promise<{
  replayed: PageCustomizationController;
  replayTarget: HTMLElement | null;
  replayDiagnostics: ReturnType<typeof resolveTargetElementDetailed> | null;
}> {
  live.setPageOperations(operations);
  const saved = await live.syncOperationsToStorage();
  if (!saved.ok) {
    throw new Error(saved.error ?? "save failed");
  }
  restoreHost();
  const replayed = new PageCustomizationController(document);
  const replay = await replayed.ensureReplayed();
  if (replay.failed > 0) {
    throw new Error(`replay failed:${String(replay.failed)}`);
  }
  const signature = operations[0]?.target.signature;
  const detailed = signature
    ? resolveTargetElementDetailed(document, operations[0]?.target ?? {})
    : null;
  return {
    replayed,
    replayTarget: detailed?.element ?? null,
    replayDiagnostics: detailed,
  };
}

export function siblingRectDelta(
  before: Record<string, GeometryRect>,
  after: Record<string, GeometryRect>,
  ignoreKey: string,
): Array<{ key: string; before: GeometryRect; after: GeometryRect }> {
  const changed: Array<{ key: string; before: GeometryRect; after: GeometryRect }> = [];
  for (const [key, rect] of Object.entries(before)) {
    if (key === ignoreKey) {
      continue;
    }
    const next = after[key];
    if (!next) {
      continue;
    }
    if (!rectsClose(rect, next)) {
      changed.push({ key, before: rect, after: next });
    }
  }
  return changed;
}
