import { OTF_MANAGED_ATTR, OTF_TRANSFORM_ATTR, type ElementStyleSnapshot, type StoredTransformState } from "./types.js";

export class ElementSnapshotStore {
  private readonly snapshots = new WeakMap<HTMLElement, ElementStyleSnapshot>();

  captureIfNeeded(element: HTMLElement): ElementStyleSnapshot {
    const existing = this.snapshots.get(element);
    if (existing) {
      return existing;
    }

    const snapshot = captureElementSnapshot(element);
    this.snapshots.set(element, snapshot);
    element.setAttribute(OTF_MANAGED_ATTR, "true");
    return snapshot;
  }

  getSnapshot(element: HTMLElement): ElementStyleSnapshot | undefined {
    return this.snapshots.get(element);
  }

  hasSnapshot(element: HTMLElement): boolean {
    return this.snapshots.has(element);
  }
}

const PRESENTATION_STYLE_PROPERTIES = [
  "color",
  "background-color",
  "border-color",
  "border-width",
  "border-radius",
  "font-size",
  "font-weight",
  "text-align",
  "opacity",
  "box-shadow",
  "filter",
] as const;

function buildPresentationCssText(element: HTMLElement, computed: CSSStyleDeclaration): string {
  const merged = new Map<string, string>();

  for (const part of element.style.cssText.split(";")) {
    const colonIndex = part.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const key = part.slice(0, colonIndex).trim();
    const value = part.slice(colonIndex + 1).trim();
    if (key && value) {
      merged.set(key, value);
    }
  }

  for (const property of PRESENTATION_STYLE_PROPERTIES) {
    const inline = element.style.getPropertyValue(property);
    const value = inline || computed.getPropertyValue(property);
    if (!value || value === "initial" || value === "auto" || value === "normal") {
      continue;
    }
    merged.set(property, value);
  }

  return [...merged.entries()].map(([key, value]) => `${key}: ${value}`).join("; ");
}

export function captureElementSnapshot(element: HTMLElement): ElementStyleSnapshot {
  const computed = getComputedStyle(element);
  const presentationCssText = buildPresentationCssText(element, computed);

  return {
    inlineStyle: element.getAttribute("style") ?? "",
    presentationCssText,
    display: element.style.display || computed.display,
    visibility: element.style.visibility || computed.visibility,
    transform: element.style.transform || computed.transform,
    width: element.style.width || computed.width,
    height: element.style.height || computed.height,
    zIndex: element.style.zIndex || computed.zIndex,
    position: element.style.position || computed.position,
    textContent: element.textContent,
  };
}

export function readStoredTransformState(element: HTMLElement): StoredTransformState | null {
  const raw = element.getAttribute(OTF_TRANSFORM_ATTR);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredTransformState;
    if (
      typeof parsed.dx !== "number" ||
      typeof parsed.dy !== "number" ||
      typeof parsed.rotate !== "number" ||
      typeof parsed.position !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredTransformState(
  element: HTMLElement,
  state: StoredTransformState | null,
): void {
  if (!state) {
    element.removeAttribute(OTF_TRANSFORM_ATTR);
    return;
  }

  element.setAttribute(OTF_TRANSFORM_ATTR, JSON.stringify(state));
}

/**
 * CSS transforms do not affect ordinary non-replaced inline boxes. OTF allows
 * text/content nodes to be selected directly, so an attached inline target
 * must be promoted only at the formatting-box level (inline -> inline-block)
 * before applying its managed transform. This keeps DOM ownership and parent
 * composition intact while making MOVE observable. Full independent placement
 * is still handled separately by the placement engine when the target leaves
 * its visual parent.
 */
function ensureTransformableFormattingBox(element: HTMLElement): void {
  if (element.style.display) {
    return;
  }
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return;
  }
  if (view.getComputedStyle(element).display === "inline") {
    element.style.display = "inline-block";
  }
}

export function applyStoredTransformState(
  element: HTMLElement,
  state: StoredTransformState,
): void {
  if (
    state.position === "fixed" ||
    state.position === "absolute"
  ) {
    if (
      state.fixedLeft !== null &&
      state.fixedLeft !== undefined &&
      state.fixedTop !== null &&
      state.fixedTop !== undefined
    ) {
      element.style.position = state.position;
      element.style.left = `${String(state.fixedLeft)}px`;
      element.style.top = `${String(state.fixedTop)}px`;
      if (state.rotate !== 0) {
        element.style.transform = `rotate(${String(state.rotate)}deg)`;
      } else {
        element.style.transform = "";
      }
      if (state.width !== null) {
        element.style.width = `${String(state.width)}px`;
      } else {
        element.style.removeProperty("width");
      }
      if (state.height !== null) {
        element.style.height = `${String(state.height)}px`;
      } else {
        element.style.removeProperty("height");
      }
      return;
    }
  }

  ensureTransformableFormattingBox(element);
  element.style.position = state.position;
  element.style.transform = `translate(${String(state.dx)}px, ${String(state.dy)}px) rotate(${String(state.rotate)}deg)`;

  if (state.width !== null) {
    element.style.width = `${String(state.width)}px`;
  } else {
    element.style.removeProperty("width");
  }

  if (state.height !== null) {
    element.style.height = `${String(state.height)}px`;
  } else {
    element.style.removeProperty("height");
  }
}

/**
 * Realize one complete OTF transform state at an explicit viewport rect.
 * Callers must start from a captured state; this function never reads another
 * target or any gesture-global transform value.
 */
export function applyStoredTransformStateToRect(
  element: HTMLElement,
  state: StoredTransformState,
  target: { x: number; y: number; width: number; height: number },
): void {
  state.width = target.width;
  state.height = target.height;
  applyStoredTransformState(element, state);
  const current = element.getBoundingClientRect();
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (element.getAttribute("data-otf-detached") === "true") {
    const view = element.ownerDocument.defaultView;
    state.dx = 0;
    state.dy = 0;
    state.position = "absolute";
    element.style.position = "absolute";
    element.style.left = `${String(target.x + (view?.scrollX ?? 0))}px`;
    element.style.top = `${String(target.y + (view?.scrollY ?? 0))}px`;
    element.style.width = `${String(target.width)}px`;
    element.style.height = `${String(target.height)}px`;
    element.style.transform = state.rotate !== 0 ? `rotate(${String(state.rotate)}deg)` : "";
    writeStoredTransformState(element, state);
    return;
  }
  if (
    (state.position === "fixed" || state.position === "absolute") &&
    state.fixedLeft !== null && state.fixedLeft !== undefined &&
    state.fixedTop !== null && state.fixedTop !== undefined
  ) {
    state.fixedLeft += dx;
    state.fixedTop += dy;
  } else {
    state.dx += dx;
    state.dy += dy;
  }
  writeStoredTransformState(element, state);
  applyStoredTransformState(element, state);
}

export function restoreInlineStyleFromSnapshot(
  element: HTMLElement,
  snapshot: ElementStyleSnapshot,
): void {
  // Restore the element's exact prior inline style attribute. Anything not set
  // inline before the operation must fall back to the page's stylesheet rules,
  // so we never bake computed values back in (that would mutate geometry and
  // break before/after determinism on undo, redo, and clear).
  if (snapshot.inlineStyle) {
    element.setAttribute("style", snapshot.inlineStyle);
    return;
  }

  element.removeAttribute("style");
}
