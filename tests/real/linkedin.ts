import type { BrowserContext, Locator, Page } from "@playwright/test";
import { LINKEDIN_NOTIFICATIONS } from "./constants.js";
import { productFailure, rectDelta, unionRect, waitVisible } from "./harness.js";
import { enableEditMode } from "../e2e/helpers/actions.js";
import { waitForReplaySettle } from "../e2e/helpers/geometry.js";
import { rect, type GeometryRect } from "../e2e/helpers/geometry.js";
import { classifyLinkedInSession, requireAuthenticated } from "./session-status.js";

export type LinkedInFilterName = "All" | "Jobs" | "My posts" | "Mentions";

function filterNamePattern(name: LinkedInFilterName): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}\\b`, "iu");
}

export async function gotoLinkedInNotifications(page: Page): Promise<void> {
  await page.goto(LINKEDIN_NOTIFICATIONS, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("load").catch(() => undefined);
}

export async function readLinkedInSession(page: Page): Promise<ReturnType<typeof classifyLinkedInSession>> {
  const url = page.url();
  const hasPasswordField = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  const mentions = page.getByRole("radio", { name: filterNamePattern("Mentions") }).or(
    page.getByRole("button", { name: filterNamePattern("Mentions") }).or(
      page.getByRole("tab", { name: filterNamePattern("Mentions") }),
    ),
  );
  const hasMentionsControl = await mentions.first().isVisible().catch(() => false);
  return classifyLinkedInSession({ url, hasMentionsControl, hasPasswordField });
}

export async function requireLinkedInAuth(page: Page): Promise<void> {
  await gotoLinkedInNotifications(page);
  const status = await readLinkedInSession(page);
  requireAuthenticated(status, "LinkedIn");
}

export async function linkedInFilter(page: Page, name: LinkedInFilterName): Promise<Locator> {
  const pattern = filterNamePattern(name);
  const locator = page
    .getByRole("radio", { name: pattern })
    .or(page.getByRole("tab", { name: pattern }))
    .or(page.getByRole("button", { name: pattern }));
  return waitVisible(locator, `LinkedIn notifications filter "${name}" was not found`);
}

export async function linkedInFilters(page: Page): Promise<Record<LinkedInFilterName, Locator>> {
  const All = await linkedInFilter(page, "All");
  const Jobs = await linkedInFilter(page, "Jobs");
  const posts = await linkedInFilter(page, "My posts");
  const Mentions = await linkedInFilter(page, "Mentions");
  return { All, Jobs, "My posts": posts, Mentions };
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
