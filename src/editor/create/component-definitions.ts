import type { CreatedElementKind, CreatedStyleFamily } from "./created-element.js";

export interface ComponentDefinition {
  readonly kind: CreatedElementKind;
  readonly label: string;
  readonly group: "basic" | "controls" | "structure";
  readonly defaultSize: { width: number; height: number };
  readonly minSize: { width: number; height: number };
  readonly styleFamily: CreatedStyleFamily;
  readonly textCapable: boolean;
  readonly defaultText?: string;
  readonly defaultPlaceholder?: string;
}

export const COMPONENT_DEFINITIONS: Record<CreatedElementKind, ComponentDefinition> = {
  rectangle: { kind: "rectangle", label: "Rectangle", group: "basic", defaultSize: { width: 180, height: 100 }, minSize: { width: 16, height: 16 }, styleFamily: "shape", textCapable: false },
  circle: { kind: "circle", label: "Circle", group: "basic", defaultSize: { width: 100, height: 100 }, minSize: { width: 16, height: 16 }, styleFamily: "shape", textCapable: false },
  divider: { kind: "divider", label: "Divider", group: "basic", defaultSize: { width: 220, height: 2 }, minSize: { width: 24, height: 1 }, styleFamily: "line", textCapable: false },
  text: { kind: "text", label: "Text", group: "basic", defaultSize: { width: 200, height: 36 }, minSize: { width: 40, height: 20 }, styleFamily: "text", textCapable: true, defaultText: "Text" },
  heading: { kind: "heading", label: "Heading", group: "basic", defaultSize: { width: 220, height: 48 }, minSize: { width: 48, height: 24 }, styleFamily: "text", textCapable: true, defaultText: "Heading" },
  button: { kind: "button", label: "Button", group: "controls", defaultSize: { width: 120, height: 40 }, minSize: { width: 48, height: 28 }, styleFamily: "control", textCapable: true, defaultText: "Button" },
  input: { kind: "input", label: "Input", group: "controls", defaultSize: { width: 220, height: 40 }, minSize: { width: 80, height: 28 }, styleFamily: "control", textCapable: true, defaultPlaceholder: "Input" },
  search: { kind: "search", label: "Search Bar", group: "controls", defaultSize: { width: 260, height: 42 }, minSize: { width: 120, height: 32 }, styleFamily: "control", textCapable: true, defaultPlaceholder: "Search" },
  badge: { kind: "badge", label: "Badge / Pill", group: "controls", defaultSize: { width: 90, height: 30 }, minSize: { width: 36, height: 20 }, styleFamily: "control", textCapable: true, defaultText: "Badge" },
  container: { kind: "container", label: "Container", group: "structure", defaultSize: { width: 280, height: 180 }, minSize: { width: 40, height: 40 }, styleFamily: "surface", textCapable: false },
  card: { kind: "card", label: "Card", group: "structure", defaultSize: { width: 280, height: 180 }, minSize: { width: 40, height: 40 }, styleFamily: "surface", textCapable: false },
  header: { kind: "header", label: "Header / Navbar", group: "structure", defaultSize: { width: 480, height: 56 }, minSize: { width: 120, height: 36 }, styleFamily: "surface", textCapable: true, defaultText: "Header" },
};

export const COMPONENT_PALETTE: ReadonlyArray<{ group: ComponentDefinition["group"]; title: string; kinds: CreatedElementKind[] }> = [
  { group: "basic", title: "Basic", kinds: ["rectangle", "circle", "divider", "text", "heading"] },
  { group: "controls", title: "Controls", kinds: ["button", "input", "search", "badge"] },
  { group: "structure", title: "Structure", kinds: ["container", "card", "header"] },
];
