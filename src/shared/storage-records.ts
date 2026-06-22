import type { EditorOperation } from "../editor/operations.js";
import type { PageKey, SiteOrigin } from "../editor/ids.js";

export interface StoredSite {
  origin: SiteOrigin;
  createdAt: number;
  updatedAt: number;
}

export interface StoredPage {
  pageKey: PageKey;
  origin: SiteOrigin;
  normalizedPath: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredCustomization {
  id: string;
  pageKey: PageKey;
  name: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export type StoredOperation = EditorOperation & {
  customizationId: string;
  sequence: number;
};

export interface PageInfo {
  origin: SiteOrigin;
  normalizedPath: string;
}

/**
 * Derives the site origin and normalized path from a page key. Page keys are
 * `origin + pathname` (see EditSession.computePageKey); this parses them back
 * out for the `sites`/`pages` records. Falls back gracefully for opaque keys.
 */
export function derivePageInfo(pageKey: PageKey): PageInfo {
  try {
    const url = new URL(pageKey);
    return { origin: url.origin, normalizedPath: url.pathname || "/" };
  } catch {
    return { origin: pageKey, normalizedPath: "/" };
  }
}

/** Default single customization id for a page in V1 (no UI for variants yet). */
export function defaultCustomizationId(pageKey: PageKey): string {
  return `${pageKey}#default`;
}
