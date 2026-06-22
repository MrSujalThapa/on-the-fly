import type { LayerCommand } from "../editor/transform/layer-order.js";
import type { StyleProperty } from "../editor/operations.js";

/** Session-level services that command handlers delegate to. */
export interface SessionCommandHost {
  hideSelection(): void;
  applyLayerCommand(command: LayerCommand): void;
  toggleCropMode(): boolean;
  isCropMode(): boolean;
  canCropSelection(): boolean;
  canEditTextSelection(): boolean;
  clearSelection(): void;
  clearPage(): Promise<void>;
  startSaveWindow(): boolean;
  isSaveWindowActive(): boolean;
  canStartSaveWindow(): boolean;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  saveAll(): Promise<boolean>;
  hasUnsavedChanges(): boolean;
  applyStyle(property: StyleProperty, value: string): void;
  applyText(value: string): void;
  openTextEditor(): void;
}

export interface SessionCommandHostOptions {
  host: SessionCommandHost;
  isCropModeActive?: () => boolean;
}
