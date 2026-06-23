import type { AgentPreviewState } from "./agent-preview-controller.js";

export interface AgentPanelCallbacks {
  onSubmit: (instruction: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRefine: (instruction: string) => void;
  onClose: () => void;
}

export interface AgentPanelOptions {
  shadowRoot: ShadowRoot;
  callbacks: AgentPanelCallbacks;
  isAvailable: () => boolean;
}

export class AgentPanel {
  private static readonly OPEN_CLASS = "is-open";

  private readonly shadowRoot: ShadowRoot;
  private readonly callbacks: AgentPanelCallbacks;
  private readonly isAvailable: () => boolean;
  private panelEl: HTMLElement | null = null;
  private instructionInput: HTMLTextAreaElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private warningsEl: HTMLElement | null = null;
  private criticWarningsEl: HTMLElement | null = null;
  private errorsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private opened = false;
  private dragState: { pointerId: number; offsetX: number; offsetY: number } | null = null;

  constructor(options: AgentPanelOptions) {
    this.shadowRoot = options.shadowRoot;
    this.callbacks = options.callbacks;
    this.isAvailable = options.isAvailable;
  }

  mount(): void {
    if (this.panelEl) {
      return;
    }

    this.panelEl = document.createElement("aside");
    this.panelEl.className = "otf-agent-panel";
    this.panelEl.setAttribute("data-otf-ui", "agent-panel");
    this.panelEl.hidden = true;
    this.panelEl.innerHTML = createAgentPanelMarkup();
    this.shadowRoot.append(this.panelEl);
    this.syncVisibility();

    this.instructionInput = this.panelEl.querySelector("[data-agent-instruction]");
    this.summaryEl = this.panelEl.querySelector("[data-agent-summary]");
    this.warningsEl = this.panelEl.querySelector("[data-agent-warnings]");
    this.criticWarningsEl = this.panelEl.querySelector("[data-agent-critic-warnings]");
    this.errorsEl = this.panelEl.querySelector("[data-agent-errors]");
    this.statusEl = this.panelEl.querySelector("[data-agent-status]");
    this.wireInteractions();
    this.ensureStyles();
  }

  unmount(): void {
    this.close();
    this.panelEl?.remove();
    this.panelEl = null;
    this.instructionInput = null;
    this.summaryEl = null;
    this.warningsEl = null;
    this.criticWarningsEl = null;
    this.errorsEl = null;
    this.statusEl = null;
    this.opened = false;
    this.dragState = null;
  }

  open(anchor: { x: number; y: number }): void {
    if (!this.panelEl || !this.isAvailable()) {
      return;
    }

    this.opened = true;
    this.syncVisibility();
    this.panelEl.style.left = `${String(Math.max(16, anchor.x))}px`;
    this.panelEl.style.top = `${String(Math.max(16, anchor.y))}px`;
    this.renderAvailability();
    this.instructionInput?.focus();
  }

  openAt(anchor: { x: number; y: number }): void {
    this.open(anchor);
  }

  close(): void {
    if (!this.panelEl) {
      this.opened = false;
      return;
    }

    this.opened = false;
    this.syncVisibility();
    this.clearTransientState();
  }

  isOpen(): boolean {
    return this.opened;
  }

  getInstruction(): string {
    return this.instructionInput?.value.trim() ?? "";
  }

  setInstruction(value: string): void {
    if (this.instructionInput) {
      this.instructionInput.value = value;
    }
  }

