import { matchElementBySignature } from "../editor/dom/signature-matcher.js";
import type { DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import type { PageKey } from "../editor/ids.js";
import type { EditorOperation, StyleProperty } from "../editor/operations.js";
import {
  clampOpacity,
  formatOpacityValue,
  parseOpacityInput,
} from "../editor/style/opacity-value.js";
import {
  isTextDescendantStyleProperty,
  resolveStyleElementTargets,
} from "../editor/style/style-target-resolver.js";
import { extractEditableText } from "../editor/style/text-target-resolver.js";
import {
  buildStyleOperation,
  buildTextOperation,
  type TransformTarget,
} from "../editor/transform/index.js";

const STYLE_CSS_MAP: Record<StyleProperty, string> = {
  color: "color",
  backgroundColor: "background-color",
  backgroundImage: "background-image",
  borderColor: "border-color",
  borderWidth: "border-width",
  borderRadius: "border-radius",
  fontSize: "font-size",
  fontWeight: "font-weight",
  textAlign: "text-align",
  opacity: "opacity",
  boxShadow: "box-shadow",
  filter: "filter",
};

export interface StyleTextControllerOptions {
  document: Document;
  adapter: DomRuntimeAdapter;
  getPageKey: () => PageKey;
  resolveTargets: () => TransformTarget[];
  resolveTextTarget: () => TransformTarget | null;
  onApply?: (operations: EditorOperation[]) => void;
  onDebug?: (message: string, data?: unknown) => void;
}

interface StyleOperationBuildResult {
  operations: EditorOperation[];
  targets: Array<{ element: HTMLElement; signatureTarget: TransformTarget }>;
}

interface StylePreviewState {
  pending: Map<StyleProperty, string>;
  operations: EditorOperation[];
}

export class StyleTextController {
  private readonly document: Document;
  private readonly adapter: DomRuntimeAdapter;
  private readonly getPageKey: () => PageKey;
  private readonly resolveTargets: () => TransformTarget[];
  private readonly resolveTextTarget: () => TransformTarget | null;
  private readonly onApply: ((operations: EditorOperation[]) => void) | undefined;
  private readonly onDebug: (message: string, data?: unknown) => void;
  private readonly lastOpacityByTarget = new Map<string, string>();
  private stylePreview: StylePreviewState | null = null;

  constructor(options: StyleTextControllerOptions) {
    this.document = options.document;
    this.adapter = options.adapter;
    this.getPageKey = options.getPageKey;
    this.resolveTargets = options.resolveTargets;
    this.resolveTextTarget = options.resolveTextTarget;
    this.onApply = options.onApply;
    this.onDebug = options.onDebug ?? (() => undefined);
  }

  applyStyle(property: StyleProperty, value: string): EditorOperation[] {
    this.cancelStylePreview();
    const built = this.buildStyleOperations(property, value);
    return this.commitOperations(built.operations, built.targets);
  }

  previewStyle(property: StyleProperty, value: string): EditorOperation[] {
    const normalized = normalizeStyleInput(property, value);
    if (normalized === null) {
      return [];
    }

    const pending = new Map(this.stylePreview?.pending ?? []);
    pending.set(property, normalized);
    this.revertStylePreviewEffects();

    const preview: StylePreviewState = { pending, operations: [] };
    this.stylePreview = preview;

    for (const [pendingProperty, pendingValue] of pending) {
      const built = this.buildStyleOperations(pendingProperty, pendingValue, {
        trackOpacity: false,
      });
      const applied = this.applyDraftOperations(built.operations, built.targets);
      preview.operations.push(...applied);
    }

    return [...preview.operations];
  }

  commitStylePreview(): EditorOperation[] {
    const pending = new Map(this.stylePreview?.pending ?? []);
    if (pending.size === 0) {
      return [];
    }

    this.revertStylePreviewEffects();
    this.stylePreview = null;

    const operations: EditorOperation[] = [];
    const targets: Array<{ element: HTMLElement; signatureTarget: TransformTarget }> = [];
    for (const [property, value] of pending) {
      const built = this.buildStyleOperations(property, value);
      operations.push(...built.operations);
      targets.push(...built.targets);
    }

    return this.commitOperations(operations, targets);
  }

  cancelStylePreview(): void {
    this.revertStylePreviewEffects();
    this.stylePreview = null;
  }

  private buildStyleOperations(
    property: StyleProperty,
    value: string,
    options: { trackOpacity?: boolean } = {},
  ): StyleOperationBuildResult {
    const transformTargets = this.resolveTargets();
    if (transformTargets.length === 0) {
      return { operations: [], targets: [] };
    }

    if (property === "opacity") {
      return this.buildOpacityOperations(
        value,
        transformTargets,
        options.trackOpacity !== false,
      );
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return { operations: [], targets: [] };
    }

    const normalized = normalizeStyleValue(property, trimmed);
    const resolution = resolveStyleElementTargets(property, transformTargets, this.document);
    if (resolution.capped) {
      this.onDebug("style-target-cap", {
        property,
        max: resolution.skippedHidden,
      });
    }

    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = [];

    for (const entry of resolution.targets) {
      const cssProperty = STYLE_CSS_MAP[property];
      const previousValue = this.readStyleValue(entry.element, cssProperty);
      operations.push(
        buildStyleOperation(
          entry.signatureTarget,
          property,
          normalized,
          { pageKey },
          previousValue || undefined,
          entry.element,
        ),
      );
    }

    if (operations.length === 0) {
      this.onDebug("style-no-targets", { property });
    }

    return { operations, targets: resolution.targets };
  }

  applyText(value: string): EditorOperation[] {
    const target = this.resolveTextTarget();
    if (!target) {
      this.onDebug("text-edit-refused", { reason: "no-target" });
      return [];
    }

    const element = this.resolveElement(target);
    if (!element) {
      this.onDebug("text-edit-refused", { reason: "element-not-found" });
      return [];
    }

    const previousValue = element.textContent;
    const operation = buildTextOperation(
      target,
      value,
      { pageKey: this.getPageKey() },
      previousValue,
      element,
    );

    return this.commitOperations([operation], [{ element, signatureTarget: target }]);
  }

  readStyleForTarget(target: TransformTarget, property: StyleProperty): string {
    const element = this.resolveElement(target);
    if (!element) {
      return property === "opacity" ? "1" : "";
    }

    if (isTextDescendantStyleProperty(property) && element.children.length > 0) {
      const resolution = resolveStyleElementTargets(property, [target], this.document);
      const first = resolution.targets[0]?.element;
      if (first) {
        return this.readStyleValue(first, STYLE_CSS_MAP[property]);
      }
    }

    const raw = this.readStyleValue(element, STYLE_CSS_MAP[property]);
    if (property === "opacity") {
      const parsed = parseOpacityInput(raw);
      return parsed === null ? "1" : formatOpacityValue(parsed);
    }
    return raw;
  }

  readTextForTarget(target: TransformTarget): string {
    const element = this.resolveElement(target);
    return element ? extractEditableText(element) : "";
  }

  private applyOpacity(raw: string, transformTargets: TransformTarget[]): EditorOperation[] {
    const built = this.buildOpacityOperations(raw, transformTargets, true);
    return this.commitOperations(built.operations, built.targets);
  }

  private buildOpacityOperations(
    raw: string,
    transformTargets: TransformTarget[],
    trackOpacity: boolean,
  ): StyleOperationBuildResult {
    const parsed = parseOpacityInput(raw);
    if (parsed === null) {
      return { operations: [], targets: [] };
    }

    const value = formatOpacityValue(parsed);
    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = [];
    const elementTargets: Array<{ element: HTMLElement; signatureTarget: TransformTarget }> = [];

    for (const target of transformTargets) {
      const element = this.resolveElement(target);
      if (!element) {
        continue;
      }

      const key = elementSignatureKey(target, element);
      const previousStored = this.lastOpacityByTarget.get(key);
      const cssProperty = STYLE_CSS_MAP.opacity;
      const previousValue = previousStored ?? this.readStyleValue(element, cssProperty);
      if (previousValue === value) {
        continue;
      }

      const entry = { element, signatureTarget: target };
      operations.push(
        buildStyleOperation(
          target,
          "opacity",
          value,
          { pageKey },
          previousValue || undefined,
          element,
        ),
      );
      elementTargets.push(entry);
      if (trackOpacity) {
        this.lastOpacityByTarget.set(key, value);
      }
    }

    return { operations, targets: elementTargets };
  }

  private readStyleValue(element: HTMLElement, cssProperty: string): string {
    const inline = element.style.getPropertyValue(cssProperty);
    if (inline) {
      return inline;
    }
    const view = element.ownerDocument.defaultView;
    return view ? view.getComputedStyle(element).getPropertyValue(cssProperty) : "";
  }

  private resolveElement(target: TransformTarget): HTMLElement | null {
    if (target.element?.isConnected) {
      return target.element;
    }
    return matchElementBySignature(this.document, target.signature);
  }

  private commitOperations(
    operations: EditorOperation[],
    targets: Array<{ element: HTMLElement; signatureTarget: TransformTarget }>,
  ): EditorOperation[] {
    const applied: EditorOperation[] = [];
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      if (!operation) {
        continue;
      }
      const element = targets[index]?.element ?? null;
      const result = this.adapter.applyOperation(
        operation,
        element?.isConnected ? element : null,
      );
      if (result.ok) {
        applied.push(operation);
      }
    }

    if (applied.length > 0) {
      this.onApply?.(applied);
    }

    return applied;
  }

  private applyDraftOperations(
    operations: EditorOperation[],
    targets: Array<{ element: HTMLElement; signatureTarget: TransformTarget }>,
  ): EditorOperation[] {
    const applied: EditorOperation[] = [];
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      if (!operation) {
        continue;
      }
      const element = targets[index]?.element ?? null;
      const result = this.adapter.applyOperation(
        operation,
        element?.isConnected ? element : null,
      );
      if (result.ok) {
        applied.push(operation);
      }
    }
    return applied;
  }

  private revertStylePreviewEffects(): void {
    const operations = this.stylePreview?.operations ?? [];
    for (const operation of [...operations].reverse()) {
      this.adapter.revertOperation(operation);
    }
    if (this.stylePreview) {
      this.stylePreview.operations = [];
    }
  }
}

function normalizeStyleInput(property: StyleProperty, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (property === "opacity") {
    const parsed = parseOpacityInput(trimmed);
    return parsed === null ? null : formatOpacityValue(clampOpacity(parsed));
  }
  return normalizeStyleValue(property, trimmed);
}

function normalizeStyleValue(property: StyleProperty, value: string): string {
  if (property === "fontSize" || property === "borderRadius") {
    return /^\d+$/.test(value) ? `${value}px` : value;
  }
  if (property === "opacity") {
    const parsed = parseOpacityInput(value);
    return parsed === null ? value : formatOpacityValue(clampOpacity(parsed));
  }
  return value;
}

function elementSignatureKey(target: TransformTarget, element: HTMLElement): string {
  return target.signature.cssPath || element.tagName;
}

export function createStyleTextController(options: StyleTextControllerOptions): StyleTextController {
  return new StyleTextController(options);
}
