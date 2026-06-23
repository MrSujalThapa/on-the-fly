import type { EditorOperation, HelperObjectBoxShadow, InsertHelperObjectOperation } from "../../editor/operations.js";
import { OTF_HELPER_ATTR } from "../../editor/dom/types.js";
import type { AgentScopeRect } from "../../editor/validation/validate-agent-scope.js";

export interface VisualSanityCriticInput {
  document: Document;
  operations: EditorOperation[];
  selectionBounds: AgentScopeRect;
  selectedElements: HTMLElement[];
  viewport: { width: number; height: number };
}

export interface VisualSanityCriticResult {
  warnings: string[];
  hardFailures: string[];
}

const VIEWPORT_MARGIN_PX = 64;
const OFFSCREEN_RATIO_HARD_FAIL = 0.92;
const OFFSCREEN_RATIO_WARNING = 0.65;
const AGGRESSIVE_COVER_RATIO = 0.88;
const NEARBY_BOUNDS_PADDING_PX = 160;
const MAX_Z_INDEX_WARNING = 1000;
const MAX_Z_INDEX_HARD_FAIL = 100000;
const MIN_VISIBLE_OPACITY = 0.04;
const MAX_HELPER_OPACITY_WARNING = 0.98;
const MAX_SHADOW_BLUR_WARNING = 96;
const MAX_SHADOW_BLUR_HARD_FAIL = 240;
const MIN_CONTRAST_RATIO = 3;

export function runVisualSanityCritic(input: VisualSanityCriticInput): VisualSanityCriticResult {
  const warnings: string[] = [];
  const hardFailures: string[] = [];

  for (const operation of input.operations) {
    if (operation.type === "insertHelperObject") {
      evaluateHelperObject(operation, input, warnings, hardFailures);
      continue;
    }

    if (operation.type === "style" && operation.payload.property === "filter") {
      warnings.push("Preview applies a filter effect that may reduce readability.");
    }

    if (operation.type === "style" && operation.payload.property === "opacity") {
      const parsed = Number.parseFloat(operation.payload.value);
      if (Number.isFinite(parsed) && parsed < MIN_VISIBLE_OPACITY) {
        warnings.push("Preview sets extremely low opacity on a selected element.");
      }
    }

    if (operation.type === "style" && operation.payload.property === "boxShadow") {
      evaluateCssShadow(operation.payload.value, warnings, hardFailures);
    }
  }

  return { warnings: uniqueStrings(warnings), hardFailures: uniqueStrings(hardFailures) };
}

function evaluateHelperObject(
  operation: InsertHelperObjectOperation,
  input: VisualSanityCriticInput,
  warnings: string[],
  hardFailures: string[],
): void {
  const element = input.document.querySelector(
    `[${OTF_HELPER_ATTR}="${operation.payload.helperId}"]`,
  );
  const helperElement = element instanceof HTMLElement ? element : null;
  const payloadRect = operation.payload.rect;
  const appliedRect = readAppliedRect(helperElement, payloadRect);
  const rect = appliedRect;

  if (payloadRect.width <= 0 || payloadRect.height <= 0) {
    hardFailures.push("Helper object has zero or negative dimensions after preview apply.");
    return;
  }

  const offscreenRatio = computeOffscreenRatio(payloadRect, input.viewport);
  if (
    offscreenRatio >= OFFSCREEN_RATIO_HARD_FAIL ||
    !rectIntersects(payloadRect, viewportRectFor(input.viewport))
  ) {
    hardFailures.push("Helper object is mostly offscreen and would damage layout.");
  } else if (offscreenRatio >= OFFSCREEN_RATIO_WARNING) {
    warnings.push("Helper object extends far outside the viewport.");
  }

  if (isRectFarOutsideBounds(payloadRect, input.selectionBounds, NEARBY_BOUNDS_PADDING_PX * 2)) {
    hardFailures.push("Helper object is placed far outside the selected area.");
  } else if (isRectFarOutsideBounds(payloadRect, input.selectionBounds, NEARBY_BOUNDS_PADDING_PX)) {
    warnings.push("Helper object sits far from the selected bounds.");
  }

  const opacity = readOpacity(helperElement, operation.payload.opacity);
  if (opacity !== undefined && opacity < MIN_VISIBLE_OPACITY) {
    warnings.push("Helper object opacity is extremely low.");
  }
  if (opacity !== undefined && opacity > MAX_HELPER_OPACITY_WARNING) {
    warnings.push("Helper object opacity is very high and may obscure content.");
  }

  const zIndex = readZIndex(helperElement, operation.payload.zIndex);
  if (zIndex !== undefined) {
    if (zIndex >= MAX_Z_INDEX_HARD_FAIL) {
      hardFailures.push("Helper object uses an extreme z-index.");
    } else if (zIndex >= MAX_Z_INDEX_WARNING) {
      warnings.push("Helper object z-index is unusually high.");
    }
  }

  evaluateShadow(operation.payload.boxShadow, warnings, hardFailures);
  evaluateTextOverlap(rect, opacity, zIndex, input, warnings);
}

