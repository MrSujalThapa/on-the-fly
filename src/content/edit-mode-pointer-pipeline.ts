import { isExtensionRoot } from "../editor/measurement/scan-guards.js";
import {
  getEventComposedPath,
  shouldHandleEditModeKeyboardActivationEvent,
  shouldHandleEditModeClickEvent,
  shouldHandleEditModePointerEvent,
  suppressPageInteractionEvent,
} from "../editor/selection/pointer-interaction.js";

export interface EditModeEventWindow {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void;
  dispatchEvent(event: Event): boolean;
}

export interface EditModePointerPipelineOptions {
  window: EditModeEventWindow;
  document: Document;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onDebug?: (message: string, data?: unknown) => void;
  onPassThroughPointer?: (event: PointerEvent) => void;
}

export interface EditModePointerPipeline {
  detach: () => void;
  setPassThrough: (enabled: boolean) => void;
  isPassThrough: () => boolean;
}

function applyInteractionStyles(document: Document): () => void {
  const html = document.documentElement;
  const body = document.body;
  const previousHtmlUserSelect = html.style.userSelect;
  const previousBodyUserSelect = body.style.userSelect;
  const previousHtmlTouchAction = html.style.touchAction;

  html.style.userSelect = "none";
  body.style.userSelect = "none";
  html.style.touchAction = "none";

  return () => {
    html.style.userSelect = previousHtmlUserSelect;
    body.style.userSelect = previousBodyUserSelect;
    html.style.touchAction = previousHtmlTouchAction;
  };
}

