import type { EditorSelection } from "../editor-selection.js";
import { createEmptySelection } from "../editor-selection.js";
import type { GroupState } from "../editor-state.js";
import type { ElementSignature } from "../element-signature.js";
import type { VisualNodeId } from "../ids.js";
import { resolveElementBySignature } from "../dom/element-resolver.js";
import { extractBoundingBox, rectToVisualNodeRect } from "../measurement/bounding-box.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { VisualNode, VisualNodeRect } from "../visual-node.js";
import type { VisualLayoutGraph } from "../visual-graph/visual-layout-graph.js";
import {
  normalizeLassoRect,
  resolveClickSelection,
  resolveLassoSelection,
  type ClickResolveOptions,
  type LassoResolveOptions,
  type SelectionResolveResult,
} from "./selection-resolver.js";
import {
  createVirtualGroup,
  memberToVisualNode,
  recomputeGroupRect,
  toGroupMember,
  type GroupMemberSource,
  type VirtualGroup,
  type VirtualGroupMember,
} from "./virtual-group.js";

export interface SelectionControllerOptions {
  getGraph: () => VisualLayoutGraph;
  getDocument?: () => Document;
  onSelectionChange?: (selection: EditorSelection, result: SelectionResolveResult) => void;
  withPageHitTest?: <T>(callback: () => T) => T;
}

export class SelectionController {
  private selection: EditorSelection = createEmptySelection();
  private readonly getGraph: () => VisualLayoutGraph;
  private readonly getDocument: (() => Document) | undefined;
  private readonly onSelectionChange?: SelectionControllerOptions["onSelectionChange"];
  private readonly withPageHitTest: <T>(callback: () => T) => T;
  private lastTargets: VirtualGroupMember[] = [];
  private activeGroup: VirtualGroup | null = null;
  private preGroupSelection: EditorSelection | null = null;
  private preGroupTargets: VirtualGroupMember[] = [];
  private altCycle: { x: number; y: number; index: number } | null = null;

  constructor(options: SelectionControllerOptions) {
    this.getGraph = options.getGraph;
    this.getDocument = options.getDocument;
    this.onSelectionChange = options.onSelectionChange;
    this.withPageHitTest = options.withPageHitTest ?? ((callback) => callback());
  }

  getSelection(): EditorSelection {
    return this.selection;
  }

  getActiveGroup(): VirtualGroup | null {
    return this.activeGroup;
  }

  clearSelection(): void {
    if (this.activeGroup) {
      this.clearVisualSelectionKeepingGroup();
      return;
    }

    this.selection = createEmptySelection();
    this.lastTargets = [];
    this.altCycle = null;
    this.onSelectionChange?.(this.selection, {
      selection: this.selection,
      resolvedNodes: [],
      rejectedWholePage: false,
    });
  }

  clearSelectionAndGroup(): void {
    this.selection = createEmptySelection();
    this.resetGroupState();
    this.lastTargets = [];
    this.altCycle = null;
    this.onSelectionChange?.(this.selection, {
      selection: this.selection,
      resolvedNodes: [],
      rejectedWholePage: false,
    });
  }

  handlePointerClick(
    x: number,
    y: number,
    shiftKey: boolean,
    composedPath: EventTarget[] = [],
    altKey = false,
  ): SelectionResolveResult {
    const options = this.getClickResolveOptions();
    if (altKey) {
      options.altKey = true;
      options.altCycleIndex = this.nextAltCycleIndex(x, y);
    } else {
      this.altCycle = null;
    }

    const result = this.withPageHitTest(() =>
      resolveClickSelection(
        this.getGraph(),
        x,
        y,
        altKey ? false : shiftKey,
        shiftKey && !altKey ? this.selection : createEmptySelection(),
        composedPath,
        options,
      ),
    );
    return this.commitSelectionResult(result);
  }

  /**
   * Advances the Alt+Click cycle counter. Clicks landing near the previous
   * Alt+Click step the chain (child → parent → container); a click elsewhere
   * resets to the deepest child.
   */
  private nextAltCycleIndex(x: number, y: number): number {
    const ALT_CYCLE_THRESHOLD_PX = 6;
    const previous = this.altCycle;
    let index = 0;
    if (
      previous &&
      Math.abs(previous.x - x) <= ALT_CYCLE_THRESHOLD_PX &&
      Math.abs(previous.y - y) <= ALT_CYCLE_THRESHOLD_PX
    ) {
      index = previous.index + 1;
    }
    this.altCycle = { x, y, index };
    return index;
  }

