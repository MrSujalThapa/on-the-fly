import type { OperationId } from "../ids.js";
import type { EditorOperation } from "../operations.js";
import {
  captureElementDomSnapshot,
  captureMissingElementDomSnapshot,
  elementSnapshotKey,
  restoreElementDomSnapshot,
  type ElementDomSnapshot,
} from "./dom-placement-snapshot.js";

export interface AffectedElementSnapshots {
  elementKey: string;
  operationIds: OperationId[];
  before: ElementDomSnapshot;
  after: ElementDomSnapshot;
}

export interface OperationBatchSnapshot {
  elements: AffectedElementSnapshots[];
}

export function createEmptyBatchSnapshot(): OperationBatchSnapshot {
  return { elements: [] };
}

export function buildBatchSnapshotFromEffects(
  root: ParentNode,
  operations: readonly EditorOperation[],
  effects: ReadonlyMap<
    OperationId,
    {
      element: HTMLElement;
      beforeSnapshot: ElementDomSnapshot;
      afterSnapshot: ElementDomSnapshot;
    }
  >,
): OperationBatchSnapshot {
  const byKey = new Map<string, AffectedElementSnapshots>();

  for (const operation of operations) {
    const effect = effects.get(operation.id);
    if (!effect) {
      continue;
    }

    const elementKey = elementSnapshotKey(effect.element, root);
    const existing = byKey.get(elementKey);
    if (existing) {
      existing.operationIds.push(operation.id);
      existing.after = effect.afterSnapshot;
      continue;
    }

    byKey.set(elementKey, {
      elementKey,
      operationIds: [operation.id],
      before: effect.beforeSnapshot,
      after: effect.afterSnapshot,
    });
  }

  return { elements: [...byKey.values()] };
}

export function captureBeforeSnapshots(
  root: ParentNode,
  elements: readonly HTMLElement[],
): Map<string, ElementDomSnapshot> {
  const snapshots = new Map<string, ElementDomSnapshot>();
  for (const element of elements) {
    snapshots.set(elementSnapshotKey(element, root), captureElementDomSnapshot(element, root));
  }
  return snapshots;
}

export function captureAfterSnapshots(
  root: ParentNode,
  elements: readonly HTMLElement[],
  beforeByKey: ReadonlyMap<string, ElementDomSnapshot>,
): Map<string, ElementDomSnapshot> {
  const snapshots = new Map<string, ElementDomSnapshot>();
  for (const element of elements) {
    const key = elementSnapshotKey(element, root);
    const before = beforeByKey.get(key);
    snapshots.set(
      key,
      element.isConnected
        ? captureElementDomSnapshot(element, root, { existed: before?.existed ?? true })
        : captureMissingElementDomSnapshot(),
    );
  }
  return snapshots;
}

export function restoreBatchSnapshot(
  root: ParentNode,
  snapshot: OperationBatchSnapshot,
  mode: "before" | "after",
  resolveElement?: (elementKey: string) => HTMLElement | null,
): void {
  for (const entry of snapshot.elements) {
    const targetSnapshot = mode === "before" ? entry.before : entry.after;
    const element = resolveElement?.(entry.elementKey) ?? null;
    restoreElementDomSnapshot(root, targetSnapshot, element);
  }
}
