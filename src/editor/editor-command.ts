import type { EditorOperation } from "./operations.js";
import type { EditorSelection } from "./editor-selection.js";
import type { VisualNode, VisualNodeKind } from "./visual-node.js";
import type { VisualNodeId } from "./ids.js";

export type CommandGroup = "primary" | "more" | "debug";

export type CommandAppliesTo = VisualNodeKind | "any" | "multi" | "group";

/** Keyboard shortcut descriptor; routes through the command registry. */
export interface CommandShortcut {
  key?: string;
  code?: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface CommandContext {
  selection: EditorSelection;
  visualNodes: ReadonlyMap<VisualNodeId, VisualNode>;
  applyOperation: (operation: EditorOperation) => void;
  openPanel: (panelId: string, props?: unknown) => void;
}

export interface EditorCommand {
  id: string;
  label: string;
  icon: string;
  appliesTo: CommandAppliesTo[];
  order: number;
  group: CommandGroup;
  shortcut?: CommandShortcut;
  isEnabled: (context: CommandContext) => boolean;
  execute: (context: CommandContext) => Promise<void> | void;
}
