export type LayerCommand = "forward" | "backward" | "front" | "back";

export const LAYER_STEP = 1;

/**
 * Layer bounds kept just inside the editor overlay z-index (2147483647) so a
 * "bring to front" element never paints over On the Fly's own UI.
 */
export const FRONT_LAYER = 2_147_483_000;
export const BACK_LAYER = 0;

/**
 * Baseline layer assigned to an On the Fly managed element the first time it
 * receives a layer command while it has no explicit numeric z-index. Sitting
 * above untouched page content (effective z-index 0) means a single "forward"
 * step produces a visible re-stacking among managed elements, while "backward"
 * can still drop back to {@link BACK_LAYER}.
 */
export const MANAGED_Z_INDEX_BASELINE = 1;

export function parseLayer(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Returns the explicit numeric z-index for a managed element, or the managed
 * baseline when the element currently has no usable z-index (`auto`/empty).
 */
export function resolveCurrentManagedLayer(
  inlineZIndex: string | null | undefined,
  computedZIndex: string | null | undefined,
): number {
  const inlineParsed = Number.parseInt(inlineZIndex ?? "", 10);
  if (Number.isFinite(inlineParsed)) {
    return inlineParsed;
  }

  const computedParsed = Number.parseInt(computedZIndex ?? "", 10);
  if (Number.isFinite(computedParsed)) {
    return computedParsed;
  }

  return MANAGED_Z_INDEX_BASELINE;
}

export function computeNextLayer(
  currentLayer: number,
  command: LayerCommand,
  siblingMaxLayer = 0,
): number {
  switch (command) {
    case "forward":
      return Math.min(FRONT_LAYER, Math.max(currentLayer + LAYER_STEP, siblingMaxLayer + 1));
    case "backward":
      return Math.max(BACK_LAYER, currentLayer - LAYER_STEP);
    case "front":
      return FRONT_LAYER;
    case "back":
      return BACK_LAYER;
  }
}
