import type { EditorOperation } from "../editor/operations.js";

/**
 * Single writable operation owner. History, dirty, and save state are derived
 * from this ledger. Persistence is a projection, not a second ledger.
 */
export interface OperationLedger {
  readonly operations: readonly EditorOperation[];
  append(operations: readonly EditorOperation[]): void;
  undo(): readonly EditorOperation[] | null;
  redo(): readonly EditorOperation[] | null;
  drafts(): readonly EditorOperation[];
  committed(): readonly EditorOperation[];
  markCommitted(ids: readonly string[]): void;
}
