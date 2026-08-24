import { isExtensionRoot } from "../editor/measurement/scan-guards.js";
import { DisposableOwner } from "./disposable-owner.js";
import type {
  InputMode,
  InputRouter,
  InputRouterHandlers,
  NormalizedPointer,
} from "./input-router.js";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function normalize(event: PointerEvent): NormalizedPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    button: event.button,
    shiftKey: event.shiftKey,
    target: event.target,
  };
}

function claim(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

export function createInputRouter(root: Document): InputRouter {
  let mode: InputMode = "edit";
  let handlers: InputRouterHandlers | null = null;
  let owner: DisposableOwner | null = null;
  let claimedPointerId: number | null = null;
  let suppressClick = false;

  const inEditorChrome = (target: EventTarget | null): boolean => {
    return target instanceof Element && isExtensionRoot(target);
  };

  const attach = (next: InputRouterHandlers): void => {
    const view = root.defaultView;
    if (!view) {
      return;
    }
    owner = new DisposableOwner();

    owner.listen(view, "pointerdown", (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) {
        return;
      }
      if (inEditorChrome(event.target)) {
        return;
      }
      if (mode === "interact") {
        return;
      }
      claimedPointerId = event.pointerId;
      suppressClick = true;
      claim(event);
      next.onPointerDown(normalize(event));
    }, true);

    owner.listen(view, "pointermove", (event) => {
      if (!(event instanceof PointerEvent) || claimedPointerId !== event.pointerId) {
        return;
      }
      claim(event);
      next.onPointerMove(normalize(event));
    }, true);

    owner.listen(view, "pointerup", (event) => {
      if (!(event instanceof PointerEvent) || claimedPointerId !== event.pointerId) {
        return;
      }
      claimedPointerId = null;
      claim(event);
      next.onPointerUp(normalize(event));
    }, true);

    owner.listen(view, "pointercancel", (event) => {
      if (!(event instanceof PointerEvent) || claimedPointerId !== event.pointerId) {
        return;
      }
      claimedPointerId = null;
      suppressClick = false;
      claim(event);
      next.onPointerCancel();
    }, true);

    const suppressIfClaimed = (event: Event): void => {
      if (!suppressClick || mode === "interact" || inEditorChrome(event.target)) {
        return;
      }
      claim(event);
      if (event.type === "click" || event.type === "auxclick") {
        suppressClick = false;
      }
    };

    owner.listen(view, "click", suppressIfClaimed, true);
    owner.listen(view, "auxclick", suppressIfClaimed, true);
    owner.listen(view, "dblclick", suppressIfClaimed, true);
    owner.listen(view, "contextmenu", suppressIfClaimed, true);
    owner.listen(view, "dragstart", suppressIfClaimed, true);

    owner.listen(view, "keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (
        event.key.toLowerCase() === "i" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        claim(event);
        const nextMode: InputMode = mode === "edit" ? "interact" : "edit";
        mode = nextMode;
        claimedPointerId = null;
        suppressClick = false;
        next.onModeChange(nextMode);
        return;
      }
      if (mode === "interact") {
        return;
      }
      next.onKeyDown(event);
    }, true);
  };

  return {
    setMode(nextMode) {
      mode = nextMode;
      claimedPointerId = null;
      suppressClick = false;
      handlers?.onModeChange(nextMode);
    },
    getMode() {
      return mode;
    },
    start(next) {
      handlers = next;
      owner?.dispose();
      attach(next);
    },
    stop() {
      claimedPointerId = null;
      suppressClick = false;
      handlers = null;
      owner?.dispose();
      owner = null;
      mode = "edit";
    },
  };
}
