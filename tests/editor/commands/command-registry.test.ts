import { describe, expect, it, vi } from "vitest";
import { createEmptySelection } from "../../../src/editor/editor-selection.js";
import type { CommandContext, EditorCommand } from "../../../src/editor/editor-command.js";
import {
  createCommandRegistry,
  findCommandForKeyboardEvent,
  matchCommandShortcut,
} from "../../../src/editor/commands/command-registry.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    selection: createEmptySelection(),
    visualNodes: new Map(),
    applyOperation: vi.fn(),
    openPanel: vi.fn(),
    ...overrides,
  };
}

describe("CommandRegistry", () => {
  it("registers commands and resolves enabled state", async () => {
    const execute = vi.fn();
    const command: EditorCommand = {
      id: "test-cmd",
      label: "Test",
      icon: "test",
      appliesTo: ["any"],
      order: 1,
      group: "primary",
      isEnabled: (context) => context.selection.selectedNodeIds.length > 0,
      execute,
    };

    const registry = createCommandRegistry([command]);
    const disabledContext = createContext();
    expect(registry.isEnabled("test-cmd", disabledContext)).toBe(false);

    const enabledContext = createContext({
      selection: { selectedNodeIds: ["node-1"], source: "click" },
    });
    expect(registry.isEnabled("test-cmd", enabledContext)).toBe(true);

    await registry.execute("test-cmd", enabledContext);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("matches keyboard shortcuts and routes to commands", async () => {
    const execute = vi.fn();
    const registry = createCommandRegistry([
      {
        id: "undo",
        label: "Undo",
        icon: "undo",
        appliesTo: ["any"],
        order: 1,
        group: "primary",
        shortcut: { key: "z", ctrlOrMeta: true },
        isEnabled: () => true,
        execute,
      },
    ]);

    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true });
    expect(matchCommandShortcut(event, { key: "z", ctrlOrMeta: true })).toBe(true);

    const context = createContext();
    const matched = findCommandForKeyboardEvent(registry, event, context);
    expect(matched?.id).toBe("undo");

    if (matched) {
      await registry.execute(matched.id, context);
    }
    expect(execute).toHaveBeenCalled();
  });
});