export function attachEditModePointerPipeline(
  options: EditModePointerPipelineOptions,
): EditModePointerPipeline {
  let passThrough = false;
  let interactionStylesApplied = true;
  const restoreStyles = applyInteractionStyles(options.document);
  const applyInteractionStylesNow = (): void => {
    if (interactionStylesApplied) {
      return;
    }
    const html = options.document.documentElement;
    const body = options.document.body;
    html.style.userSelect = "none";
    body.style.userSelect = "none";
    html.style.touchAction = "none";
    interactionStylesApplied = true;
  };

  const releaseInteractionStyles = (): void => {
    if (!interactionStylesApplied) {
      return;
    }
    restoreStyles();
    interactionStylesApplied = false;
  };

  // Capture phase so the editor owns the gesture before the page can react,
  // while the overlay itself stays click-through (pointer-events: none) so
  // document.elementsFromPoint keeps resolving the real page underneath.
  const listenerOptions: AddEventListenerOptions = { capture: true, passive: false };

  const pointerDownHandler = (event: PointerEvent): void => {
    if (passThrough) {
      options.onPassThroughPointer?.(event);
      return;
    }

    if (!shouldHandleEditModePointerEvent(event, isExtensionRoot)) {
      return;
    }

    options.onDebug?.("pointerdown", {
      x: event.clientX,
      y: event.clientY,
      pathLength: getEventComposedPath(event).length,
    });
    options.onPointerDown(event);
    suppressPageInteractionEvent(event);
  };

  const pointerMoveHandler = (event: PointerEvent): void => {
    if (passThrough) {
      options.onPassThroughPointer?.(event);
      return;
    }

    options.onPointerMove(event);
    if (shouldHandleEditModePointerEvent(event, isExtensionRoot)) {
      suppressPageInteractionEvent(event);
    }
  };

  const pointerUpHandler = (event: PointerEvent): void => {
    if (passThrough) {
      options.onPassThroughPointer?.(event);
      return;
    }

    if (!shouldHandleEditModePointerEvent(event, isExtensionRoot)) {
      return;
    }

    options.onDebug?.("pointerup", {
      x: event.clientX,
      y: event.clientY,
    });
    options.onPointerUp(event);
    suppressPageInteractionEvent(event);
  };

  const pointerCancelHandler = (event: PointerEvent): void => {
    if (passThrough) {
      return;
    }

    options.onPointerCancel(event);
    if (shouldHandleEditModePointerEvent(event, isExtensionRoot)) {
      suppressPageInteractionEvent(event);
    }
  };

  const mouseDownHandler = (event: MouseEvent): void => {
    if (passThrough) {
      return;
    }

    if (!shouldHandleEditModeClickEvent(event, isExtensionRoot)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const mouseUpHandler = (event: MouseEvent): void => {
    if (passThrough) {
      return;
    }

    if (!shouldHandleEditModeClickEvent(event, isExtensionRoot)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const clickHandler = (event: MouseEvent): void => {
    if (passThrough) {
      return;
    }

    if (!shouldHandleEditModeClickEvent(event, isExtensionRoot)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const auxClickHandler = (event: MouseEvent): void => {
    if (passThrough) {
      return;
    }

    if (!shouldHandleEditModeClickEvent(event, isExtensionRoot)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const doubleClickHandler = (event: MouseEvent): void => {
    if (passThrough) {
      return;
    }

    if (!shouldHandleEditModeClickEvent(event, isExtensionRoot)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const selectStartHandler = (event: Event): void => {
    if (passThrough) {
      return;
    }

    if (isExtensionRootInEventPath(event)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const dragStartHandler = (event: Event): void => {
    if (passThrough) {
      return;
    }

    if (isExtensionRootInEventPath(event)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const keyActivationHandler = (event: KeyboardEvent): void => {
    if (passThrough) {
      return;
    }

    if (!shouldHandleEditModeKeyboardActivationEvent(event, isExtensionRoot)) {
      return;
    }

    suppressPageInteractionEvent(event);
  };

  const pointerDownListener = pointerDownHandler as EventListener;
  const pointerMoveListener = pointerMoveHandler as EventListener;
  const pointerUpListener = pointerUpHandler as EventListener;
  const pointerCancelListener = pointerCancelHandler as EventListener;
  const mouseDownListener = mouseDownHandler as EventListener;
  const mouseUpListener = mouseUpHandler as EventListener;
  const clickListener = clickHandler as EventListener;
  const auxClickListener = auxClickHandler as EventListener;
  const doubleClickListener = doubleClickHandler as EventListener;
  const selectStartListener = selectStartHandler;
  const dragStartListener = dragStartHandler;
  const keyActivationListener = keyActivationHandler as EventListener;

  options.window.addEventListener("pointerdown", pointerDownListener, listenerOptions);
  options.window.addEventListener("pointermove", pointerMoveListener, listenerOptions);
  options.window.addEventListener("pointerup", pointerUpListener, listenerOptions);
  options.window.addEventListener("pointercancel", pointerCancelListener, listenerOptions);
  options.window.addEventListener("mousedown", mouseDownListener, listenerOptions);
  options.window.addEventListener("mouseup", mouseUpListener, listenerOptions);
  options.window.addEventListener("click", clickListener, listenerOptions);
  options.window.addEventListener("auxclick", auxClickListener, listenerOptions);
  options.window.addEventListener("dblclick", doubleClickListener, listenerOptions);
  options.window.addEventListener("selectstart", selectStartListener, listenerOptions);
  options.window.addEventListener("dragstart", dragStartListener, listenerOptions);
  options.window.addEventListener("keydown", keyActivationListener, listenerOptions);
  options.window.addEventListener("keyup", keyActivationListener, listenerOptions);

  return {
    setPassThrough(enabled: boolean) {
      passThrough = enabled;
      if (enabled) {
        releaseInteractionStyles();
        return;
      }
      applyInteractionStylesNow();
    },
    isPassThrough() {
      return passThrough;
    },
    detach: () => {
      options.window.removeEventListener("pointerdown", pointerDownListener, true);
      options.window.removeEventListener("pointermove", pointerMoveListener, true);
      options.window.removeEventListener("pointerup", pointerUpListener, true);
      options.window.removeEventListener("pointercancel", pointerCancelListener, true);
      options.window.removeEventListener("mousedown", mouseDownListener, true);
      options.window.removeEventListener("mouseup", mouseUpListener, true);
      options.window.removeEventListener("click", clickListener, true);
      options.window.removeEventListener("auxclick", auxClickListener, true);
      options.window.removeEventListener("dblclick", doubleClickListener, true);
      options.window.removeEventListener("selectstart", selectStartListener, true);
      options.window.removeEventListener("dragstart", dragStartListener, true);
      options.window.removeEventListener("keydown", keyActivationListener, true);
      options.window.removeEventListener("keyup", keyActivationListener, true);
      restoreStyles();
    },
  };
}

function isExtensionRootInEventPath(event: Event): boolean {
  return getEventComposedPath(event).some(
    (target) => target instanceof Element && isExtensionRoot(target),
  );
}
