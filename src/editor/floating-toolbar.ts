import type { StyleProperty } from "./operations.js";
import type { VisualNodeRect } from "./visual-node.js";
import type { ResolvedCommand } from "./commands/command-registry.js";
import { OPACITY_MAX, OPACITY_MIN, OPACITY_STEP } from "./style/opacity-value.js";
import {
  buildBoxShadowValue,
  buildGradientFromPreset,
  buildLinearGradientValue,
  GRADIENT_ANGLE_PRESETS,
  GRADIENT_PRESETS,
  parseBoxShadowPreset,
  parseLinearGradientValue,
  SHADOW_PRESETS,
  type ShadowPresetId,
} from "./style-panel-controls.js";

export interface StylePanelValues {
  backgroundColor: string;
  backgroundImage: string;
  color: string;
  fontSize: string;
  fontWeight: string;
  borderRadius: string;
  boxShadow: string;
  opacity: string;
}

export interface FloatingToolbarCallbacks {
  onCommand: (commandId: string) => void;
  onStyleChange: (property: StyleProperty, value: string) => void;
  onStylePanelApply?: () => void;
  onTextCommit: (value: string) => void;
  onTextCancel: () => void;
  onStylePanelReset?: () => Partial<StylePanelValues> | undefined;
  onStylePanelClose?: () => void;
  onToolbarBackgroundClick?: (clientX: number, clientY: number) => void;
  onToolbarPointerDown?: (clientX: number, clientY: number) => boolean;
}

export interface FloatingToolbarOptions {
  shadowRoot: ShadowRoot;
  callbacks: FloatingToolbarCallbacks;
}

export interface FloatingToolbarCommandState {
  id: string;
  enabled: boolean;
}

const VIEWBOX_WIDTH = 520;
const VIEWBOX_HEIGHT = 420;
const DEFAULT_TOOLBAR_WIDTH = 390;
const MIN_TOOLBAR_WIDTH = 330;
const MAX_TOOLBAR_WIDTH = 420;
const MAIN_PATH = "M 90 300 C 55 185 140 82 270 78 C 335 76 390 92 432 120";
const MAIN_DIVIDERS = [0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84] as const;

const COMMAND_LAYOUT: Array<{ id: string; tool: string; label: string; at: number }> = [
  { id: "crop-mode", tool: "crop", label: "Crop", at: 0.06 },
  { id: "style-panel", tool: "style", label: "Style", at: 0.18 },
  { id: "agent", tool: "agent", label: "Agent (coming soon)", at: 0.3 },
  { id: "text-edit", tool: "text", label: "Edit text", at: 0.42 },
  { id: "lasso", tool: "lasso", label: "Lasso", at: 0.54 },
  { id: "undo", tool: "undo", label: "Undo", at: 0.66 },
  { id: "redo", tool: "redo", label: "Redo", at: 0.78 },
  { id: "more", tool: "more", label: "More", at: 0.9 },
];

const TOOL_ICONS: Record<string, string> = {
  hide: `<svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>`,
  backward: `<svg viewBox="0 0 24 24"><rect x="8" y="8" width="9" height="9" rx="1.5"/><path d="M5 5h9"/><path d="M5 5v9"/></svg>`,
  forward: `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M10 4h9"/><path d="M19 4v9"/></svg>`,
  crop: `<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></svg>`,
  style: `<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18h1.5a1.8 1.8 0 0 0 1.3-3.05 1.2 1.2 0 0 1 .85-2.05H17a4 4 0 0 0 4-4c0-4.9-4-8.9-9-8.9Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="14" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>`,
  agent: `<svg viewBox="0 0 24 24"><path d="M12 3l1.25 4.25L17.5 8.5l-4.25 1.25L12 14l-1.25-4.25L6.5 8.5l4.25-1.25L12 3Z"/><path d="M18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/></svg>`,
  text: `<svg viewBox="0 0 24 24"><path d="M4 6V4h16v2"/><path d="M12 4v16"/><path d="M8 20h8"/></svg>`,
  lasso: `<svg viewBox="0 0 24 24"><path d="M18.5 8.2c1.8 1.7 2.2 4.3.8 6.2-1.8 2.5-6.3 3.1-10.1 1.4-3.8-1.7-5.4-5-3.6-7.5 1.8-2.5 6.3-3.1 10.1-1.4"/><path d="M19.2 14.5c1.7 1.4 2 3.2.8 4.4-1.2 1.2-3.4.8-4.2-.6-.7-1.2.1-2.6 1.4-2.7" stroke-dasharray="2.2 2.2"/></svg>`,
  undo: `<svg viewBox="0 0 24 24"><path d="M4 7v6h6"/><path d="M20 17A8 8 0 0 0 6.5 11.2L4 13"/></svg>`,
  redo: `<svg viewBox="0 0 24 24"><path d="M20 7v6h-6"/><path d="M4 17a8 8 0 0 1 13.5-5.8L20 13"/></svg>`,
  more: `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`,
};

export class FloatingToolbar {
  private readonly shadowRoot: ShadowRoot;
  private readonly callbacks: FloatingToolbarCallbacks;
  private toolbarEl: HTMLElement | null = null;
  private stylePanelEl: HTMLElement | null = null;
  private textEditorEl: HTMLElement | null = null;
  private lassoChooserEl: HTMLElement | null = null;
  private moreMenuEl: HTMLElement | null = null;
  private paletteEl: HTMLElement | null = null;
  private styleOpen = false;
  private textEditorOpen = false;
  private lassoChooserOpen = false;
  private moreMenuOpen = false;
  private wrapEnabled = false;
  private paletteOpen = false;
  private toolbarWasDragged = false;
  private panelWasDragged = false;
  private styleAnchorButton: HTMLButtonElement | null = null;
  private outsidePointerListener: ((event: PointerEvent) => void) | null = null;
  private viewportListener: (() => void) | null = null;
  private pendingPositionFrame: number | null = null;
  private pendingShowFrame: number | null = null;
  private lastAnchor: VisualNodeRect | null = null;

  constructor(options: FloatingToolbarOptions) {
    this.shadowRoot = options.shadowRoot;
    this.callbacks = options.callbacks;
    this.ensureStyles();
  }

  mount(): void {
    if (this.toolbarEl) {
      return;
    }

    const staleUi = Array.from(
      this.shadowRoot.querySelectorAll<HTMLElement>(
        '[data-otf-ui="toolbar"], [data-otf-ui="style-panel"], [data-otf-ui="text-editor"], [data-otf-ui="lasso-chooser"], [data-otf-ui="more-menu"], [data-otf-ui="component-palette"]',
      ),
    );
    if (staleUi.length > 0) {
      console.warn("[On the Fly] Removed duplicate toolbar UI before mounting.", {
        count: staleUi.length,
      });
      for (const element of staleUi) {
        element.remove();
      }
    }

    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "otf-curved-toolbar";
    this.toolbarEl.setAttribute("data-otf-ui", "toolbar");
    this.toolbarEl.setAttribute("role", "toolbar");
    this.toolbarEl.hidden = true;
    this.renderToolbarStructure();
    this.wireToolbarInteractions();
    this.attachViewportListeners();

    this.stylePanelEl = document.createElement("aside");
    this.stylePanelEl.className = "otf-style-panel";
    this.stylePanelEl.setAttribute("data-otf-ui", "style-panel");
    this.stylePanelEl.hidden = true;
    this.stylePanelEl.innerHTML = createStylePanelMarkup();
    this.wireStylePanel();

    this.textEditorEl = document.createElement("div");
    this.textEditorEl.className = "otf-text-editor";
    this.textEditorEl.setAttribute("data-otf-ui", "text-editor");
    this.textEditorEl.hidden = true;

    this.lassoChooserEl = document.createElement("div");
    this.lassoChooserEl.className = "otf-lasso-chooser";
    this.lassoChooserEl.setAttribute("data-otf-ui", "lasso-chooser");
    this.lassoChooserEl.setAttribute("role", "menu");
    this.lassoChooserEl.hidden = true;
    this.lassoChooserEl.innerHTML = createLassoChooserMarkup();
    this.wireLassoChooser();

    this.moreMenuEl = document.createElement("div");
    this.moreMenuEl.className = "otf-more-menu";
    this.moreMenuEl.setAttribute("data-otf-ui", "more-menu");
    this.moreMenuEl.setAttribute("role", "menu");
    this.moreMenuEl.hidden = true;
    this.moreMenuEl.innerHTML = createMoreMenuMarkup();
    this.wireMoreMenu();

    this.paletteEl = document.createElement("div");
    this.paletteEl.className = "otf-component-palette";
    this.paletteEl.setAttribute("data-otf-ui", "component-palette");
    this.paletteEl.hidden = true;
    this.paletteEl.innerHTML = createComponentPaletteMarkup();
    this.wireComponentPalette();

    this.shadowRoot.append(this.toolbarEl, this.stylePanelEl, this.textEditorEl, this.lassoChooserEl, this.moreMenuEl, this.paletteEl);
  }

