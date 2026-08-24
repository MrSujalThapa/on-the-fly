import type { GroupId, VisualNodeId } from "../editor/ids.js";
import type { IntendedRect } from "./placement-engine.js";

export type RuntimeSelectionSource = "click" | "shift-click" | "lasso" | "group" | "clear";

export type SelectionAtom =
  | { readonly kind: "node"; readonly nodeId: VisualNodeId }
  | { readonly kind: "group"; readonly groupId: GroupId };

export interface RuntimeSelection {
  readonly atoms: readonly SelectionAtom[];
  readonly primary: SelectionAtom | null;
  readonly source: RuntimeSelectionSource;
}

export interface RuntimeVirtualGroup {
  readonly id: GroupId;
  readonly memberIds: readonly VisualNodeId[];
}

export function atomKey(atom: SelectionAtom): string {
  return atom.kind === "node" ? `node:${atom.nodeId}` : `group:${atom.groupId}`;
}

export function emptySelection(source: RuntimeSelectionSource = "clear"): RuntimeSelection {
  return { atoms: [], primary: null, source };
}

export function selectionFromAtoms(
  atoms: readonly SelectionAtom[],
  source: RuntimeSelectionSource,
): RuntimeSelection {
  const seen = new Set<string>();
  const unique = atoms.filter((atom) => {
    const key = atomKey(atom);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { atoms: unique, primary: unique.at(-1) ?? null, source };
}

export function normalizeSelection(
  atoms: readonly SelectionAtom[],
  groups: ReadonlyMap<GroupId, RuntimeVirtualGroup>,
  source: RuntimeSelectionSource,
): RuntimeSelection {
  const groupByMember = new Map<VisualNodeId, GroupId>();
  for (const [groupId, group] of groups) {
    for (const memberId of group.memberIds) {
      if (!groupByMember.has(memberId)) groupByMember.set(memberId, groupId);
    }
  }
  const canonical: SelectionAtom[] = [];
  for (const atom of atoms) {
    if (atom.kind === "group") {
      if (groups.has(atom.groupId)) canonical.push(atom);
      continue;
    }
    const groupId = groupByMember.get(atom.nodeId);
    canonical.push(groupId ? { kind: "group", groupId } : atom);
  }
  return selectionFromAtoms(canonical, source);
}

export function toggleAtom(selection: RuntimeSelection, atom: SelectionAtom): RuntimeSelection {
  const key = atomKey(atom);
  const exists = selection.atoms.some((candidate) => atomKey(candidate) === key);
  return selectionFromAtoms(
    exists ? selection.atoms.filter((candidate) => atomKey(candidate) !== key) : [...selection.atoms, atom],
    "shift-click",
  );
}

export function flattenSelection(
  selection: RuntimeSelection,
  groups: ReadonlyMap<GroupId, RuntimeVirtualGroup>,
): VisualNodeId[] {
  const seen = new Set<VisualNodeId>();
  const result: VisualNodeId[] = [];
  for (const atom of selection.atoms) {
    const ids = atom.kind === "node" ? [atom.nodeId] : groups.get(atom.groupId)?.memberIds ?? [];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }
  return result;
}

export function unionRects(rects: Iterable<IntendedRect>): IntendedRect | null {
  let result: IntendedRect | null = null;
  for (const rect of rects) {
    if (!result) {
      result = { ...rect };
      continue;
    }
    const right = Math.max(result.x + result.width, rect.x + rect.width);
    const bottom = Math.max(result.y + result.height, rect.y + rect.height);
    result.x = Math.min(result.x, rect.x);
    result.y = Math.min(result.y, rect.y);
    result.width = right - result.x;
    result.height = bottom - result.y;
  }
  return result;
}
