import type { EditorOperation } from "../editor/operations.js";

export interface LedgerEntry {
  readonly operation: EditorOperation;
  readonly transactionId: string;
}

/**
 * Single writable operation owner. History, dirty, and save state are derived
 * from this ledger. Persistence is a projection, not a second ledger.
 *
 * Cursor moves only after the caller has verified the corresponding DOM change.
 */
export interface OperationLedger {
  readonly entries: readonly LedgerEntry[];
  readonly cursor: number;
  readonly persistedRevision: number;
  activeOperations(): readonly EditorOperation[];
  canUndo(): boolean;
  canRedo(): boolean;
  isDirty(): boolean;
  /** After a successful verified mutation. Truncates the redo tail. */
  commit(operation: EditorOperation): void;
  commitBatch(operations: readonly EditorOperation[]): void;
  peekUndo(): EditorOperation | null;
  peekRedo(): EditorOperation | null;
  peekUndoTransaction(): readonly EditorOperation[];
  peekRedoTransaction(): readonly EditorOperation[];
  /** After a successful verified DOM revert. */
  confirmUndo(): EditorOperation | null;
  /** After a successful verified DOM reapplication. */
  confirmRedo(): EditorOperation | null;
  confirmUndoTransaction(): readonly EditorOperation[];
  confirmRedoTransaction(): readonly EditorOperation[];
  markPersisted(revision?: number): void;
  hydratePersisted(operations: readonly EditorOperation[]): void;
}
