import type { VisualNodeRect } from "../editor/visual-node.js";
import type { MeasurementRect } from "../editor/measurement/types.js";

const ROOT_HOST_ID = "on-the-fly-root-host";

export type SelectionOutlineVariant = "node" | "group";

export const TRANSFORM_HANDLE_ATTR = "data-otf-handle";
export const ROTATE_HANDLE_ID = "rotate";

const RESIZE_HANDLE_LAYOUT = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export type TransformHandleId = (typeof RESIZE_HANDLE_LAYOUT)[number] | typeof ROTATE_HANDLE_ID;

export interface RenderSelectionOptions {
  handles?: boolean;
}

export type HandlePointerDownHandler = (handleId: TransformHandleId, event: PointerEvent) => void;

export type EditorSessionMode = "edit" | "interact";

export interface EditorShellMountOptions {
  onDeactivate: () => void;
  onEscape?: () => boolean;
}

export interface SaveButtonState {
  visible: boolean;
  count?: number;
  onSave?: () => void;
}

export class EditorShell {
  private rootHost: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private overlayLayer: HTMLElement | null = null;
  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;
  private onDeactivate: (() => void) | null = null;
  private onEscape: (() => boolean) | null = null;
  private handlePointerDownHandler: HandlePointerDownHandler | null = null;
  private overlayPointerDownListener: ((event: Event) => void) | null = null;
  private modeIndicatorEl: HTMLElement | null = null;
  private saveButtonEl: HTMLButtonElement | null = null;
  private saveButtonHandler: (() => void) | null = null;
  private saveButtonVisible = false;
  private saveButtonCount = 0;
  private sessionMode: EditorSessionMode = "edit";

  isMounted(): boolean {
    return this.rootHost !== null && this.rootHost.isConnected;
  }

