import {
  OTF_ROOT_HOST_ATTR,
  OTF_ROOT_HOST_ID,
  OTF_ROOT_HOST_VALUE,
} from "../editor/measurement/constants.js";
import type { ElementHandle } from "./element-registry.js";
import { isResolvedElement, type ElementRegistry } from "./element-registry.js";
import { rectFromElement } from "./geometry.js";
import type { OverlayCoordinator } from "./overlay-coordinator.js";
import type { IntendedRect } from "./placement-engine.js";

export interface OverlayCoordinatorDeps {
  document: Document;
  registry: ElementRegistry;
}

const SAVE_BUTTON_CLASS = "otf-save-button";
const OUTLINE_CLASS = "otf-selection-outline";

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
  let selected: readonly ElementHandle[] = [];
  let lastRect: IntendedRect | null = null;
  let saveHandler: (() => void) | null = null;
  let outline: HTMLElement | null = null;

  const render = (): void => {
    if (!layer) {
      return;
    }
    const handle = selected[0];
    if (!handle) {
      outline?.remove();
      outline = null;
      lastRect = null;
      return;
    }
    const resolved = deps.registry.resolve(handle);
    if (!isResolvedElement(resolved)) {
      outline?.remove();
      outline = null;
      lastRect = null;
      return;
    }
    const rect = rectFromElement(resolved.element);
    lastRect = rect;
    if (!outline) {
      outline = deps.document.createElement("div");
      outline.className = OUTLINE_CLASS;
      layer.append(outline);
    }
    outline.style.left = `${String(rect.x)}px`;
    outline.style.top = `${String(rect.y)}px`;
    outline.style.width = `${String(rect.width)}px`;
    outline.style.height = `${String(rect.height)}px`;
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
      indicator.innerHTML =
        `<span class="otf-indicator-dot"></span><span>Edit mode</span>`;
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
    },
    unmount() {
      host?.remove();
      host = null;
      shadow = null;
      layer = null;
      outline = null;
      saveButton = null;
      selected = [];
      lastRect = null;
      saveHandler = null;
    },
    showSelection(handles: readonly ElementHandle[]) {
      selected = handles;
      render();
    },
    refreshFromLiveGeometry() {
      render();
    },
    clear() {
      selected = [];
      render();
    },
    selectionOutlineRect() {
      return lastRect;
    },
    setSave(state) {
      saveHandler = state.onSave ?? null;
      if (saveButton) {
        saveButton.hidden = !state.visible;
      }
    },
  };
}
