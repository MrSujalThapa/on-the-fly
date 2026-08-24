import type { VisualNodeId } from "../editor/ids.js";
import type { IntendedRect } from "./placement-engine.js";
import type { InputMode } from "./input-router.js";

/**
 * Derived UI only. Must not own element identity or authoritative geometry.
 * Geometry is always queried from VisualModel.
 */
export interface OverlayCoordinator {
  showSelection(nodeIds: readonly VisualNodeId[], kind?: "selection" | "group"): void;
  showLasso(rect: IntendedRect): void;
  clearLasso(): void;
  refreshFromLiveGeometry(): void;
  clear(): void;
  selectionOutlineRect(): IntendedRect | null;
  setMode(mode: InputMode): void;
}
