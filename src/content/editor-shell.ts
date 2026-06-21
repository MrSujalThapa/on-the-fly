import type { VisualNodeRect } from "../editor/visual-node.js";
import type { MeasurementRect } from "../editor/measurement/types.js";

const ROOT_HOST_ID = "on-the-fly-root-host";

export interface EditorShellMountOptions {
  onDeactivate: () => void;
  onEscape?: () => boolean;
}

export class EditorShell {
  private rootHost: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private overlayLayer: HTMLElement | null = null;
  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;
  private onDeactivate: (() => void) | null = null;
  private onEscape: (() => boolean) | null = null;

  isMounted(): boolean {
    return this.rootHost !== null;
  }

  mount(options: EditorShellMountOptions): void {
    if (this.rootHost) {
      return;
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
      createOverlayLayer(),
    );

    document.documentElement.appendChild(host);
    this.rootHost = host;
    this.shadow = shadow;
    this.overlayLayer = shadow.querySelector(".otf-overlay-layer");
    this.attachEscapeHandler();
  }

  unmount(): void {
    this.detachEscapeHandler();
    this.rootHost?.remove();
    this.rootHost = null;
    this.shadow = null;
    this.overlayLayer = null;
    this.onDeactivate = null;
    this.onEscape = null;
  }

  renderSelectionOutlines(rects: VisualNodeRect[]): void {
    if (!this.overlayLayer) {
      return;
    }

    this.overlayLayer.replaceChildren();
    for (const rect of rects) {
      this.overlayLayer.appendChild(createOutlineElement(rect));
    }
  }

  renderLassoBox(rect: MeasurementRect | null): void {
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

  clearOverlays(): void {
    this.overlayLayer?.replaceChildren();
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

    .otf-lasso {
      position: fixed;
      box-sizing: border-box;
      border: 1px dashed #2563eb;
      background: rgba(37, 99, 235, 0.08);
      pointer-events: none;
    }
  `;
  return style;
}

function createActiveIndicator(): HTMLElement {
  const indicator = document.createElement("div");
  indicator.className = "otf-indicator";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  indicator.innerHTML = `<span class="otf-indicator-dot" aria-hidden="true"></span><span>On the Fly active</span>`;
  return indicator;
}

function createOverlayLayer(): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "otf-overlay-layer";
  return layer;
}

function createOutlineElement(rect: VisualNodeRect): HTMLElement {
  const outline = document.createElement("div");
  outline.className = "otf-selection-outline";
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

export { ROOT_HOST_ID };
