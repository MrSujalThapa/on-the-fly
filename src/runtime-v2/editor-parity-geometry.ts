import type { IntendedRect } from "./placement-engine.js";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export function resizeRectFromCorner(start: IntendedRect, corner: ResizeCorner, dx: number, dy: number, min = 8): IntendedRect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const x = corner.includes("w") ? Math.min(start.x + dx, right - min) : start.x;
  const y = corner.includes("n") ? Math.min(start.y + dy, bottom - min) : start.y;
  const nextRight = corner.includes("e") ? Math.max(start.x + min, right + dx) : right;
  const nextBottom = corner.includes("s") ? Math.max(start.y + min, bottom + dy) : bottom;
  return { x, y, width: nextRight - x, height: nextBottom - y };
}

export function scaleRects(startUnion: IntendedRect, targetUnion: IntendedRect, rects: readonly IntendedRect[]): IntendedRect[] {
  const sx = targetUnion.width / startUnion.width;
  const sy = targetUnion.height / startUnion.height;
  return rects.map((rect) => ({
    x: targetUnion.x + (rect.x - startUnion.x) * sx,
    y: targetUnion.y + (rect.y - startUnion.y) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  }));
}

/**
 * Multi/group resize owns member geometry, not a synthetic group box.
 * Scale G → G', then each movement-root world rect Ri → Ri'. Local size
 * scales with G; unrotated local size is the planned world size.
 */
export function planMultiResizeMembers(
  startUnion: IntendedRect,
  targetUnion: IntendedRect,
  members: readonly {
    rect: IntendedRect;
    local: { width: number; height: number };
    rotate: number;
  }[],
): Array<{ aabb: IntendedRect; local: { width: number; height: number } }> {
  const width = Math.max(1, startUnion.width);
  const height = Math.max(1, startUnion.height);
  const sx = targetUnion.width / width;
  const sy = targetUnion.height / height;
  const scaled = scaleRects(
    { ...startUnion, width, height },
    targetUnion,
    members.map((member) => member.rect),
  );
  return members.map((member, index) => {
    const aabb = scaled[index] ?? member.rect;
    if (Math.abs(member.rotate) < 0.01) {
      return { aabb, local: { width: aabb.width, height: aabb.height } };
    }
    return {
      aabb,
      local: {
        width: Math.max(8, member.local.width * sx),
        height: Math.max(8, member.local.height * sy),
      },
    };
  });
}

export function rotatePointAroundCenter(point: { x: number; y: number }, center: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function rotatedMemberRect(rect: IntendedRect, union: IntendedRect, degrees: number): IntendedRect {
  const center = { x: union.x + union.width / 2, y: union.y + union.height / 2 };
  const member = rotatePointAroundCenter({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, center, degrees);
  return { x: member.x - rect.width / 2, y: member.y - rect.height / 2, width: rect.width, height: rect.height };
}

export function localSizeForRotatedBounds(
  width: number,
  height: number,
  degrees: number,
  currentLocal: { width: number; height: number },
): { width: number; height: number } {
  const radians = degrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const determinant = cos * cos - sin * sin;
  if (Math.abs(determinant) > 0.08) {
    const localWidth = (width * cos - height * sin) / determinant;
    const localHeight = (height * cos - width * sin) / determinant;
    if (localWidth > 1 && localHeight > 1) return { width: localWidth, height: localHeight };
  }
  const currentBoundsWidth = cos * currentLocal.width + sin * currentLocal.height;
  const currentBoundsHeight = sin * currentLocal.width + cos * currentLocal.height;
  const scale = Math.min(width / Math.max(1, currentBoundsWidth), height / Math.max(1, currentBoundsHeight));
  return { width: Math.max(8, currentLocal.width * scale), height: Math.max(8, currentLocal.height * scale) };
}

/** World AABB size of a local border-box rotated by `degrees` around its center. */
export function aabbSizeFromLocal(
  local: { width: number; height: number },
  degrees: number,
): { width: number; height: number } {
  const radians = degrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: local.width * cos + local.height * sin,
    height: local.width * sin + local.height * cos,
  };
}

/** World AABB whose origin is `origin` and whose size is the rotated local box. */
export function aabbFromLocalSize(
  origin: { x: number; y: number },
  local: { width: number; height: number },
  degrees: number,
): IntendedRect {
  return { x: origin.x, y: origin.y, ...aabbSizeFromLocal(local, degrees) };
}

/**
 * Convert a screen-space handle drag into new LOCAL width/height, then derive
 * the world AABB. Handles sit on the AABB; persistent size stays unrotated.
 * Opposite local corner stays fixed in world space (identity with
 * `resizeRectFromCorner` at 0°).
 */
export function resizeLocalFromScreenDelta(
  local: { width: number; height: number },
  aabb: IntendedRect,
  degrees: number,
  corner: ResizeCorner,
  screenDx: number,
  screenDy: number,
  min = 8,
): { local: { width: number; height: number }; aabb: IntendedRect } {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const localDx = screenDx * cos + screenDy * sin;
  const localDy = -screenDx * sin + screenDy * cos;
  let width = local.width;
  let height = local.height;
  if (corner.includes("e")) width += localDx;
  if (corner.includes("w")) width -= localDx;
  if (corner.includes("s")) height += localDy;
  if (corner.includes("n")) height -= localDy;
  width = Math.max(min, width);
  height = Math.max(min, height);
  const dw = width - local.width;
  const dh = height - local.height;
  const signX = corner.includes("e") ? 1 : corner.includes("w") ? -1 : 0;
  const signY = corner.includes("s") ? 1 : corner.includes("n") ? -1 : 0;
  const localShiftX = signX * dw / 2;
  const localShiftY = signY * dh / 2;
  const center = { x: aabb.x + aabb.width / 2, y: aabb.y + aabb.height / 2 };
  const nextCenter = {
    x: center.x + localShiftX * cos - localShiftY * sin,
    y: center.y + localShiftX * sin + localShiftY * cos,
  };
  const size = aabbSizeFromLocal({ width, height }, degrees);
  return {
    local: { width, height },
    aabb: {
      x: nextCenter.x - size.width / 2,
      y: nextCenter.y - size.height / 2,
      width: size.width,
      height: size.height,
    },
  };
}
