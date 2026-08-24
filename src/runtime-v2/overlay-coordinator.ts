import type { VisualNodeId } from "../editor/ids.js";
import type { IntendedRect } from "./placement-engine.js";
import type { InputMode } from "./input-router.js";
import type { FloatingToolbarCallbacks, FloatingToolbarCommandState, StylePanelValues } from "../editor/floating-toolbar.js";

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
  setHandlePointerDown(handler: ((kind: "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "rotate" | "crop-nw" | "crop-ne" | "crop-sw" | "crop-se", event: PointerEvent) => void) | null): void;
  setCropMode(active: boolean, subjectNodeId?: VisualNodeId): void;
  setMode(mode: InputMode): void;
  configureToolbar(callbacks: FloatingToolbarCallbacks): void;
  setToolbarCommands(commands: readonly FloatingToolbarCommandState[], activeStates?: Record<string, boolean>): void;
  setToolbarVisible(visible: boolean): void;
  openStylePanel(values: Partial<StylePanelValues>): void;
  closeStylePanel(): void;
  openTextEditor(initialText: string): void;
  closeTextEditor(cancel: boolean): void;
}
