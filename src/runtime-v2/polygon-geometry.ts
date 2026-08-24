import type { IntendedRect } from "./placement-engine.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Candidate qualifies if its center is inside or >= this fraction of its area intersects the polygon. */
export const FREEFORM_OVERLAP_RATIO = 0.35;
export const FREEFORM_POINT_SPACING_PX = 3;
export const FREEFORM_SIMPLIFY_TOLERANCE_PX = 1.75;
export const FREEFORM_MAX_POINTS = 512;
export const FREEFORM_MAX_SAMPLES = 200;
export const FREEFORM_MIN_SAMPLES = 12;
export const FREEFORM_MIN_AREA_PX = 24;

/**
 * Even-odd fill rule. Winding direction does not change membership.
 * Self-crossing paths are accepted without repair; overlapping lobes follow even-odd.
 */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const last = polygon[previous];
    if (!current || !last) continue;
    const intersects = (current.y > point.y) !== (last.y > point.y);
    if (!intersects) continue;
    const atX = ((last.x - current.x) * (point.y - current.y)) / (last.y - current.y) + current.x;
    if (point.x < atX) inside = !inside;
  }
  return inside;
}

export function polygonBounds(polygon: readonly Point[]): IntendedRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
    width: Number.isFinite(maxX) ? Math.max(0, maxX - minX) : 0,
    height: Number.isFinite(maxY) ? Math.max(0, maxY - minY) : 0,
  };
}

export function polygonArea(polygon: readonly Point[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    if (!current || !next) continue;
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function clipPolygonToRect(polygon: readonly Point[], rect: IntendedRect): Point[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let output = [...polygon];
  output = clipEdge(output, (point) => point.x >= rect.x, (start, end) => intersectX(start, end, rect.x));
  output = clipEdge(output, (point) => point.x <= right, (start, end) => intersectX(start, end, right));
  output = clipEdge(output, (point) => point.y >= rect.y, (start, end) => intersectY(start, end, rect.y));
  output = clipEdge(output, (point) => point.y <= bottom, (start, end) => intersectY(start, end, bottom));
  return output;
}

export function polygonRectIntersectionArea(polygon: readonly Point[], rect: IntendedRect): number {
  return polygonArea(clipPolygonToRect(polygon, rect));
}

export function polygonQualifiesRect(
  polygon: readonly Point[],
  rect: IntendedRect,
  ratio = FREEFORM_OVERLAP_RATIO,
): boolean {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  if (pointInPolygon(center, polygon)) return true;
  const area = Math.max(1, rect.width * rect.height);
  return polygonRectIntersectionArea(polygon, rect) / area >= ratio;
}

export function shouldAppendFreeformPoint(previous: Point | undefined, next: Point, spacing = FREEFORM_POINT_SPACING_PX): boolean {
  if (!previous) return true;
  return Math.hypot(next.x - previous.x, next.y - previous.y) >= spacing;
}

export function simplifyPolygon(
  points: readonly Point[],
  tolerance = FREEFORM_SIMPLIFY_TOLERANCE_PX,
  maxPoints = FREEFORM_MAX_POINTS,
): Point[] {
  if (points.length <= 3) return [...points];
  const simplified = ramerDouglasPeucker(points, tolerance);
  if (simplified.length <= maxPoints) return simplified;
  const stride = Math.ceil(simplified.length / maxPoints);
  const capped: Point[] = [];
  for (let index = 0; index < simplified.length; index += stride) {
    const point = simplified[index];
    if (point) capped.push(point);
  }
  const last = simplified[simplified.length - 1];
  if (last && capped[capped.length - 1] !== last) capped.push(last);
  return capped.slice(0, maxPoints);
}

export function isMeaningfulFreeform(points: readonly Point[]): boolean {
  if (points.length < 3) return false;
  const bounds = polygonBounds(points);
  return polygonArea(points) >= FREEFORM_MIN_AREA_PX && (bounds.width >= 6 || bounds.height >= 6);
}

export function buildInsidePolygonSamples(
  polygon: readonly Point[],
  maxSamples = FREEFORM_MAX_SAMPLES,
  minSamples = FREEFORM_MIN_SAMPLES,
): Point[] {
  const bounds = polygonBounds(polygon);
  if (bounds.width < 1 || bounds.height < 1) return [];
  let spacing = 24;
  let inside: Point[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const grid = sampleGrid(bounds, spacing, maxSamples);
    inside = grid.filter((point) => pointInPolygon(point, polygon));
    if (inside.length >= minSamples || grid.length >= maxSamples) break;
    spacing = Math.max(4, spacing * 0.6);
  }
  return inside.slice(0, maxSamples);
}

function sampleGrid(rect: IntendedRect, spacing: number, maxSamples: number): Point[] {
  let cols = Math.max(2, Math.ceil(rect.width / spacing) + 1);
  let rows = Math.max(2, Math.ceil(rect.height / spacing) + 1);
  while (cols * rows > maxSamples) {
    if (cols >= rows && cols > 2) cols -= 1;
    else if (rows > 2) rows -= 1;
    else break;
  }
  const points: Point[] = [];
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

function clipEdge(
  input: readonly Point[],
  inside: (point: Point) => boolean,
  intersect: (start: Point, end: Point) => Point,
): Point[] {
  if (input.length === 0) return [];
  const output: Point[] = [];
  let previous = input[input.length - 1];
  if (!previous) return [];
  for (const current of input) {
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
    previous = current;
  }
  return output;
}

function intersectX(start: Point, end: Point, x: number): Point {
  const dy = end.y - start.y;
  const dx = end.x - start.x;
  const t = dx === 0 ? 0 : (x - start.x) / dx;
  return { x, y: start.y + dy * t };
}

function intersectY(start: Point, end: Point, y: number): Point {
  const dy = end.y - start.y;
  const dx = end.x - start.x;
  const t = dy === 0 ? 0 : (y - start.y) / dy;
  return { x: start.x + dx * t, y };
}

function ramerDouglasPeucker(points: readonly Point[], tolerance: number): Point[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 3) return [...points];
  let maxDistance = 0;
  let index = 0;
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const point = points[cursor];
    if (!point) continue;
    const distance = perpendicularDistance(point, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = cursor;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = ramerDouglasPeucker(points.slice(0, index + 1), tolerance);
  const right = ramerDouglasPeucker(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}
