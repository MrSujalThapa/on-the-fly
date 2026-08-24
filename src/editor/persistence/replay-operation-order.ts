import type { EditorOperation } from "../operations.js";

const REPLAY_TYPE_ORDER: Record<string, number> = {
  insertHelperObject: 10,
  createElement: 15,
  duplicate: 20,
  move: 30,
  resize: 40,
  rotate: 50,
  hide: 60,
  style: 70,
  text: 80,
  crop: 90,
  zIndex: 100,
};

/**
 * Stable replay order: preserve save sequence within a type band, but apply
 * structural/transform ops before z-index so layer changes win after moves.
 */
export function sortOperationsForReplay(operations: readonly EditorOperation[]): EditorOperation[] {
  return operations
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => {
      const leftOrder = REPLAY_TYPE_ORDER[left.operation.type] ?? 1000;
      const rightOrder = REPLAY_TYPE_ORDER[right.operation.type] ?? 1000;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.operation);
}
