import type { EditorOperation } from "../editor/operations.js";
import type { LedgerEntry, OperationLedger } from "./operation-ledger.js";

export function createOperationLedger(): OperationLedger {
  const entries: LedgerEntry[] = [];
  let cursor = 0;
  let persistedRevision = 0;
  let transactionCounter = 0;

  const nextTransactionId = (): string => {
    transactionCounter += 1;
    return `otf-tx-${transactionCounter.toString(36)}`;
  };

  const transactionAt = (index: number): LedgerEntry[] => {
    const entry = entries[index];
    if (!entry) return [];
    let start = index;
    let end = index;
    while (start > 0 && entries[start - 1]?.transactionId === entry.transactionId) start -= 1;
    while (end + 1 < entries.length && entries[end + 1]?.transactionId === entry.transactionId) end += 1;
    return entries.slice(start, end + 1);
  };

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
      ledger.commitBatch([operation]);
    },
    commitBatch(operations: readonly EditorOperation[]): void {
      if (operations.length === 0) return;
      if (cursor < entries.length) {
        entries.splice(cursor);
      }
      const transactionId = nextTransactionId();
      entries.push(...operations.map((operation) => ({ operation, transactionId })));
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
    peekUndoTransaction(): readonly EditorOperation[] {
      return transactionAt(cursor - 1).map((entry) => entry.operation);
    },
    peekRedoTransaction(): readonly EditorOperation[] {
      return transactionAt(cursor).map((entry) => entry.operation);
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
    confirmUndoTransaction(): readonly EditorOperation[] {
      const operations = ledger.peekUndoTransaction();
      cursor -= operations.length;
      return operations;
    },
    confirmRedoTransaction(): readonly EditorOperation[] {
      const operations = ledger.peekRedoTransaction();
      cursor += operations.length;
      return operations;
    },
    markPersisted(): void {
      persistedRevision = cursor;
    },
    hydratePersisted(operations: readonly EditorOperation[]): void {
      entries.splice(0, entries.length, ...operations.map((operation) => ({
        operation,
        transactionId: nextTransactionId(),
      })));
      cursor = entries.length;
      persistedRevision = cursor;
    },
  };

  return ledger;
}
