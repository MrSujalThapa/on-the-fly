import type { VisualNodeRect } from "../visual-node.js";

export type ResizeHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const RESIZE_HANDLE_IDS: readonly ResizeHandleId[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

export const MIN_RESIZE_SIZE_PX = 8;

export interface ResizeResult {
  width: number;
  height: number;
  /** Additional translate needed to keep the opposite edge/corner anchored. */
  dx: number;
  dy: number;
}

export function isResizeHandleId(value: string): value is ResizeHandleId {
  return (RESIZE_HANDLE_IDS as readonly string[]).includes(value);
}

/**
 * Computes the new box size from a handle drag while keeping the opposite
 * edge/corner fixed. `pointerDx`/`pointerDy` are the pointer offsets from the
 * gesture start in client space. The returned `dx`/`dy` is the additional
 * translate the element needs so the anchored edge does not shift.
 */
export function computeResize(
  rect: VisualNodeRect,
  handle: ResizeHandleId,
  pointerDx: number,
  pointerDy: number,
  minSize: number = MIN_RESIZE_SIZE_PX,
): ResizeResult {
  let width = rect.width;
  let height = rect.height;

  if (handle.includes("e")) {
    width = rect.width + pointerDx;
  }
  if (handle.includes("w")) {
    width = rect.width - pointerDx;
  }
  if (handle.includes("s")) {
    height = rect.height + pointerDy;
  }
  if (handle.includes("n")) {
    height = rect.height - pointerDy;
  }

  width = Math.max(minSize, width);
  height = Math.max(minSize, height);

  const dx = handle.includes("w") ? rect.width - width : 0;
  const dy = handle.includes("n") ? rect.height - height : 0;

  return { width, height, dx, dy };
}
