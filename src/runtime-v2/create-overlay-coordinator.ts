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
import type { VisualModel } from "./visual-model.js";

export interface OverlayCoordinatorDeps {
  document: Document;
  visualModel: VisualModel;
}

const SAVE_BUTTON_CLASS = "otf-save-button";
const OUTLINE_CLASS = "otf-selection-outline";

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
  `;
  return style;
}

export function createOverlayCoordinator(deps: OverlayCoordinatorDeps): OverlayCoordinator & {
  mount(): void;
  unmount(): void;
  setSave(state: { visible: boolean; onSave?: () => void }): void;
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

  const paint = (rect: IntendedRect | null): void => {
    if (!layer) {
      return;
    }
    if (!rect) {
      outline?.remove();
      outline = null;
      painted = null;
      return;
    }
    if (!outline) {
      outline = deps.document.createElement("div");
      outline.className = OUTLINE_CLASS;
      layer.append(outline);
    }
    outline.style.left = `${String(rect.x)}px`;
    outline.style.top = `${String(rect.y)}px`;
    outline.style.width = `${String(rect.width)}px`;
    outline.style.height = `${String(rect.height)}px`;
    const model = measureSelected();
    outline.dataset.otfModel = serializeRect(model ?? rect);
    outline.dataset.otfRenderer = serializeRect(rect);
    outline.dataset.otfSpace = "viewport";
    painted = rect;
  };

  const measureSelected = (): IntendedRect | null => {
    const id = selected[0];
    if (!id) {
      return null;
    }
    return deps.visualModel.measure([id]).get(id) ?? null;
  };

  const render = (force = false): void => {
    const rect = measureSelected();
    if (!rect) {
      paint(null);
      return;
    }
    if (!force && painted && rectsNear(rect, painted, 0.5)) {
      return;
    }
    paint(rect);
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
    const id = selected[0];
    if (!id) {
      return;
    }
    const element = deps.visualModel.bind(id);
    if (!element) {
      return;
    }
    const onNestedScroll = (): void => {
      render(true);
    };
    let current: HTMLElement | null = element;
    while (current) {
      current.addEventListener("scroll", onNestedScroll, { passive: true });
      const node = current;
      nestedScrollCleanups.push(() => {
        node.removeEventListener("scroll", onNestedScroll);
      });
      current = current.parentElement;
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
    refreshFromLiveGeometry() {
      render(true);
    },
    clear() {
      selected = [];
      attachNestedScroll();
      cancelLoop();
      paint(null);
    },
    selectionOutlineRect() {
      return measureSelected();
    },
    setMode(next: InputMode) {
      mode = next;
      applyMode();
    },
    setSave(state) {
      saveHandler = state.onSave ?? null;
      if (saveButton) {
        saveButton.hidden = !state.visible;
      }
    },
  };
}
