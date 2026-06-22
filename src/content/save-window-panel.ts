import type { SaveWindowClassificationSummary } from "../editor/save-window/classify-operations.js";
import type { MeasurementRect } from "../editor/measurement/types.js";

export interface SaveWindowPanelSummary extends SaveWindowClassificationSummary {
  ambiguousDefault: "revert";
}

export interface SaveWindowPanelCallbacks {
  onConfirm: () => void;
  onCancel: () => void;
}

export class SaveWindowPanel {
  private host: HTMLElement | null = null;
  private readonly shadowRoot: ShadowRoot;
  private readonly callbacks: SaveWindowPanelCallbacks;

  constructor(shadowRoot: ShadowRoot, callbacks: SaveWindowPanelCallbacks) {
    this.shadowRoot = shadowRoot;
    this.callbacks = callbacks;
  }

  show(summary: SaveWindowPanelSummary, windowRect: MeasurementRect): void {
    this.hide();
    this.ensureStyles();

    const host = document.createElement("div");
    host.className = "otf-save-window-panel-host";
    host.setAttribute("data-otf-ui", "save-window-panel");
    host.style.left = `${String(Math.max(16, windowRect.x))}px`;
    host.style.top = `${String(Math.max(16, windowRect.y + windowRect.height + 12))}px`;

    host.innerHTML = `
      <div class="otf-save-window-panel" role="dialog" aria-labelledby="otf-save-window-title">
        <h2 id="otf-save-window-title" class="otf-save-window-title">Keep changes inside this window?</h2>
        <ul class="otf-save-window-stats">
          <li><span class="otf-save-window-stat-label">Kept</span><span class="otf-save-window-stat-value kept">${String(summary.keptCount)}</span></li>
          <li><span class="otf-save-window-stat-label">Reverted</span><span class="otf-save-window-stat-value reverted">${String(summary.revertedCount + summary.ambiguousCount)}</span></li>
          <li><span class="otf-save-window-stat-label">Partial / ambiguous</span><span class="otf-save-window-stat-value ambiguous">${String(summary.ambiguousCount)}</span></li>
        </ul>
        <p class="otf-save-window-note">Ambiguous changes default to revert.</p>
        <div class="otf-save-window-actions">
          <button type="button" class="otf-save-window-btn confirm" data-action="confirm">Confirm</button>
          <button type="button" class="otf-save-window-btn cancel" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;

    host.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const action = target.closest("[data-action]")?.getAttribute("data-action");
      if (action === "confirm") {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onConfirm();
      } else if (action === "cancel") {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onCancel();
      }
    });

    this.shadowRoot.appendChild(host);
    this.host = host;
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
  }

  isVisible(): boolean {
    return this.host !== null;
  }

  private ensureStyles(): void {
    const existing = this.shadowRoot.querySelector("style[data-otf-save-window-panel]");
    if (existing) {
      return;
    }

    const style = document.createElement("style");
    style.setAttribute("data-otf-save-window-panel", "true");
    style.textContent = `
      .otf-save-window-panel-host {
        position: fixed;
        z-index: 2147483647;
        pointer-events: auto;
        max-width: min(320px, calc(100vw - 32px));
      }

      .otf-save-window-panel {
        box-sizing: border-box;
        padding: 14px 16px;
        border-radius: 12px;
        background: rgba(17, 24, 39, 0.96);
        color: #f9fafb;
        font: 500 13px/1.45 system-ui, -apple-system, sans-serif;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .otf-save-window-title {
        margin: 0 0 10px;
        font: 600 14px/1.3 system-ui, -apple-system, sans-serif;
      }

      .otf-save-window-stats {
        list-style: none;
        margin: 0 0 8px;
        padding: 0;
        display: grid;
        gap: 6px;
      }

      .otf-save-window-stats li {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .otf-save-window-stat-value.kept { color: #34d399; }
      .otf-save-window-stat-value.reverted { color: #f87171; }
      .otf-save-window-stat-value.ambiguous { color: #fbbf24; }

      .otf-save-window-note {
        margin: 0 0 12px;
        color: #9ca3af;
        font-size: 12px;
      }

      .otf-save-window-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .otf-save-window-btn {
        all: unset;
        box-sizing: border-box;
        cursor: pointer;
        padding: 8px 12px;
        border-radius: 8px;
        font: 600 12px/1 system-ui, -apple-system, sans-serif;
      }

      .otf-save-window-btn.confirm {
        background: #059669;
        color: #ecfdf5;
      }

      .otf-save-window-btn.cancel {
        background: rgba(255, 255, 255, 0.08);
        color: #e5e7eb;
      }
    `;
    this.shadowRoot.appendChild(style);
  }
}
