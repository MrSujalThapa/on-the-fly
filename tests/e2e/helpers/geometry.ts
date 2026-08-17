import { expect, type Locator, type Page } from "@playwright/test";

export interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export const DEFAULT_TOLERANCE_PX = 4;

export async function rect(target: Locator): Promise<GeometryRect> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      top: box.top,
      left: box.left,
      right: box.right,
      bottom: box.bottom,
    };
  });
}

export function translated(origin: GeometryRect, dx: number, dy: number): GeometryRect {
  return {
    x: origin.x + dx,
    y: origin.y + dy,
    width: origin.width,
    height: origin.height,
    top: origin.top + dy,
    left: origin.left + dx,
    right: origin.right + dx,
    bottom: origin.bottom + dy,
  };
}

export function expectRectNear(
  actual: GeometryRect,
  expected: GeometryRect,
  tolerance = DEFAULT_TOLERANCE_PX,
  label = "rect",
): void {
  expect.soft(Math.abs(actual.x - expected.x), `${label} x`).toBeLessThanOrEqual(tolerance);
  expect.soft(Math.abs(actual.y - expected.y), `${label} y`).toBeLessThanOrEqual(tolerance);
  expect.soft(Math.abs(actual.width - expected.width), `${label} width`).toBeLessThanOrEqual(tolerance);
  expect.soft(Math.abs(actual.height - expected.height), `${label} height`).toBeLessThanOrEqual(tolerance);
}

export async function snapshotLayout(
  page: Page,
  selector: string,
): Promise<Record<string, GeometryRect>> {
  const locators = page.locator(selector);
  const count = await locators.count();
  const layout: Record<string, GeometryRect> = {};
  for (let index = 0; index < count; index += 1) {
    const item = locators.nth(index);
    const id = (await item.getAttribute("data-testid")) ?? `item-${String(index)}`;
    layout[id] = await rect(item);
  }
  return layout;
}

export function expectUnchanged(
  before: Record<string, GeometryRect>,
  after: Record<string, GeometryRect>,
  ids: string[],
  tolerance = DEFAULT_TOLERANCE_PX,
): void {
  for (const id of ids) {
    const previous = before[id];
    const next = after[id];
    expect(previous, `${id} before`).toBeDefined();
    expect(next, `${id} after`).toBeDefined();
    if (!previous || !next) {
      continue;
    }
    expectRectNear(next, previous, tolerance, id);
  }
}

interface CdpNode {
  nodeId: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
}

function classListOf(node: CdpNode): string[] {
  const attributes = node.attributes ?? [];
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === "class") {
      return (attributes[index + 1] ?? "").split(/\s+/u).filter(Boolean);
    }
  }
  return [];
}

function findNodeByClass(node: CdpNode, className: string): CdpNode | null {
  if (classListOf(node).includes(className)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const hit = findNodeByClass(child, className);
    if (hit) {
      return hit;
    }
  }
  for (const shadow of node.shadowRoots ?? []) {
    const hit = findNodeByClass(shadow, className);
    if (hit) {
      return hit;
    }
  }
  if (node.contentDocument) {
    return findNodeByClass(node.contentDocument, className);
  }
  return null;
}

export async function getOverlayRect(page: Page): Promise<GeometryRect | null> {
  const session = await page.context().newCDPSession(page);
  try {
    const document = await session.send("DOM.getDocument", { depth: -1, pierce: true });
    const root: CdpNode = document.root;
    const outline = findNodeByClass(root, "otf-selection-outline");
    if (!outline) {
      return null;
    }
    const model = await session.send("DOM.getBoxModel", { nodeId: outline.nodeId });
    const quad = model.model.border.length >= 8 ? model.model.border : model.model.content;
    if (quad.length < 8) {
      return null;
    }
    const xs = [quad[0], quad[2], quad[4], quad[6]].filter((value): value is number => value !== undefined);
    const ys = [quad[1], quad[3], quad[5], quad[7]].filter((value): value is number => value !== undefined);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      top,
      left,
      right,
      bottom,
    };
  } catch {
    return null;
  } finally {
    await session.detach();
  }
}

export async function waitForReplaySettle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let frames = 0;
      const tick = (): void => {
        frames += 1;
        if (frames >= 90) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
}
