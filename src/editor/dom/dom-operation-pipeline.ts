import type { EditorState } from "../editor-state.js";
import {
  applyOperation as applyStateOperation,
  revertOperation as revertStateOperation,
} from "../engine/apply-operation.js";
import type { EditorHistory, HistoryRedoResult, HistoryUndoResult } from "../history/history-manager.js";
import {
  commitBatch,
  createBatchFromOperations,
  createEditorHistory,
  redo as redoHistory,
  undo as undoHistory,
} from "../history/history-manager.js";
import type { EditorOperation } from "../operations.js";
import { DomRuntimeAdapter } from "./dom-runtime-adapter.js";
import type { DomApplyResult } from "./types.js";

export interface DomPipelineApplyResult {
  state: EditorState;
  dom: DomApplyResult;
}

export interface DomPipelineBatchResult {
  state: EditorState;
  history: EditorHistory;
  dom: DomApplyResult[];
  batchId: string;
}

export class DomOperationPipeline {
  constructor(private readonly adapter: DomRuntimeAdapter) {}

  apply(state: EditorState, operation: EditorOperation): DomPipelineApplyResult {
    const dom = this.adapter.applyOperation(operation);
    if (!dom.ok) {
      return { state, dom };
    }

    return {
      state: applyStateOperation(state, operation),
      dom,
    };
  }

  revert(state: EditorState, operation: EditorOperation): DomPipelineApplyResult {
    const dom = this.adapter.revertOperation(operation);
    if (!dom.ok) {
      return { state, dom };
    }

    return {
      state: revertStateOperation(state, operation),
      dom,
    };
  }

  replay(state: EditorState, operations: EditorOperation[]): { state: EditorState; dom: DomApplyResult[] } {
    let nextState = state;
    const domResults: DomApplyResult[] = [];

    for (const operation of operations) {
      const result = this.apply(nextState, operation);
      nextState = result.state;
      domResults.push(result.dom);
      if (!result.dom.ok) {
        break;
      }
    }

    return { state: nextState, dom: domResults };
  }

  commitBatch(
    state: EditorState,
    history: EditorHistory,
    operations: EditorOperation[],
    batchId: string,
    createdAt: number,
    label?: string,
  ): DomPipelineBatchResult {
    const batch = createBatchFromOperations(batchId, operations, createdAt, label);
    const domResults: DomApplyResult[] = [];
    const appliedOperations: EditorOperation[] = [];
    let nextState = state;

    for (const operation of batch.operations) {
      const result = this.apply(nextState, operation);
      domResults.push(result.dom);

      if (!result.dom.ok) {
        for (const appliedOperation of [...appliedOperations].reverse()) {
          this.adapter.revertOperation(appliedOperation);
        }

        return {
          state,
          history,
          dom: domResults,
          batchId,
        };
      }

      appliedOperations.push(operation);
      nextState = result.state;
    }

    const committed = commitBatch(nextState, history, batch);
    return {
      state: committed.state,
      history: committed.history,
      dom: domResults,
      batchId,
    };
  }

  undo(
    state: EditorState,
    history: EditorHistory,
  ): (HistoryUndoResult & { dom: DomApplyResult[] }) | null {
    const batch = history.undoStack.at(-1);
    if (!batch) {
      return null;
    }

    const domResults: DomApplyResult[] = [];
    for (const operation of [...batch.operations].reverse()) {
      domResults.push(this.adapter.revertOperation(operation));
    }

    const undone = undoHistory(history, state);
    if (!undone) {
      return null;
    }

    return { ...undone, dom: domResults };
  }

  redo(
    state: EditorState,
    history: EditorHistory,
  ): (HistoryRedoResult & { dom: DomApplyResult[] }) | null {
    const batch = history.redoStack.at(-1);
    if (!batch) {
      return null;
    }

    const domResults: DomApplyResult[] = [];
    for (const operation of batch.operations) {
      domResults.push(this.adapter.applyOperation(operation));
    }

    const redone = redoHistory(history, state);
    if (!redone) {
      return null;
    }

    return { ...redone, dom: domResults };
  }
}

export function createDomOperationPipeline(root: ParentNode): DomOperationPipeline {
  return new DomOperationPipeline(new DomRuntimeAdapter(root));
}

export { createEditorHistory };

export type { HistoryUndoResult, HistoryRedoResult };
