import { describe, expect, it } from "vitest";
import {
  appendDraftOperations,
  clearAllOperations,
  createSessionOperationState,
  getAppliedOperations,
  hasUnsavedChanges,
  promoteAllDraftToSaved,
  promoteDraftOperationsToSaved,
  removeDraftOperationsById,
} from "../../src/content/session-operation-state.js";
import { createHideOperation, createStyleOperation } from "../editor/fixtures.js";

describe("session operation state", () => {
  it("tracks saved and draft operations separately", () => {
    const saved = createStyleOperation({ id: "saved-1", status: "approved" });
    let state = createSessionOperationState([saved]);
    state = appendDraftOperations(state, [createHideOperation({ id: "draft-1" })]);

    expect(state.savedOperations).toHaveLength(1);
    expect(state.draftOperations).toHaveLength(1);
    expect(getAppliedOperations(state)).toHaveLength(2);
    expect(hasUnsavedChanges(state)).toBe(true);
  });

  it("promotes all drafts to saved on explicit save", () => {
    let state = createSessionOperationState([]);
    state = appendDraftOperations(state, [
      createStyleOperation({ id: "draft-1" }),
      createHideOperation({ id: "draft-2" }),
    ]);

    state = promoteAllDraftToSaved(state);

    expect(state.draftOperations).toHaveLength(0);
    expect(state.savedOperations).toHaveLength(2);
    expect(state.savedOperations.every((operation) => operation.status === "approved")).toBe(true);
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("promotes only kept drafts for save window", () => {
    let state = createSessionOperationState([createStyleOperation({ id: "saved-1" })]);
    state = appendDraftOperations(state, [
      createStyleOperation({ id: "draft-left" }),
      createStyleOperation({ id: "draft-right" }),
    ]);

    const kept = state.draftOperations.filter((operation) => operation.id === "draft-left");
    state = promoteDraftOperationsToSaved(state, kept);

    expect(state.savedOperations.map((operation) => operation.id)).toEqual([
      "saved-1",
      "draft-left",
    ]);
    expect(state.draftOperations.map((operation) => operation.id)).toEqual(["draft-right"]);
  });

  it("removes draft operations by id for undo", () => {
    let state = createSessionOperationState([]);
    state = appendDraftOperations(state, [
      createStyleOperation({ id: "draft-1" }),
      createHideOperation({ id: "draft-2" }),
    ]);

    state = removeDraftOperationsById(state, new Set(["draft-1"]));
    expect(state.draftOperations.map((operation) => operation.id)).toEqual(["draft-2"]);
  });

  it("clears all operations", () => {
    let state = createSessionOperationState([createStyleOperation({ id: "saved-1" })]);
    state = appendDraftOperations(state, [createHideOperation({ id: "draft-1" })]);
    state = clearAllOperations();

    expect(state.savedOperations).toHaveLength(0);
    expect(state.draftOperations).toHaveLength(0);
  });
});
