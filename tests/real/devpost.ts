import type { Locator, Page } from "@playwright/test";
import { DEVPOST_HOME } from "./constants.js";
import { siteStructureChanged, unionRect, waitVisible } from "./harness.js";
import { rect, type GeometryRect } from "../e2e/helpers/geometry.js";
import { classifyDevpostSession, requireAuthenticated } from "./session-status.js";

export async function gotoDevpostHome(page: Page): Promise<void> {
  await page.goto(DEVPOST_HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("load").catch(() => undefined);
}

async function hasSignedInNav(page: Page): Promise<boolean> {
  const names = [/portfolio/i, /my hackathons/i, /log out/i, /sign out/i];
  for (const name of names) {
    const visible = await page.getByRole("link", { name }).first().isVisible().catch(() => false);
    if (visible) {
      return true;
    }
  }
  const button = await page.getByRole("button", { name: /account|profile|menu/i }).first().isVisible().catch(() => false);
  return button;
}

export async function readDevpostSession(page: Page): Promise<ReturnType<typeof classifyDevpostSession>> {
  const url = page.url();
  const hasPasswordField = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  const hasInProgressSection = await page.getByText(/in progress/i).first().isVisible().catch(() => false);
  return classifyDevpostSession({
    url,
    hasInProgressSection,
    hasPasswordField,
    hasSignedInNav: await hasSignedInNav(page),
  });
}

export async function requireDevpostAuth(page: Page): Promise<void> {
  await gotoDevpostHome(page);
  const status = await readDevpostSession(page);
  requireAuthenticated(status, "Devpost");
}

export async function openDevpostPortfolio(page: Page): Promise<void> {
  await requireDevpostAuth(page);
  if (await page.getByText(/in progress/i).first().isVisible().catch(() => false)) {
    return;
  }
  const portfolio = page.getByRole("link", { name: /portfolio/i }).or(page.getByRole("link", { name: /view profile/i }));
  if ((await portfolio.count()) > 0) {
    await portfolio.first().click();
    await page.waitForLoadState("domcontentloaded");
  }
  if (!(await page.getByText(/in progress/i).first().isVisible().catch(() => false))) {
    throw siteStructureChanged(
      "Devpost In Progress section was not found on the authenticated profile/portfolio page",
    );
  }
}

export async function inProgressCardHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("h1, h2, h3, h4, legend, p, div, section"));
    const heading = nodes.find((node) => {
      const text = node.textContent.replace(/\s+/gu, " ").trim();
      return /^in progress$/iu.test(text) || (/^in progress\b/iu.test(text) && text.length < 40);
    });
    if (!heading) {
      return [];
    }

    const nextHeading = (start: Element): Element | null => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"));
      const startTop = start.getBoundingClientRect().top;
      return (
        headings.find((node) => {
          const text = node.textContent.replace(/\s+/gu, " ").trim();
          const top = node.getBoundingClientRect().top;
          return top > startTop + 8 && text.length > 0 && text.length < 80 && !/^in progress$/iu.test(text);
        }) ?? null
      );
    };

    const end = nextHeading(heading);
    const endTop = end ? end.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
    const startTop = heading.getBoundingClientRect().top;
    const hrefs: string[] = [];
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") ?? "";
      if (!/\/software\//u.test(href)) {
        continue;
      }
      const top = anchor.getBoundingClientRect().top;
      if (top <= startTop + 4 || top >= endTop - 4) {
        continue;
      }
      try {
        const absolute = new URL(href, location.origin).pathname;
        if (!hrefs.includes(absolute)) {
          hrefs.push(absolute);
        }
      } catch {
        continue;
      }
    }
    return hrefs;
  });
}

export async function inProgressCards(page: Page): Promise<Locator[]> {
  await waitVisible(page.getByText(/in progress/i), "Devpost In Progress heading was not found");
  const hrefs = await inProgressCardHrefs(page);
  if (hrefs.length < 3) {
    throw siteStructureChanged(
      `expected at least 3 In Progress project cards, found ${String(hrefs.length)}`,
    );
  }
  return hrefs.slice(0, 3).map((pathname) =>
    page.locator(`a[href*="${pathname}"]`).first(),
  );
}

export async function inProgressCollectionRect(page: Page, cards: Locator[]): Promise<GeometryRect> {
  const rects = [];
  for (const card of cards) {
    rects.push(await rect(card));
  }
  return unionRect(rects);
}
