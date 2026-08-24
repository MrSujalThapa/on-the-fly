import { describe, expect, it, vi, afterEach } from "vitest";
import { EditorShell } from "../../src/content/editor-shell.js";
import { FloatingToolbar } from "../../src/editor/floating-toolbar.js";
import type { EditorCommand } from "../../src/editor/editor-command.js";

describe("FloatingToolbar", () => {
  afterEach(() => {
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
  });

  it("renders only when selection anchor is provided", async () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const onCommand = vi.fn();
    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand,
        onStyleChange: vi.fn(),
        onTextCommit: vi.fn(),
        onTextCancel: vi.fn(),
      },
    });
    toolbar.mount();

    const command: EditorCommand = {
      id: "hide",
      label: "Hide",
      icon: "eye-off",
      appliesTo: ["any"],
      order: 1,
      group: "primary",
      isEnabled: () => true,
      execute: vi.fn(),
    };

    toolbar.renderCommands([], null);
    const toolbarEl = shadow.querySelector(".otf-curved-toolbar");
    expect(toolbarEl).toBeInstanceOf(HTMLElement);
    expect((toolbarEl as HTMLElement).hidden).toBe(true);

    toolbar.renderCommands([{ command, enabled: true }], { x: 10, y: 10, width: 100, height: 40 });
    expect((toolbarEl as HTMLElement).hidden).toBe(true);
    await nextFrame();
    expect((toolbarEl as HTMLElement).hidden).toBe(false);
    expect(shadow.querySelector("[data-command-id='crop-mode']")).not.toBeNull();

    shell.unmount();
  });

  it("invokes command handler when toolbar button is clicked", async () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const onCommand = vi.fn();
    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand,
        onStyleChange: vi.fn(),
        onTextCommit: vi.fn(),
        onTextCancel: vi.fn(),
      },
    });
    toolbar.mount();

    const command: EditorCommand = {
      id: "style-panel",
      label: "Style",
      icon: "style",
      appliesTo: ["any"],
      order: 1,
      group: "primary",
      isEnabled: () => true,
      execute: vi.fn(),
    };

    toolbar.renderCommands([{ command, enabled: true }], { x: 20, y: 20, width: 80, height: 30 });
    await nextFrame();
    const button = shadow.querySelector("[data-command-id='style-panel']") as HTMLButtonElement;
    button.click();
    expect(onCommand).toHaveBeenCalledWith("style-panel");

    shell.unmount();
  });

  it("renders only one contextual curved toolbar without a duplicate top-left panel", () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand: vi.fn(),
        onStyleChange: vi.fn(),
        onTextCommit: vi.fn(),
        onTextCancel: vi.fn(),
      },
    });
    toolbar.mount();
    toolbar.renderCommands([], { x: 10, y: 10, width: 100, height: 40 });

    expect(shadow.querySelectorAll(".otf-curved-toolbar")).toHaveLength(1);
    expect(shadow.querySelector(".rotation-controls")).toBeNull();
    expect(shadow.querySelectorAll('[data-otf-ui="toolbar"]')).toHaveLength(1);
    expect(Array.from(shadow.querySelectorAll(".otf-tool-btn")).map((button) => button.getAttribute("data-command-id"))).toEqual([
      "crop-mode", "style-panel", "agent", "text-edit", "lasso", "undo", "redo", "more",
    ]);
    for (const id of ["agent", "lasso", "more"]) {
      expect((shadow.querySelector(`[data-command-id="${id}"]`) as HTMLButtonElement).disabled).toBe(true);
    }

    shell.unmount();
  });

  it("closes the style panel from the close button", async () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const onStylePanelClose = vi.fn();
    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand: vi.fn(),
        onStyleChange: vi.fn(),
        onTextCommit: vi.fn(),
        onTextCancel: vi.fn(),
        onStylePanelClose,
      },
    });
    toolbar.mount();
    toolbar.renderCommands([], { x: 10, y: 10, width: 100, height: 40 });
    await nextFrame();
    toolbar.toggleStylePanel(true, { opacity: "1" });

    expect(toolbar.isStylePanelOpen()).toBe(true);
    const closeButton = shadow.querySelector("[data-style-close]") as HTMLButtonElement;
    closeButton.click();
    expect(toolbar.isStylePanelOpen()).toBe(false);
    expect(onStylePanelClose).toHaveBeenCalled();

    shell.unmount();
  });

  it("keeps first-render toolbar sizing stable and independent of selection width", async () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand: vi.fn(),
        onStyleChange: vi.fn(),
        onTextCommit: vi.fn(),
        onTextCancel: vi.fn(),
      },
    });
    toolbar.mount();

    toolbar.renderCommands([], { x: 10, y: 10, width: 40, height: 20 });
    const toolbarEl = shadow.querySelector(".otf-curved-toolbar") as HTMLElement;
    expect(toolbarEl.hidden).toBe(true);
    await nextFrame();
    const narrowWidth = toolbarEl.dataset.width;

    toolbar.renderCommands([], { x: 10, y: 10, width: 900, height: 20 });
    await nextFrame();

    expect(toolbarEl.dataset.width).toBe(narrowWidth);
    expect(Number(toolbarEl.dataset.width)).toBeGreaterThanOrEqual(330);
    expect(Number(toolbarEl.dataset.width)).toBeLessThanOrEqual(420);

    shell.unmount();
  });

  it("renders style panel controls without overflowing fields", async () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand: vi.fn(),
        onStyleChange: vi.fn(),
        onTextCommit: vi.fn(),
        onTextCancel: vi.fn(),
      },
    });
    toolbar.mount();
    toolbar.renderCommands([], { x: 10, y: 10, width: 100, height: 40 });
    await nextFrame();
    toolbar.toggleStylePanel(true, { opacity: "0.5" });

    const panel = shadow.querySelector(".otf-style-panel") as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(shadow.querySelector('[data-gradient-start]')).toBeInstanceOf(HTMLInputElement);
    expect(shadow.querySelector('[data-shadow-preset]')).toBeInstanceOf(HTMLSelectElement);
    expect(shadow.querySelector('[data-style-field="backgroundImage"]')).toBeNull();
    expect(shadow.querySelector('[data-style-field="boxShadow"]')).toBeNull();
    const opacity = shadow.querySelector('[data-style-field="opacity"]') as HTMLInputElement;
    expect(opacity.getAttribute("min")).toBe("0");
    expect(opacity.getAttribute("max")).toBe("1");
    expect(shadow.querySelector("[data-style-reset]")).toBeInstanceOf(HTMLButtonElement);
    expect(shadow.querySelector("[data-style-apply]")).toBeInstanceOf(HTMLButtonElement);

    shell.unmount();
  });

  it("saves changed text with Ctrl+Enter and cancels with Escape", () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const onTextCommit = vi.fn();
    const onTextCancel = vi.fn();
    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand: vi.fn(),
        onStyleChange: vi.fn(),
        onTextCommit,
        onTextCancel,
      },
    });
    toolbar.mount();

    toolbar.openTextEditor({ x: 10, y: 10, width: 120, height: 20 }, "Hello");
    const firstInput = shadow.querySelector(".otf-text-editor-input") as HTMLTextAreaElement;
    firstInput.value = "Updated";
    firstInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
    }));
    expect(onTextCommit).toHaveBeenCalledWith("Updated");

    toolbar.openTextEditor({ x: 10, y: 10, width: 120, height: 20 }, "Hello");
    const secondInput = shadow.querySelector(".otf-text-editor-input") as HTMLTextAreaElement;
    secondInput.value = "Cancelled";
    secondInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
    }));
    expect(onTextCancel).toHaveBeenCalledTimes(1);
    expect(onTextCommit).toHaveBeenCalledTimes(1);

    shell.unmount();
  });

  it("saves single-line text with Enter and blur only when changed", () => {
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const onTextCommit = vi.fn();
    const toolbar = new FloatingToolbar({
      shadowRoot: shadow,
      callbacks: {
        onCommand: vi.fn(),
        onStyleChange: vi.fn(),
        onTextCommit,
        onTextCancel: vi.fn(),
      },
    });
    toolbar.mount();

    toolbar.openTextEditor({ x: 10, y: 10, width: 120, height: 20 }, "Hello");
    const unchangedInput = shadow.querySelector(".otf-text-editor-input") as HTMLTextAreaElement;
    unchangedInput.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    expect(onTextCommit).not.toHaveBeenCalled();

    toolbar.openTextEditor({ x: 10, y: 10, width: 120, height: 20 }, "Hello");
    const changedInput = shadow.querySelector(".otf-text-editor-input") as HTMLTextAreaElement;
    changedInput.value = "Changed";
    changedInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    }));
    expect(onTextCommit).toHaveBeenCalledWith("Changed");

    shell.unmount();
  });
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}
