import type { MeasurementRect } from "../measurement/types.js";

export const LASSO_DRAG_THRESHOLD_PX = 6;
export const MIN_LASSO_RECT_PX = 1;

export type PointerGestureKind = "pending" | "lasso" | "click";

export interface PointerGestureState {
  pointerId: number;
  startX: number;
  startY: number;
  shiftKey: boolean;
  altKey: boolean;
  kind: PointerGestureKind;
}

export function beginPointerGesture(
  pointerId: number,
  startX: number,
  startY: number,
  shiftKey: boolean,
  altKey = false,
): PointerGestureState {
  return {
    pointerId,
    startX,
    startY,
    shiftKey,
    altKey,
    kind: "pending",
  };
}

export function isLassoGesture(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold: number = LASSO_DRAG_THRESHOLD_PX,
): boolean {
  return (
    Math.abs(endX - startX) >= threshold ||
    Math.abs(endY - startY) >= threshold
  );
}

export function updatePointerGesture(
  state: PointerGestureState,
  currentX: number,
  currentY: number,
  threshold: number = LASSO_DRAG_THRESHOLD_PX,
): PointerGestureState {
  if (state.kind !== "pending") {
    return state;
  }

  if (isLassoGesture(state.startX, state.startY, currentX, currentY, threshold)) {
    return { ...state, kind: "lasso" };
  }

  return state;
}

export function resolvePointerGestureAction(
  state: PointerGestureState,
  endX: number,
  endY: number,
  threshold: number = LASSO_DRAG_THRESHOLD_PX,
): "click" | "lasso" | "cancel" {
  if (state.kind === "lasso") {
    return "lasso";
  }

  if (isLassoGesture(state.startX, state.startY, endX, endY, threshold)) {
    return "lasso";
  }

  return "click";
}

export function shouldConsumeEditModePointerEvent(options: {
  button: number;
  isExtensionRootTarget: boolean;
}): boolean {
  return options.button === 0 && !options.isExtensionRootTarget;
}

export function shouldSuppressEditModeClick(options: {
  button: number;
  isExtensionRootTarget: boolean;
}): boolean {
  return (options.button === 0 || options.button === 1) && !options.isExtensionRootTarget;
}

export function normalizeLassoRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): MeasurementRect {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  return {
    x,
    y,
    width: Math.max(MIN_LASSO_RECT_PX, Math.abs(endX - startX)),
    height: Math.max(MIN_LASSO_RECT_PX, Math.abs(endY - startY)),
  };
}

export function suppressPageInteractionEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

export function getEventComposedPath(event: Event): EventTarget[] {
  if (typeof event.composedPath === "function") {
    return event.composedPath();
  }

  return event.target ? [event.target] : [];
}

export function isExtensionRootInComposedPath(
  path: EventTarget[],
  isExtensionRoot: (element: Element) => boolean,
): boolean {
  return path.some((target) => target instanceof Element && isExtensionRoot(target));
}

function isEditableElementInComposedPath(path: EventTarget[]): boolean {
  return path.some(
    (target) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || target.getAttribute("contenteditable") !== null),
  );
}

function isKeyboardTextEntryInComposedPath(path: EventTarget[]): boolean {
  return path.some(
    (target) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.getAttribute("contenteditable") !== null ||
        isTextEntryElement(target)),
  );
}

function isTextEntryElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") {
    return true;
  }

  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }

  return false;
}

function isClickableActivationElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "a" && element.hasAttribute("href")) {
    return true;
  }
  if (tag === "button") {
    return true;
  }
  if (tag === "summary") {
    return true;
  }
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return [
      "button",
      "checkbox",
      "image",
      "radio",
      "reset",
      "submit",
    ].includes(type);
  }

  const role = element.getAttribute("role")?.toLowerCase();
  return role !== undefined && [
    "button",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "radio",
    "switch",
    "tab",
  ].includes(role);
}

export function shouldHandleEditModePointerEvent(
  event: PointerEvent,
  isExtensionRoot: (element: Element) => boolean,
): boolean {
  const path = getEventComposedPath(event);
  if (isEditableElementInComposedPath(path)) {
    return false;
  }

  return shouldConsumeEditModePointerEvent({
    button: event.button,
    isExtensionRootTarget: isExtensionRootInComposedPath(path, isExtensionRoot),
  });
}

export function shouldHandleEditModeClickEvent(
  event: MouseEvent,
  isExtensionRoot: (element: Element) => boolean,
): boolean {
  const path = getEventComposedPath(event);
  if (isEditableElementInComposedPath(path)) {
    return false;
  }

  return shouldSuppressEditModeClick({
    button: event.button,
    isExtensionRootTarget: isExtensionRootInComposedPath(path, isExtensionRoot),
  });
}

export function shouldHandleEditModeKeyboardActivationEvent(
  event: KeyboardEvent,
  isExtensionRoot: (element: Element) => boolean,
): boolean {
  if (event.key !== "Enter" && event.key !== " ") {
    return false;
  }

  const path = getEventComposedPath(event);
  if (
    isExtensionRootInComposedPath(path, isExtensionRoot) ||
    isKeyboardTextEntryInComposedPath(path)
  ) {
    return false;
  }

  return path.some(
    (target) => target instanceof HTMLElement && isClickableActivationElement(target),
  );
}