  unmount(): void {
    this.detachOutsideListener();
    this.detachViewportListeners();
    this.cancelPendingPositionFrame();
    this.cancelPendingShowFrame();
    this.toolbarEl?.remove();
    this.stylePanelEl?.remove();
    this.textEditorEl?.remove();
    this.lassoChooserEl?.remove();
    this.moreMenuEl?.remove();
    this.paletteEl?.remove();
    this.toolbarEl = null;
    this.stylePanelEl = null;
    this.textEditorEl = null;
    this.lassoChooserEl = null;
    this.moreMenuEl = null;
    this.paletteEl = null;
    this.styleOpen = false;
    this.textEditorOpen = false;
    this.lassoChooserOpen = false;
    this.moreMenuOpen = false;
    this.paletteOpen = false;
    this.lastAnchor = null;
  }

  renderCommands(
    commands: ResolvedCommand[],
    anchorRect: VisualNodeRect | null,
    activeStates: Record<string, boolean> = {},
  ): void {
    this.renderCommandStates(
      commands.map((entry) => ({ id: entry.command.id, enabled: entry.enabled })),
      anchorRect,
      activeStates,
    );
  }

  renderCommandStates(
    commands: readonly FloatingToolbarCommandState[],
    anchorRect: VisualNodeRect | null,
    activeStates: Record<string, boolean> = {},
  ): void {
    if (!this.toolbarEl) {
      return;
    }

    if (!anchorRect) {
      if (!this.toolbarWasDragged) {
        this.lastAnchor = this.defaultViewportAnchor();
      }
    } else {
      this.lastAnchor = anchorRect;
    }
    const layoutAnchor = this.lastAnchor ?? this.defaultViewportAnchor();
    this.cancelPendingShowFrame();
    this.toolbarEl.hidden = true;
    this.toolbarEl.style.visibility = "hidden";

    for (const layout of COMMAND_LAYOUT) {
      const button = this.toolbarEl.querySelector<HTMLButtonElement>(`[data-command-id="${layout.id}"]`);
      if (!button) {
        continue;
      }
      const entry = commands.find((item) => item.id === layout.id);
      button.disabled = entry ? !entry.enabled : true;
      button.classList.toggle("selected", activeStates[layout.id] === true);
    }

    this.pendingShowFrame = requestAnimationFrame(() => {
      this.pendingShowFrame = null;
      if (!this.toolbarEl) {
        return;
      }
      this.toolbarEl.hidden = false;
      if (!this.toolbarWasDragged) {
        this.positionToolbarNearSelection(layoutAnchor);
      }
      this.updateToolButtonPositions();
      this.toolbarEl.style.visibility = "visible";

      if (this.styleOpen) {
        this.positionStylePanel();
      }
      if (this.lassoChooserOpen) {
        this.positionLassoChooser();
      }
      this.schedulePositionRefresh();
    });
  }

  hide(): void {
    this.hideToolbarOnly();
    this.closeStylePanel();
    this.closeTextEditor(true);
    this.closeLassoChooser();
    this.closeMoreMenu();
    this.closeComponentPalette();
    this.lastAnchor = null;
  }

  refreshAnchor(anchorRect: VisualNodeRect): void {
    if (!this.toolbarEl || this.toolbarEl.hidden) return;
    this.lastAnchor = anchorRect;
    if (this.toolbarWasDragged) return;
    this.positionToolbarNearSelection(anchorRect);
    this.updateToolButtonPositions();
    if (this.styleOpen) this.positionStylePanel();
    if (this.lassoChooserOpen) this.positionLassoChooser();
  }

  hideToolbarOnly(): void {
    this.cancelPendingShowFrame();
    if (this.toolbarEl) {
      this.toolbarEl.hidden = true;
      this.toolbarEl.style.removeProperty("visibility");
    }
  }

  toggleStylePanel(open: boolean, values?: Partial<StylePanelValues>): void {
    if (!this.stylePanelEl) {
      return;
    }

    if (open) {
      if (!this.toolbarEl || this.toolbarEl.hidden) {
        return;
      }
      this.closeLassoChooser();
      this.closeMoreMenu();
      this.closeComponentPalette();
      this.styleAnchorButton =
        this.toolbarEl.querySelector<HTMLButtonElement>('[data-command-id="style-panel"]') ?? null;
      this.panelWasDragged = false;
      this.stylePanelEl.hidden = false;
      if (values) {
        this.setStylePanelValues(values);
      }
      this.positionStylePanel(true);
      requestAnimationFrame(() => {
        this.stylePanelEl?.classList.add("is-open");
        this.positionStylePanel();
      });
      this.styleOpen = true;
      this.attachOutsideListener();
      return;
    }

    this.closeStylePanel();
  }

  closeStylePanel(notifyClose = true): void {
    if (!this.stylePanelEl || !this.styleOpen) {
      return;
    }
    this.styleOpen = false;
    this.stylePanelEl.classList.remove("is-open");
    this.syncOutsideListener();
    window.setTimeout(() => {
      if (this.stylePanelEl && !this.styleOpen) {
        this.stylePanelEl.hidden = true;
      }
    }, 160);
    this.styleAnchorButton = null;
    this.panelWasDragged = false;
    if (notifyClose) {
      this.callbacks.onStylePanelClose?.();
    }
  }

  isStylePanelOpen(): boolean {
    return this.styleOpen;
  }

  isTextEditorOpen(): boolean {
    return this.textEditorOpen;
  }

  setStylePanelValues(values: Partial<StylePanelValues>): void {
    if (!this.stylePanelEl) {
      return;
    }
    setInputValue(this.stylePanelEl, "backgroundColor", values.backgroundColor);
    syncGradientControls(this.stylePanelEl, values.backgroundImage);
    setInputValue(this.stylePanelEl, "color", values.color);
    setInputValue(this.stylePanelEl, "fontSize", values.fontSize);
    setInputValue(this.stylePanelEl, "fontWeight", values.fontWeight);
    setInputValue(this.stylePanelEl, "borderRadius", values.borderRadius);
    syncShadowControls(this.stylePanelEl, values.boxShadow);
    if (values.opacity !== undefined) {
      const range = this.stylePanelEl.querySelector<HTMLInputElement>('[data-style-field="opacity"]');
      if (range) {
        range.value = values.opacity;
      }
      const readout = this.stylePanelEl.querySelector<HTMLSpanElement>('[data-opacity-readout]');
      if (readout) {
        readout.textContent = values.opacity;
      }
    }
  }

