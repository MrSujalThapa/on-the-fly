import type { VisualNodeRect } from "../visual-node.js";
import type { ResizeHandleId } from "./resize-geometry.js";

export interface CropInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const MIN_CROP_VISIBLE_PX = 8;

export function createEmptyCropInsets(): CropInsets {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function isCropped(insets: CropInsets): boolean {
  return insets.top > 0 || insets.right > 0 || insets.bottom > 0 || insets.left > 0;
}

/**
 * Computes new crop insets from a handle drag. Crop is conceptually different
 * from resize: the element box keeps its size, and the inset clips the visible
 * region (no content stretching). Dragging a handle inward grows the inset on
 * that edge; corner handles affect two edges. Insets are clamped to stay
 * non-negative and to keep a minimum visible region.
 */
export function computeCrop(
  rect: VisualNodeRect,
  handle: ResizeHandleId,
  base: CropInsets,
  pointerDx: number,
  pointerDy: number,
  minVisible: number = MIN_CROP_VISIBLE_PX,
): CropInsets {
  let { top, right, bottom, left } = base;

  if (handle.includes("e")) {
    right = base.right - pointerDx;
  }
  if (handle.includes("w")) {
    left = base.left + pointerDx;
  }
  if (handle.includes("s")) {
    bottom = base.bottom - pointerDy;
  }
  if (handle.includes("n")) {
    top = base.top + pointerDy;
  }

  left = Math.max(0, left);
  right = Math.max(0, right);
  top = Math.max(0, top);
  bottom = Math.max(0, bottom);

  const maxHorizontal = Math.max(0, rect.width - minVisible);
  const maxVertical = Math.max(0, rect.height - minVisible);

  if (left + right > maxHorizontal) {
    if (handle.includes("w")) {
      left = Math.max(0, maxHorizontal - right);
    } else {
      right = Math.max(0, maxHorizontal - left);
    }
  }

  if (top + bottom > maxVertical) {
    if (handle.includes("n")) {
      top = Math.max(0, maxVertical - bottom);
    } else {
      bottom = Math.max(0, maxVertical - top);
    }
  }

  return { top, right, bottom, left };
}

/** Returns the visible region rect after applying crop insets. */
export function applyCropToRect(rect: VisualNodeRect, insets: CropInsets): VisualNodeRect {
  return {
    x: rect.x + insets.left,
    y: rect.y + insets.top,
    width: Math.max(0, rect.width - insets.left - insets.right),
    height: Math.max(0, rect.height - insets.top - insets.bottom),
  };
}

/** Serializes insets into a CSS `inset(...)` clip-path value in pixels. */
export function cropInsetsToClipPath(insets: CropInsets): string {
  return `inset(${String(insets.top)}px ${String(insets.right)}px ${String(insets.bottom)}px ${String(insets.left)}px)`;
}
