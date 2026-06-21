import type { EditorSelection } from "../editor-selection.js";
import { createEmptySelection } from "../editor-selection.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { VisualLayoutGraph } from "../visual-graph/visual-layout-graph.js";
import {
  normalizeLassoRect,
  resolveClickSelection,
  resolveLassoSelection,
  type ClickResolveOptions,
  type LassoResolveOptions,
  type SelectionResolveResult,
} from "./selection-resolver.js";

export interface SelectionControllerOptions {
  getGraph: () => VisualLayoutGraph;
  getDocument?: () => Document;
  onSelectionChange?: (selection: EditorSelection, result: SelectionResolveResult) => void;
  withPageHitTest?: <T>(callback: () => T) => T;
}

export class SelectionController {
  private selection: EditorSelection = createEmptySelection();
  private readonly getGraph: () => VisualLayoutGraph;
  private readonly getDocument: (() => Document) | undefined;
  private readonly onSelectionChange?: SelectionControllerOptions["onSelectionChange"];
  private readonly withPageHitTest: <T>(callback: () => T) => T;

  constructor(options: SelectionControllerOptions) {
    this.getGraph = options.getGraph;
    this.getDocument = options.getDocument;
    this.onSelectionChange = options.onSelectionChange;
    this.withPageHitTest = options.withPageHitTest ?? ((callback) => callback());
  }

  getSelection(): EditorSelection {
    return this.selection;
  }

  clearSelection(): void {
    this.selection = createEmptySelection();
    this.onSelectionChange?.(this.selection, {
      selection: this.selection,
      resolvedNodes: [],
      rejectedWholePage: false,
    });
  }

  handlePointerClick(
    x: number,
    y: number,
    shiftKey: boolean,
    composedPath: EventTarget[] = [],
  ): SelectionResolveResult {
    const result = this.withPageHitTest(() =>
      resolveClickSelection(
        this.getGraph(),
        x,
        y,
        shiftKey,
        shiftKey ? this.selection : createEmptySelection(),
        composedPath,
        this.getClickResolveOptions(),
      ),
    );
    this.selection = result.selection;
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  handleLasso(startX: number, startY: number, endX: number, endY: number, shiftKey: boolean): SelectionResolveResult {
    const lassoRect = normalizeLassoRect(startX, startY, endX, endY);
    const result = this.withPageHitTest(() =>
      resolveLassoSelection(
        this.getGraph(),
        lassoRect,
        shiftKey ? this.selection : createEmptySelection(),
        shiftKey,
        this.getLassoResolveOptions(),
      ),
    );
    this.selection = result.selection;
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  handleLassoRect(lassoRect: MeasurementRect, shiftKey: boolean): SelectionResolveResult {
    const result = this.withPageHitTest(() =>
      resolveLassoSelection(
        this.getGraph(),
        lassoRect,
        shiftKey ? this.selection : createEmptySelection(),
        shiftKey,
        this.getLassoResolveOptions(),
      ),
    );
    this.selection = result.selection;
    this.onSelectionChange?.(this.selection, result);
    return result;
  }

  private getClickResolveOptions(): ClickResolveOptions {
    const document = this.getDocument?.();
    return document ? { document } : {};
  }

  private getLassoResolveOptions(): LassoResolveOptions {
    const document = this.getDocument?.();
    return document ? { document } : {};
  }
}

export function createSelectionController(
  options: SelectionControllerOptions,
): SelectionController {
  return new SelectionController(options);
}