  renderState(state: AgentPreviewState): void {
    if (!this.panelEl) {
      return;
    }

    this.renderAvailability();
    if (this.statusEl) {
      const message = resolveAgentStatusMessage(state);
      this.statusEl.textContent = message;
      this.statusEl.hidden = message.length === 0;
    }

    renderList(this.summaryEl, "Summary", state.summary);
    renderList(this.warningsEl, "Warnings", state.warnings);
    renderList(this.criticWarningsEl, "Preview checks", state.criticWarnings);
    renderList(this.errorsEl, "Validation", state.validationErrors);

    const approveButton = this.panelEl.querySelector<HTMLButtonElement>("[data-agent-approve]");
    const rejectButton = this.panelEl.querySelector<HTMLButtonElement>("[data-agent-reject]");
    const refineButton = this.panelEl.querySelector<HTMLButtonElement>("[data-agent-refine]");
    const generateButton = this.panelEl.querySelector<HTMLButtonElement>("[data-agent-generate]");

    const hasPreview = state.status === "preview";
    if (approveButton) {
      approveButton.disabled = !hasPreview || state.status === "loading";
    }
    if (rejectButton) {
      rejectButton.disabled = !hasPreview || state.status === "loading";
    }
    if (refineButton) {
      refineButton.disabled = state.status === "loading" || !this.isAvailable();
    }
    if (generateButton) {
      generateButton.disabled = state.status === "loading" || !this.isAvailable();
    }
  }

  private renderAvailability(): void {
    const unavailable = this.panelEl?.querySelector<HTMLElement>("[data-agent-unavailable]");
    if (unavailable) {
      unavailable.hidden = this.isAvailable();
    }
  }

  private syncVisibility(): void {
    if (!this.panelEl) {
      return;
    }

    this.panelEl.hidden = !this.opened;
    this.panelEl.classList.toggle(AgentPanel.OPEN_CLASS, this.opened);
  }

  private clearTransientState(): void {
    this.setInstruction("");
    this.dragState = null;
    if (this.statusEl) {
      this.statusEl.textContent = "";
      this.statusEl.hidden = true;
    }
    renderList(this.summaryEl, "Summary", []);
    renderList(this.warningsEl, "Warnings", []);
    renderList(this.criticWarningsEl, "Preview checks", []);
    renderList(this.errorsEl, "Validation", []);
  }

  private wireInteractions(): void {
    if (!this.panelEl) {
      return;
    }

    this.panelEl.querySelector("[data-agent-close]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      this.callbacks.onClose();
    });

    this.panelEl.querySelector("[data-agent-generate]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onSubmit(this.getInstruction());
    });

