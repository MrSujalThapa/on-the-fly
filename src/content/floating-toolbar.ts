import type { StyleProperty } from "../editor/operations.js";
import type { VisualNodeRect } from "../editor/visual-node.js";
import type { ResolvedCommand } from "../editor/commands/command-registry.js";

export interface ToolbarButtonView {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  active?: boolean;
}

export interface StylePanelValues {
  backgroundColor: string;
  color: string;
  fontSize: string;
  fontWeight: string;
  borderRadius: string;
  opacity: string;
}

export interface FloatingToolbarCallbacks {
  onCommand: (commandId: string) => void;
  onStyleChange: (property: StyleProperty, value: string) => void;
  onTextCommit: (value: string) => void;
  onTextCancel: () => void;
}

export interface FloatingToolbarOptions {
  shadowRoot: ShadowRoot;
  callbacks: FloatingToolbarCallbacks;
}

const ICONS: Record<string, string> = {
  "eye-off":
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5c-4.5 0-8.2 2.6-10 6.5 1.8 3.9 5.5 6.5 10 6.5s8.2-2.6 10-6.5C20.2 7.6 16.5 5 12 5Zm0 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>',
  "layer-up":
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4 3 10l1.5 1.2L12 6.8l7.5 4.4L21 10 12 4Zm0 6-7.5 4.5L12 17l7.5-2.5L12 10Z"/></svg>',
  "layer-down":
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 20 21 14l-1.5-1.2L12 17.2 4.5 12.8 3 14l9 6Zm0-6 7.5-4.5L12 7 4.5 9.5 12 14Z"/></svg>',
  crop:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 17V7H17v2h-6v8H7Zm10-2V7h2v10h-8v-2h6Z"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 0 0-1 17.9V19a2 2 0 0 0 2-2v-.5c3.1-.4 5.5-3 5.5-6.2C18.5 6.5 15.6 3 12 3Zm-3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-3.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 3.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>',
  text:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5v3h5v11h3V8h5V5H5Z"/></svg>',
  undo:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 7h8a5 5 0 0 1 0 10H9v-2h6a3 3 0 1 0 0-6H9l3 3-2 2-5-5 5-5 2 2-3 3Z"/></svg>',
  redo:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 7H9a5 5 0 0 0 0 10h6v-2H9a3 3 0 1 1 0-6h6l-3-3 2-2 5 5-5 5-2-2 3-3Z"/></svg>',
};

export class FloatingToolbar {
  private readonly shadowRoot: ShadowRoot;
  private readonly callbacks: FloatingToolbarCallbacks;
  private toolbarEl: HTMLElement | null = null;
  private stylePanelEl: HTMLElement | null = null;
  private textEditorEl: HTMLElement | null = null;
  private styleOpen = false;
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

    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "otf-toolbar";
    this.toolbarEl.setAttribute("role", "toolbar");
    this.toolbarEl.hidden = true;

    this.stylePanelEl = document.createElement("div");
    this.stylePanelEl.className = "otf-style-panel";
    this.stylePanelEl.hidden = true;
    this.stylePanelEl.innerHTML = createStylePanelMarkup();

    this.textEditorEl = document.createElement("div");
    this.textEditorEl.className = "otf-text-editor";
    this.textEditorEl.hidden = true;

