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

export function captureElementSnapshot(element: HTMLElement): ElementStyleSnapshot {
  const computed = getComputedStyle(element);

  return {
    inlineStyle: element.getAttribute("style") ?? "",
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

export function applyStoredTransformState(
  element: HTMLElement,
  state: StoredTransformState,
): void {
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

export function restoreInlineStyleFromSnapshot(
  element: HTMLElement,
  snapshot: ElementStyleSnapshot,
): void {
  if (snapshot.inlineStyle) {
    element.setAttribute("style", snapshot.inlineStyle);
    return;
  }

  element.removeAttribute("style");
}
