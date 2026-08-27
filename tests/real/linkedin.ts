import type { BrowserContext, Locator, Page } from "@playwright/test";
import { LINKEDIN_NOTIFICATIONS } from "./constants.js";
import { siteStructureChanged, productFailure, rectDelta, unionRect, waitVisible } from "./harness.js";
import { enableEditMode } from "../e2e/helpers/actions.js";
import { waitForReplaySettle } from "../e2e/helpers/geometry.js";
import { rect, type GeometryRect } from "../e2e/helpers/geometry.js";
import { classifyLinkedInSession, requireAuthenticated } from "./session-status.js";

export type LinkedInFilterName = "All" | "Jobs" | "My posts" | "Mentions";

function filterNamePattern(name: LinkedInFilterName): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}\\b`, "iu");
}

function filterLocator(page: Page, name: LinkedInFilterName): Locator {
  const pattern = filterNamePattern(name);
  const scope = page.getByRole("main");
  return scope
    .getByRole("radio", { name: pattern })
    .or(scope.getByRole("tab", { name: pattern }))
    .or(scope.getByRole("button", { name: pattern }))
    .or(scope.getByRole("link", { name: pattern }));
}

export async function gotoLinkedInNotifications(page: Page): Promise<void> {
  await page.goto(LINKEDIN_NOTIFICATIONS, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("load").catch(() => undefined);
}

export async function readLinkedInSession(page: Page): Promise<ReturnType<typeof classifyLinkedInSession>> {
  const url = page.url();
  const hasPasswordField = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  const mentions = filterLocator(page, "Mentions");
  const hasMentionsControl = await mentions.first().isVisible().catch(() => false);
  return classifyLinkedInSession({ url, hasMentionsControl, hasPasswordField });
}

export async function requireLinkedInAuth(page: Page): Promise<void> {
  await gotoLinkedInNotifications(page);
  const status = await readLinkedInSession(page);
  requireAuthenticated(status, "LinkedIn");
}

export async function linkedInFilter(page: Page, name: LinkedInFilterName): Promise<Locator> {
  const stamped = await page.waitForFunction((filterName: string) => {
    const escaped = filterName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const nameRe = new RegExp(`^${escaped}\\b`, "iu");
    const label = (node: Element): string => (node.textContent ?? "").replace(/\s+/gu, " ").trim();
    const isGlobalNav = (node: Element): boolean =>
      /new notification/i.test(label(node)) ||
      Boolean(node.closest("header, [role='banner']")) ||
      Boolean(node.closest("a[href*='/jobs'], a[href*='/mynetwork'], a[href*='/messaging']") && !node.closest("main"));
    const visibleBox = (node: Element): DOMRect | null => {
      if (!(node instanceof HTMLElement) || node.closest("#on-the-fly-root-host")) {
        return null;
      }
      const box = node.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) {
        return null;
      }
      return box;
    };
    const matches = (node: Element): boolean => {
      if (!nameRe.test(label(node)) || isGlobalNav(node)) {
        return false;
      }
      return Boolean(visibleBox(node));
    };
    // Only clear this filter's own stamp; clearing every stamp invalidates the
    // locators already handed out for the other filters.
    const previous = document.querySelectorAll(`[data-otf-test-filter="${filterName}"]`);
    for (let index = 0; index < previous.length; index += 1) {
      previous.item(index)?.removeAttribute("data-otf-test-filter");
    }
    const managed = Array.from(document.querySelectorAll("[data-otf-managed],[data-otf-detached],[data-otf-transform]"))
      .filter(matches);
    const inMain = Array.from(document.querySelectorAll("main a, main button, main [role='tab'], main [role='radio']"))
      .filter(matches);
    const chosen = managed[managed.length - 1] ?? inMain[0];
    if (!(chosen instanceof HTMLElement)) {
      return false;
    }
    chosen.setAttribute("data-otf-test-filter", filterName);
    return true;
  }, name, { timeout: 25_000 }).catch(() => null);
  if (!stamped) {
    throw siteStructureChanged(`LinkedIn notifications filter "${name}" was not found`);
  }
  return waitVisible(
    page.locator(`[data-otf-test-filter="${name}"]`),
    `LinkedIn notifications filter "${name}" was not found`,
  );
}

export async function linkedInFilters(page: Page): Promise<Record<LinkedInFilterName, Locator>> {
  const load = async (): Promise<Record<LinkedInFilterName, Locator>> => {
    const All = await linkedInFilter(page, "All");
    const Jobs = await linkedInFilter(page, "Jobs");
    const posts = await linkedInFilter(page, "My posts");
    const Mentions = await linkedInFilter(page, "Mentions");
    return { All, Jobs, "My posts": posts, Mentions };
  };
  try {
    return await load();
  } catch {
    await gotoLinkedInNotifications(page);
    const all = page.getByRole("main").getByRole("link", { name: /^All\b/iu }).or(page.getByRole("main").getByRole("button", { name: /^All\b/iu })).first();
    if (await all.isVisible().catch(() => false)) {
      await all.click();
      await page.waitForTimeout(400);
    }
    return await load();
  }
}

export async function reloadLinkedInAndReplay(page: Page, context: BrowserContext): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await linkedInFilters(page);
  await waitForReplaySettle(page);
  await enableEditMode(context, page);
}

export async function linkedInFilterCollectionRect(page: Page): Promise<GeometryRect> {
  const filters = await linkedInFilters(page);
  const rects = [
    await rect(filters.All),
    await rect(filters.Jobs),
    await rect(filters["My posts"]),
    await rect(filters.Mentions),
  ];
  return unionRect(rects);
}

export function assertSiblingMoveIsolated(input: {
  movedName: string;
  movedBefore: GeometryRect;
  movedAfter: GeometryRect;
  siblingName: string;
  siblingBefore: GeometryRect;
  siblingAfter: GeometryRect;
  expectedDx: number;
  expectedDy: number;
  tolerance?: number;
}): void {
  const tolerance = input.tolerance ?? 12;
  const movedDx = input.movedAfter.x - input.movedBefore.x;
  const movedDy = input.movedAfter.y - input.movedBefore.y;
  if (Math.abs(movedDx - input.expectedDx) > tolerance || Math.abs(movedDy - input.expectedDy) > tolerance) {
    throw new Error(
      productFailure(
        `${input.movedName} did not keep the expected move (dx=${String(movedDx)}, dy=${String(movedDy)}; expected ${String(input.expectedDx)}, ${String(input.expectedDy)})`,
      ),
    );
  }
  if (rectDelta(input.siblingAfter, input.siblingBefore) > tolerance) {
    throw new Error(
      productFailure(
        `${input.siblingName} received ${input.movedName}'s move (sibling delta=${String(rectDelta(input.siblingAfter, input.siblingBefore))})`,
      ),
    );
  }
}
