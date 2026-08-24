export const OTF_ELEMENT_ID_ATTR = "data-otf-element-id";
export const OTF_COMPONENT_KIND_ATTR = "data-otf-component-kind";
export const OTF_PART_ATTR = "data-otf-part";
export const OTF_PREVIEW_ATTR = "data-otf-preview";

export const CREATED_ELEMENT_KINDS = [
  "rectangle",
  "circle",
  "divider",
  "text",
  "heading",
  "button",
  "input",
  "search",
  "badge",
  "container",
  "card",
  "header",
] as const;

export type CreatedElementKind = (typeof CREATED_ELEMENT_KINDS)[number];

export type CreatedStyleFamily = "text" | "control" | "surface" | "shape" | "line";

export interface CreatedElementContent {
  readonly text?: string;
  readonly placeholder?: string;
}

export interface CreatedElementAppearance {
  readonly fill?: string;
  readonly textColor?: string;
  readonly fontFamily?: string;
  readonly fontSize?: string;
  readonly fontWeight?: string;
  readonly lineHeight?: string;
  readonly letterSpacing?: string;
  readonly textAlign?: string;
  readonly borderColor?: string;
  readonly borderWidth?: string;
  readonly borderStyle?: string;
  readonly borderRadius?: string;
  readonly boxShadow?: string;
  readonly opacity?: string;
  readonly paddingX?: string;
  readonly paddingY?: string;
}

export interface CreatedElementRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const CREATED_KIND_SET: ReadonlySet<string> = new Set(CREATED_ELEMENT_KINDS);

export function isCreatedElementKind(value: unknown): value is CreatedElementKind {
  return typeof value === "string" && CREATED_KIND_SET.has(value);
}

export function createdEntityKey(elementId: string): string {
  return `created:${elementId}`;
}

export function createdRootOf(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>(`[${OTF_ELEMENT_ID_ATTR}]`) ?? element;
}

export function readCreatedElementId(element: HTMLElement): string | null {
  return createdRootOf(element).getAttribute(OTF_ELEMENT_ID_ATTR)?.trim() || null;
}
