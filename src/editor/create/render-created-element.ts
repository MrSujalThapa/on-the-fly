import { OTF_MANAGED_ATTR } from "../dom/types.js";
import { COMPONENT_DEFINITIONS } from "./component-definitions.js";
import {
  OTF_COMPONENT_KIND_ATTR,
  OTF_ELEMENT_ID_ATTR,
  OTF_PART_ATTR,
  type CreatedElementAppearance,
  type CreatedElementContent,
  type CreatedElementKind,
  type CreatedElementRect,
} from "./created-element.js";

export interface RenderCreatedElementInput {
  readonly elementId: string;
  readonly kind: CreatedElementKind;
  readonly rect: CreatedElementRect;
  readonly content?: CreatedElementContent;
  readonly appearance?: CreatedElementAppearance;
}

const DEFAULT_FILL = "#f4f4f5";
const DEFAULT_SURFACE = "#ffffff";
const DEFAULT_BORDER = "#d4d4d8";
const DEFAULT_TEXT = "#18181b";

export function defaultAppearance(kind: CreatedElementKind): CreatedElementAppearance {
  if (kind === "text" || kind === "heading") {
    return {
      textColor: DEFAULT_TEXT,
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: kind === "heading" ? "22px" : "16px",
      fontWeight: kind === "heading" ? "700" : "400",
    };
  }
  if (kind === "divider") {
    return { fill: DEFAULT_BORDER };
  }
  if (kind === "rectangle" || kind === "circle") {
    return { fill: DEFAULT_FILL, borderColor: DEFAULT_BORDER, borderWidth: "1px", borderStyle: "solid" };
  }
  if (kind === "card") {
    return {
      fill: DEFAULT_SURFACE,
      borderColor: DEFAULT_BORDER,
      borderWidth: "1px",
      borderStyle: "solid",
      borderRadius: "12px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
    };
  }
  if (kind === "container" || kind === "header") {
    return {
      fill: DEFAULT_SURFACE,
      borderColor: DEFAULT_BORDER,
      borderWidth: "1px",
      borderStyle: "solid",
      borderRadius: kind === "header" ? "0px" : "8px",
    };
  }
  return {
    fill: DEFAULT_SURFACE,
    textColor: DEFAULT_TEXT,
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: "14px",
    fontWeight: "600",
    borderColor: DEFAULT_BORDER,
    borderWidth: "1px",
    borderStyle: "solid",
    borderRadius: kind === "badge" ? "999px" : "8px",
    paddingX: kind === "badge" ? "10px" : "12px",
    paddingY: kind === "badge" ? "4px" : "8px",
  };
}

export function renderCreatedElement(document: Document, input: RenderCreatedElementInput): HTMLElement {
  const definition = COMPONENT_DEFINITIONS[input.kind];
  const appearance = { ...defaultAppearance(input.kind), ...input.appearance };
  const content: CreatedElementContent = {
    ...(definition.defaultText ? { text: definition.defaultText } : {}),
    ...(definition.defaultPlaceholder ? { placeholder: definition.defaultPlaceholder } : {}),
    ...input.content,
  };
  const root = createRoot(document, input.kind);
  root.setAttribute(OTF_ELEMENT_ID_ATTR, input.elementId);
  root.setAttribute(OTF_COMPONENT_KIND_ATTR, input.kind);
  root.setAttribute(OTF_MANAGED_ATTR, "true");
  applyBox(root, input.rect, appearance, input.kind);
  populate(root, input.kind, content, appearance, document);
  return root;
}

export function createdPrimaryText(element: HTMLElement): string | null {
  const kind = element.getAttribute(OTF_COMPONENT_KIND_ATTR);
  if (!kind) return null;
  const input = element.querySelector<HTMLInputElement>(`[${OTF_PART_ATTR}="input"]`);
  if (input) return input.placeholder;
  const label = element.querySelector(`[${OTF_PART_ATTR}="label"]`);
  if (label) return (label.textContent || "").replace(/\s+/g, " ").trim();
  if (kind === "text" || kind === "heading") return (element.textContent || "").replace(/\s+/g, " ").trim();
  return null;
}

export function applyCreatedPrimaryText(element: HTMLElement, value: string): boolean {
  const input = element.querySelector<HTMLInputElement>(`[${OTF_PART_ATTR}="input"]`);
  if (input) {
    input.placeholder = value;
    return true;
  }
  const label = element.querySelector(`[${OTF_PART_ATTR}="label"]`);
  if (label) {
    label.textContent = value;
    return true;
  }
  const kind = element.getAttribute(OTF_COMPONENT_KIND_ATTR);
  if (kind === "text" || kind === "heading") {
    element.textContent = value;
    return true;
  }
  return false;
}

function createRoot(document: Document, kind: CreatedElementKind): HTMLElement {
  if (kind === "button") {
    const button = document.createElement("button");
    button.type = "button";
    return button;
  }
  if (kind === "heading") return document.createElement("h2");
  if (kind === "header") return document.createElement("header");
  return document.createElement("div");
}

