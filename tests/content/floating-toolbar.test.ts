import { describe, expect, it, vi, afterEach } from "vitest";
import { EditorShell } from "../../src/content/editor-shell.js";
import { FloatingToolbar } from "../../src/content/floating-toolbar.js";
import type { EditorCommand } from "../../src/editor/editor-command.js";

describe("FloatingToolbar", () => {
  afterEach(() => {
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
  });

  it("renders only when selection anchor is provided", () => {
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
    const toolbarEl = shadow.querySelector(".otf-toolbar");
    expect(toolbarEl).toBeInstanceOf(HTMLElement);
    expect((toolbarEl as HTMLElement).hidden).toBe(true);

    toolbar.renderCommands([{ command, enabled: true }], { x: 10, y: 10, width: 100, height: 40 });
    expect((toolbarEl as HTMLElement).hidden).toBe(false);
    expect(shadow.querySelector("[data-command-id='hide']")).not.toBeNull();

    shell.unmount();
  });

  it("invokes command handler when toolbar button is clicked", () => {
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
      id: "bring-forward",
      label: "Bring forward",
      icon: "layer-up",
      appliesTo: ["any"],
      order: 1,
      group: "primary",
      isEnabled: () => true,
      execute: vi.fn(),
    };

    toolbar.renderCommands([{ command, enabled: true }], { x: 20, y: 20, width: 80, height: 30 });
    const button = shadow.querySelector("[data-command-id='bring-forward']") as HTMLButtonElement;
    button.click();
    expect(onCommand).toHaveBeenCalledWith("bring-forward");

    shell.unmount();
  });
});