    this.panelEl.querySelector("[data-agent-refine]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onRefine(this.getInstruction());
    });

    this.panelEl.querySelector("[data-agent-approve]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onApprove();
    });

    this.panelEl.querySelector("[data-agent-reject]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      this.callbacks.onReject();
    });

    for (const input of Array.from(this.panelEl.querySelectorAll("input, textarea, select, button"))) {
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
      });
    }

    const header = this.panelEl.querySelector<HTMLElement>("[data-agent-drag-handle]");
    header?.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element) || event.target.closest("button")) {
        return;
      }
      if (!this.panelEl) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rect = this.panelEl.getBoundingClientRect();
      this.dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      header.setPointerCapture(event.pointerId);
    });

    header?.addEventListener("pointermove", (event) => {
      if (!this.dragState || this.dragState.pointerId !== event.pointerId || !this.panelEl) {
        return;
      }
      event.preventDefault();
      const x = Math.max(16, event.clientX - this.dragState.offsetX);
      const y = Math.max(16, event.clientY - this.dragState.offsetY);
      this.panelEl.style.left = `${String(x)}px`;
      this.panelEl.style.top = `${String(y)}px`;
    });

    const endDrag = (event: PointerEvent): void => {
      if (!this.dragState || this.dragState.pointerId !== event.pointerId) {
        return;
      }
      this.dragState = null;
      header?.releasePointerCapture(event.pointerId);
    };
    header?.addEventListener("pointerup", endDrag);
    header?.addEventListener("pointercancel", endDrag);
  }

  private ensureStyles(): void {
    if (this.shadowRoot.querySelector('[data-otf-ui="agent-panel-styles"]')) {
      return;
    }

    const style = document.createElement("style");
    style.setAttribute("data-otf-ui", "agent-panel-styles");
    style.textContent = `
      .otf-agent-panel {
        --agent-height: clamp(390px, 62vh, 462px);
        --agent-width-ratio: 0.65;
        --agent-padding: clamp(14px, 2.4vh, 18px);
        position: fixed;
        width: min(
          calc(var(--agent-height) * var(--agent-width-ratio)),
          calc(100vw - 28px)
        );
        height: min(var(--agent-height), calc(100vh - 28px));
        padding: var(--agent-padding);
        display: none;
        pointer-events: auto;
        z-index: 2147483646;
        isolation: isolate;
        overflow: hidden;
        background:
          linear-gradient(
            145deg,
            rgba(255, 255, 255, 0.82),
            rgba(229, 238, 248, 0.42) 52%,
            rgba(255, 255, 255, 0.62)
          );
        backdrop-filter: blur(20px) saturate(145%);
        -webkit-backdrop-filter: blur(20px) saturate(145%);
        border: 1px solid rgba(255, 255, 255, 0.78);
        border-radius: clamp(18px, 4.8vw, 22px);
        box-shadow:
          0 14px 30px rgba(41, 57, 78, 0.12),
          0 5px 12px rgba(41, 57, 78, 0.06),
          inset 0 1px 1px rgba(255, 255, 255, 0.92),
          inset 0 -12px 20px rgba(120, 155, 190, 0.07);
        color: #253243;
        font: 600 clamp(12px, 2.1vh, 14px)/1.35 Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .otf-agent-panel[hidden],
      .otf-agent-panel:not(.is-open) {
        display: none !important;
      }
      .otf-agent-panel.is-open {
        display: flex;
        flex-direction: column;
        animation: otf-agent-float-in 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .otf-agent-panel::before {
        content: "";
        position: absolute;
        inset: 5px;
        border-radius: calc(clamp(18px, 4.8vw, 22px) - 5px);
        pointer-events: none;
        border: 1px solid rgba(255, 255, 255, 0.52);
        box-shadow:
          inset 0 8px 14px rgba(255, 255, 255, 0.18),
          inset 0 -8px 14px rgba(113, 151, 189, 0.05);
        z-index: -1;
      }
      .otf-agent-panel::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background:
          radial-gradient(circle at 14% 10%, rgba(255, 255, 255, 0.42), transparent 20%),
          radial-gradient(circle at 92% 66%, rgba(185, 220, 255, 0.16), transparent 14%),
          linear-gradient(120deg, transparent 0 25%, rgba(255, 255, 255, 0.14) 29%, transparent 34%);
        opacity: 0.52;
        mix-blend-mode: screen;
        z-index: -1;
      }
      .otf-agent-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: clamp(16px, 3vh, 22px);
        flex-shrink: 0;
        cursor: grab;
        position: relative;
        z-index: 1;
      }
      .otf-agent-panel-header:active {
        cursor: grabbing;
      }
      .otf-agent-panel-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: clamp(14px, 2.7vh, 16px);
        font-weight: 800;
        letter-spacing: -0.03em;
        color: #1f2937;
      }
      .otf-agent-panel-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background:
          radial-gradient(circle at 35% 28%, #7df4a4 0 16%, #22c55e 42%, #149447 100%);
        box-shadow:
          0 0 0 6px rgba(34, 197, 94, 0.10),
          0 0 10px rgba(34, 197, 94, 0.24),
          inset 0 1px 1px rgba(255, 255, 255, 0.75);
      }
      .otf-agent-panel-close {
        width: clamp(30px, 5vh, 34px);
        height: clamp(30px, 5vh, 34px);
        border: 1px solid rgba(255, 255, 255, 0.58);
        border-radius: 999px;
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.44), rgba(220, 233, 246, 0.14));
        color: #475569;
        display: grid;
        place-items: center;
        cursor: pointer;
        box-shadow:
          0 4px 10px rgba(55, 72, 92, 0.05),
          inset 0 1px 1px rgba(255, 255, 255, 0.88);
      }
      .otf-agent-panel-close span {
        width: 14px;
        height: 14px;
        position: relative;
        display: block;
      }
      .otf-agent-panel-close span::before,
      .otf-agent-panel-close span::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 16px;
        height: 2px;
        border-radius: 999px;
        background: currentColor;
      }
      .otf-agent-panel-close span::before {
        transform: translate(-50%, -50%) rotate(45deg);
      }
      .otf-agent-panel-close span::after {
        transform: translate(-50%, -50%) rotate(-45deg);
      }
      .otf-agent-panel-intro {
        margin-bottom: clamp(11px, 2vh, 14px);
        font-size: clamp(12px, 2.1vh, 12.5px);
        line-height: 1.35;
        font-weight: 700;
        color: #253243;
        flex-shrink: 0;
        position: relative;
        z-index: 1;
      }
      .otf-agent-unavailable {
        position: relative;
        z-index: 1;
        margin-bottom: clamp(8px, 1.5vh, 10px);
        color: #92400e;
        font-size: clamp(11px, 1.9vh, 12px);
        flex-shrink: 0;
      }
      .otf-agent-feedback {
        position: relative;
        z-index: 1;
        flex-shrink: 0;
        display: grid;
        gap: 6px;
        margin-bottom: clamp(8px, 1.5vh, 10px);
        max-height: 28%;
        overflow: auto;
      }
      .otf-agent-panel-status,
      .otf-agent-panel-section {
        color: #374151;
        font-size: clamp(11px, 1.9vh, 12px);
        font-weight: 500;
      }
      .otf-agent-panel-section ul {
        margin: 4px 0 0;
        padding-left: 16px;
      }
      .otf-agent-panel-section[data-agent-critic-warnings] {
        color: #92400e;
      }
      .otf-agent-textarea-wrap {
        position: relative;
        flex: 1;
        min-height: 0;
        margin-bottom: clamp(11px, 2vh, 14px);
        padding: 1px;
        border-radius: clamp(14px, 3.4vw, 17px);
        background:
          linear-gradient(
            145deg,
            rgba(255, 255, 255, 0.90),
            rgba(182, 208, 233, 0.20) 46%,
            rgba(255, 255, 255, 0.72)
          );
        box-shadow:
          0 7px 14px rgba(58, 83, 110, 0.05),
          inset 0 1px 1px rgba(255, 255, 255, 0.84);
        z-index: 1;
      }
      .otf-agent-textarea-wrap::before {
        content: "";
        position: absolute;
        inset: 4px;
        border-radius: calc(clamp(14px, 3.4vw, 17px) - 4px);
        pointer-events: none;
        border: 1px solid rgba(255, 255, 255, 0.36);
      }
      .otf-agent-panel textarea {
        width: 100%;
        height: 100%;
        display: block;
        resize: none;
        outline: none;
        border: 0;
        border-radius: clamp(13px, 3.2vw, 16px);
        padding: clamp(12px, 2.5vh, 15px);
        box-sizing: border-box;
        font: inherit;
        font-size: clamp(12px, 2.15vh, 13px);
        line-height: 1.35;
        color: #1f2937;
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.22), rgba(217, 232, 247, 0.15)),
          rgba(238, 246, 255, 0.17);
        backdrop-filter: blur(14px) saturate(132%);
        -webkit-backdrop-filter: blur(14px) saturate(132%);
      }
      .otf-agent-panel textarea::placeholder {
        color: rgba(79, 91, 106, 0.56);
        font-style: italic;
      }
      .otf-agent-panel-actions {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: clamp(8px, 1.8vh, 10px);
        flex-shrink: 0;
      }
      .otf-agent-glass-btn {
        min-height: clamp(40px, 6.2vh, 42px);
        position: relative;
        border: 1px solid rgba(255, 255, 255, 0.54);
        border-radius: 999px;
        padding: 10px;
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.38), rgba(225, 238, 250, 0.12)),
          rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(13px) saturate(132%);
        -webkit-backdrop-filter: blur(13px) saturate(132%);
        color: #253243;
        font: inherit;
        font-size: clamp(11px, 2vh, 12px);
        font-weight: 600;
        letter-spacing: -0.01em;
        cursor: pointer;
        box-shadow:
          0 4px 10px rgba(55, 72, 92, 0.05),
          inset 0 1px 1px rgba(255, 255, 255, 0.82);
      }
      .otf-agent-glass-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        border-color: rgba(255, 255, 255, 0.92);
      }
      .otf-agent-glass-btn[disabled] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .otf-agent-glass-btn[data-agent-approve] {
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.48), rgba(255, 224, 190, 0.16)),
          rgba(255, 245, 234, 0.14);
        border-color: rgba(255, 245, 222, 0.70);
        box-shadow:
          0 7px 14px rgba(236, 161, 91, 0.07),
          0 0 14px rgba(255, 194, 122, 0.08),
          inset 0 1px 1px rgba(255, 255, 255, 0.88);
      }
      .otf-agent-glass-btn[data-agent-approve]::after {
        content: "";
        position: absolute;
        inset: -7px -9px;
        border-radius: 999px;
        background:
          radial-gradient(circle at 34% 50%, rgba(255, 211, 139, 0.22), transparent 44%);
        filter: blur(10px);
        z-index: -1;
        pointer-events: none;
      }
      @keyframes otf-agent-float-in {
        from { opacity: 0; transform: translateY(12px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;
    this.shadowRoot.append(style);
  }
}

function createAgentPanelMarkup(): string {
  return `
    <div class="otf-agent-panel-header" data-agent-drag-handle>
      <div class="otf-agent-panel-title">
        <span class="otf-agent-panel-dot"></span>
        <span>AI Agent</span>
      </div>
      <button type="button" class="otf-agent-panel-close" data-agent-close aria-label="Close agent panel">
        <span></span>
      </button>
    </div>
    <div class="otf-agent-panel-intro">Give a design prompt!</div>
    <div class="otf-agent-unavailable" data-agent-unavailable hidden>
      Local agent is disabled in public builds.
    </div>
    <div class="otf-agent-feedback">
      <div class="otf-agent-panel-status" data-agent-status hidden></div>
      <div class="otf-agent-panel-section" data-agent-summary hidden></div>
      <div class="otf-agent-panel-section" data-agent-warnings hidden></div>
      <div class="otf-agent-panel-section" data-agent-critic-warnings hidden></div>
      <div class="otf-agent-panel-section" data-agent-errors hidden></div>
    </div>
    <div class="otf-agent-textarea-wrap">
      <textarea data-agent-instruction placeholder="Ask agent..."></textarea>
    </div>
    <div class="otf-agent-panel-actions">
      <button type="button" class="otf-agent-glass-btn" data-agent-generate>Generate preview</button>
      <button type="button" class="otf-agent-glass-btn" data-agent-refine>Refine</button>
      <button type="button" class="otf-agent-glass-btn" data-agent-approve>Approve</button>
      <button type="button" class="otf-agent-glass-btn" data-agent-reject>Reject</button>
    </div>
  `;
}

function renderList(element: HTMLElement | null, label: string, items: string[]): void {
  if (!element) {
    return;
  }

  if (items.length === 0) {
    element.hidden = true;
    element.textContent = "";
    return;
  }

  element.hidden = false;
  element.innerHTML = `<strong>${label}</strong><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resolveAgentStatusMessage(state: AgentPreviewState): string {
  if (state.status === "loading") {
    return "Generating preview...";
  }

  if (state.status === "preview") {
    if (state.criticWarnings.length > 0) {
      return "Preview ready with warnings. Review checks, then approve or reject.";
    }
    return "Preview ready. Approve to save or reject to revert.";
  }

  if (state.status === "error") {
    switch (state.failureCode) {
      case "critic_failed":
        return "Preview blocked for safety. No changes were applied.";
      case "manual_tool_recommended":
        return "Use the manual toolbar for this edit.";
      case "validation_failed":
        return "Preview validation failed. No changes were applied.";
      case "timeout":
        return "Agent request timed out. No changes were applied.";
      case "generation_failed":
        return "Agent generation failed. No changes were applied.";
      case "agent_unavailable":
        return "Local agent is unavailable.";
      case "network_error":
        return "Could not reach the local agent server.";
      case "agent_disabled":
        return "Local agent is disabled in this build.";
      default:
        return "Preview failed. No changes were applied.";
    }
  }

  return "";
}
