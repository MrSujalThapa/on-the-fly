import type { EditorOperation, ZIndexOperation } from "../operations.js";
import type { LayerCommand } from "../transform/layer-order.js";
import {
  contentIdentityTargetKey,
  zIndexOperationsShareTarget,
} from "../persistence/z-index-target-matching.js";
import { operationTargetKey } from "../persistence/operation-target-key.js";
import { isInteractiveElement } from "../dom/interactive-safety.js";
import { areDiagnosticsEnabled } from "../../shared/diagnostics.js";

export interface ZIndexOperationDiagnostic {
  phase: "created" | "saved" | "replayed" | "skipped";
  operationId: string;
  targetKey: string | null;
  contentKey: string | null;
  nodeId: string | null;
  previousLayer: number | null;
  layer: number;
  sourceCommand: string | null;
  reason?: string;
}

export interface MoveStrategyDiagnostic {
  operationId: string;
  tag: string;
  strategy: "detached" | "interaction-safe-fixed" | "transform-only" | "in-flow";
  interactive: boolean;
  parentTag: string | null;
  parentId: string | null;
  rootTag: string | null;
  detached: boolean;
}

export type EditorDiagnosticLogger = (message: string, data?: unknown) => void;

export function logZIndexOperationDiagnostic(
  onDebug: EditorDiagnosticLogger | undefined,
  diagnostic: ZIndexOperationDiagnostic,
): void {
  onDebug?.("zindex-op", diagnostic);
}

export function describeZIndexOperation(
  operation: ZIndexOperation,
  phase: ZIndexOperationDiagnostic["phase"],
  options: { sourceCommand?: string | null; reason?: string } = {},
): ZIndexOperationDiagnostic {
  return {
    phase,
    operationId: operation.id,
    targetKey: operationTargetKey(operation),
    contentKey: contentIdentityTargetKey(operation.target.signature),
    nodeId: operation.target.nodeId ?? null,
    previousLayer: operation.payload.previousLayer ?? null,
    layer: operation.payload.layer,
    sourceCommand: options.sourceCommand ?? operation.metadata?.sourceCommand ?? null,
    ...(options.reason ? { reason: options.reason } : {}),
  };
}

export function logMoveStrategyDiagnostic(
  onDebug: EditorDiagnosticLogger | undefined,
  element: HTMLElement,
  operationId: string,
  strategy: MoveStrategyDiagnostic["strategy"],
  detached: boolean,
): void {
  // Guarded because the payload reads the DOM once per moved element per commit.
  if (!areDiagnosticsEnabled()) {
    return;
  }

  const parent = element.parentElement;
  const root = element.ownerDocument.documentElement;
  onDebug?.("move-strategy", {
    operationId,
    tag: element.tagName.toLowerCase(),
    strategy,
    interactive: isInteractiveElement(element),
    parentTag: parent?.tagName.toLowerCase() ?? null,
    parentId: parent?.id ?? null,
    rootTag: root.tagName.toLowerCase(),
    detached,
  } satisfies MoveStrategyDiagnostic);
}

export function layerCommandToSource(command: LayerCommand): string {
  return `layer:${command}`;
}

export function logZIndexBatchDiagnostics(
  onDebug: EditorDiagnosticLogger | undefined,
  phase: "saved" | "replayed" | "skipped",
  operations: readonly EditorOperation[],
  reason?: string,
): void {
  // Guarded because describing an operation rebuilds two target keys per op.
  if (!areDiagnosticsEnabled()) {
    return;
  }

  for (const operation of operations) {
    if (operation.type !== "zIndex") {
      continue;
    }
    logZIndexOperationDiagnostic(
      onDebug,
      describeZIndexOperation(operation, phase, reason ? { reason } : {}),
    );
  }
}

export function findSupersededZIndexOperations(
  existing: readonly EditorOperation[],
  incoming: readonly ZIndexOperation[],
): ZIndexOperation[] {
  return existing.filter(
    (operation): operation is ZIndexOperation =>
      operation.type === "zIndex" &&
      incoming.some((candidate) => zIndexOperationsShareTarget(operation, candidate)),
  );
}