  mount(options: EditorShellMountOptions): void {
    if (this.rootHost?.isConnected) {
      return;
    }

    this.rootHost = null;
    this.shadow = null;
    this.overlayLayer = null;

    const existingHosts = Array.from(document.querySelectorAll<HTMLElement>(`#${ROOT_HOST_ID}`));
    if (existingHosts.length > 0) {
      console.warn("[On the Fly] Removed duplicate overlay root before mounting.", {
        count: existingHosts.length,
      });
      for (const existingHost of existingHosts) {
        existingHost.remove();
      }
    }

    this.onDeactivate = options.onDeactivate;
    this.onEscape = options.onEscape ?? null;

    const host = document.createElement("div");
    host.id = ROOT_HOST_ID;
    host.setAttribute("data-on-the-fly", "root-host");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "pointer-events: none",
      "contain: strict",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.append(
      createShellStyles(),
      createActiveIndicator(),
      createSaveButton(),
      createOverlayLayer(),
    );

    document.documentElement.appendChild(host);
    this.rootHost = host;
    this.shadow = shadow;
    this.overlayLayer = shadow.querySelector(".otf-overlay-layer");
    this.modeIndicatorEl = shadow.querySelector(".otf-indicator");
    this.saveButtonEl = shadow.querySelector(".otf-save-button");
    if (this.saveButtonEl) {
      this.saveButtonEl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.saveButtonHandler?.();
      });
    }
    this.setSessionMode("edit");
    this.attachEscapeHandler();
    this.attachOverlayPointerDownListener();
  }

  unmount(): void {
    this.detachEscapeHandler();
    this.detachOverlayPointerDownListener();
    this.rootHost?.remove();
    this.rootHost = null;
    this.shadow = null;
    this.overlayLayer = null;
    this.modeIndicatorEl = null;
    this.saveButtonEl = null;
    this.saveButtonHandler = null;
    this.saveButtonVisible = false;
    this.saveButtonCount = 0;
    this.sessionMode = "edit";
    this.onDeactivate = null;
    this.onEscape = null;
    this.handlePointerDownHandler = null;
  }

  setHandlePointerDownHandler(handler: HandlePointerDownHandler | null): void {
    this.handlePointerDownHandler = handler;
  }

  /** Live-preview helper: shifts the whole overlay layer during a move drag. */
  translateOverlay(dx: number, dy: number): void {
    if (this.overlayLayer) {
      this.overlayLayer.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`;
    }
  }

  clearOverlayTranslate(): void {
    if (this.overlayLayer) {
      this.overlayLayer.style.removeProperty("transform");
    }
  }

  setSessionMode(mode: EditorSessionMode): void {
    this.sessionMode = mode;
    if (!this.modeIndicatorEl) {
      return;
    }

    const label = this.modeIndicatorEl.querySelector(".otf-indicator-label");
    const dot = this.modeIndicatorEl.querySelector(".otf-indicator-dot");
    if (!(label instanceof HTMLElement) || !(dot instanceof HTMLElement)) {
      return;
    }

    if (mode === "interact") {
      label.textContent = "Interact mode — site clicks enabled";
      dot.style.background = "#fbbf24";
      dot.style.boxShadow = "0 0 0 3px rgba(251, 191, 36, 0.25)";
      this.modeIndicatorEl.dataset.mode = "interact";
      this.renderSaveButtonUi();
      return;
    }

    label.textContent = "Edit mode — press I to interact";
    if (this.saveButtonVisible && this.saveButtonCount > 0) {
      label.textContent = `Edit mode — ${String(this.saveButtonCount)} unsaved · press S and drag to save a region`;
    }
    dot.style.background = "#34d399";
    dot.style.boxShadow = "0 0 0 3px rgba(52, 211, 153, 0.25)";
    this.modeIndicatorEl.dataset.mode = "edit";
    this.renderSaveButtonUi();
  }

  setSaveButton(state: SaveButtonState): void {
    this.saveButtonVisible = state.visible;
    this.saveButtonCount = state.count ?? 0;
    this.saveButtonHandler = state.onSave ?? null;
    this.renderSaveButtonUi();
  }

  private renderSaveButtonUi(): void {
    if (!this.saveButtonEl) {
      return;
    }

    const show = this.saveButtonVisible && this.sessionMode === "edit";
    this.saveButtonEl.hidden = !show;
    if (!show) {
      return;
    }

    const count = this.saveButtonCount;
    const label =
      count > 0 ? `Save all (${String(count)} unsaved)` : "Save all";
    this.saveButtonEl.textContent = label;
    this.saveButtonEl.setAttribute("aria-label", "Use Save button to save all changes");
    this.saveButtonEl.setAttribute("title", "Use Save button to save all changes");
  }

  getSessionMode(): EditorSessionMode {
    return this.sessionMode;
  }

  renderSelectionOutlines(
    rects: VisualNodeRect[],
    variant: SelectionOutlineVariant = "node",
    options: RenderSelectionOptions = {},
  ): void {
    if (this.sessionMode === "interact") {
      this.overlayLayer?.replaceChildren();
      return;
    }

    if (!this.overlayLayer) {
      return;
    }

    this.overlayLayer.replaceChildren();
    const withHandles = options.handles === true && rects.length === 1;
    for (const rect of rects) {
      const outline = createOutlineElement(rect, variant);
      if (withHandles) {
        appendTransformHandles(outline);
      }
      this.overlayLayer.appendChild(outline);
    }
  }

  renderLassoBox(rect: MeasurementRect | null): void {
    if (this.sessionMode === "interact") {
      return;
    }

    if (!this.overlayLayer) {
      return;
    }

    const existing = this.overlayLayer.querySelector(".otf-lasso");
    existing?.remove();

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    this.overlayLayer.appendChild(createLassoElement(rect));
  }

  renderSaveWindowBox(rect: MeasurementRect | null): void {
    if (this.sessionMode === "interact") {
      return;
    }

    if (!this.overlayLayer) {
      return;
    }

    const existing = this.overlayLayer.querySelector(".otf-save-window");
    existing?.remove();

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    this.overlayLayer.appendChild(createSaveWindowElement(rect));
  }

  clearOverlays(): void {
    this.overlayLayer?.replaceChildren();
    this.clearOverlayTranslate();
  }

  getShadowRoot(): ShadowRoot | null {
    return this.shadow;
  }

  private attachOverlayPointerDownListener(): void {
    if (!this.overlayLayer || this.overlayPointerDownListener) {
      return;
    }

    this.overlayPointerDownListener = (event: Event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) {
        return;
      }

      const handleId = findHandleId(event);
      if (!handleId || !this.handlePointerDownHandler) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.handlePointerDownHandler(handleId, event);
    };

    this.overlayLayer.addEventListener("pointerdown", this.overlayPointerDownListener);
  }

  private detachOverlayPointerDownListener(): void {
    if (this.overlayLayer && this.overlayPointerDownListener) {
      this.overlayLayer.removeEventListener("pointerdown", this.overlayPointerDownListener);
    }
    this.overlayPointerDownListener = null;
  }

  private attachEscapeHandler(): void {
    if (this.escapeHandler) {
      return;
    }

    this.escapeHandler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !this.isMounted()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const handled = this.onEscape?.() ?? false;
      if (!handled) {
        this.onDeactivate?.();
      }
    };

    window.addEventListener("keydown", this.escapeHandler, true);
  }

  private detachEscapeHandler(): void {
    if (!this.escapeHandler) {
      return;
    }

    window.removeEventListener("keydown", this.escapeHandler, true);
    this.escapeHandler = null;
  }
}

function createShellStyles(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    .otf-indicator {
      position: fixed;
      right: 16px;
      bottom: 16px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.92);
      color: #f9fafb;
      font: 600 12px/1 system-ui, -apple-system, sans-serif;
      letter-spacing: 0.01em;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      pointer-events: none;
      user-select: none;
    }

    .otf-indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #34d399;
      box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.25);
      flex: 0 0 auto;
    }

    .otf-indicator[data-mode="interact"] {
      background: rgba(30, 41, 59, 0.94);
    }

    .otf-save-button {
      position: fixed;
      left: 16px;
      bottom: 16px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: none;
      border-radius: 999px;
      background: #059669;
      color: #ecfdf5;
      font: 600 12px/1 system-ui, -apple-system, sans-serif;
      letter-spacing: 0.01em;
      box-shadow: 0 8px 24px rgba(5, 150, 105, 0.35);
      pointer-events: auto;
      cursor: pointer;
      user-select: none;
    }

    .otf-save-button:hover {
      background: #047857;
    }

    .otf-save-button:focus-visible {
      outline: 2px solid #6ee7b7;
      outline-offset: 2px;
    }

    .otf-save-button[hidden] {
      display: none !important;
    }

    .otf-overlay-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
    }

    .otf-selection-outline {
      position: fixed;
      box-sizing: border-box;
      border: 2px solid #2563eb;
      border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85), 0 0 0 4px rgba(37, 99, 235, 0.18);
      pointer-events: none;
    }

    .otf-group-outline {
      border: 2px solid #7c3aed;
      border-radius: 6px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85), 0 0 0 5px rgba(124, 58, 237, 0.2);
    }

    .otf-lasso {
      position: fixed;
      box-sizing: border-box;
      border: 1px dashed #2563eb;
      background: rgba(37, 99, 235, 0.08);
      pointer-events: none;
    }

    .otf-save-window {
      position: fixed;
      box-sizing: border-box;
      border: 2px solid #059669;
      background: rgba(5, 150, 105, 0.1);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85), 0 0 0 4px rgba(5, 150, 105, 0.18);
      pointer-events: none;
    }

    .otf-handle {
      position: absolute;
      width: 12px;
      height: 12px;
      margin: -6px 0 0 -6px;
      box-sizing: border-box;
      border: 1.5px solid #2563eb;
      border-radius: 3px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      pointer-events: auto;
    }

    .otf-handle-nw { top: 0; left: 0; cursor: nwse-resize; }
    .otf-handle-n { top: 0; left: 50%; cursor: ns-resize; }
    .otf-handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
    .otf-handle-e { top: 50%; left: 100%; cursor: ew-resize; }
    .otf-handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
    .otf-handle-s { top: 100%; left: 50%; cursor: ns-resize; }
    .otf-handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
    .otf-handle-w { top: 50%; left: 0; cursor: ew-resize; }

    .otf-handle-rotate {
      top: -28px;
      left: 50%;
      border-radius: 50%;
      cursor: grab;
    }

    .otf-handle-rotate::after {
      content: "";
      position: absolute;
      top: 12px;
      left: 50%;
      width: 1.5px;
      height: 16px;
      margin-left: -0.75px;
      background: #2563eb;
    }
  `;
  return style;
}

function appendTransformHandles(outline: HTMLElement): void {
  for (const id of RESIZE_HANDLE_LAYOUT) {
    outline.appendChild(createHandleElement(id, `otf-handle otf-handle-${id}`));
  }
  outline.appendChild(
    createHandleElement(ROTATE_HANDLE_ID, "otf-handle otf-handle-rotate"),
  );
}

function createHandleElement(id: TransformHandleId, className: string): HTMLElement {
  const handle = document.createElement("div");
  handle.className = className;
  handle.setAttribute(TRANSFORM_HANDLE_ATTR, id);
  return handle;
}

function findHandleId(event: PointerEvent): TransformHandleId | null {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const target of path) {
    if (target instanceof Element && target.hasAttribute(TRANSFORM_HANDLE_ATTR)) {
      return target.getAttribute(TRANSFORM_HANDLE_ATTR) as TransformHandleId;
    }
  }

  if (event.target instanceof Element && event.target.hasAttribute(TRANSFORM_HANDLE_ATTR)) {
    return event.target.getAttribute(TRANSFORM_HANDLE_ATTR) as TransformHandleId;
  }

  return null;
}

