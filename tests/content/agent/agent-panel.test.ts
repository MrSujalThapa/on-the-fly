import { beforeEach, describe, expect, it } from "vitest";
import { AgentPanel } from "../../../src/content/agent/agent-panel.js";
import type { AgentPreviewState } from "../../../src/content/agent/agent-preview-controller.js";

describe("AgentPanel status messages", () => {
  let host: HTMLElement;
  let shadow: ShadowRoot;
  let panel: AgentPanel;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    shadow = host.attachShadow({ mode: "open" });
    panel = new AgentPanel({
      shadowRoot: shadow,
      callbacks: {
        onSubmit: () => undefined,
        onApprove: () => undefined,
        onReject: () => undefined,
        onRefine: () => undefined,
        onCancel: () => undefined,
        onClose: () => undefined,
      },
      isAvailable: () => true,
    });
    panel.mount();
  });

  it("shows manual toolbar guidance for manual_tool_recommended failures", () => {
    const state: AgentPreviewState = {
      status: "error",
      failureCode: "manual_tool_recommended",
      summary: ["Use the style toolbar to change text color."],
      warnings: [],
      criticWarnings: [],
      validationErrors: ["Use the style toolbar to change text color."],
      lastInstruction: "make text red",
    };

    panel.renderState(state);
    const status = shadow.querySelector("[data-agent-status]");
    expect(status?.textContent).toContain("manual toolbar");
  });

  it("shows critic warnings and keeps approve enabled for preview warnings", () => {
    const state: AgentPreviewState = {
      status: "preview",
      summary: ["Added background panel."],
      warnings: [],
      criticWarnings: ["Helper object z-index is unusually high."],
      validationErrors: [],
      lastInstruction: "Add soft elevation",
    };

    panel.renderState(state);
    expect(shadow.querySelector("[data-agent-critic-warnings]")?.textContent).toContain(
      "Preview checks",
    );
    expect(shadow.querySelector("[data-agent-status]")?.textContent).toContain("warnings");
    expect(
      shadow.querySelector<HTMLButtonElement>("[data-agent-approve]")?.disabled,
    ).toBe(false);
  });

  it("shows blocked preview messaging for critic hard failures", () => {
    const state: AgentPreviewState = {
      status: "error",
      failureCode: "critic_failed",
      summary: ["Added background panel."],
      warnings: [],
      criticWarnings: [],
      validationErrors: ["Helper object is mostly offscreen and would damage layout."],
      lastInstruction: "Add broken panel",
    };

    panel.renderState(state);
    expect(shadow.querySelector("[data-agent-status]")?.textContent).toContain(
      "blocked for safety",
    );
  });

  it("renders the liquid glass agent title", () => {
    panel.open({ x: 20, y: 20 });
    expect(shadow.querySelector(".otf-agent-panel-title")?.textContent).toContain("AI Agent");
    expect(shadow.querySelector(".otf-agent-panel-dot")).not.toBeNull();
  });

  it("matches the updated design intro and hides idle status text", () => {
    panel.open({ x: 20, y: 20 });
    panel.renderState({
      status: "idle",
      summary: [],
      warnings: [],
      criticWarnings: [],
      validationErrors: [],
      lastInstruction: "",
    });

    expect(shadow.querySelector(".otf-agent-panel-intro")?.textContent).toBe("Give a design prompt!");
    expect(shadow.querySelector(".otf-agent-textarea-wrap")).not.toBeNull();
    expect(shadow.querySelector(".otf-agent-panel-actions")?.children).toHaveLength(5);
    expect(shadow.querySelector(".otf-agent-feedback")).not.toBeNull();
    expect((shadow.querySelector("[data-agent-status]") as HTMLElement).hidden).toBe(true);
    expect(shadow.querySelector(".otf-agent-panel-actions")?.nextElementSibling).toBeNull();
  });

  it("is hidden by default after mount", () => {
    const panelEl = shadow.querySelector(".otf-agent-panel") as HTMLElement;
    expect(panelEl).not.toBeNull();
    expect(panelEl.hidden).toBe(true);
    expect(panel.isOpen()).toBe(false);
  });

  it("opens and closes explicitly", () => {
    panel.open({ x: 20, y: 20 });
    expect(panel.isOpen()).toBe(true);
    expect((shadow.querySelector(".otf-agent-panel") as HTMLElement).hidden).toBe(false);
    expect(shadow.querySelector(".otf-agent-panel")?.classList.contains("is-open")).toBe(true);

    panel.close();
    expect(panel.isOpen()).toBe(false);
    expect((shadow.querySelector(".otf-agent-panel") as HTMLElement).hidden).toBe(true);
    expect(shadow.querySelector(".otf-agent-panel")?.classList.contains("is-open")).toBe(false);
  });

  it("renderState does not open a hidden panel", () => {
    panel.renderState({
      status: "preview",
      summary: ["Added background panel."],
      warnings: [],
      criticWarnings: [],
      validationErrors: [],
      lastInstruction: "Add soft elevation",
    });

    expect(panel.isOpen()).toBe(false);
    expect((shadow.querySelector(".otf-agent-panel") as HTMLElement).hidden).toBe(true);
  });

  it("close clears transient instruction and feedback state", () => {
    panel.open({ x: 20, y: 20 });
    panel.setInstruction("temporary prompt");
    panel.renderState({
      status: "error",
      failureCode: "validation_failed",
      summary: ["Summary line"],
      warnings: ["Warning line"],
      criticWarnings: [],
      validationErrors: ["Validation line"],
      lastInstruction: "temporary prompt",
    });

    panel.close();

    expect(panel.getInstruction()).toBe("");
    expect(shadow.querySelector("[data-agent-summary]")?.textContent).toBe("");
    expect((shadow.querySelector("[data-agent-summary]") as HTMLElement).hidden).toBe(true);
  });

  it("calls close when the close button is clicked", () => {
    panel.unmount();
    let closed = false;
    const closable = new AgentPanel({
      shadowRoot: shadow,
      callbacks: {
        onSubmit: () => undefined,
        onApprove: () => undefined,
        onReject: () => undefined,
        onRefine: () => undefined,
        onCancel: () => undefined,
        onClose: () => {
          closed = true;
        },
      },
      isAvailable: () => true,
    });
    closable.mount();
    closable.open({ x: 20, y: 20 });
    shadow.querySelector<HTMLButtonElement>("[data-agent-close]")?.click();
    expect(closed).toBe(true);
    expect(closable.isOpen()).toBe(false);
    expect((shadow.querySelector(".otf-agent-panel") as HTMLElement).hidden).toBe(true);
  });

  it("calls close when reject is clicked", () => {
    panel.unmount();
    let rejected = false;
    const rejectable = new AgentPanel({
      shadowRoot: shadow,
      callbacks: {
        onSubmit: () => undefined,
        onApprove: () => undefined,
        onReject: () => {
          rejected = true;
        },
        onRefine: () => undefined,
        onCancel: () => undefined,
        onClose: () => undefined,
      },
      isAvailable: () => true,
    });
    rejectable.mount();
    rejectable.open({ x: 20, y: 20 });
    rejectable.renderState({
      status: "preview",
      summary: [],
      warnings: [],
      criticWarnings: [],
      validationErrors: [],
      lastInstruction: "test",
    });
    shadow.querySelector<HTMLButtonElement>("[data-agent-reject]")?.click();
    expect(rejected).toBe(true);
    expect(rejectable.isOpen()).toBe(false);
    expect((shadow.querySelector(".otf-agent-panel") as HTMLElement).hidden).toBe(true);
  });

  it("does not open in public build mode", () => {
    panel.unmount();
    const publicPanel = new AgentPanel({
      shadowRoot: shadow,
      callbacks: {
        onSubmit: () => undefined,
        onApprove: () => undefined,
        onReject: () => undefined,
        onRefine: () => undefined,
        onCancel: () => undefined,
        onClose: () => undefined,
      },
      isAvailable: () => false,
    });
    publicPanel.mount();
    publicPanel.open({ x: 20, y: 20 });
    expect(publicPanel.isOpen()).toBe(false);
    expect((shadow.querySelector(".otf-agent-panel") as HTMLElement).hidden).toBe(true);
  });
});
