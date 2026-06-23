import { describe, expect, it } from "vitest";
import {
  appendDraftOperations,
  appendPreviewOperations,
  clearAllOperations,
  clearPreviewOperations,
  createSessionOperationState,
  getAppliedOperations,
  hasUnsavedChanges,
  promoteAllDraftToSaved,
  promoteDraftOperationsToSaved,
  promotePreviewOperationsToDraft,
  removeDraftOperationsById,
} from "../../src/content/session-operation-state.js";
import { createHideOperation, createStyleOperation, createTestTarget } from "../editor/fixtures.js";
import type { ZIndexOperation } from "../../src/editor/operations.js";

const PAGE_KEY = "https://example.com/";

function createZIndexOperation(overrides: Partial<ZIndexOperation> = {}): ZIndexOperation {
  return {
    id: "op-z-1",
    type: "zIndex",
    pageKey: PAGE_KEY,
    target: createTestTarget(),
    payload: { layer: 2, previousLayer: 1 },
    createdAt: 1,
    source: "manual",
    status: "draft",
    ...overrides,
  };
}

describe("session operation state", () => {
  it("tracks saved and draft operations separately", () => {
    const saved = createStyleOperation({ id: "saved-1", status: "approved" });
    let state = createSessionOperationState([saved]);
    state = appendDraftOperations(state, [createHideOperation({ id: "draft-1" })]);

    expect(state.savedOperations).toHaveLength(1);
    expect(state.draftOperations).toHaveLength(1);
    expect(state.previewOperations).toHaveLength(0);
    expect(getAppliedOperations(state)).toHaveLength(2);
    expect(hasUnsavedChanges(state)).toBe(true);
  });

  it("tracks preview operations separately from saved operations and drafts", () => {
    const saved = createStyleOperation({ id: "saved-1", status: "approved" });
    let state = createSessionOperationState([saved]);
    state = appendDraftOperations(state, [createHideOperation({ id: "draft-1" })]);
    state = appendPreviewOperations(state, [createStyleOperation({ id: "preview-1" })]);

    expect(state.savedOperations.map((operation) => operation.id)).toEqual(["saved-1"]);
    expect(state.draftOperations.map((operation) => operation.id)).toEqual(["draft-1"]);
    expect(state.previewOperations.map((operation) => operation.id)).toEqual(["preview-1"]);
    expect(state.previewOperations.every((operation) => operation.status === "preview")).toBe(true);
    expect(getAppliedOperations(state).map((operation) => operation.id)).toEqual([
      "saved-1",
      "draft-1",
      "preview-1",
    ]);
  });

  it("rejects preview state without touching saved operations or drafts", () => {
    let state = createSessionOperationState([createStyleOperation({ id: "saved-1" })]);
    state = appendDraftOperations(state, [createHideOperation({ id: "draft-1" })]);
    state = appendPreviewOperations(state, [createStyleOperation({ id: "preview-1" })]);

    state = clearPreviewOperations(state);

    expect(state.savedOperations.map((operation) => operation.id)).toEqual(["saved-1"]);
    expect(state.draftOperations.map((operation) => operation.id)).toEqual(["draft-1"]);
    expect(state.previewOperations).toHaveLength(0);
  });

  it("does not save preview operations unless they are explicitly promoted", () => {
    let state = createSessionOperationState([]);
    state = appendPreviewOperations(state, [createStyleOperation({ id: "preview-1" })]);

    state = promoteAllDraftToSaved(state);
    expect(state.savedOperations).toHaveLength(0);
    expect(state.previewOperations.map((operation) => operation.id)).toEqual(["preview-1"]);

    state = promotePreviewOperationsToDraft(state);
    expect(state.previewOperations).toHaveLength(0);
    expect(state.draftOperations.map((operation) => operation.id)).toEqual(["preview-1"]);

    state = promoteAllDraftToSaved(state);
    expect(state.savedOperations.map((operation) => operation.id)).toEqual(["preview-1"]);
    expect(state.savedOperations.every((operation) => operation.status === "approved")).toBe(true);
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
    expect(state.previewOperations).toHaveLength(0);
    expect(state.savedOperations.every((operation) => operation.status === "approved")).toBe(true);
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("promotes only the latest zIndex draft per target when saving", () => {
    let state = createSessionOperationState([
      createZIndexOperation({ id: "saved-z-back", status: "approved", payload: { layer: 0, previousLayer: 1 } }),
    ]);

    state = appendDraftOperations(state, [
      createZIndexOperation({ id: "draft-z-back", payload: { layer: 0, previousLayer: 1 }, createdAt: 2 }),
      createZIndexOperation({
        id: "draft-z-front",
        payload: { layer: 2_147_483_000, previousLayer: 0 },
        createdAt: 3,
      }),
    ]);

    state = promoteAllDraftToSaved(state);

    expect(state.savedOperations).toHaveLength(1);
    expect(state.savedOperations[0]?.id).toBe("draft-z-front");
    expect(state.savedOperations[0]?.status).toBe("approved");
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
    expect(state.previewOperations).toHaveLength(0);
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
    expect(state.previewOperations).toHaveLength(0);
  });
});