function evaluateCssShadow(value: string, warnings: string[], hardFailures: string[]): void {
  const blurMatches = /(-?\d+(?:\.\d+)?)px/g;
  for (const match of value.matchAll(blurMatches)) {
    const blur = Math.abs(Number.parseFloat(match[1] ?? "0"));
    if (!Number.isFinite(blur)) {
      continue;
    }
    if (blur >= MAX_SHADOW_BLUR_HARD_FAIL) {
      hardFailures.push("Preview shadow blur is excessive.");
      return;
    }
    if (blur >= MAX_SHADOW_BLUR_WARNING) {
      warnings.push("Preview shadow blur is very large.");
      return;
    }
  }
}

function evaluateShadow(
  boxShadow: HelperObjectBoxShadow | undefined,
  warnings: string[],
  hardFailures: string[],
): void {
  if (!boxShadow) {
    return;
  }

  const blur = Math.abs(boxShadow.blurRadius);
  if (blur >= MAX_SHADOW_BLUR_HARD_FAIL) {
    hardFailures.push("Helper object shadow blur is excessive.");
  } else if (blur >= MAX_SHADOW_BLUR_WARNING) {
    warnings.push("Helper object shadow blur is very large.");
  }

  const spread = Math.abs(boxShadow.spreadRadius ?? 0);
  if (spread >= 120) {
    warnings.push("Helper object shadow spread is unusually large.");
  }
}

function evaluateTextOverlap(
  helperRect: AgentScopeRect,
  opacity: number | undefined,
  zIndex: number | undefined,
  input: VisualSanityCriticInput,
  warnings: string[],
): void {
  if (input.selectedElements.length === 0) {
    return;
  }

  const effectiveOpacity = opacity ?? 1;
  const effectiveZ = zIndex ?? 0;
  if (effectiveOpacity < 0.35 || effectiveZ <= 0) {
    return;
  }

  for (const element of input.selectedElements) {
    const textRect = readElementRect(element);
    const overlapRatio = intersectionRatio(helperRect, textRect);
    if (overlapRatio >= AGGRESSIVE_COVER_RATIO) {
      warnings.push("Helper object covers selected text too aggressively.");
      break;
    }

    const contrast = estimateContrast(element, helperRect, input.document);
    if (contrast !== undefined && contrast < MIN_CONTRAST_RATIO) {
      warnings.push("Selected text contrast may be unreadable against the helper panel.");
      break;
    }
  }
}