function createActiveIndicator(): HTMLElement {
  const indicator = document.createElement("div");
  indicator.className = "otf-indicator";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  indicator.innerHTML = `<span class="otf-indicator-dot" aria-hidden="true"></span><span class="otf-indicator-label">Edit mode — press I to interact</span>`;
  return indicator;
}

function createSaveButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "otf-save-button";
  button.setAttribute("data-otf-ui", "save-button");
  button.hidden = true;
  button.textContent = "Save";
  return button;
}

function createOverlayLayer(): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "otf-overlay-layer";
  return layer;
}

function createOutlineElement(
  rect: VisualNodeRect,
  variant: SelectionOutlineVariant,
): HTMLElement {
  const outline = document.createElement("div");
  outline.className =
    variant === "group" ? "otf-selection-outline otf-group-outline" : "otf-selection-outline";
  outline.style.left = `${String(rect.x)}px`;
  outline.style.top = `${String(rect.y)}px`;
  outline.style.width = `${String(rect.width)}px`;
  outline.style.height = `${String(rect.height)}px`;
  return outline;
}

function createLassoElement(rect: MeasurementRect): HTMLElement {
  const lasso = document.createElement("div");
  lasso.className = "otf-lasso";
  lasso.style.left = `${String(rect.x)}px`;
  lasso.style.top = `${String(rect.y)}px`;
  lasso.style.width = `${String(rect.width)}px`;
  lasso.style.height = `${String(rect.height)}px`;
  return lasso;
}

function createSaveWindowElement(rect: MeasurementRect): HTMLElement {
  const box = document.createElement("div");
  box.className = "otf-save-window";
  box.style.left = `${String(rect.x)}px`;
  box.style.top = `${String(rect.y)}px`;
  box.style.width = `${String(rect.width)}px`;
  box.style.height = `${String(rect.height)}px`;
  return box;
}

export { ROOT_HOST_ID };
