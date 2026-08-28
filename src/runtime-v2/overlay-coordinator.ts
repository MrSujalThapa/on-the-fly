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
  showFreeformLasso(points: readonly { x: number; y: number }[]): void;
  clearLasso(): void;
  toggleLassoChooser(): void;
  closeLassoChooser(): boolean;
  isLassoChooserOpen(): boolean;
  toggleMoreMenu(): void;
  closeMoreMenu(): boolean;
  setMoreWrapEnabled(enabled: boolean): void;
  openComponentPalette(options: { canSample: boolean; sampling: boolean; wrapEnabled: boolean }): void;
  closeComponentPalette(): boolean;
  isComponentPaletteOpen(): boolean;
  setPaletteSampling(sampling: boolean): void;
  setLassoDiagnostics(stats: Record<string, number> | null): void;
  refreshFromLiveGeometry(): void;
  setLiveFollow(enabled: boolean): void;
  clear(): void;
  selectionOutlineRect(): IntendedRect | null;
  setHandlePointerDown(handler: ((kind: "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "rotate" | "crop-nw" | "crop-ne" | "crop-sw" | "crop-se", event: PointerEvent) => void) | null): void;
  setCropMode(active: boolean, subjectNodeId?: VisualNodeId): void;
  setMode(mode: InputMode): void;
  configureToolbar(callbacks: FloatingToolbarCallbacks): void;
  setToolbarCommands(commands: readonly FloatingToolbarCommandState[], activeStates?: Record<string, boolean>): void;
  setToolbarVisible(visible: boolean): void;
  setPlacementArmed(armed: boolean): void;
  openStylePanel(values: Partial<StylePanelValues>): void;
  closeStylePanel(): void;
  openTextEditor(initialText: string): void;
  closeTextEditor(cancel: boolean): void;
}
