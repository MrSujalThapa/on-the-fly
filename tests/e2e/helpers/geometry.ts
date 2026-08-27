import { expect, type Locator, type Page } from "@playwright/test";
import {
  cdpAttr,
  cdpBox,
  cdpClassList,
  countCdpByClass,
  findCdpByClass,
  findCdpNode,
  withOtfHost,
} from "./otf-cdp.js";

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

export async function getOverlayRect(page: Page): Promise<GeometryRect | null> {
  return withOtfHost(page, async (session, host) => {
    if (!host) {
      return null;
    }
    const outline = findCdpByClass(host, "otf-selection-outline");
    if (!outline) {
      return null;
    }
    return cdpBox(session, outline);
  }, null);
}

export async function getTransformHandleRect(page: Page, handle: string): Promise<GeometryRect | null> {
  return withOtfHost(page, async (session, host) => {
    if (!host) {
      return null;
    }
    const target = findCdpNode(
      host,
      (node) => cdpClassList(node).includes("otf-transform-handle") && cdpAttr(node, "data-handle") === handle,
    );
    if (!target) {
      return null;
    }
    return cdpBox(session, target);
  }, null);
}

export async function getIndicatorMode(page: Page): Promise<string | null> {
  return withOtfHost(page, async (_session, host) => {
    if (!host) {
      return null;
    }
    const indicator = findCdpByClass(host, "otf-indicator");
    return indicator ? cdpAttr(indicator, "data-mode") : null;
  }, null);
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

function parsePackedRect(value: string | null): GeometryRect | null {
  if (!value) {
    return null;
  }
  const parts = value.split(",").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
  };
}

export interface OverlayPipeline {
  model: GeometryRect | null;
  renderer: GeometryRect | null;
  rendered: GeometryRect | null;
  space: string | null;
  outlineCount: number;
}

export async function getOverlayPipeline(page: Page): Promise<OverlayPipeline> {
  const empty: OverlayPipeline = { model: null, renderer: null, rendered: null, space: null, outlineCount: 0 };
  return withOtfHost(page, async (session, host) => {
    if (!host) {
      return empty;
    }
    const outline = findCdpByClass(host, "otf-selection-outline");
    if (!outline) {
      return empty;
    }
    return {
      model: parsePackedRect(cdpAttr(outline, "data-otf-model")),
      renderer: parsePackedRect(cdpAttr(outline, "data-otf-renderer")),
      rendered: await cdpBox(session, outline),
      space: cdpAttr(outline, "data-otf-space"),
      outlineCount: countCdpByClass(host, "otf-selection-outline"),
    };
  }, empty);
}
