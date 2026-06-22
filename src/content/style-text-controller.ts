import { matchElementBySignature } from "../editor/dom/signature-matcher.js";
import type { DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import type { PageKey } from "../editor/ids.js";
import type { EditorOperation, StyleProperty } from "../editor/operations.js";
import {
  buildStyleOperation,
  buildTextOperation,
  type TransformTarget,
} from "../editor/transform/index.js";

const STYLE_CSS_MAP: Record<StyleProperty, string> = {
  color: "color",
  backgroundColor: "background-color",
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
}

export class StyleTextController {
  private readonly document: Document;
  private readonly adapter: DomRuntimeAdapter;
  private readonly getPageKey: () => PageKey;
  private readonly resolveTargets: () => TransformTarget[];
  private readonly resolveTextTarget: () => TransformTarget | null;
  private readonly onApply: ((operations: EditorOperation[]) => void) | undefined;

  constructor(options: StyleTextControllerOptions) {
    this.document = options.document;
    this.adapter = options.adapter;
    this.getPageKey = options.getPageKey;
    this.resolveTargets = options.resolveTargets;
    this.resolveTextTarget = options.resolveTextTarget;
    this.onApply = options.onApply;
  }

  applyStyle(property: StyleProperty, value: string): EditorOperation[] {
    const targets = this.resolveTargets();
    if (targets.length === 0 || !value.trim()) {
      return [];
    }

    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = [];

    for (const target of targets) {
      const element = this.resolveElement(target);
      if (!element) {
        continue;
      }

      const cssProperty = STYLE_CSS_MAP[property];
      const previousValue = this.readStyleValue(element, cssProperty);
      operations.push(
        buildStyleOperation(
          target,
          property,
          value,
          { pageKey },
          previousValue || undefined,
          element,
        ),
      );
    }

    return this.commitOperations(operations);
  }

  applyText(value: string): EditorOperation[] {
    const target = this.resolveTextTarget();
    if (!target) {
      return [];
    }

    const element = this.resolveElement(target);
    if (!element) {
      return [];
    }

    if (element.children.length > 0) {
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

    return this.commitOperations([operation]);
  }

  readStyleForTarget(target: TransformTarget, property: StyleProperty): string {
    const element = this.resolveElement(target);
    if (!element) {
      return "";
    }
    return this.readStyleValue(element, STYLE_CSS_MAP[property]);
  }

  readTextForTarget(target: TransformTarget): string {
    const element = this.resolveElement(target);
    return element?.textContent ?? "";
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

  private commitOperations(operations: EditorOperation[]): EditorOperation[] {
    const applied: EditorOperation[] = [];
    for (const operation of operations) {
      const nodeId = operation.target.nodeId;
      const override =
        nodeId !== undefined
          ? this.resolveTargets().find((target) => target.nodeId === nodeId)?.element ?? null
          : null;
      const result = this.adapter.applyOperation(
        operation,
        override?.isConnected ? override : null,
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
}

export function createStyleTextController(options: StyleTextControllerOptions): StyleTextController {
  return new StyleTextController(options);
}
