import type { Locator, Page } from "@playwright/test";
import { getOverlayRect, getTransformHandleRect, rect, type GeometryRect } from "./geometry.js";

/**
 * Site-independent measurement of one live element: what the browser actually
 * paints, what the editor stored on it, and who wins the hit test at its centre.
 */

export interface VisualOracle {
  tag: string;
  id: string | null;
  cloneId: string | null;
  elementId: string | null;
  managed: boolean;
  detached: boolean;
  isConnected: boolean;
  display: string;
  visibility: string;
  rect: GeometryRect;
  inlineWidth: string;
  inlineHeight: string;
  inlineLeft: string;
  inlineTop: string;
  inlineTransform: string;
  computedWidth: string;
  computedHeight: string;
  computedTransform: string;
  computedTransformOrigin: string;
  computedPosition: string;
  computedZIndex: string;
  storedTransform: Record<string, unknown> | null;
  offsetParentTag: string | null;
  hitWinner: {
    tag: string;
    cloneId: string | null;
    elementId: string | null;
    text: string;
  } | null;
}

export function parseStored(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

export async function captureOracle(_page: Page, target: Locator): Promise<VisualOracle> {
  const box = await rect(target);
  return target.evaluate((element, measured) => {
    const html = element as HTMLElement;
    const style = html.style;
    const computed = getComputedStyle(html);
    const cx = measured.x + measured.width / 2;
    const cy = measured.y + measured.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const hitHtml = hit instanceof HTMLElement ? hit : null;
    const storedRaw = html.getAttribute("data-otf-transform");
    let stored: Record<string, unknown> | null = null;
    if (storedRaw) {
      try {
        stored = JSON.parse(storedRaw) as Record<string, unknown>;
      } catch {
        stored = { raw: storedRaw };
      }
    }
    return {
      tag: html.tagName.toLowerCase(),
      id: html.id || null,
      cloneId: html.getAttribute("data-otf-clone-id"),
      elementId: html.getAttribute("data-otf-element-id"),
      managed: html.getAttribute("data-otf-managed") === "true",
      detached: html.getAttribute("data-otf-detached") === "true",
      isConnected: html.isConnected,
      display: style.display || computed.display,
      visibility: computed.visibility,
      rect: measured,
      inlineWidth: style.width,
      inlineHeight: style.height,
      inlineLeft: style.left,
      inlineTop: style.top,
      inlineTransform: style.transform,
      computedWidth: computed.width,
      computedHeight: computed.height,
      computedTransform: computed.transform,
      computedTransformOrigin: computed.transformOrigin,
      computedPosition: computed.position,
      computedZIndex: computed.zIndex,
      storedTransform: stored,
      offsetParentTag: html.offsetParent instanceof HTMLElement ? html.offsetParent.tagName.toLowerCase() : null,
      hitWinner: hitHtml
        ? {
            tag: hitHtml.tagName.toLowerCase(),
            cloneId: hitHtml.closest("[data-otf-clone-id]")?.getAttribute("data-otf-clone-id") ?? null,
            elementId: hitHtml.closest("[data-otf-element-id]")?.getAttribute("data-otf-element-id") ?? null,
            text: (hitHtml.innerText ?? "").slice(0, 80),
          }
        : null,
    };
  }, box);
}

export async function captureStepSnapshot(page: Page, target: Locator): Promise<{
  oracle: VisualOracle;
  overlay: GeometryRect | null;
  resizeHandle: GeometryRect | null;
  rotateHandle: GeometryRect | null;
}> {
  return {
    oracle: await captureOracle(page, target),
    overlay: await getOverlayRect(page),
    resizeHandle: await getTransformHandleRect(page, "resize-se"),
    rotateHandle: await getTransformHandleRect(page, "rotate"),
  };
}

export async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<boolean> {
  const viewport = page.viewportSize();
  let box = await getTransformHandleRect(page, handle);
  if (!box) return false;
  if (viewport) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const pad = 64;
    const offX = cx < pad || cx > viewport.width - pad;
    const offY = cy < pad || cy > viewport.height - pad;
    if (offX || offY) {
      await page.evaluate(({ scrollX, scrollY }) => window.scrollBy(scrollX, scrollY), {
        scrollX: offX ? cx - viewport.width / 2 : 0,
        scrollY: offY ? cy - viewport.height / 2 : 0,
      });
      await page.waitForTimeout(150);
      box = await getTransformHandleRect(page, handle);
      if (!box) return false;
    }
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
  return true;
}
