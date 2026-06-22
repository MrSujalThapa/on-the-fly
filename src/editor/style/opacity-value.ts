const OPACITY_MIN = 0;
const OPACITY_MAX = 1;
const OPACITY_STEP = 0.05;

export function parseOpacityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampOpacity(parsed);
}

export function clampOpacity(value: number): number {
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, value));
}

export function formatOpacityValue(value: number): string {
  return String(clampOpacity(value));
}

export { OPACITY_MIN, OPACITY_MAX, OPACITY_STEP };