  openTextEditor(rect: VisualNodeRect, initialText: string): void {
    if (!this.textEditorEl) {
      return;
    }
    this.closeLassoChooser();
    this.closeMoreMenu();
    this.closeComponentPalette();

    this.textEditorEl.replaceChildren();
    const textarea = document.createElement("textarea");
    textarea.className = "otf-text-editor-input";
    textarea.value = initialText;
    textarea.setAttribute("aria-label", "Edit text");
    textarea.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });
    this.textEditorEl.appendChild(textarea);

    this.textEditorEl.style.left = `${String(rect.x)}px`;
    this.textEditorEl.style.top = `${String(rect.y)}px`;
    this.textEditorEl.style.width = `${String(Math.max(rect.width, 120))}px`;
    this.textEditorEl.style.minHeight = `${String(Math.max(rect.height, 32))}px`;
    this.textEditorEl.hidden = false;
    this.textEditorOpen = true;

    textarea.focus();
    textarea.select();

    const wasMultiLine = initialText.includes("\n") || rect.height > 44;
    let finished = false;
    const commit = (): void => {
      if (!this.textEditorOpen || finished) {
        return;
      }
      finished = true;
      if (textarea.value !== initialText) {
        this.callbacks.onTextCommit(textarea.value);
      }
      this.closeTextEditor(false);
    };

    const cancel = (): void => {
      if (!this.textEditorOpen || finished) {
        return;
      }
      finished = true;
      this.closeTextEditor(true);
    };

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commit();
        return;
      }
      if (event.key === "Enter" && !wasMultiLine && !event.shiftKey) {
        event.preventDefault();
        commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });

    textarea.addEventListener("blur", () => {
      commit();
    });
  }

  closeTextEditor(cancel: boolean): void {
    if (!this.textEditorEl || !this.textEditorOpen) {
      return;
    }
    this.textEditorOpen = false;
    this.textEditorEl.hidden = true;
    this.textEditorEl.replaceChildren();
    if (cancel) {
      this.callbacks.onTextCancel();
    }
  }

  toggleLassoChooser(): void {
    if (this.lassoChooserOpen) {
      this.closeLassoChooser();
      return;
    }
    if (this.styleOpen) this.closeStylePanel();
    if (this.textEditorOpen) this.closeTextEditor(true);
    this.closeMoreMenu();
    this.closeComponentPalette();
    if (!this.lassoChooserEl || !this.toolbarEl) return;
    this.lassoChooserEl.hidden = false;
    this.lassoChooserOpen = true;
    this.positionLassoChooser();
    this.syncOutsideListener();
  }

  closeLassoChooser(): boolean {
    if (!this.lassoChooserOpen) return false;
    this.lassoChooserOpen = false;
    if (this.lassoChooserEl) this.lassoChooserEl.hidden = true;
    this.syncOutsideListener();
    return true;
  }

  isLassoChooserOpen(): boolean {
    return this.lassoChooserOpen;
  }

  toggleMoreMenu(): void {
    if (this.moreMenuOpen) {
      this.closeMoreMenu();
      return;
    }
    if (this.styleOpen) this.closeStylePanel();
    if (this.textEditorOpen) this.closeTextEditor(true);
    this.closeLassoChooser();
    this.closeComponentPalette();
    if (!this.moreMenuEl || !this.toolbarEl) return;
    this.setMoreWrapEnabled(this.wrapEnabled);
    this.moreMenuEl.hidden = false;
    this.moreMenuOpen = true;
    this.positionAnchoredChrome(this.moreMenuEl, "more");
    this.syncOutsideListener();
  }

  closeMoreMenu(): boolean {
    if (!this.moreMenuOpen) return false;
    this.moreMenuOpen = false;
    if (this.moreMenuEl) this.moreMenuEl.hidden = true;
    this.syncOutsideListener();
    return true;
  }

  setMoreWrapEnabled(enabled: boolean): void {
    this.wrapEnabled = enabled;
    const wrap = this.moreMenuEl?.querySelector<HTMLButtonElement>('[data-more-action="wrap-selection"]');
    if (wrap) wrap.disabled = !enabled;
  }

  openComponentPalette(options: { canSample: boolean; sampling: boolean; wrapEnabled: boolean }): void {
    if (this.styleOpen) this.closeStylePanel();
    if (this.textEditorOpen) this.closeTextEditor(true);
    this.closeLassoChooser();
    this.closeMoreMenu();
    if (!this.paletteEl || !this.toolbarEl) return;
    this.paletteEl.hidden = false;
    this.paletteOpen = true;
    this.setPaletteSampling(options.sampling);
    const sampleRow = this.paletteEl.querySelector<HTMLElement>(".otf-palette-sample");
    if (sampleRow) sampleRow.hidden = !options.canSample;
    this.positionAnchoredChrome(this.paletteEl, "more");
    this.syncOutsideListener();
  }

  closeComponentPalette(): boolean {
    if (!this.paletteOpen) return false;
    this.paletteOpen = false;
    if (this.paletteEl) this.paletteEl.hidden = true;
    this.syncOutsideListener();
    return true;
  }

  isComponentPaletteOpen(): boolean {
    return this.paletteOpen;
  }

  setPaletteSampling(sampling: boolean): void {
    if (!this.paletteEl) return;
    for (const button of Array.from(this.paletteEl.querySelectorAll<HTMLButtonElement>("[data-palette-style]"))) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-palette-style") === (sampling ? "sampled" : "default")));
    }
  }

  private positionAnchoredChrome(element: HTMLElement, commandId: string): void {
    if (!this.toolbarEl) return;
    const button = this.toolbarEl.querySelector<HTMLButtonElement>(`[data-command-id="${commandId}"]`);
    const rect = button?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(element.getBoundingClientRect().width || 320, 340);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const top = rect.bottom + 10;
    element.style.left = `${String(left)}px`;
    element.style.top = `${String(Math.min(top, Math.max(8, window.innerHeight - 280)))}px`;
  }

  private renderToolbarStructure(): void {
    if (!this.toolbarEl) {
      return;
    }

    this.toolbarEl.innerHTML = `
      <svg class="otf-toolbar-svg" viewBox="0 0 ${String(VIEWBOX_WIDTH)} ${String(VIEWBOX_HEIGHT)}" aria-hidden="true">
        <path class="otf-toolbar-path" d="${MAIN_PATH}" />
      </svg>
    `;

    const path = this.toolbarEl.querySelector("path");
    if (!path) {
      return;
    }

    for (const dividerAt of MAIN_DIVIDERS) {
      this.toolbarEl.appendChild(createDivider(path, dividerAt, this.toolbarEl));
    }

    for (const item of COMMAND_LAYOUT) {
      this.toolbarEl.appendChild(createToolButton(path, item, this.toolbarEl));
    }

    const rotateHandle = document.createElement("button");
    rotateHandle.type = "button";
    rotateHandle.className = "otf-rotate-handle";
    rotateHandle.title = "Drag to rotate toolbar";
    rotateHandle.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
    this.toolbarEl.appendChild(rotateHandle);
  }

  private wireToolbarInteractions(): void {
    if (!this.toolbarEl) {
      return;
    }
    this.toolbarEl.addEventListener("pointerdown", (event) => {
      if (!this.callbacks.onToolbarPointerDown?.(event.clientX, event.clientY)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    for (const button of Array.from(this.toolbarEl.querySelectorAll<HTMLButtonElement>(".otf-tool-btn"))) {
      const guardPointer = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
      };
      button.addEventListener("mousedown", guardPointer);
      button.addEventListener("pointerdown", guardPointer);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) {
          return;
        }
        const id = button.getAttribute("data-command-id");
        if (id) {
          this.callbacks.onCommand(id);
        }
      });
    }

    this.makeToolbarDraggable();
    this.makeToolbarRotatable();
  }

  private wireLassoChooser(): void {
    if (!this.lassoChooserEl) return;
    this.lassoChooserEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    for (const button of Array.from(this.lassoChooserEl.querySelectorAll<HTMLButtonElement>("[data-lasso-mode]"))) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const mode = button.getAttribute("data-lasso-mode");
        if (mode === "rectangle" || mode === "freeform") {
          this.closeLassoChooser();
          this.callbacks.onCommand(`lasso-${mode}`);
        }
      });
    }
  }

  private wireMoreMenu(): void {
    if (!this.moreMenuEl) return;
    this.moreMenuEl.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    for (const button of Array.from(this.moreMenuEl.querySelectorAll<HTMLButtonElement>("[data-more-action]"))) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.getAttribute("data-more-action");
        this.closeMoreMenu();
        if (action) this.callbacks.onCommand(action);
      });
    }
  }

  private wireComponentPalette(): void {
    if (!this.paletteEl) return;
    this.paletteEl.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    for (const button of Array.from(this.paletteEl.querySelectorAll<HTMLButtonElement>("[data-create-kind]"))) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const kind = button.getAttribute("data-create-kind");
        this.closeComponentPalette();
        if (kind) this.callbacks.onCommand(`create-${kind}`);
      });
    }
    for (const button of Array.from(this.paletteEl.querySelectorAll<HTMLButtonElement>("[data-palette-style]"))) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const mode = button.getAttribute("data-palette-style");
        this.callbacks.onCommand(mode === "sampled" ? "palette-style-sampled" : "palette-style-default");
      });
    }
  }

  private positionLassoChooser(): void {
    if (!this.lassoChooserEl || !this.toolbarEl) return;
    const button = this.toolbarEl.querySelector<HTMLButtonElement>('[data-command-id="lasso"]');
    const rect = button?.getBoundingClientRect();
    if (!rect) return;
    const width = 168;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const top = rect.bottom + 10;
    const maxTop = Math.max(8, window.innerHeight - 96);
    this.lassoChooserEl.style.left = `${String(left)}px`;
    this.lassoChooserEl.style.top = `${String(Math.min(top, maxTop))}px`;
  }

  private wireStylePanel(): void {
    if (!this.stylePanelEl) {
      return;
    }

    const closeButton = this.stylePanelEl.querySelector<HTMLButtonElement>("[data-style-close]");
    closeButton?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    closeButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeStylePanel();
    });

    const bindings: Array<{ field: string; property: StyleProperty; transform?: (v: string) => string }> = [
      { field: "backgroundColor", property: "backgroundColor" },
      { field: "color", property: "color" },
      { field: "fontSize", property: "fontSize", transform: (v) => (/^\d+$/.test(v) ? `${v}px` : v) },
      { field: "fontWeight", property: "fontWeight" },
      { field: "borderRadius", property: "borderRadius", transform: (v) => (/^\d+$/.test(v) ? `${v}px` : v) },
    ];

    for (const binding of bindings) {
      const input = this.stylePanelEl.querySelector<HTMLInputElement>(
        `[data-style-field="${binding.field}"]`,
      );
      input?.addEventListener("input", () => {
        const raw = input.value.trim();
        if (!raw) {
          return;
        }
        const value = binding.transform ? binding.transform(raw) : raw;
        this.callbacks.onStyleChange(binding.property, value);
        if (binding.property === "backgroundColor") {
          this.callbacks.onStyleChange("backgroundImage", "none");
        }
      });
    }

    this.wireGradientControls();
    this.wireShadowControls();
    this.wireOverlayInputKeyboardGuards(this.stylePanelEl);

    const opacityRange = this.stylePanelEl.querySelector<HTMLInputElement>('[data-style-field="opacity"]');
    const opacityReadout = this.stylePanelEl.querySelector<HTMLSpanElement>("[data-opacity-readout]");
    opacityRange?.addEventListener("input", () => {
      if (opacityReadout) {
        opacityReadout.textContent = opacityRange.value;
      }
      const raw = opacityRange.value.trim();
      if (!raw) {
        return;
      }
      this.callbacks.onStyleChange("opacity", raw);
    });

    const header = this.stylePanelEl.querySelector<HTMLElement>(".otf-style-panel-header");
    header?.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }
      this.makePanelDraggable(event);
    });

    const applyButton = this.stylePanelEl.querySelector<HTMLButtonElement>("[data-style-apply]");
    applyButton?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    applyButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onStylePanelApply?.();
      this.closeStylePanel(false);
    });

    const resetButton = this.stylePanelEl.querySelector<HTMLButtonElement>("[data-style-reset]");
    resetButton?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    resetButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const values = this.callbacks.onStylePanelReset?.();
      if (values) {
        this.setStylePanelValues(values);
      }
    });
  }

  private wireGradientControls(): void {
    if (!this.stylePanelEl) {
      return;
    }

    const applyGradient = (): void => {
      const start = this.stylePanelEl?.querySelector<HTMLInputElement>('[data-gradient-start]')?.value ?? "#3B82F6";
      const end = this.stylePanelEl?.querySelector<HTMLInputElement>('[data-gradient-end]')?.value ?? "#06B6D4";
      const angle = Number(this.stylePanelEl?.querySelector<HTMLSelectElement>('[data-gradient-angle]')?.value ?? "135");
      const value = buildLinearGradientValue(start, end, angle);
      if (value) {
        this.callbacks.onStyleChange("backgroundImage", value);
      }
    };

    for (const button of Array.from(
      this.stylePanelEl.querySelectorAll<HTMLButtonElement>("[data-gradient-preset]"),
    )) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const presetId = button.getAttribute("data-gradient-preset");
        const preset = GRADIENT_PRESETS.find((entry) => entry.id === presetId);
        if (!preset || !this.stylePanelEl) {
          return;
        }
        syncGradientControls(this.stylePanelEl, buildGradientFromPreset(preset));
        this.callbacks.onStyleChange("backgroundImage", buildGradientFromPreset(preset));
      });
    }

    for (const field of ["[data-gradient-start]", "[data-gradient-end]", "[data-gradient-angle]"]) {
      this.stylePanelEl.querySelector(field)?.addEventListener("input", applyGradient);
      this.stylePanelEl.querySelector(field)?.addEventListener("change", applyGradient);
    }
  }

  private wireShadowControls(): void {
    if (!this.stylePanelEl) {
      return;
    }

    const applyShadow = (): void => {
      const presetId = (this.stylePanelEl?.querySelector<HTMLSelectElement>('[data-shadow-preset]')?.value ??
        "none") as ShadowPresetId;
      const intensityInput = this.stylePanelEl?.querySelector<HTMLInputElement>('[data-shadow-intensity]');
      const intensity = Number(intensityInput?.value ?? "1");
      const readout = this.stylePanelEl?.querySelector<HTMLSpanElement>("[data-shadow-intensity-readout]");
      if (readout) {
        readout.textContent = String(intensity);
      }
      this.callbacks.onStyleChange("boxShadow", buildBoxShadowValue(presetId, intensity));
    };

    this.stylePanelEl.querySelector('[data-shadow-preset]')?.addEventListener("change", applyShadow);
    this.stylePanelEl.querySelector('[data-shadow-intensity]')?.addEventListener("input", applyShadow);
  }

  private wireOverlayInputKeyboardGuards(root: HTMLElement): void {
    for (const input of Array.from(root.querySelectorAll("input, textarea, select, button"))) {
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
      });
    }
  }

  private updateToolButtonPositions(): void {
    if (!this.toolbarEl) {
      return;
    }
    const path = this.toolbarEl.querySelector("path");
    if (!path) {
      return;
    }
    const scale = this.toolbarEl.offsetWidth > 0 ? this.toolbarEl.offsetWidth / VIEWBOX_WIDTH : 1;
    this.toolbarEl.style.setProperty("--scale", String(scale));

    for (const layout of COMMAND_LAYOUT) {
      const button = this.toolbarEl.querySelector<HTMLButtonElement>(`[data-command-id="${layout.id}"]`);
      if (!button) {
        continue;
      }
      const point = pointOnPath(path, layout.at, this.toolbarEl);
      button.style.left = `${String(point.x)}px`;
      button.style.top = `${String(point.y)}px`;
      button.style.setProperty("--angle", `${String(point.angle + 90)}deg`);
    }

    for (const dividerAt of MAIN_DIVIDERS) {
      const index = MAIN_DIVIDERS.indexOf(dividerAt);
      const divider = this.toolbarEl.querySelectorAll(".otf-divider")[index];
      if (!(divider instanceof HTMLElement)) {
        continue;
      }
      const point = pointOnPath(path, dividerAt, this.toolbarEl);
      divider.style.left = `${String(point.x)}px`;
      divider.style.top = `${String(point.y)}px`;
      divider.style.setProperty("--angle", `${String(point.angle + 90)}deg`);
    }
  }

  private defaultViewportAnchor(): VisualNodeRect {
    const viewportHeight = Math.max(1, window.innerHeight);
    return { x: 24, y: Math.max(72, viewportHeight * 0.28), width: 1, height: 1 };
  }

  private positionToolbarNearSelection(rect: VisualNodeRect): void {
    if (!this.toolbarEl) {
      return;
    }
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const maxWidth = Math.max(220, Math.min(MAX_TOOLBAR_WIDTH, viewportWidth - 28));
    const minWidth = Math.min(MIN_TOOLBAR_WIDTH, maxWidth);
    const width = clamp(DEFAULT_TOOLBAR_WIDTH, minWidth, maxWidth);
    const x = clamp(rect.x + rect.width / 2 - width / 2, 14, viewportWidth - width - 14);
    const y = clamp(rect.y - 126, 14, Math.max(14, viewportHeight - 164));
    this.setToolbarPlacement(x, y, width, -82);
  }

  private setToolbarPlacement(x: number, y: number, width: number, rotation: number): void {
    if (!this.toolbarEl) {
      return;
    }
    this.toolbarEl.dataset.x = String(x);
    this.toolbarEl.dataset.y = String(y);
    this.toolbarEl.dataset.rotation = String(rotation);
    this.toolbarEl.dataset.width = String(width);
    this.toolbarEl.style.setProperty("--x", `${String(x)}px`);
    this.toolbarEl.style.setProperty("--y", `${String(y)}px`);
    this.toolbarEl.style.setProperty("--rotation", `${String(rotation)}deg`);
    this.toolbarEl.style.setProperty("--toolbar-width", `${String(width)}px`);
    this.toolbarEl.style.setProperty("--scale", String(width / VIEWBOX_WIDTH));
    const handle = this.toolbarEl.querySelector<HTMLElement>(".otf-rotate-handle");
    handle?.style.setProperty("--counter-angle", `${String(-rotation)}deg`);
  }

  private schedulePositionRefresh(): void {
    this.cancelPendingPositionFrame();
    this.pendingPositionFrame = requestAnimationFrame(() => {
      this.pendingPositionFrame = null;
      if (!this.lastAnchor || !this.toolbarEl || this.toolbarWasDragged) {
        return;
      }
      this.positionToolbarNearSelection(this.lastAnchor);
      this.updateToolButtonPositions();
      if (this.styleOpen) {
        this.positionStylePanel();
      }
    });
  }

  private cancelPendingPositionFrame(): void {
    if (this.pendingPositionFrame !== null) {
      cancelAnimationFrame(this.pendingPositionFrame);
      this.pendingPositionFrame = null;
    }
  }

  private cancelPendingShowFrame(): void {
    if (this.pendingShowFrame !== null) {
      cancelAnimationFrame(this.pendingShowFrame);
      this.pendingShowFrame = null;
    }
  }

  private positionStylePanel(force = false): void {
    if (!this.stylePanelEl || !this.styleAnchorButton || !this.toolbarEl) {
      return;
    }
    if (this.panelWasDragged && !force) {
      return;
    }

    const anchorRect = this.styleAnchorButton.getBoundingClientRect();
    const width = 310;
    let x = anchorRect.right + 18;
    let y = anchorRect.top - 36;
    x = clamp(x, 14, window.innerWidth - width - 14);
    y = clamp(y, 14, window.innerHeight - 260);

    this.stylePanelEl.style.setProperty("--panel-x", `${String(x)}px`);
    this.stylePanelEl.style.setProperty("--panel-y", `${String(y)}px`);
  }

  private makeToolbarDraggable(): void {
    if (!this.toolbarEl) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let moved = false;

    this.toolbarEl.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(".otf-tool-btn") || event.target.closest(".otf-rotate-handle")) {
        return;
      }
      this.toolbarEl?.setPointerCapture(event.pointerId);
      startX = event.clientX;
      startY = event.clientY;
      originX = Number(this.toolbarEl?.dataset.x ?? 0);
      originY = Number(this.toolbarEl?.dataset.y ?? 0);
      moved = false;
      if (this.toolbarEl) {
        this.toolbarEl.dataset.dragging = "true";
      }
    });

    this.toolbarEl.addEventListener("pointermove", (event) => {
      if (this.toolbarEl?.dataset.dragging !== "true") {
        return;
      }
      const nextX = originX + (event.clientX - startX);
      const nextY = originY + (event.clientY - startY);
      moved = moved || Math.hypot(event.clientX - startX, event.clientY - startY) >= 3;
      if (!moved) return;
      this.toolbarWasDragged = true;
      this.setToolbarPlacement(
        nextX,
        nextY,
        Number(this.toolbarEl.dataset.width ?? 440),
        Number(this.toolbarEl.dataset.rotation ?? -82),
      );
      this.positionStylePanel();
    });

    const endDrag = (event: PointerEvent): void => {
      if (this.toolbarEl?.dataset.dragging === "true") {
        this.toolbarEl.dataset.dragging = "false";
        if (this.toolbarEl.hasPointerCapture(event.pointerId)) {
          this.toolbarEl.releasePointerCapture(event.pointerId);
        }
        if (!moved && event.type === "pointerup") {
          this.callbacks.onToolbarBackgroundClick?.(event.clientX, event.clientY);
        }
      }
    };
    this.toolbarEl.addEventListener("pointerup", endDrag);
    this.toolbarEl.addEventListener("pointercancel", endDrag);
  }

  private makeToolbarRotatable(): void {
    if (!this.toolbarEl) {
      return;
    }

    let startAngle = 0;
    let startRotation = 0;

    this.toolbarEl.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".otf-rotate-handle")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.toolbarEl?.setPointerCapture(event.pointerId);
      const toolbar = this.toolbarEl;
      if (!toolbar) {
        return;
      }
      const rect = toolbar.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      startAngle = Math.atan2(event.clientY - cy, event.clientX - cx) * (180 / Math.PI);
      startRotation = Number(this.toolbarEl?.dataset.rotation ?? -82);
      if (this.toolbarEl) {
        this.toolbarEl.dataset.rotating = "true";
      }
    });

    this.toolbarEl.addEventListener("pointermove", (event) => {
      if (this.toolbarEl?.dataset.rotating !== "true") {
        return;
      }
      const rect = this.toolbarEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(event.clientY - cy, event.clientX - cx) * (180 / Math.PI);
      const rotation = Math.round(startRotation + (angle - startAngle));
      this.toolbarWasDragged = true;
      this.setToolbarPlacement(
        Number(this.toolbarEl.dataset.x ?? 0),
        Number(this.toolbarEl.dataset.y ?? 0),
        Number(this.toolbarEl.dataset.width ?? 440),
        rotation,
      );
      this.positionStylePanel();
    });

    const endRotate = (event: PointerEvent): void => {
      if (this.toolbarEl?.dataset.rotating === "true") {
        this.toolbarEl.dataset.rotating = "false";
        if (this.toolbarEl.hasPointerCapture(event.pointerId)) {
          this.toolbarEl.releasePointerCapture(event.pointerId);
        }
      }
    };
    this.toolbarEl.addEventListener("pointerup", endRotate);
    this.toolbarEl.addEventListener("pointercancel", endRotate);
  }

  private makePanelDraggable(startEvent: PointerEvent): void {
    if (!this.stylePanelEl) {
      return;
    }

    this.panelWasDragged = true;
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const header = startEvent.currentTarget instanceof HTMLElement ? startEvent.currentTarget : this.stylePanelEl;
    header.setPointerCapture(startEvent.pointerId);
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const currentX = Number.parseFloat(this.stylePanelEl.style.getPropertyValue("--panel-x")) || 0;
    const currentY = Number.parseFloat(this.stylePanelEl.style.getPropertyValue("--panel-y")) || 0;

    const onMove = (event: PointerEvent): void => {
      const x = currentX + (event.clientX - startX);
      const y = currentY + (event.clientY - startY);
      this.stylePanelEl?.style.setProperty("--panel-x", `${String(x)}px`);
      this.stylePanelEl?.style.setProperty("--panel-y", `${String(y)}px`);
    };

    const onUp = (event: PointerEvent): void => {
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      header.removeEventListener("pointercancel", onUp);
    };

    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onUp);
  }

  private attachOutsideListener(): void {
    this.detachOutsideListener();
    this.outsidePointerListener = (event: PointerEvent) => {
      if (this.isInsideOtfUi(event)) {
        return;
      }
      this.closeLassoChooser();
      this.closeMoreMenu();
      this.closeComponentPalette();
      this.closeStylePanel();
    };
    window.addEventListener("pointerdown", this.outsidePointerListener, true);
  }

  private syncOutsideListener(): void {
    if (this.styleOpen || this.lassoChooserOpen || this.moreMenuOpen || this.paletteOpen) this.attachOutsideListener();
    else this.detachOutsideListener();
  }

  private detachOutsideListener(): void {
    if (this.outsidePointerListener) {
      window.removeEventListener("pointerdown", this.outsidePointerListener, true);
      this.outsidePointerListener = null;
    }
  }

  private attachViewportListeners(): void {
    this.detachViewportListeners();
    this.viewportListener = () => {
      if (!this.lastAnchor || this.toolbarWasDragged) {
        return;
      }
      this.positionToolbarNearSelection(this.lastAnchor);
      this.updateToolButtonPositions();
      if (this.styleOpen) {
        this.positionStylePanel();
      }
      if (this.lassoChooserOpen) {
        this.positionLassoChooser();
      }
    };
    window.addEventListener("resize", this.viewportListener);
    window.addEventListener("scroll", this.viewportListener, true);
  }

  private detachViewportListeners(): void {
    if (!this.viewportListener) {
      return;
    }
    window.removeEventListener("resize", this.viewportListener);
    window.removeEventListener("scroll", this.viewportListener, true);
    this.viewportListener = null;
  }

  private isInsideOtfUi(event: PointerEvent): boolean {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node instanceof Element && node.getAttribute("data-otf-ui")) {
        return true;
      }
      if (node instanceof Element && node.id === "on-the-fly-root-host") {
        return true;
      }
    }
    return false;
  }

  private ensureStyles(): void {
    if (this.shadowRoot.querySelector(".otf-toolbar-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.className = "otf-toolbar-styles";
    style.textContent = CURVED_TOOLBAR_CSS;
    this.shadowRoot.appendChild(style);
  }
}

function createLassoChooserMarkup(): string {
  return `
    <button type="button" class="otf-lasso-option" role="menuitem" data-lasso-mode="rectangle">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>
      Rectangle
    </button>
    <button type="button" class="otf-lasso-option" role="menuitem" data-lasso-mode="freeform">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15c2.2-4 4.2 3 7-1 2.4-3.4 3.4 4.2 6.2.4 1.4-1.8 2.8-3.2 3.8-3.8"/></svg>
      Freeform
    </button>
  `;
}

function createMoreMenuMarkup(): string {
  return `
    <button type="button" class="otf-more-option" role="menuitem" data-more-action="add-element">Add element…</button>
    <button type="button" class="otf-more-option" role="menuitem" data-more-action="wrap-selection">Container around selection</button>
  `;
}

function createComponentPaletteMarkup(): string {
  const icon = (kind: string): string => {
    if (kind === "rectangle") return '<rect x="5" y="7" width="14" height="10" rx="1.5"/>';
    if (kind === "circle") return '<circle cx="12" cy="12" r="6"/>';
    if (kind === "divider") return '<path d="M4 12h16"/>';
    if (kind === "text") return '<path d="M5 7V5h14v2M12 5v14M8 19h8"/>';
    if (kind === "heading") return '<path d="M6 5v14M18 5v14M6 12h12"/>';
    if (kind === "button") return '<rect x="4" y="8" width="16" height="8" rx="2"/><path d="M8 12h8"/>';
    if (kind === "input") return '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M6 12h6"/>';
    if (kind === "search") return '<circle cx="11" cy="11" r="4"/><path d="M16 16l3 3"/>';
    if (kind === "badge") return '<rect x="4" y="8" width="16" height="8" rx="4"/>';
    if (kind === "container") return '<rect x="4" y="5" width="16" height="14" rx="2"/>';
    if (kind === "card") return '<rect x="5" y="6" width="14" height="12" rx="2"/><path d="M8 10h8M8 13h5"/>';
    return '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M6 12h6"/>';
  };
  const item = (kind: string, label: string): string =>
    `<button type="button" class="otf-palette-item" data-create-kind="${kind}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon(kind)}</svg><span>${label}</span></button>`;
  return `
    <div class="otf-palette-sample" hidden>
      <span>Style</span>
      <button type="button" data-palette-style="default" aria-pressed="true">Default</button>
      <button type="button" data-palette-style="sampled" aria-pressed="false">Use selected style</button>
    </div>
    <div class="otf-palette-group"><div class="otf-palette-title">Basic</div>${item("rectangle", "Rectangle")}${item("circle", "Circle")}${item("divider", "Divider")}${item("text", "Text")}${item("heading", "Heading")}</div>
    <div class="otf-palette-group"><div class="otf-palette-title">Controls</div>${item("button", "Button")}${item("input", "Input")}${item("search", "Search Bar")}${item("badge", "Badge / Pill")}</div>
    <div class="otf-palette-group"><div class="otf-palette-title">Structure</div>${item("container", "Container")}${item("card", "Card")}${item("header", "Header / Navbar")}</div>
  `;
}

function createToolButton(
  path: SVGPathElement,
  item: { id: string; tool: string; label: string; at: number },
  toolbar: HTMLElement,
): HTMLButtonElement {
  const point = pointOnPath(path, item.at, toolbar);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "otf-tool-btn";
  button.setAttribute("data-command-id", item.id);
  button.setAttribute("data-tool", item.tool);
  button.setAttribute("aria-label", item.label);
  button.title = item.label;
  button.innerHTML = TOOL_ICONS[item.tool] ?? "";
  button.style.left = `${String(point.x)}px`;
  button.style.top = `${String(point.y)}px`;
  button.style.setProperty("--angle", `${String(point.angle + 90)}deg`);
  return button;
}

function createDivider(path: SVGPathElement, at: number, toolbar: HTMLElement): HTMLElement {
  const point = pointOnPath(path, at, toolbar);
  const divider = document.createElement("span");
  divider.className = "otf-divider";
  divider.style.left = `${String(point.x)}px`;
  divider.style.top = `${String(point.y)}px`;
  divider.style.setProperty("--angle", `${String(point.angle + 90)}deg`);
  return divider;
}

function pointOnPath(path: SVGPathElement, percent: number, toolbar: HTMLElement): {
  x: number;
  y: number;
  angle: number;
} {
  const length = path.getTotalLength();
  const point = path.getPointAtLength(length * percent);
  const before = path.getPointAtLength(length * Math.max(0, percent - 0.01));
  const after = path.getPointAtLength(length * Math.min(1, percent + 0.01));
  const angle = Math.atan2(after.y - before.y, after.x - before.x) * (180 / Math.PI);
  const scale = toolbar.offsetWidth > 0 ? toolbar.offsetWidth / VIEWBOX_WIDTH : 1;
  return {
    x: point.x * scale,
    y: point.y * scale,
    angle,
  };
}

function setInputValue(root: HTMLElement, field: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  const input = root.querySelector<HTMLInputElement>(`[data-style-field="${field}"]`);
  if (input) {
    input.value = value;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function createStylePanelMarkup(): string {
  const gradientChips = GRADIENT_PRESETS.map(
    (preset) =>
      `<button type="button" class="otf-gradient-chip" data-gradient-preset="${preset.id}" title="${preset.label}" style="background:${buildGradientFromPreset(preset)}"></button>`,
  ).join("");

  const angleOptions = GRADIENT_ANGLE_PRESETS.map(
    (angle) => `<option value="${String(angle)}">${String(angle)}°</option>`,
  ).join("");

  const shadowOptions = SHADOW_PRESETS.map(
    (preset) => `<option value="${preset.id}">${preset.label}</option>`,
  ).join("");

  return `
    <div class="otf-style-panel-header">
      <div class="otf-style-panel-title"><span class="otf-style-panel-title-dot"></span><span>Style</span></div>
      <button type="button" class="otf-style-panel-close" data-style-close aria-label="Close style panel">×</button>
    </div>
    <div class="otf-style-panel-grid">
      <label class="otf-style-field"><span>Background</span><input type="color" data-style-field="backgroundColor" /></label>
      <label class="otf-style-field"><span>Text color</span><input type="color" data-style-field="color" /></label>
      <label class="otf-style-field"><span>Font size</span><input type="text" data-style-field="fontSize" placeholder="16px" /></label>
      <label class="otf-style-field"><span>Font weight</span><input type="text" data-style-field="fontWeight" placeholder="400" /></label>
      <label class="otf-style-field"><span>Radius</span><input type="text" data-style-field="borderRadius" placeholder="0px" /></label>
      <label class="otf-style-field otf-opacity-field">
        <span>Opacity <strong data-opacity-readout>1</strong></span>
        <input type="range" min="${String(OPACITY_MIN)}" max="${String(OPACITY_MAX)}" step="${String(OPACITY_STEP)}" value="1" data-style-field="opacity" />
      </label>
    </div>
    <div class="otf-style-section">
      <div class="otf-style-section-label">Gradient</div>
      <div class="otf-gradient-chips">${gradientChips}</div>
      <div class="otf-style-panel-grid otf-gradient-grid">
        <label class="otf-style-field"><span>Start</span><input type="color" data-gradient-start value="#3B82F6" /></label>
        <label class="otf-style-field"><span>End</span><input type="color" data-gradient-end value="#06B6D4" /></label>
        <label class="otf-style-field otf-gradient-angle-field"><span>Angle</span><select data-gradient-angle>${angleOptions}</select></label>
      </div>
    </div>
    <div class="otf-style-section">
      <div class="otf-style-section-label">Shadow</div>
      <div class="otf-style-panel-grid otf-shadow-grid">
        <label class="otf-style-field"><span>Preset</span><select data-shadow-preset>${shadowOptions}</select></label>
        <label class="otf-style-field otf-shadow-intensity-field">
          <span>Intensity <strong data-shadow-intensity-readout>1</strong></span>
          <input type="range" min="0.25" max="2" step="0.05" value="1" data-shadow-intensity />
        </label>
      </div>
    </div>
    <div class="otf-style-panel-actions">
      <button type="button" data-style-reset>Reset</button>
      <button type="button" data-style-apply>Apply</button>
    </div>
  `;
}

function syncGradientControls(root: HTMLElement, value: string | undefined): void {
  const parsed = value ? parseLinearGradientValue(value) : null;
  const start = root.querySelector<HTMLInputElement>("[data-gradient-start]");
  const end = root.querySelector<HTMLInputElement>("[data-gradient-end]");
  const angle = root.querySelector<HTMLSelectElement>("[data-gradient-angle]");
  if (start && parsed?.startColor) {
    start.value = parsed.startColor;
  }
  if (end && parsed?.endColor) {
    end.value = parsed.endColor;
  }
  if (angle && parsed) {
    angle.value = String(Math.round(parsed.angleDeg));
  }
}

function syncShadowControls(root: HTMLElement, value: string | undefined): void {
  const parsed = parseBoxShadowPreset(value ?? "none");
  const preset = root.querySelector<HTMLSelectElement>("[data-shadow-preset]");
  const intensity = root.querySelector<HTMLInputElement>("[data-shadow-intensity]");
  const readout = root.querySelector<HTMLSpanElement>("[data-shadow-intensity-readout]");
  if (preset) {
    preset.value = parsed.presetId;
  }
  if (intensity) {
    intensity.value = String(parsed.intensity);
  }
  if (readout) {
    readout.textContent = String(parsed.intensity);
  }
}

const CURVED_TOOLBAR_CSS = `
  :host, :host * {
    box-sizing: border-box;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
  }
  .otf-curved-toolbar {
    position: fixed;
    left: 0;
    top: 0;
    width: var(--toolbar-width, 440px);
    aspect-ratio: 520 / 420;
    --scale: 1;
    --x: 0px;
    --y: 0px;
    --rotation: -82deg;
    transform: translate(var(--x), var(--y)) rotate(var(--rotation));
    transform-origin: center center;
    cursor: grab;
    touch-action: none;
    user-select: none;
    pointer-events: none;
    z-index: 2;
    contain: layout style paint;
  }
  .otf-curved-toolbar:active { cursor: grabbing; }
  .otf-toolbar-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .otf-toolbar-path {
    fill: none;
    stroke: #f1eee4;
    stroke-width: 54;
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 12px 20px rgba(0,0,0,0.42)) drop-shadow(0 1px 0 rgba(255,255,255,0.35));
    pointer-events: stroke;
    cursor: grab;
  }
  .otf-tool-btn {
    position: absolute;
    width: calc(44px * var(--scale));
    height: calc(44px * var(--scale));
    border: 0;
    padding: 0;
    display: grid;
    place-items: center;
    background: transparent;
    color: #202020;
    cursor: pointer;
    pointer-events: auto;
    transform: translate(-50%, -50%) rotate(var(--angle));
  }
  .otf-tool-btn.selected, .otf-tool-btn:hover:not(:disabled) {
    background: rgba(0,0,0,0.08);
    border-radius: 999px;
  }
  .otf-tool-btn:disabled { opacity: 0.35; cursor: default; }
  .otf-tool-btn svg {
    width: calc(25px * var(--scale));
    height: calc(25px * var(--scale));
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .otf-divider {
    position: absolute;
    width: calc(1px * var(--scale));
    height: calc(42px * var(--scale));
    background: rgba(25,25,25,0.18);
    border-radius: 999px;
    transform: translate(-50%, -50%) rotate(var(--angle));
    pointer-events: none;
  }
  .otf-rotate-handle {
    position: absolute;
    left: 52%;
    top: 8%;
    width: calc(34px * var(--scale));
    height: calc(34px * var(--scale));
    border: calc(1px * var(--scale)) solid rgba(32,32,32,0.12);
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at top left, rgba(255,255,255,0.85), transparent 46%), #f1eee4;
    color: #202020;
    box-shadow: 0 calc(10px * var(--scale)) calc(22px * var(--scale)) rgba(0,0,0,0.26), inset 0 calc(1px * var(--scale)) 0 rgba(255,255,255,0.8);
    cursor: grab;
    pointer-events: auto;
    transform: translate(-50%, -50%) rotate(var(--counter-angle, 0deg));
    z-index: 10;
  }
  .otf-rotate-handle svg {
    width: calc(18px * var(--scale));
    height: calc(18px * var(--scale));
    stroke: currentColor;
    stroke-width: 2.3;
    fill: none;
  }
  .otf-lasso-chooser {
    position: fixed;
    z-index: 4;
    width: 168px;
    padding: 6px;
    border-radius: 12px;
    background: radial-gradient(circle at top left, rgba(255,255,255,0.88), transparent 45%), linear-gradient(145deg, #f6f1e6 0%, #e8dfcf 100%);
    border: 1px solid rgba(255,255,255,0.65);
    box-shadow: 0 16px 36px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.9);
    color: #202020;
    pointer-events: auto;
  }
  .otf-lasso-chooser[hidden] { display: none; }
  .otf-lasso-option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: 600 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .otf-lasso-option:hover { background: rgba(0,0,0,0.08); }
  .otf-lasso-option svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 1.8;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: none;
  }
  .otf-more-menu,
  .otf-component-palette {
    position: fixed;
    z-index: 4;
    padding: 6px;
    border-radius: 12px;
    background: radial-gradient(circle at top left, rgba(255,255,255,0.88), transparent 45%), linear-gradient(145deg, #f6f1e6 0%, #e8dfcf 100%);
    border: 1px solid rgba(255,255,255,0.65);
    box-shadow: 0 16px 36px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.9);
    color: #202020;
    pointer-events: auto;
  }
  .otf-more-menu { width: 220px; }
  .otf-component-palette { width: 320px; max-height: min(420px, calc(100vh - 24px)); overflow: auto; }
  .otf-more-menu[hidden],
  .otf-component-palette[hidden] { display: none; }
  .otf-more-option,
  .otf-palette-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: 600 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
    text-align: left;
  }
  .otf-more-option:hover,
  .otf-palette-item:hover { background: rgba(0,0,0,0.08); }
  .otf-palette-item svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    stroke-width: 1.8;
    fill: none;
    flex: none;
  }
  .otf-palette-title {
    padding: 8px 10px 4px;
    font: 700 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.62;
  }
  .otf-palette-sample {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 10px;
    font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  }
  .otf-palette-sample button {
    border: 1px solid rgba(32,32,32,0.12);
    background: rgba(255,255,255,0.55);
    border-radius: 999px;
    padding: 4px 8px;
    font: 600 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .otf-palette-sample button[aria-pressed="true"] { background: #202020; color: #f6f1e6; }
  .otf-style-panel {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 3;
    width: min(310px, calc(100vw - 24px));
    min-width: min(280px, calc(100vw - 24px));
    max-width: 310px;
    max-height: min(620px, calc(100vh - 28px));
    overflow-y: auto;
    padding: 12px;
    border-radius: 8px;
    background: radial-gradient(circle at top left, rgba(255,255,255,0.88), transparent 45%), linear-gradient(145deg, #f6f1e6 0%, #e8dfcf 100%);
    border: 1px solid rgba(255,255,255,0.65);
    box-shadow: 0 24px 55px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.9);
    color: #202020;
    transform: translate(var(--panel-x, 0px), var(--panel-y, 0px)) scale(0.97);
    transform-origin: top left;
    opacity: 0;
    pointer-events: none;
    transition: opacity 160ms ease, transform 160ms ease;
    contain: layout style;
  }
  .otf-style-panel.is-open {
    opacity: 1;
    pointer-events: auto;
    transform: translate(var(--panel-x, 0px), var(--panel-y, 0px)) scale(1);
  }
  .otf-style-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 1;
    margin: -12px -12px 8px;
    padding: 12px 12px 8px;
    background: linear-gradient(145deg, #f6f1e6 0%, #e8dfcf 100%);
    border-bottom: 1px solid rgba(32,32,32,0.12);
    cursor: grab;
  }
  .otf-style-panel-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 760;
    line-height: 1.2;
  }
  .otf-style-panel-title-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #202020;
    opacity: 0.8;
  }
  .otf-style-panel-close {
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 999px;
    background: rgba(0,0,0,0.075);
    color: #202020;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .otf-style-panel-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .otf-style-field {
    display: grid;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    color: rgba(32,32,32,0.62);
    min-width: 0;
  }
  .otf-style-field input[type="text"],
  .otf-style-field input[type="color"] {
    width: 100%;
    min-width: 0;
    height: 32px;
    border: 1px solid rgba(32,32,32,0.16);
    border-radius: 8px;
    background: linear-gradient(180deg, rgba(255,255,255,0.56), rgba(255,255,255,0.32));
    color: #202020;
    padding: 0 8px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
  }
  .otf-style-field input[type="color"] {
    padding: 3px;
  }
  .otf-opacity-field input[type="range"] {
    width: 100%;
    min-width: 0;
    accent-color: #202020;
  }
  .otf-opacity-field strong {
    font: inherit;
    color: #202020;
  }
  .otf-style-section {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(32,32,32,0.12);
  }
  .otf-style-section-label {
    font-size: 11px;
    font-weight: 760;
    color: rgba(32,32,32,0.62);
    margin-bottom: 6px;
  }
  .otf-gradient-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .otf-gradient-chip {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1px solid rgba(32,32,32,0.16);
    cursor: pointer;
    padding: 0;
  }
  .otf-gradient-grid,
  .otf-shadow-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .otf-gradient-angle-field,
  .otf-shadow-intensity-field {
    grid-column: 1 / -1;
  }
  .otf-style-field select {
    width: 100%;
    min-width: 0;
    height: 32px;
    border: 1px solid rgba(32,32,32,0.16);
    border-radius: 8px;
    background: linear-gradient(180deg, rgba(255,255,255,0.56), rgba(255,255,255,0.32));
    color: #202020;
    padding: 0 8px;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
  }
  .otf-shadow-intensity-field input[type="range"] {
    width: 100%;
    accent-color: #202020;
  }
  .otf-style-panel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid rgba(32,32,32,0.12);
  }
  .otf-style-panel-actions button {
    height: 32px;
    min-width: 64px;
    border: 1px solid rgba(32,32,32,0.14);
    border-radius: 8px;
    padding: 0 10px;
    background: rgba(255,255,255,0.48);
    color: #202020;
    font: 700 12px/1 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
  }
  .otf-style-panel-actions button[data-style-apply] {
    background: #202020;
    color: #ffffff;
  }
  .otf-text-editor {
    position: fixed;
    pointer-events: auto;
    z-index: 4;
  }
  .otf-text-editor-input {
    width: 100%;
    min-height: inherit;
    box-sizing: border-box;
    border: 2px solid #2563eb;
    border-radius: 6px;
    padding: 6px 8px;
    font: inherit;
    color: inherit;
    background: #ffffff;
    resize: vertical;
  }
`;
