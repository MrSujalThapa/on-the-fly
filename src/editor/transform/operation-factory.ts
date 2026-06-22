import type { OperationId, PageKey } from "../ids.js";
import type {
  MoveOperation,
  ResizeMode,
  ResizeOperation,
  RotateOperation,
  ZIndexOperation,
} from "../operations.js";
import { createOperationId } from "./operation-id.js";
import {
  transformTargetToEditorTarget,
  type TransformTarget,
} from "./transform-target.js";

export interface BuildOperationOptions {
  pageKey: PageKey;
  now?: number;
  createId?: () => OperationId;
}

function resolveMeta(options: BuildOperationOptions): { id: OperationId; createdAt: number } {
  return {
    id: (options.createId ?? createOperationId)(),
    createdAt: options.now ?? Date.now(),
  };
}

export function buildMoveOperation(
  target: TransformTarget,
  dx: number,
  dy: number,
  options: BuildOperationOptions,
): MoveOperation {
  const { id, createdAt } = resolveMeta(options);
  return {
    id,
    type: "move",
    pageKey: options.pageKey,
    target: transformTargetToEditorTarget(target),
    payload: { dx, dy },
    createdAt,
    source: "manual",
    status: "approved",
  };
}

export function buildMoveOperations(
  targets: TransformTarget[],
  dx: number,
  dy: number,
  options: BuildOperationOptions,
): MoveOperation[] {
  return targets.map((target) => buildMoveOperation(target, dx, dy, options));
}

export interface ResizePayloadInput {
  width: number;
  height: number;
  mode?: ResizeMode;
}

export function buildResizeOperation(
  target: TransformTarget,
  resize: ResizePayloadInput,
  options: BuildOperationOptions,
): ResizeOperation {
  const { id, createdAt } = resolveMeta(options);
  return {
    id,
    type: "resize",
    pageKey: options.pageKey,
    target: transformTargetToEditorTarget(target),
    payload: {
      width: resize.width,
      height: resize.height,
      mode: resize.mode ?? "box",
    },
    createdAt,
    source: "manual",
    status: "approved",
  };
}

export function buildRotateOperation(
  target: TransformTarget,
  degrees: number,
  options: BuildOperationOptions,
): RotateOperation {
  const { id, createdAt } = resolveMeta(options);
  return {
    id,
    type: "rotate",
    pageKey: options.pageKey,
    target: transformTargetToEditorTarget(target),
    payload: { degrees },
    createdAt,
    source: "manual",
    status: "approved",
  };
}

export function buildZIndexOperation(
  target: TransformTarget,
  layer: number,
  previousLayer: number | undefined,
  options: BuildOperationOptions,
): ZIndexOperation {
  const { id, createdAt } = resolveMeta(options);
  const payload: ZIndexOperation["payload"] =
    previousLayer === undefined ? { layer } : { layer, previousLayer };
  return {
    id,
    type: "zIndex",
    pageKey: options.pageKey,
    target: transformTargetToEditorTarget(target),
    payload,
    createdAt,
    source: "manual",
    status: "approved",
  };
}
