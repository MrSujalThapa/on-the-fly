import type { VisualNodeComputedStyles } from "../visual-node.js";

const COMPUTED_STYLE_KEYS: Array<keyof VisualNodeComputedStyles> = [
  "display",
  "position",
  "zIndex",
  "color",
  "backgroundColor",
  "borderRadius",
  "fontSize",
  "fontWeight",
  "textAlign",
  "opacity",
  "transform",
  "overflow",
];

export function snapshotComputedStyles(element: Element): VisualNodeComputedStyles {
  const styles = getComputedStyle(element);
  const snapshot: VisualNodeComputedStyles = {};

  for (const key of COMPUTED_STYLE_KEYS) {
    const cssProperty = key === "zIndex" ? "z-index" : camelToKebab(key);
    const value = styles.getPropertyValue(cssProperty).trim();
    if (value) {
      snapshot[key] = value;
    }
  }

  return snapshot;
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