    this.shadowRoot.append(this.toolbarEl, this.stylePanelEl, this.textEditorEl);
    this.wireStylePanel();
  }

  unmount(): void {
    this.toolbarEl?.remove();
    this.stylePanelEl?.remove();
    this.textEditorEl?.remove();
    this.toolbarEl = null;
    this.stylePanelEl = null;
    this.textEditorEl = null;
    this.styleOpen = false;
    this.lastAnchor = null;
  }

  renderCommands(
    commands: ResolvedCommand[],
    anchorRect: VisualNodeRect | null,
    activeStates: Record<string, boolean> = {},
  ): void {
    if (!this.toolbarEl) {
      return;
    }

    if (!anchorRect || commands.length === 0) {
      this.hide();
      return;
    }

    this.lastAnchor = anchorRect;
    this.toolbarEl.replaceChildren();
    for (const entry of commands) {
      const button = createToolbarButton(
        entry.command.id,
        entry.command.label,
        entry.command.icon,
        entry.enabled,
        activeStates[entry.command.id] === true,
      );
      this.toolbarEl.appendChild(button);
    }

    this.wireToolbarButtons();
    this.positionNearRect(this.toolbarEl, anchorRect);
    this.toolbarEl.hidden = false;

    if (this.styleOpen && this.stylePanelEl) {
      this.stylePanelEl.hidden = false;
      this.positionNearRect(this.stylePanelEl, anchorRect, 48);
    }
  }

  hide(): void {
    if (this.toolbarEl) {
      this.toolbarEl.hidden = true;
      this.toolbarEl.replaceChildren();
    }
    this.closeStylePanel();
    this.closeTextEditor();
    this.lastAnchor = null;
  }

  toggleStylePanel(open: boolean, values?: Partial<StylePanelValues>): void {
    if (!this.stylePanelEl) {
      return;
    }

    this.styleOpen = open;
    this.stylePanelEl.hidden = !open;

    if (open && values) {
      this.setStylePanelValues(values);
    }

    if (open && this.lastAnchor) {
      this.positionNearRect(this.stylePanelEl, this.lastAnchor, 48);
    }
  }

  closeStylePanel(): void {
    this.styleOpen = false;
    if (this.stylePanelEl) {
      this.stylePanelEl.hidden = true;
    }
  }

  isStylePanelOpen(): boolean {
    return this.styleOpen;
  }

  setStylePanelValues(values: Partial<StylePanelValues>): void {
    if (!this.stylePanelEl) {
      return;
    }

    const set = (name: string, value: string | undefined): void => {
      if (value === undefined) {
        return;
      }
      const input = this.stylePanelEl?.querySelector<HTMLInputElement>(`[data-style-field="${name}"]`);
      if (input) {
        input.value = value;
      }
    };

    set("backgroundColor", values.backgroundColor);
    set("color", values.color);
    set("fontSize", values.fontSize);
    set("fontWeight", values.fontWeight);
    set("borderRadius", values.borderRadius);
    set("opacity", values.opacity);
  }

  openTextEditor(rect: VisualNodeRect, initialText: string): void {
    if (!this.textEditorEl) {
      return;
    }

    this.textEditorEl.replaceChildren();
    const textarea = document.createElement("textarea");
    textarea.className = "otf-text-editor-input";
    textarea.value = initialText;
    textarea.setAttribute("aria-label", "Edit text");
    this.textEditorEl.appendChild(textarea);

    this.textEditorEl.style.left = `${String(rect.x)}px`;
    this.textEditorEl.style.top = `${String(rect.y)}px`;
    this.textEditorEl.style.width = `${String(Math.max(rect.width, 120))}px`;
    this.textEditorEl.style.minHeight = `${String(Math.max(rect.height, 32))}px`;
    this.textEditorEl.hidden = false;

    textarea.focus();
    textarea.select();

    const commit = (): void => {
      this.callbacks.onTextCommit(textarea.value);
      this.closeTextEditor();
    };

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.callbacks.onTextCancel();
        this.closeTextEditor();
      }
    });

    textarea.addEventListener("blur", () => {
      commit();
    });
  }

  closeTextEditor(): void {
    if (this.textEditorEl) {
      this.textEditorEl.hidden = true;
      this.textEditorEl.replaceChildren();
    }
  }

  private wireToolbarButtons(): void {
    if (!this.toolbarEl) {
      return;
    }

    for (const button of Array.from(this.toolbarEl.querySelectorAll<HTMLButtonElement>("[data-command-id]"))) {
      button.onclick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) {
          return;
        }
        const id = button.getAttribute("data-command-id");
        if (id) {
          this.callbacks.onCommand(id);
        }
      };
    }
  }

  private wireStylePanel(): void {
    if (!this.stylePanelEl) {
      return;
    }

    const bindings: Array<{ field: string; property: StyleProperty; transform?: (v: string) => string }> = [
      { field: "backgroundColor", property: "backgroundColor" },
      { field: "color", property: "color" },
      { field: "fontSize", property: "fontSize", transform: (v) => (/^\d+$/.test(v) ? `${v}px` : v) },
      { field: "fontWeight", property: "fontWeight" },
      { field: "borderRadius", property: "borderRadius", transform: (v) => (/^\d+$/.test(v) ? `${v}px` : v) },
      { field: "opacity", property: "opacity" },
    ];

    for (const binding of bindings) {
      const input = this.stylePanelEl.querySelector<HTMLInputElement>(
        `[data-style-field="${binding.field}"]`,
      );
      if (!input) {
        continue;
      }

      input.addEventListener("change", () => {
        const raw = input.value.trim();
        if (!raw) {
          return;
        }
        const value = binding.transform ? binding.transform(raw) : raw;
        this.callbacks.onStyleChange(binding.property, value);
      });
    }
  }

  private positionNearRect(element: HTMLElement, rect: VisualNodeRect, offsetY = 0): void {
    const margin = 8;
    const toolbarHeight = 40;
    let top = rect.y - toolbarHeight - margin + offsetY;
    if (top < margin) {
      top = rect.y + rect.height + margin + offsetY;
    }

    element.style.left = `${String(Math.max(margin, rect.x))}px`;
    element.style.top = `${String(top)}px`;
  }

  private ensureStyles(): void {
    if (this.shadowRoot.querySelector(".otf-toolbar-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.className = "otf-toolbar-styles";
    style.textContent = `
      .otf-toolbar {
        position: fixed;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border-radius: 999px;
        background: rgba(17, 24, 39, 0.94);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        pointer-events: auto;
        z-index: 2;
      }

      .otf-toolbar-btn {
        all: unset;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 999px;
        color: #f9fafb;
        cursor: pointer;
      }

      .otf-toolbar-btn svg {
        width: 16px;
        height: 16px;
      }

      .otf-toolbar-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.12);
      }

      .otf-toolbar-btn:disabled {
        opacity: 0.35;
        cursor: default;
      }

      .otf-toolbar-btn-active {
        background: rgba(37, 99, 235, 0.45);
      }

      .otf-style-panel {
        position: fixed;
        display: grid;
        grid-template-columns: repeat(2, minmax(120px, 1fr));
        gap: 8px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(17, 24, 39, 0.96);
        color: #f9fafb;
        font: 12px/1.3 system-ui, -apple-system, sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        pointer-events: auto;
        z-index: 2;
      }

      .otf-style-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .otf-style-field label {
        font-size: 11px;
        opacity: 0.8;
      }

      .otf-style-field input {
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        padding: 4px 6px;
        font: inherit;
      }

      .otf-text-editor {
        position: fixed;
        pointer-events: auto;
        z-index: 3;
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
    this.shadowRoot.appendChild(style);
  }
}

function createToolbarButton(
  id: string,
  label: string,
  icon: string,
  enabled: boolean,
  active: boolean,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "otf-toolbar-btn";
  button.setAttribute("data-command-id", id);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.disabled = !enabled;
  if (active) {
    button.classList.add("otf-toolbar-btn-active");
  }
  button.innerHTML = ICONS[icon] ?? `<span>${icon}</span>`;
  return button;
}

function createStylePanelMarkup(): string {
  return `
    <div class="otf-style-field"><label>Background</label><input type="color" data-style-field="backgroundColor" /></div>
    <div class="otf-style-field"><label>Text color</label><input type="color" data-style-field="color" /></div>
    <div class="otf-style-field"><label>Font size</label><input type="text" data-style-field="fontSize" placeholder="16px" /></div>
    <div class="otf-style-field"><label>Font weight</label><input type="text" data-style-field="fontWeight" placeholder="400" /></div>
    <div class="otf-style-field"><label>Radius</label><input type="text" data-style-field="borderRadius" placeholder="8px" /></div>
    <div class="otf-style-field"><label>Opacity</label><input type="text" data-style-field="opacity" placeholder="1" /></div>
  `;
}