function readAppliedRect(
  element: HTMLElement | null,
  fallback: AgentScopeRect,
): AgentScopeRect {
  if (!(element instanceof HTMLElement)) {
    return fallback;
  }

  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 0 && bounds.height <= 0) {
    return fallback;
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function readElementRect(element: HTMLElement): AgentScopeRect {
  const bounds = element.getBoundingClientRect();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function readOpacity(element: HTMLElement | null, fallback?: number): number | undefined {
  if (element) {
    const parsed = Number.parseFloat(getComputedStyle(element).opacity);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function readZIndex(element: HTMLElement | null, fallback?: number): number | undefined {
  if (element) {
    const parsed = Number.parseInt(getComputedStyle(element).zIndex, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function computeOffscreenRatio(rect: AgentScopeRect, viewport: { width: number; height: number }): number {
  const viewportRect = viewportRectFor(viewport);
  const intersection = intersectRect(rect, viewportRect);
  if (!intersection) {
    return 1;
  }

  const visibleArea = intersection.width * intersection.height;
  const totalArea = Math.max(1, rect.width * rect.height);
  return 1 - visibleArea / totalArea;
}

function viewportRectFor(viewport: { width: number; height: number }): AgentScopeRect {
  return {
    x: -VIEWPORT_MARGIN_PX,
    y: -VIEWPORT_MARGIN_PX,
    width: viewport.width + VIEWPORT_MARGIN_PX * 2,
    height: viewport.height + VIEWPORT_MARGIN_PX * 2,
  };
}

function isRectFarOutsideBounds(
  rect: AgentScopeRect,
  bounds: AgentScopeRect,
  padding: number,
): boolean {
  const expanded = {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
  return !rectIntersects(rect, expanded);
}

function rectIntersects(a: AgentScopeRect, b: AgentScopeRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function intersectRect(a: AgentScopeRect, b: AgentScopeRect): AgentScopeRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function intersectionRatio(a: AgentScopeRect, b: AgentScopeRect): number {
  const intersection = intersectRect(a, b);
  if (!intersection) {
    return 0;
  }
  const intersectionArea = intersection.width * intersection.height;
  const targetArea = Math.max(1, b.width * b.height);
  return intersectionArea / targetArea;
}

function estimateContrast(
  textElement: HTMLElement,
  helperRect: AgentScopeRect,
  document: Document,
): number | undefined {
  const textRect = readElementRect(textElement);
  if (!rectIntersects(helperRect, textRect)) {
    return undefined;
  }

  const textColor = parseCssColor(getComputedStyle(textElement).color);
  const helperElement = findTopmostHelperAtPoint(
    document,
    textRect.x + textRect.width / 2,
    textRect.y + textRect.height / 2,
  );
  const backgroundColor = helperElement
    ? readSolidBackgroundColor(helperElement)
    : parseCssColor(getComputedStyle(textElement).backgroundColor);

  if (!textColor || !backgroundColor) {
    return undefined;
  }

  return contrastRatio(textColor, backgroundColor);
}

function findTopmostHelperAtPoint(
  document: Document,
  x: number,
  y: number,
): HTMLElement | null {
  const helpers = document.querySelectorAll(`[${OTF_HELPER_ATTR}]`);
  for (const node of Array.from(helpers)) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return node;
    }
  }
  return null;
}

function readSolidBackgroundColor(element: HTMLElement): RgbColor | undefined {
  const inline = element.style.backgroundColor;
  const parsedInline = parseCssColor(inline);
  if (parsedInline) {
    return parsedInline;
  }

  const computed = getComputedStyle(element).backgroundColor;
  return parseCssColor(computed);
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function parseCssColor(value: string): RgbColor | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "transparent") {
    return undefined;
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (rgbMatch) {
    const parts = rgbMatch[1]?.split(",").map((part) => Number.parseFloat(part.trim())) ?? [];
    if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0 };
    }
  }

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1] ?? "";
    if (hex.length === 3) {
      const r = hex.charAt(0);
      const g = hex.charAt(1);
      const b = hex.charAt(2);
      return {
        r: Number.parseInt(`${r}${r}`, 16),
        g: Number.parseInt(`${g}${g}`, 16),
        b: Number.parseInt(`${b}${b}`, 16),
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  return undefined;
}

function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: RgbColor): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
