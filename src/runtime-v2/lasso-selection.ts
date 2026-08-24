import type { IntendedRect } from "./placement-engine.js";

const MAX_SAMPLES = 64;
const SAMPLE_SPACING_PX = 24;
export const LASSO_THRESHOLD_PX = 6;
export const MEANINGFUL_OVERLAP_RATIO = 0.5;

export function normalizeRect(startX: number, startY: number, endX: number, endY: number): IntendedRect {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function buildLassoSampleGrid(rect: IntendedRect): Array<{ x: number; y: number }> {
  let cols = Math.max(2, Math.ceil(rect.width / SAMPLE_SPACING_PX) + 1);
  let rows = Math.max(2, Math.ceil(rect.height / SAMPLE_SPACING_PX) + 1);
  while (cols * rows > MAX_SAMPLES) {
    if (cols >= rows && cols > 2) cols -= 1;
    else if (rows > 2) rows -= 1;
    else break;
  }
  const points: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      points.push({
        x: rect.x + (rect.width * col) / Math.max(1, cols - 1),
        y: rect.y + (rect.height * row) / Math.max(1, rows - 1),
      });
    }
  }
  return points;
}

export function meaningfullyIntersects(candidate: IntendedRect, lasso: IntendedRect): boolean {
  const centerX = candidate.x + candidate.width / 2;
  const centerY = candidate.y + candidate.height / 2;
  if (
    centerX >= lasso.x && centerX <= lasso.x + lasso.width &&
    centerY >= lasso.y && centerY <= lasso.y + lasso.height
  ) return true;
  const overlapWidth = Math.max(0, Math.min(candidate.x + candidate.width, lasso.x + lasso.width) - Math.max(candidate.x, lasso.x));
  const overlapHeight = Math.max(0, Math.min(candidate.y + candidate.height, lasso.y + lasso.height) - Math.max(candidate.y, lasso.y));
  return (overlapWidth * overlapHeight) / Math.max(1, candidate.width * candidate.height) >= MEANINGFUL_OVERLAP_RATIO;
}
