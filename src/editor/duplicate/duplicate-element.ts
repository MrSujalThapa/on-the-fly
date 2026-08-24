import type { PageKey } from "../ids.js";
import type { DuplicateOperation, EditorOperation } from "../operations.js";
import { buildElementSignature } from "../measurement/signature-builder.js";
import type { TransformTarget } from "../transform/transform-target.js";
import { DUPLICATE_OFFSET_PX } from "../../shared/storage-limits.js";
import {
  measurementRectToAffectedRect,
} from "../save-window/operation-metadata.js";
import { summarizeElementSignature } from "../dom/signature-matcher.js";

export const OTF_CLONE_ATTR = "data-otf-clone-id";

const BLOCKED_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "iframe",
  "object",
  "embed",
  "template",
  "svg",
]);

const PRESENTATION_PROPS = [
  "color",
  "background-color",
  "background",
  "border",
  "border-radius",
  "padding",
  "margin",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "text-align",
  "box-shadow",
  "opacity",
  "display",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "z-index",
  "cursor",
  "white-space",
  "text-decoration",
  "letter-spacing",
  "gap",
  "flex-direction",
  "align-items",
  "justify-content",
] as const;

export interface EditorClipboardEntry {
  target: TransformTarget;
  element: HTMLElement;
}

export interface DuplicateBuildResult {
  operation: DuplicateOperation;
  cloneTarget: TransformTarget;
}

export function captureEditorClipboard(
  targets: TransformTarget[],
  resolveElement: (target: TransformTarget) => HTMLElement | null,
): EditorClipboardEntry[] {
  const entries: EditorClipboardEntry[] = [];
  for (const target of targets) {
    const element = resolveElement(target);
    if (!element || !isSafeToClone(element)) {
      continue;
    }
    entries.push({ target, element });
  }
  return entries;
}

export function buildDuplicateFromClipboardEntry(
  entry: EditorClipboardEntry,
  pageKey: PageKey,
  operationId: string,
  offsetIndex: number,
): DuplicateBuildResult | null {
  const source = entry.element;
  if (!isSafeToClone(source)) {
    return null;
  }

  const view = source.ownerDocument.defaultView;
  const rect = source.getBoundingClientRect();
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;
  const cloneId = operationId;
  const offsetDx = DUPLICATE_OFFSET_PX * (offsetIndex + 1);
  const offsetDy = DUPLICATE_OFFSET_PX * (offsetIndex + 1);

  const sanitized = sanitizeElementForClone(source);
  const signature = buildElementSignature(sanitized, {
    root: source.ownerDocument,
    ...(view
      ? {
          viewport: {
            width: source.ownerDocument.documentElement.clientWidth,
            height: source.ownerDocument.documentElement.clientHeight,
          },
        }
      : {}),
  });
  signature.cssPath = `[${OTF_CLONE_ATTR}="${cloneId}"]`;

  const cloneTarget: TransformTarget = {
    nodeId: cloneId,
    signature,
    rect: {
      x: rect.x + offsetDx,
      y: rect.y + offsetDy,
      width: rect.width,
      height: rect.height,
    },
  };

  const operation: DuplicateOperation = {
    id: operationId,
    type: "duplicate",
    pageKey,
    target: {
      nodeId: cloneId,
      signature,
    },
    payload: {
      cloneId,
      html: sanitized.outerHTML,
      parentCssPath: "body",
      offsetDx,
      offsetDy,
      sourceCssPath: entry.target.signature.cssPath,
      anchorLeft: rect.left + scrollX,
      anchorTop: rect.top + scrollY,
      anchorWidth: rect.width,
      anchorHeight: rect.height,
      styleSnapshot: captureStyleSnapshot(source),
    },
    createdAt: Date.now(),
    source: "manual",
    status: "draft",
    metadata: {
      targetSummary: summarizeElementSignature(signature),
      affectedRect: measurementRectToAffectedRect({
        x: rect.x + offsetDx,
        y: rect.y + offsetDy,
        width: rect.width,
        height: rect.height,
      }),
      sourceCommand: "duplicate",
    },
  };

  return { operation, cloneTarget };
}

export function isSafeToClone(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(tag)) {
    return false;
  }

  if (element.closest("script, style, svg")) {
    return false;
  }

  return true;
}

export function captureStyleSnapshot(element: HTMLElement): Record<string, string> {
  const computed = getComputedStyle(element);
  const snapshot: Record<string, string> = {};
  for (const property of PRESENTATION_PROPS) {
    const value = computed.getPropertyValue(property);
    if (value && value !== "none" && value !== "auto" && value !== "normal") {
      snapshot[property] = value;
    }
  }
  return snapshot;
}

export function applyStyleSnapshot(element: HTMLElement, snapshot: Record<string, string>): void {
  for (const [property, value] of Object.entries(snapshot)) {
    element.style.setProperty(property, value);
  }
}

function sanitizeElementForClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  sanitizeCloneTree(clone);
  clone.removeAttribute("id");
  return clone;
}

function sanitizeCloneTree(root: HTMLElement): void {
  const blocked = root.querySelectorAll(
    "script, style, link, meta, iframe, object, embed, template",
  );
  for (const node of Array.from(blocked)) {
    node.remove();
  }

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (!(element instanceof HTMLElement)) continue;
    element.removeAttribute("id");
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("data-otf-")) element.removeAttribute(attribute.name);
    }
  }
}

export function createDuplicateOperations(
  entries: EditorClipboardEntry[],
  pageKey: PageKey,
  createId: () => string,
): { operations: EditorOperation[]; cloneTargets: TransformTarget[] } {
  const operations: EditorOperation[] = [];
  const cloneTargets: TransformTarget[] = [];

  entries.forEach((entry, index) => {
    const built = buildDuplicateFromClipboardEntry(entry, pageKey, createId(), index);
    if (!built) {
      return;
    }
    operations.push(built.operation);
    cloneTargets.push(built.cloneTarget);
  });

  return { operations, cloneTargets };
}

export function resolveDuplicateElement(
  document: Document,
  cloneId: string,
): HTMLElement | null {
  const match = document.querySelector(`[${OTF_CLONE_ATTR}="${cloneId}"]`);
  return match instanceof HTMLElement ? match : null;
}