  handleLasso(startX: number, startY: number, endX: number, endY: number, shiftKey: boolean): SelectionResolveResult {
    const lassoRect = normalizeLassoRect(startX, startY, endX, endY);
    return this.handleLassoRect(lassoRect, shiftKey);
  }

  handleLassoRect(lassoRect: MeasurementRect, shiftKey: boolean): SelectionResolveResult {
    this.altCycle = null;
    const result = this.withPageHitTest(() =>
      resolveLassoSelection(
        this.getGraph(),
        lassoRect,
        shiftKey ? this.selection : createEmptySelection(),
        shiftKey,
        this.getLassoResolveOptions(),
      ),
    );
    return this.commitSelectionResult(result);
  }

  /**
   * Groups the current selection into a single virtual group. Works after
   * DOM-first rectangle selection: members come from the last resolved targets,
   * which may be VisualNode-backed or DOM-derived synthetic targets.
   */
  groupSelection(): SelectionResolveResult {
    const members = this.lastTargets.filter((target) =>
      this.selection.selectedNodeIds.includes(target.nodeId),
    );

    const viewport = this.tryGetViewport();
    const group = createVirtualGroup(members, viewport ? { viewport } : {});
    if (!group) {
      const result: SelectionResolveResult = {
        selection: this.selection,
        resolvedNodes: this.lastTargets.map(memberToVisualNode),
        rejectedWholePage: false,
        rejectionReason: "not-groupable",
      };
      this.onSelectionChange?.(this.selection, result);
      return result;
    }

    this.preGroupSelection = this.selection;
    this.preGroupTargets = this.lastTargets;
    this.activeGroup = group;
    this.selection = {
      selectedNodeIds: group.memberIds,
      activeGroupId: group.id,
      source: "group",
    };

    const result: SelectionResolveResult = {
      selection: this.selection,
      resolvedNodes: group.members.map(memberToVisualNode),
      rejectedWholePage: false,
      group,
    };
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  /**
   * Ungroups the active group and restores the individual member selection.
   */
  ungroupSelection(): SelectionResolveResult {
    const group = this.activeGroup;
    if (!group) {
      const result: SelectionResolveResult = {
        selection: this.selection,
        resolvedNodes: this.lastTargets.map(memberToVisualNode),
        rejectedWholePage: false,
        rejectionReason: "no-active-group",
      };
      this.onSelectionChange?.(this.selection, result);
      return result;
    }

    const restoredTargets =
      this.preGroupTargets.length > 0 ? this.preGroupTargets : group.members;
    this.selection = this.preGroupSelection ?? {
      selectedNodeIds: group.memberIds,
      source: "lasso",
    };
    this.lastTargets = restoredTargets;
    this.resetGroupState();

    const result: SelectionResolveResult = {
      selection: this.selection,
      resolvedNodes: restoredTargets.map(memberToVisualNode),
      rejectedWholePage: false,
    };
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  /**
   * Restores a persisted group after replay when enough members still resolve.
   */
  restorePersistedGroup(groupState: GroupState): SelectionResolveResult | null {
    const members = groupState.memberNodeIds
      .map((nodeId, index) => {
        const signature = groupState.memberSignatures[index];
        if (!signature) {
          return null;
        }
        return this.resolvePersistedMember(nodeId, signature);
      })
      .filter((member): member is VirtualGroupMember => member !== null);

    const viewport = this.tryGetViewport();
    const group = createVirtualGroup(
      members,
      viewport
        ? { id: groupState.groupId, viewport }
        : { id: groupState.groupId },
    );
    if (!group) {
      return null;
    }

    this.preGroupSelection = null;
    this.preGroupTargets = [];
    this.activeGroup = group;
    this.selection = {
      selectedNodeIds: group.memberIds,
      activeGroupId: group.id,
      source: "replay",
    };
    this.lastTargets = group.members;

    const result: SelectionResolveResult = {
      selection: this.selection,
      resolvedNodes: group.members.map(memberToVisualNode),
      rejectedWholePage: false,
      group,
    };
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  /**
   * Re-applies a saved multi-selection or group without creating new operations.
   */
  applySelectionSnapshot(
    selection: EditorSelection,
    resolvedNodes: VisualNode[],
    group: VirtualGroup | null = null,
  ): SelectionResolveResult {
    this.selection = {
      ...selection,
      selectedNodeIds: [...selection.selectedNodeIds],
    };
    this.lastTargets = group?.members ?? this.buildTargetsFromResult({
      selection: this.selection,
      resolvedNodes,
      rejectedWholePage: false,
    });

    if (group) {
      this.activeGroup = group;
      this.preGroupSelection = null;
      this.preGroupTargets = [];
    } else {
      this.resetGroupState();
    }

    const result: SelectionResolveResult = {
      selection: this.selection,
      resolvedNodes,
      rejectedWholePage: false,
      ...(group ? { group } : {}),
    };
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  /**
   * Recomputes the active group rect from the current layout (graph rects for
   * VisualNode-backed members, signature matching for DOM-derived members).
   */
  refreshActiveGroup(): VirtualGroup | null {
    if (!this.activeGroup) {
      return null;
    }

    this.activeGroup = recomputeGroupRect(this.activeGroup, (member) =>
      this.resolveCurrentMemberRect(member),
    );

    this.onSelectionChange?.(this.selection, {
      selection: this.selection,
      resolvedNodes: this.activeGroup.members.map(memberToVisualNode),
      rejectedWholePage: false,
      group: this.activeGroup,
    });
    return this.activeGroup;
  }

  private commitSelectionResult(result: SelectionResolveResult): SelectionResolveResult {
    if (this.activeGroup) {
      if (result.selection.source === "shift-click") {
        const rebuilt = this.rebuildActiveGroupFromSelection(result);
        if (rebuilt) {
          return rebuilt;
        }
      } else if (result.selection.source === "click") {
        if (this.clickTargetsActiveGroup(result)) {
          return this.selectActiveGroup("group");
        }
        return this.clearVisualSelectionKeepingGroup();
      } else if (result.selection.source === "lasso") {
        this.resetGroupState();
      }
    } else if (result.selection.source !== "shift-click") {
      this.resetGroupState();
    } else {
      this.resetGroupState();
    }

    this.selection = result.selection;
    this.lastTargets = this.buildTargetsFromResult(result);
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  private selectActiveGroup(source: EditorSelection["source"] = "group"): SelectionResolveResult {
    const group = this.refreshActiveGroup() ?? this.activeGroup;
    if (!group) {
      return this.clearVisualSelectionKeepingGroup();
    }

    this.selection = {
      selectedNodeIds: [...group.memberIds],
      activeGroupId: group.id,
      source,
    };
    this.lastTargets = group.members;

    const updated: SelectionResolveResult = {
      selection: this.selection,
      resolvedNodes: group.members.map(memberToVisualNode),
      rejectedWholePage: false,
      group,
    };
    this.onSelectionChange?.(this.selection, updated);
    return updated;
  }

  private clearVisualSelectionKeepingGroup(): SelectionResolveResult {
    this.selection = createEmptySelection();
    this.lastTargets = this.activeGroup?.members ?? [];
    this.altCycle = null;

    const cleared: SelectionResolveResult = {
      selection: this.selection,
      resolvedNodes: [],
      rejectedWholePage: false,
    };
    this.onSelectionChange?.(this.selection, cleared);
    return cleared;
  }

  private clickTargetsActiveGroup(result: SelectionResolveResult): boolean {
    if (!this.activeGroup || result.resolvedNodes.length === 0) {
      return false;
    }

    const document = this.getDocument?.();
    const graph = this.tryGetGraph();

    for (const clicked of result.resolvedNodes) {
      if (this.activeGroup.memberIds.includes(clicked.id)) {
        return true;
      }

      if (graph) {
        for (const memberId of this.activeGroup.memberIds) {
          if (this.isGraphDescendantOfMember(clicked.id, memberId, graph)) {
            return true;
          }
        }
      }

      const clickedElement =
        clicked.element ??
        (document ? resolveElementBySignature(document, clicked.signature) : null);
      if (!clickedElement) {
        continue;
      }

      for (const member of this.activeGroup.members) {
        const memberElement =
          member.element?.isConnected === true
            ? member.element
            : document
              ? resolveElementBySignature(document, member.signature)
              : null;
        if (memberElement?.contains(clickedElement)) {
          return true;
        }
      }
    }

    return false;
  }

  private isGraphDescendantOfMember(
    nodeId: VisualNodeId,
    memberId: VisualNodeId,
    graph: VisualLayoutGraph,
  ): boolean {
    let current = graph.getNodeById(nodeId);
    while (current?.parentId) {
      if (current.parentId === memberId) {
        return true;
      }
      current = graph.getNodeById(current.parentId);
    }
    return false;
  }

  private rebuildActiveGroupFromSelection(
    result: SelectionResolveResult,
  ): SelectionResolveResult | null {
    const memberTargets = this.buildTargetsFromResult(result).filter((target) =>
      result.selection.selectedNodeIds.includes(target.nodeId),
    );

    if (memberTargets.length < 2) {
      this.resetGroupState();
      return null;
    }

    const viewport = this.tryGetViewport();
    const group = createVirtualGroup(memberTargets, viewport ? { viewport } : {});
    if (!group) {
      this.resetGroupState();
      return null;
    }

    this.activeGroup = group;
    this.selection = {
      selectedNodeIds: group.memberIds,
      activeGroupId: group.id,
      ...(result.selection.activeNodeId ? { activeNodeId: result.selection.activeNodeId } : {}),
      source: "group",
    };
    this.lastTargets = group.members;

    const updated: SelectionResolveResult = {
      ...result,
      selection: this.selection,
      resolvedNodes: group.members.map(memberToVisualNode),
      group,
    };
    this.onSelectionChange?.(this.selection, updated);
    return updated;
  }

  private buildTargetsFromResult(result: SelectionResolveResult): VirtualGroupMember[] {
    const graph = this.tryGetGraph();
    return result.resolvedNodes.map((node) => {
      const source: GroupMemberSource = graph?.getNodeById(node.id) ? "visual-node" : "dom";
      return toGroupMember(node, source);
    });
  }

  private resolvePersistedMember(
    nodeId: VisualNodeId,
    signature: ElementSignature,
  ): VirtualGroupMember | null {
    const graphNode = this.tryGetGraph()?.getNodeById(nodeId);
    if (graphNode) {
      return toGroupMember(graphNode, "visual-node");
    }

    const document = this.getDocument?.();
    if (!document) {
      return null;
    }

    const element = resolveElementBySignature(document, signature);
    if (!element) {
      return null;
    }

    return {
      nodeId,
      signature,
      rect: rectToVisualNodeRect(extractBoundingBox(element)),
      source: "dom",
      isPageLevel: false,
      element,
    };
  }

  private resolveCurrentMemberRect(member: VirtualGroupMember): VisualNodeRect | null {
    if (member.source === "visual-node") {
      const node = this.tryGetGraph()?.getNodeById(member.nodeId);
      return node ? { ...node.rect } : null;
    }

    if (member.element?.isConnected) {
      return rectToVisualNodeRect(extractBoundingBox(member.element));
    }

    const document = this.getDocument?.();
    if (!document) {
      return null;
    }

    const element = resolveElementBySignature(document, member.signature);
    return element ? rectToVisualNodeRect(extractBoundingBox(element)) : null;
  }

  private resetGroupState(): void {
    this.activeGroup = null;
    this.preGroupSelection = null;
    this.preGroupTargets = [];
  }

  private tryGetGraph(): VisualLayoutGraph | null {
    try {
      return this.getGraph();
    } catch {
      return null;
    }
  }

  private tryGetViewport(): ReturnType<VisualLayoutGraph["getViewport"]> | undefined {
    return this.tryGetGraph()?.getViewport();
  }

  private getClickResolveOptions(): ClickResolveOptions {
    const document = this.getDocument?.();
    return document ? { document } : {};
  }

  private getLassoResolveOptions(): LassoResolveOptions {
    const document = this.getDocument?.();
    return document ? { document } : {};
  }
}

export function createSelectionController(
  options: SelectionControllerOptions,
): SelectionController {
  return new SelectionController(options);
}
