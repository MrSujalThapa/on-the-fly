import type { GroupId, VisualNodeId } from "../editor/ids.js";
import type { LayerCommand } from "../editor/transform/layer-order.js";
import type { BatchExecutionResult, ExecutionResult, OperationExecutor } from "./operation-executor.js";
import type { OperationLedger } from "./operation-ledger.js";
import type { OverlayCoordinator } from "./overlay-coordinator.js";
import type { PlacementEngine } from "./placement-engine.js";
import type { InputRouter } from "./input-router.js";
import type { RuntimeLifecycle } from "./runtime-lifecycle.js";
import type { VisualModel } from "./visual-model.js";
import type { IntendedRect } from "./placement-engine.js";
import type { RuntimeSelection, RuntimeVirtualGroup } from "./runtime-selection.js";
import type { CropOperation, StyleProperty } from "../editor/operations.js";

export interface PersistResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly failureKind?: "LEDGER" | "PERSISTENCE" | "IDENTITY" | "EXECUTION";
}

export interface ReplayResult {
  readonly ok: boolean;
  readonly applied: number;
  readonly unresolved: number;
  readonly failed: number;
  readonly failureKind?: "LEDGER" | "PERSISTENCE" | "IDENTITY" | "EXECUTION";
}

/**
 * Human and future agent entry point. No agent-specific API.
 *
 * MOVE: visualModel.resolve → placement.planMove → executor.executeMove → ledger.append.
 */
export interface EditorRuntime {
  readonly visualModel: VisualModel;
  readonly placement: PlacementEngine;
  readonly executor: OperationExecutor;
  readonly ledger: OperationLedger;
  readonly overlays: OverlayCoordinator;
  readonly input: InputRouter;
  readonly lifecycle: RuntimeLifecycle;
  start(): void;
  stop(): void;
  select(element: HTMLElement): VisualNodeId | null;
  toggleSelection(element: HTMLElement): VisualNodeId | null;
  selectRect(rect: IntendedRect, mode: "add" | "replace"): RuntimeSelection;
  selectPolygon(points: readonly { x: number; y: number }[], mode: "add" | "replace"): RuntimeSelection;
  armLasso(mode: "rectangle" | "freeform"): void;
  clearSelection(): void;
  getSelection(): RuntimeSelection;
  selectedNodeIds(): readonly VisualNodeId[];
  measureSelection(): IntendedRect | null;
  measureGroup(groupId: GroupId): IntendedRect | null;
  getGroup(groupId: GroupId): RuntimeVirtualGroup | null;
  groupSelection(): GroupId | null;
  ungroupSelection(): readonly VisualNodeId[];
  copySelection(): boolean;
  pasteClipboard(): BatchExecutionResult;
  deleteSelection(): BatchExecutionResult;
  resizeSelection(targetRect: IntendedRect): BatchExecutionResult;
  rotateSelection(degrees: number): BatchExecutionResult;
  moveSelection(dx: number, dy: number): BatchExecutionResult;
  selectParent(): VisualNodeId | null;
  move(nodeId: VisualNodeId, dx: number, dy: number): ExecutionResult;
  layer(nodeId: VisualNodeId, command: LayerCommand): ExecutionResult;
  styleSelection(styles: ReadonlyMap<StyleProperty, string>): BatchExecutionResult;
  editSelectedText(value: string): ExecutionResult;
  cropSelection(insets: CropOperation["payload"]): ExecutionResult;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): BatchExecutionResult;
  redo(): BatchExecutionResult;
  save(): Promise<PersistResult>;
  replay(): Promise<ReplayResult>;
}
