import type { CommandContext, EditorCommand } from "../editor/editor-command.js";
import type { LayerCommand } from "../editor/transform/layer-order.js";
import {
  hasActiveSelection,
  isSingleHandleTarget,
} from "../editor/commands/command-helpers.js";
import type { SessionCommandHost } from "./session-command-host.js";

const ALWAYS = ["any"] as const;

export function createDefaultCommands(host: SessionCommandHost): EditorCommand[] {
  return [
    {
      id: "hide",
      label: "Hide",
      icon: "eye-off",
      appliesTo: [...ALWAYS],
      order: 10,
      group: "primary",
      shortcut: { key: "Delete" },
      isEnabled: hasActiveSelection,
      execute: () => {
        host.hideSelection();
      },
    },
    {
      id: "hide-backspace",
      label: "Hide",
      icon: "eye-off",
      appliesTo: [...ALWAYS],
      order: 11,
      group: "more",
      shortcut: { key: "Backspace" },
      isEnabled: hasActiveSelection,
      execute: () => {
        host.hideSelection();
      },
    },
    {
      id: "bring-forward",
      label: "Bring forward",
      icon: "layer-up",
      appliesTo: [...ALWAYS],
      order: 20,
      group: "primary",
      shortcut: { code: "BracketRight", ctrlOrMeta: true, shift: false },
      isEnabled: hasActiveSelection,
      execute: () => {
        host.applyLayerCommand("forward");
      },
    },
    {
      id: "send-backward",
      label: "Send backward",
      icon: "layer-down",
      appliesTo: [...ALWAYS],
      order: 21,
      group: "primary",
      shortcut: { code: "BracketLeft", ctrlOrMeta: true, shift: false },
      isEnabled: hasActiveSelection,
      execute: () => {
        host.applyLayerCommand("backward");
      },
    },
    {
      id: "bring-to-front",
      label: "Bring to front",
      icon: "layer-front",
      appliesTo: [...ALWAYS],
      order: 22,
      group: "more",
      shortcut: { code: "BracketRight", ctrlOrMeta: true, shift: true },
      isEnabled: hasActiveSelection,
      execute: () => {
        host.applyLayerCommand("front");
      },
    },
    {
      id: "send-to-back",
      label: "Send to back",
      icon: "layer-back",
      appliesTo: [...ALWAYS],
      order: 23,
      group: "more",
      shortcut: { code: "BracketLeft", ctrlOrMeta: true, shift: true },
      isEnabled: hasActiveSelection,
      execute: () => {
        host.applyLayerCommand("back");
      },
    },
    {
      id: "crop-mode",
      label: "Crop mode",
      icon: "crop",
      appliesTo: ["text", "image", "container", "button", "input", "unknown", "any"],
      order: 30,
      group: "primary",
      isEnabled: (context) => isSingleHandleTarget(context) && host.canCropSelection(),
      execute: () => {
        host.toggleCropMode();
      },
    },
    {
      id: "style-panel",
      label: "Style",
      icon: "palette",
      appliesTo: [...ALWAYS],
      order: 40,
      group: "primary",
      isEnabled: hasActiveSelection,
      execute: (context: CommandContext) => {
        context.openPanel("style");
      },
    },
    {
      id: "text-edit",
      label: "Edit text",
      icon: "text",
      appliesTo: ["text", "button", "input", "any"],
      order: 50,
      group: "primary",
      isEnabled: hasActiveSelection,
      execute: () => {
        host.openTextEditor();
      },
    },
    {
      id: "undo",
      label: "Undo",
      icon: "undo",
      appliesTo: [...ALWAYS],
      order: 60,
      group: "primary",
      shortcut: { key: "z", ctrlOrMeta: true, shift: false },
      isEnabled: () => host.canUndo(),
      execute: () => {
        host.undo();
      },
    },
    {
      id: "redo",
      label: "Redo",
      icon: "redo",
      appliesTo: [...ALWAYS],
      order: 61,
      group: "primary",
      shortcut: { key: "y", ctrlOrMeta: true, shift: false },
      isEnabled: () => host.canRedo(),
      execute: () => {
        host.redo();
      },
    },
    {
      id: "redo-shift",
      label: "Redo",
      icon: "redo",
      appliesTo: [...ALWAYS],
      order: 62,
      group: "more",
      shortcut: { key: "z", ctrlOrMeta: true, shift: true },
      isEnabled: () => host.canRedo(),
      execute: () => {
        host.redo();
      },
    },
    {
      id: "clear-selection",
      label: "Clear selection",
      icon: "deselect",
      appliesTo: [...ALWAYS],
      order: 70,
      group: "more",
      isEnabled: hasActiveSelection,
      execute: () => {
        host.clearSelection();
      },
    },
    {
      id: "clear-page",
      label: "Clear page changes",
      icon: "clear",
      appliesTo: [...ALWAYS],
      order: 80,
      group: "more",
      isEnabled: () => true,
      execute: () => {
        void host.clearPage();
      },
    },
    {
      id: "saveWindow.start",
      label: "Save window",
      icon: "save-window",
      appliesTo: [...ALWAYS],
      order: 85,
      group: "more",
      shortcut: { key: "s", shift: false },
      isEnabled: () => host.canStartSaveWindow(),
      execute: () => {
        host.startSaveWindow();
      },
    },
  ];
}

export const TOOLBAR_COMMAND_IDS = [
  "hide",
  "send-backward",
  "bring-forward",
  "crop-mode",
  "style-panel",
  "text-edit",
  "undo",
  "redo",
] as const;

export type ToolbarCommandId = (typeof TOOLBAR_COMMAND_IDS)[number];

export function layerCommandFromId(id: string): LayerCommand | null {
  switch (id) {
    case "bring-forward":
      return "forward";
    case "send-backward":
      return "backward";
    case "bring-to-front":
      return "front";
    case "send-to-back":
      return "back";
    default:
      return null;
  }
}
