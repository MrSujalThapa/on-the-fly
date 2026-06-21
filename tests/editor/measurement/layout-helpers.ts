import type { MeasurementRect } from "../../../src/editor/measurement/types.js";

export function layoutElement(
  element: HTMLElement,
  rect: MeasurementRect,
): void {
  element.style.display = "block";
  element.style.width = `${String(rect.width)}px`;
  element.style.height = `${String(rect.height)}px`;

  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  });
}

export function layoutTree(root: ParentNode): void {
  if (!(root instanceof HTMLElement)) {
    return;
  }

  let offsetY = 0;

  const walk = (element: HTMLElement): void => {
    const width = element.tagName === "BUTTON" || element.tagName === "INPUT" ? 120 : 200;
    const height =
      element.children.length > 0 && element.textContent === element.children[0]?.textContent
        ? 80
        : element.children.length > 0
          ? 240
          : 32;

    layoutElement(element, { x: 16, y: offsetY, width, height });
    offsetY += height + 8;

    for (const child of Array.from(element.children)) {
      if (child instanceof HTMLElement) {
        walk(child);
      }
    }
  };

  walk(root);
}
