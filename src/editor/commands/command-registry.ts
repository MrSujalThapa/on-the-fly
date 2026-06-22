import type {
  CommandContext,
  CommandShortcut,
  EditorCommand,
} from "../editor-command.js";
import {
  commandAppliesToSelection,
  resolveSelectionTags,
} from "./command-helpers.js";

export interface ResolvedCommand {
  command: EditorCommand;
  enabled: boolean;
}

export class CommandRegistry {
  private readonly commands = new Map<string, EditorCommand>();

  register(command: EditorCommand): void {
    this.commands.set(command.id, command);
  }

  registerAll(commands: EditorCommand[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  get(id: string): EditorCommand | undefined {
    return this.commands.get(id);
  }

  list(): EditorCommand[] {
    return [...this.commands.values()].sort((left, right) => left.order - right.order);
  }

  resolveForContext(context: CommandContext, group?: EditorCommand["group"]): ResolvedCommand[] {
    const tags = resolveSelectionTags(context.selection, context.visualNodes);
    return this.list()
      .filter((command) => (group ? command.group === group : true))
      .filter((command) => commandAppliesToSelection(command.appliesTo, tags))
      .map((command) => ({
        command,
        enabled: command.isEnabled(context),
      }));
  }

  resolveToolbarCommands(context: CommandContext): ResolvedCommand[] {
    return this.resolveForContext(context, "primary");
  }

  isEnabled(id: string, context: CommandContext): boolean {
    const command = this.commands.get(id);
    if (!command) {
      return false;
    }
    const tags = resolveSelectionTags(context.selection, context.visualNodes);
    if (!commandAppliesToSelection(command.appliesTo, tags)) {
      return false;
    }
    return command.isEnabled(context);
  }

  async execute(id: string, context: CommandContext): Promise<boolean> {
    const command = this.commands.get(id);
    if (!command || !this.isEnabled(id, context)) {
      return false;
    }

    await command.execute(context);
    return true;
  }
}

export function matchCommandShortcut(
  event: KeyboardEvent,
  shortcut: CommandShortcut,
): boolean {
  const wantsCtrl = shortcut.ctrlOrMeta === true;
  const hasCtrl = event.ctrlKey || event.metaKey;
  if (wantsCtrl && !hasCtrl) {
    return false;
  }
  if (!wantsCtrl && hasCtrl && shortcut.key !== undefined) {
    return false;
  }

  if (shortcut.shift === true && !event.shiftKey) {
    return false;
  }
  if (shortcut.shift === false && event.shiftKey) {
    return false;
  }

  if (shortcut.alt === true && !event.altKey) {
    return false;
  }
  if (shortcut.alt === false && event.altKey) {
    return false;
  }

  if (shortcut.code) {
    return event.code === shortcut.code;
  }

  if (shortcut.key) {
    return event.key.toLowerCase() === shortcut.key.toLowerCase();
  }

  return false;
}

export function findCommandForKeyboardEvent(
  registry: CommandRegistry,
  event: KeyboardEvent,
  context: CommandContext,
): EditorCommand | null {
  for (const command of registry.list()) {
    if (!command.shortcut) {
      continue;
    }
    if (!matchCommandShortcut(event, command.shortcut)) {
      continue;
    }
    if (!registry.isEnabled(command.id, context)) {
      continue;
    }
    return command;
  }
  return null;
}

export function createCommandRegistry(commands: EditorCommand[] = []): CommandRegistry {
  const registry = new CommandRegistry();
  registry.registerAll(commands);
  return registry;
}