function applyBox(
  root: HTMLElement,
  rect: CreatedElementRect,
  appearance: CreatedElementAppearance,
  kind: CreatedElementKind,
): void {
  const view = root.ownerDocument.defaultView;
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;
  root.style.position = "absolute";
  root.style.left = `${String(rect.x + scrollX)}px`;
  root.style.top = `${String(rect.y + scrollY)}px`;
  root.style.width = `${String(rect.width)}px`;
  root.style.height = `${String(rect.height)}px`;
  root.style.boxSizing = "border-box";
  root.style.margin = "0";
  root.style.zIndex = "1";
  root.style.display = kind === "button" || kind === "badge" || kind === "header" || kind === "search" || kind === "input" ? "flex" : "block";
  root.style.alignItems = "center";
  root.style.justifyContent = kind === "header" ? "flex-start" : "center";
  root.style.overflow = "hidden";
  applyAppearance(root, appearance, kind);
}

function applyAppearance(element: HTMLElement, appearance: CreatedElementAppearance, kind: CreatedElementKind): void {
  if (kind === "text" || kind === "heading") {
    element.style.background = "transparent";
  } else if (appearance.fill) {
    element.style.background = appearance.fill;
  }
  if (appearance.textColor) element.style.color = appearance.textColor;
  if (appearance.fontFamily) element.style.fontFamily = appearance.fontFamily;
  if (appearance.fontSize) element.style.fontSize = appearance.fontSize;
  if (appearance.fontWeight) element.style.fontWeight = appearance.fontWeight;
  if (appearance.lineHeight) element.style.lineHeight = appearance.lineHeight;
  if (appearance.letterSpacing) element.style.letterSpacing = appearance.letterSpacing;
  if (appearance.textAlign) element.style.textAlign = appearance.textAlign;
  if (kind === "circle") element.style.borderRadius = "50%";
  else if (appearance.borderRadius) element.style.borderRadius = appearance.borderRadius;
  if (appearance.borderWidth && appearance.borderColor) {
    element.style.border = `${appearance.borderWidth} ${appearance.borderStyle ?? "solid"} ${appearance.borderColor}`;
  }
  if (appearance.boxShadow) element.style.boxShadow = appearance.boxShadow;
  if (appearance.opacity) element.style.opacity = appearance.opacity;
  if (appearance.paddingX) element.style.paddingLeft = appearance.paddingX;
  if (appearance.paddingX) element.style.paddingRight = appearance.paddingX;
  if (appearance.paddingY) element.style.paddingTop = appearance.paddingY;
  if (appearance.paddingY) element.style.paddingBottom = appearance.paddingY;
}

function populate(
  root: HTMLElement,
  kind: CreatedElementKind,
  content: CreatedElementContent,
  appearance: CreatedElementAppearance,
  document: Document,
): void {
  if (kind === "button" || kind === "badge" || kind === "text" || kind === "heading" || kind === "header") {
    const label = kind === "text" || kind === "heading" ? root : part(document, kind === "header" ? "span" : "span", "label");
    label.textContent = content.text ?? "";
    applyType(label, appearance);
    if (label !== root) root.append(label);
    return;
  }
  if (kind === "input") {
    root.append(createInput(document, content.placeholder ?? "Input", appearance));
    return;
  }
  if (kind === "search") {
    root.append(searchIcon(document), createInput(document, content.placeholder ?? "Search", appearance));
    root.style.gap = "8px";
    root.style.paddingLeft = appearance.paddingX ?? "12px";
  }
}

function createInput(document: Document, placeholder: string, appearance: CreatedElementAppearance): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute(OTF_PART_ATTR, "input");
  input.placeholder = placeholder;
  input.style.border = "0";
  input.style.outline = "none";
  input.style.background = "transparent";
  input.style.width = "100%";
  input.style.minWidth = "0";
  input.style.pointerEvents = "none";
  applyType(input, appearance);
  return input;
}

function searchIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute(OTF_PART_ATTR, "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.style.width = "16px";
  svg.style.height = "16px";
  svg.style.flex = "none";
  svg.style.pointerEvents = "none";
  svg.style.stroke = "currentColor";
  svg.style.fill = "none";
  svg.style.strokeWidth = "2";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M11 5.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm7.5 12.5-3.2-3.2");
  svg.append(path);
  return svg;
}

function part(document: Document, tag: string, name: string): HTMLElement {
  const node = document.createElement(tag);
  node.setAttribute(OTF_PART_ATTR, name);
  node.style.pointerEvents = "none";
  node.style.margin = "0";
  return node;
}

function applyType(element: HTMLElement, appearance: CreatedElementAppearance): void {
  if (appearance.textColor) element.style.color = appearance.textColor;
  if (appearance.fontFamily) element.style.fontFamily = appearance.fontFamily;
  if (appearance.fontSize) element.style.fontSize = appearance.fontSize;
  if (appearance.fontWeight) element.style.fontWeight = appearance.fontWeight;
}
