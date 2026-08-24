import {
  OTF_ROOT_HOST_ATTR,
  OTF_ROOT_HOST_ID,
  OTF_ROOT_HOST_VALUE,
} from "../editor/measurement/constants.js";
import type { VisualNodeId } from "../editor/ids.js";
import { rectsNear } from "./geometry.js";
import type { InputMode } from "./input-router.js";
import type { OverlayCoordinator } from "./overlay-coordinator.js";
import type { IntendedRect } from "./placement-engine.js";
import { unionRects } from "./runtime-selection.js";
import type { VisualModel } from "./visual-model.js";

export interface OverlayCoordinatorDeps {
  document: Document;
  visualModel: VisualModel;
}

const SAVE_BUTTON_CLASS = "otf-save-button";
const OUTLINE_CLASS = "otf-selection-outline";
const MEMBER_OUTLINE_CLASS = "otf-selection-member-outline";
const LASSO_CLASS = "otf-lasso";

function serializeRect(rect: IntendedRect): string {
  return `${String(rect.x)},${String(rect.y)},${String(rect.width)},${String(rect.height)}`;
}

function overlayStyles(doc: Document): HTMLStyleElement {
  const style = doc.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .otf-indicator {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.92);
      color: #f9fafb;
      font: 600 12px/1 system-ui, sans-serif;
      pointer-events: none;
    }
    .otf-indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #34d399;
    }
    .otf-indicator[data-mode="interact"] .otf-indicator-dot {
      background: #fbbf24;
    }
    .${SAVE_BUTTON_CLASS} {
      position: fixed;
      left: 16px;
      bottom: 16px;
      display: inline-flex;
      padding: 8px 14px;
      border: none;
      border-radius: 999px;
      background: #059669;
      color: #ecfdf5;
      font: 600 12px/1 system-ui, sans-serif;
      pointer-events: auto;
      cursor: pointer;
    }
    .${SAVE_BUTTON_CLASS}[hidden] { display: none !important; }
    .otf-overlay-layer { position: fixed; inset: 0; pointer-events: none; }
    .${OUTLINE_CLASS} {
      position: fixed;
      box-sizing: border-box;
      border: 2px solid #2563eb;
      border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85), 0 0 0 4px rgba(37, 99, 235, 0.18);
      pointer-events: none;
    }
    .${MEMBER_OUTLINE_CLASS} {
      position: fixed;
      box-sizing: border-box;
      border: 1px solid rgba(37, 99, 235, 0.72);
      border-radius: 3px;
      pointer-events: none;
    }
    .${LASSO_CLASS} {
      position: fixed;
      box-sizing: border-box;
      border: 1px solid #2563eb;
      background: rgba(37, 99, 235, 0.08);
      pointer-events: none;
    }
  `;
  return style;
}

export function createOverlayCoordinator(deps: OverlayCoordinatorDeps): OverlayCoordinator & {
  mount(): void;
  unmount(): void;
  setSave(state: {
    visible: boolean;
    status?: "idle" | "saving" | "saved" | "failed";
    onSave?: () => void;
  }): void;
} {
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot | null = null;
  let layer: HTMLElement | null = null;
  let saveButton: HTMLButtonElement | null = null;
  let indicatorLabel: HTMLElement | null = null;
  let selected: readonly VisualNodeId[] = [];
  let painted: IntendedRect | null = null;
  let saveHandler: (() => void) | null = null;
  let outline: HTMLElement | null = null;
  let memberOutlines: HTMLElement[] = [];
  let lasso: HTMLElement | null = null;
  let rafId = 0;
  let mode: InputMode = "edit";
  const scrollCleanups: Array<() => void> = [];
  const nestedScrollCleanups: Array<() => void> = [];

  const cancelLoop = (): void => {
    if (rafId !== 0) {
      deps.document.defaultView?.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const position = (element: HTMLElement, rect: IntendedRect): void => {
    element.style.left = `${String(rect.x)}px`;
    element.style.top = `${String(rect.y)}px`;
    element.style.width = `${String(rect.width)}px`;
    element.style.height = `${String(rect.height)}px`;
  };

  const paint = (rect: IntendedRect | null, members: readonly IntendedRect[] = []): void => {
    if (!layer) {
      return;
    }
    if (!rect) {
      outline?.remove();
      outline = null;
      for (const member of memberOutlines) member.remove();
      memberOutlines = [];
      painted = null;
      return;
    }
    if (!outline) {
      outline = deps.document.createElement("div");
      outline.className = OUTLINE_CLASS;
      layer.append(outline);
    }
    position(outline, rect);
    while (memberOutlines.length < members.length) {
      const member = deps.document.createElement("div");
      member.className = MEMBER_OUTLINE_CLASS;
      layer.append(member);
      memberOutlines.push(member);
    }
    while (memberOutlines.length > members.length) memberOutlines.pop()?.remove();
    members.forEach((member, index) => {
      const target = memberOutlines[index];
      if (target) position(target, member);
    });
    const model = measureSelected().union;
    outline.dataset.otfModel = serializeRect(model ?? rect);
    outline.dataset.otfRenderer = serializeRect(rect);
    outline.dataset.otfSpace = "viewport";
    painted = rect;
  };

  const measureSelected = (): { union: IntendedRect | null; members: IntendedRect[] } => {
    const measured = deps.visualModel.measure(selected);
    const members = selected
      .map((id) => measured.get(id))
      .filter((rect): rect is IntendedRect => Boolean(rect));
    return { union: unionRects(members), members };
  };

  const render = (force = false): void => {
    const measured = measureSelected();
    const rect = measured.union;
    if (!rect) {
      paint(null);
      return;
    }
    if (!force && painted && rectsNear(rect, painted, 0.5)) {
      return;
    }
    paint(rect, selected.length > 1 ? measured.members : []);
  };

  const loop = (): void => {
    rafId = 0;
    if (selected.length === 0) {
      return;
    }
    render(true);
    const view = deps.document.defaultView;
    if (view) {
      rafId = view.requestAnimationFrame(loop);
    }
  };

  const attachNestedScroll = (): void => {
    while (nestedScrollCleanups.length > 0) {
      nestedScrollCleanups.pop()?.();
    }
    const onNestedScroll = (): void => {
      render(true);
    };
    const observed = new Set<HTMLElement>();
    for (const id of selected) {
      let current = deps.visualModel.bind(id);
      while (current) {
        if (!observed.has(current)) {
          observed.add(current);
          current.addEventListener("scroll", onNestedScroll, { passive: true });
          const node = current;
          nestedScrollCleanups.push(() => {
            node.removeEventListener("scroll", onNestedScroll);
          });
        }
        current = current.parentElement;
      }
    }
  };

  const startLoop = (): void => {
    if (rafId !== 0 || selected.length === 0) {
      return;
    }
    const view = deps.document.defaultView;
    if (!view) {
      render(true);
      return;
    }
    rafId = view.requestAnimationFrame(loop);
  };

  const applyMode = (): void => {
    if (!host || !indicatorLabel) {
      return;
    }
    const indicator = indicatorLabel.parentElement;
    if (mode === "interact") {
      indicatorLabel.textContent = "Interact mode — site clicks enabled";
      indicator?.setAttribute("data-mode", "interact");
      selected = [];
      cancelLoop();
      paint(null);
      return;
    }
    indicatorLabel.textContent = "Edit mode — press I to interact";
    indicator?.setAttribute("data-mode", "edit");
  };

  return {
    mount() {
      if (host?.isConnected) {
        return;
      }
      const existing = deps.document.getElementById(OTF_ROOT_HOST_ID);
      existing?.remove();

      host = deps.document.createElement("div");
      host.id = OTF_ROOT_HOST_ID;
      host.setAttribute(OTF_ROOT_HOST_ATTR, OTF_ROOT_HOST_VALUE);
      host.style.cssText =
        "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
      shadow = host.attachShadow({ mode: "closed" });
      const indicator = deps.document.createElement("div");
      indicator.className = "otf-indicator";
      indicator.dataset.mode = mode;
      const dot = deps.document.createElement("span");
      dot.className = "otf-indicator-dot";
      indicatorLabel = deps.document.createElement("span");
      indicatorLabel.textContent = "Edit mode — press I to interact";
      indicator.append(dot, indicatorLabel);
      saveButton = deps.document.createElement("button");
      saveButton.type = "button";
      saveButton.className = SAVE_BUTTON_CLASS;
      saveButton.hidden = true;
      saveButton.textContent = "Save";
      saveButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        saveHandler?.();
      });
      layer = deps.document.createElement("div");
      layer.className = "otf-overlay-layer";
      shadow.append(overlayStyles(deps.document), indicator, saveButton, layer);
      deps.document.documentElement.append(host);
      const view = deps.document.defaultView;
      const onScrollOrResize = (): void => {
        render(true);
      };
      if (view) {
        view.addEventListener("scroll", onScrollOrResize, true);
        view.addEventListener("resize", onScrollOrResize);
        scrollCleanups.push(() => {
          view.removeEventListener("scroll", onScrollOrResize, true);
          view.removeEventListener("resize", onScrollOrResize);
        });
      }
      deps.document.addEventListener("scroll", onScrollOrResize, true);
      scrollCleanups.push(() => {
        deps.document.removeEventListener("scroll", onScrollOrResize, true);
      });
      applyMode();
      startLoop();
    },
    unmount() {
      cancelLoop();
      while (scrollCleanups.length > 0) {
        scrollCleanups.pop()?.();
      }
      while (nestedScrollCleanups.length > 0) {
        nestedScrollCleanups.pop()?.();
      }
      host?.remove();
      host = null;
      shadow = null;
      layer = null;
      outline = null;
      memberOutlines = [];
      lasso = null;
      saveButton = null;
      indicatorLabel = null;
      selected = [];
      painted = null;
      saveHandler = null;
    },
    showSelection(nodeIds: readonly VisualNodeId[]) {
      selected = nodeIds;
      attachNestedScroll();
      render(true);
      if (nodeIds.length > 0) {
        startLoop();
        return;
      }
      cancelLoop();
    },
    showLasso(rect) {
      if (!layer) return;
      if (!lasso) {
        lasso = deps.document.createElement("div");
        lasso.className = LASSO_CLASS;
        layer.append(lasso);
      }
      position(lasso, rect);
    },
    clearLasso() {
      lasso?.remove();
      lasso = null;
    },
    refreshFromLiveGeometry() {
      render(true);
    },
    clear() {
      selected = [];
      attachNestedScroll();
      cancelLoop();
      paint(null);
      lasso?.remove();
      lasso = null;
    },
    selectionOutlineRect() {
      return measureSelected().union;
    },
    setMode(next: InputMode) {
      mode = next;
      applyMode();
    },
    setSave(state) {
      saveHandler = state.onSave ?? null;
      host?.setAttribute("data-otf-save-status", state.status ?? "idle");
      if (saveButton) {
        saveButton.hidden = !state.visible;
        saveButton.textContent = state.status === "saving"
          ? "Saving…"
          : state.status === "saved"
            ? "Saved"
            : state.status === "failed"
              ? "Save failed"
              : "Save";
      }
    },
  };
}
