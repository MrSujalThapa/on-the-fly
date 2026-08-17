import type { ElementHandle } from "./element-registry.js";
import type { IntendedRect } from "./placement-engine.js";

/**
 * Derived UI only. Must not own element identity or authoritative geometry.
 */
export interface OverlayCoordinator {
  showSelection(handles: readonly ElementHandle[]): void;
  refreshFromLiveGeometry(): void;
  clear(): void;
  selectionOutlineRect(): IntendedRect | null;
}
