import { resolveFillSurface } from "../style/fill-surface.js";
import { renderedVisibleText } from "../dom/handlers/text-handler.js";
import { OTF_ELEMENT_ID_ATTR, OTF_PART_ATTR, type CreatedElementAppearance, type CreatedStyleFamily } from "./created-element.js";

const LAYOUT_PROPS = new Set([
  "position", "top", "left", "right", "bottom", "transform", "z-index", "display",
  "grid-area", "grid-template", "grid-template-columns", "grid-template-rows",
  "flex-grow", "flex-shrink", "flex-basis", "order", "float", "animation",
  "transition", "visibility", "overflow",
]);

export function sampleAppearance(element: HTMLElement): CreatedElementAppearance {
  const fillSurface = resolveFillSurface(element);
  const fillStyle = getComputedStyle(fillSurface);
  const textStyle = getComputedStyle(textSampleSource(element));
  const fill = opaqueColor(fillStyle.backgroundColor);
  const textColor = opaqueColor(textStyle.color);
  const fontFamily = firstFont(textStyle.fontFamily);
  const lineHeight = numericLineHeight(textStyle.lineHeight);
  const borderColor = opaqueColor(fillStyle.borderTopColor);
  const borderWidth = positiveLength(fillStyle.borderTopWidth);
  const paddingX = averageLength(fillStyle.paddingLeft, fillStyle.paddingRight);
  const paddingY = averageLength(fillStyle.paddingTop, fillStyle.paddingBottom);
  return {
    ...(fill ? { fill } : {}),
    ...(textColor ? { textColor } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(textStyle.fontSize ? { fontSize: textStyle.fontSize } : {}),
    ...(textStyle.fontWeight ? { fontWeight: textStyle.fontWeight } : {}),
    ...(lineHeight ? { lineHeight } : {}),
    ...(textStyle.letterSpacing !== "normal" ? { letterSpacing: textStyle.letterSpacing } : {}),
    ...(textStyle.textAlign && textStyle.textAlign !== "start" ? { textAlign: textStyle.textAlign } : {}),
    ...(borderColor ? { borderColor } : {}),
    ...(borderWidth ? { borderWidth } : {}),
    ...(fillStyle.borderTopStyle !== "none" ? { borderStyle: fillStyle.borderTopStyle } : {}),
    ...(fillStyle.borderTopLeftRadius ? { borderRadius: fillStyle.borderTopLeftRadius } : {}),
    ...(fillStyle.boxShadow !== "none" ? { boxShadow: fillStyle.boxShadow } : {}),
    ...(fillStyle.opacity !== "1" ? { opacity: fillStyle.opacity } : {}),
    ...(paddingX ? { paddingX } : {}),
    ...(paddingY ? { paddingY } : {}),
  };
}

export function appearanceForFamily(
  sampled: CreatedElementAppearance,
  family: CreatedStyleFamily,
): CreatedElementAppearance {
  if (family === "text") {
    return pick(sampled, ["textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign"]);
  }
  if (family === "control") {
    return pick(sampled, [
      "fill", "textColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
      "borderColor", "borderWidth", "borderStyle", "borderRadius", "boxShadow", "opacity", "paddingX", "paddingY",
    ]);
  }
  if (family === "surface") {
    return pick(sampled, ["fill", "borderColor", "borderWidth", "borderStyle", "borderRadius", "boxShadow", "opacity"]);
  }
  if (family === "line") {
    return {
      ...(sampled.borderColor ? { fill: sampled.borderColor } : sampled.fill ? { fill: sampled.fill } : {}),
      ...(sampled.borderWidth ? { borderWidth: sampled.borderWidth } : {}),
      ...(sampled.opacity ? { opacity: sampled.opacity } : {}),
    };
  }
  return pick(sampled, ["fill", "borderColor", "borderWidth", "borderStyle", "boxShadow", "opacity"]);
}

export function appearanceHasLayoutProps(appearance: CreatedElementAppearance): boolean {
  return Object.keys(appearance).some((key) => LAYOUT_PROPS.has(key));
}

function pick(source: CreatedElementAppearance, keys: Array<keyof CreatedElementAppearance>): CreatedElementAppearance {
  const next: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (value) next[key] = value;
  }
  return next;
}

function textSampleSource(element: HTMLElement): HTMLElement {
  if (element.hasAttribute(OTF_ELEMENT_ID_ATTR)) {
    return element.querySelector<HTMLElement>(`[${OTF_PART_ATTR}="label"], [${OTF_PART_ATTR}="input"]`) ?? element;
  }
  const full = renderedVisibleText(element);
  if (!full) return element;
  const tagged = Array.from(element.querySelectorAll<HTMLElement>("p, span, button, a, label, h1, h2, h3, h4, h5, h6, li"))
    .filter((candidate) => renderedVisibleText(candidate) === full);
  return tagged[0] ?? element;
}

function opaqueColor(value: string): string | null {
  const token = value.trim().toLowerCase();
  if (!token || token === "transparent" || token === "rgba(0, 0, 0, 0)") return null;
  return value.trim();
}

function firstFont(family: string): string | undefined {
  const token = family.split(",")[0]?.trim().replace(/["']/g, "");
  return token || undefined;
}

function positiveLength(value: string): string | undefined {
  return Number.parseFloat(value) > 0 ? value : undefined;
}

function averageLength(left: string, right: string): string | undefined {
  const a = Number.parseFloat(left);
  const b = Number.parseFloat(right);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return undefined;
  return `${String(Math.round((a + b) / 2))}px`;
}

function numericLineHeight(value: string): string | undefined {
  if (!value || value === "normal") return undefined;
  return value;
}
