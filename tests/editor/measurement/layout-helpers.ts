export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutElement(
  element: HTMLElement,
  rect: LayoutRect,
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

export function layoutManagedElement(
  element: HTMLElement,
  base: LayoutRect,
): void {
  element.getBoundingClientRect = () => {
    if (element.style.position === "fixed" || element.style.position === "absolute") {
      const x = Number.parseFloat(element.style.left) || base.x;
      const y = Number.parseFloat(element.style.top) || base.y;
      const width = element.style.width
        ? Number.parseFloat(element.style.width)
        : base.width;
      const height = element.style.height
        ? Number.parseFloat(element.style.height)
        : base.height;
      return {
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        toJSON: () => ({}),
      };
    }

    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(element.style.transform);
    const dx = match ? Number.parseFloat(match[1] ?? "0") : 0;
    const dy = match ? Number.parseFloat(match[2] ?? "0") : 0;
    return {
      x: base.x + dx,
      y: base.y + dy,
      width: base.width,
      height: base.height,
      top: base.y + dy,
      left: base.x + dx,
      right: base.x + dx + base.width,
      bottom: base.y + dy + base.height,
      toJSON: () => ({}),
    };
  };
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
