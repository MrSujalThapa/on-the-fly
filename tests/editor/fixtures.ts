import type { ElementSignature } from "../../src/editor/element-signature.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type { EditorTarget } from "../../src/editor/editor-target.js";
import type { HideOperation, InsertHelperObjectOperation, MoveOperation, ResizeOperation, RotateOperation, StyleOperation, TextOperation } from "../../src/editor/operations.js";

const PAGE_KEY = "https://example.com/";

export function createTestSignature(overrides: Partial<ElementSignature> = {}): ElementSignature {
  return {
    cssPath: "main article p.intro",
    tagName: "p",
    classList: ["intro"],
    boundingBoxHint: createEmptyBoundingBoxHint(),
    ...overrides,
  };
}

export function createTestTarget(overrides: Partial<EditorTarget> = {}): EditorTarget {
  return {
    nodeId: "node-1",
    signature: createTestSignature(),
    ...overrides,
  };
}

export function createStyleOperation(overrides: Partial<StyleOperation> = {}): StyleOperation {
  return {
    id: "op-style-1",
    type: "style",
    pageKey: PAGE_KEY,
    target: createTestTarget(),
    payload: {
      property: "color",
      value: "rgb(0, 0, 0)",
    },
    createdAt: 1_700_000_000_000,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

export function createHideOperation(overrides: Partial<HideOperation> = {}): HideOperation {
  return {
    id: "op-hide-1",
    type: "hide",
    pageKey: PAGE_KEY,
    target: createTestTarget({ nodeId: "node-2" }),
    payload: {
      hidden: true,
    },
    createdAt: 1_700_000_000_001,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

export function createMoveOperation(overrides: Partial<MoveOperation> = {}): MoveOperation {
  return {
    id: "op-move-1",
    type: "move",
    pageKey: PAGE_KEY,
    target: createTestTarget(),
    payload: { dx: 10, dy: 5 },
    createdAt: 1_700_000_000_002,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

export function createRotateOperation(overrides: Partial<RotateOperation> = {}): RotateOperation {
  return {
    id: "op-rotate-1",
    type: "rotate",
    pageKey: PAGE_KEY,
    target: createTestTarget(),
    payload: { degrees: 15 },
    createdAt: 1_700_000_000_003,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

export function createResizeOperation(overrides: Partial<ResizeOperation> = {}): ResizeOperation {
  return {
    id: "op-resize-1",
    type: "resize",
    pageKey: PAGE_KEY,
    target: createTestTarget(),
    payload: { width: 120, height: 80, mode: "box" },
    createdAt: 1_700_000_000_004,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

export function createTextOperation(overrides: Partial<TextOperation> = {}): TextOperation {
  return {
    id: "op-text-1",
    type: "text",
    pageKey: PAGE_KEY,
    target: createTestTarget(),
    payload: { value: "Updated", preserveFormat: true },
    createdAt: 1_700_000_000_005,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

export function createInsertHelperObjectOperation(
  overrides: Partial<InsertHelperObjectOperation> = {},
): InsertHelperObjectOperation {
  return {
    id: "op-helper-1",
    type: "insertHelperObject",
    pageKey: PAGE_KEY,
    target: {
      nodeId: "helper-panel-1",
      signature: createTestSignature({
        cssPath: "#otf-helper-helper-panel-1",
        tagName: "div",
        idAttr: "otf-helper-helper-panel-1",
        classList: ["otf-helper-object"],
      }),
    },
    payload: {
      helperId: "helper-panel-1",
      role: "backgroundPanel",
      rect: { x: 24, y: 32, width: 240, height: 120 },
      fill: {
        type: "linearGradient",
        angleDeg: 135,
        stops: [
          { color: "#ffffff", position: 0 },
          { color: "#f1f5f9", position: 100 },
        ],
      },
      borderRadius: "16px",
      opacity: 0.95,
      boxShadow: {
        offsetX: 0,
        offsetY: 12,
        blurRadius: 28,
        spreadRadius: 0,
        color: "rgba(15, 23, 42, 0.18)",
      },
      zIndex: 3,
      border: {
        width: 1,
        color: "#e2e8f0",
        style: "solid",
      },
      label: "Generated background panel",
    },
    createdAt: 1_700_000_000_006,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

export { PAGE_KEY };
