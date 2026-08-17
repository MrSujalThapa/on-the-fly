import type { EditorOperation } from "../editor/operations.js";
import type { LedgerEntry, OperationLedger } from "./operation-ledger.js";

export function createOperationLedger(): OperationLedger {
  const entries: LedgerEntry[] = [];
  let cursor = 0;
  let persistedRevision = 0;

  const ledger: OperationLedger = {
    get entries(): readonly LedgerEntry[] {
      return entries;
    },
    get cursor(): number {
      return cursor;
    },
    get persistedRevision(): number {
      return persistedRevision;
    },
    activeOperations(): readonly EditorOperation[] {
      return entries.slice(0, cursor).map((entry) => entry.operation);
    },
    canUndo(): boolean {
      return cursor > 0;
    },
    canRedo(): boolean {
      return cursor < entries.length;
    },
    isDirty(): boolean {
      return cursor !== persistedRevision;
    },
    commit(operation: EditorOperation): void {
      if (cursor < entries.length) {
        entries.splice(cursor);
      }
      entries.push({ operation });
      cursor = entries.length;
    },
    peekUndo(): EditorOperation | null {
      if (cursor <= 0) {
        return null;
      }
      return entries[cursor - 1]?.operation ?? null;
    },
    peekRedo(): EditorOperation | null {
      if (cursor >= entries.length) {
        return null;
      }
      return entries[cursor]?.operation ?? null;
    },
    confirmUndo(): EditorOperation | null {
      const operation = ledger.peekUndo();
      if (!operation) {
        return null;
      }
      cursor -= 1;
      return operation;
    },
    confirmRedo(): EditorOperation | null {
      const operation = ledger.peekRedo();
      if (!operation) {
        return null;
      }
      cursor += 1;
      return operation;
    },
    markPersisted(): void {
      persistedRevision = cursor;
    },
    hydratePersisted(operations: readonly EditorOperation[]): void {
      entries.splice(0, entries.length, ...operations.map((operation) => ({ operation })));
      cursor = entries.length;
      persistedRevision = cursor;
    },
  };

  return ledger;
}
