import type { ElementSignature } from "../editor/element-signature.js";
import { isDangerousCssPath } from "../editor/validation/dangerous-selectors.js";
import {
  buildPersistableElementSignature,
  buildUniqueCssPath,
} from "../editor/measurement/signature-builder.js";
import { fingerprintSrcValue } from "../editor/measurement/src-fingerprint.js";
import type {
  DurableVisualIdentity,
  IdentityEvidence,
  VisualResolveResult,
} from "./visual-model.js";

const VOLATILE_DATA_PREFIXES = [
  "react",
  "v-",
  "ember",
  "cid",
  "otf",
  "gtm",
  "google",
  "qa-shadow",
];

const STABLE_DATA_KEYS = new Set([
  "id",
  "key",
  "itemid",
  "logicalid",
  "testid",
  "urn",
  "entityid",
  "entityuri",
]);

export const IDENTITY_VERSION = 2;

function normalize(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function queryCssPath(root: ParentNode, cssPath: string): HTMLElement[] {
  if (!cssPath || isDangerousCssPath(cssPath)) {
    return [];
  }
  const scope = root instanceof Document ? root.documentElement : root;
  try {
    return Array.from(scope.querySelectorAll(cssPath)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
  } catch {
    return [];
  }
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function siblingOrdinal(element: Element): number {
  const parent = element.parentElement;
  if (!parent) {
    return 0;
  }
  const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  return siblings.indexOf(element) + 1;
}

function siblingCount(element: Element): number {
  const parent = element.parentElement;
  if (!parent) {
    return 1;
  }
  return Array.from(parent.children).filter((child) => child.tagName === element.tagName).length;
}

function isVolatileDataKey(key: string): boolean {
  const lower = key.toLowerCase();
  return VOLATILE_DATA_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function isGeneratedIdentityValue(value: string | undefined): boolean {
  const token = (value ?? "").trim();
  if (!token) {
    return false;
  }
  return /(?:^|[-_:])ember\d+(?:$|[-_:])|^react[-:].+|^:?r[a-z0-9]+:$/iu.test(token);
}

function stableDatasetEntries(element: HTMLElement): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [rawKey, value] of Object.entries(element.dataset)) {
    if (!value || isVolatileDataKey(rawKey) || isGeneratedIdentityValue(value)) {
      continue;
    }
    if (STABLE_DATA_KEYS.has(rawKey.toLowerCase()) || STABLE_DATA_KEYS.has(rawKey)) {
      entries.push([rawKey, value]);
    }
  }
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

function datasetFingerprint(element: HTMLElement): string | undefined {
  const entries = stableDatasetEntries(element);
  if (entries.length === 0) {
    return undefined;
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(";");
}

function descendantHref(element: HTMLElement): string | undefined {
  if (element instanceof HTMLAnchorElement && element.getAttribute("href")) {
    return element.getAttribute("href")?.trim();
  }
  const nested = element.querySelector("a[href]");
  return nested?.getAttribute("href")?.trim() || undefined;
}

function descendantSrc(element: HTMLElement): string | undefined {
  if (element instanceof HTMLImageElement) {
    return fingerprintSrcValue(element.currentSrc || element.src);
  }
  const image = element.querySelector("img");
  if (image instanceof HTMLImageElement) {
    return fingerprintSrcValue(image.currentSrc || image.src);
  }
  return undefined;
}

function parseDatasetFingerprint(value: string | undefined): Array<[string, string]> {
  if (!value) {
    return [];
  }
  return value
    .split(";")
    .map((part) => {
      const split = part.indexOf("=");
      if (split <= 0) {
        return null;
      }
      return [part.slice(0, split), part.slice(split + 1)] as [string, string];
    })
    .filter((entry): entry is [string, string] => entry !== null);
}

export function buildDurableIdentity(element: HTMLElement, root: ParentNode): DurableVisualIdentity {
  const signature = buildPersistableElementSignature(element, { root });
  const uniquePath = buildUniqueCssPath(element, root);
  const data = datasetFingerprint(element);
  const hrefAttr = descendantHref(element);
  const nameAttr = element.getAttribute("name")?.trim();
  const src = descendantSrc(element);
  return {
    signature: {
      ...signature,
      cssPath: uniquePath,
      identityVersion: IDENTITY_VERSION,
      siblingOrdinal: siblingOrdinal(element),
      siblingCount: siblingCount(element),
      ...(data ? { datasetFingerprint: data } : {}),
      ...(hrefAttr ? { hrefAttr } : {}),
      ...(nameAttr ? { nameAttr } : {}),
      ...(src && !signature.srcFingerprint ? { srcFingerprint: src } : {}),
    },
  };
}

function evidence(
  partial: Omit<IdentityEvidence, "candidateCount"> & { candidateCount?: number },
): IdentityEvidence {
  return {
    candidateCount: partial.candidateCount ?? 0,
    cssPathMatched: partial.cssPathMatched,
    structureShifted: partial.structureShifted,
    matchedKeys: partial.matchedKeys,
    strategy: partial.strategy,
    ...(partial.reason ? { reason: partial.reason } : {}),
  };
}

function structureShifted(element: HTMLElement, signature: ElementSignature): boolean {
  if (signature.siblingCount === undefined || signature.siblingOrdinal === undefined) {
    return false;
  }
  return (
    siblingCount(element) !== signature.siblingCount ||
    siblingOrdinal(element) !== signature.siblingOrdinal
  );
}

function uniqueIn(root: ParentNode, selector: string): HTMLElement[] {
  try {
    const scope = root instanceof Document ? root.documentElement : root;
    return Array.from(scope.querySelectorAll(selector)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
  } catch {
    return [];
  }
}

function gatherByStableKeys(root: ParentNode, signature: ElementSignature): HTMLElement[] {
  const found = new Set<HTMLElement>();
  if (signature.idAttr && !isGeneratedIdentityValue(signature.idAttr)) {
    for (const node of uniqueIn(root, `#${escapeCssIdentifier(signature.idAttr)}`)) {
      found.add(node);
    }
  }
  for (const [key, value] of parseDatasetFingerprint(signature.datasetFingerprint)) {
    if (isGeneratedIdentityValue(value)) {
      continue;
    }
    const attr = key.startsWith("data-")
      ? key
      : `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
    for (const node of uniqueIn(root, `[${attr}="${escapeCssIdentifier(value)}"]`)) {
      found.add(node);
    }
  }
  if (signature.nameAttr) {
    for (const node of uniqueIn(
      root,
      `${signature.tagName}[name="${escapeCssIdentifier(signature.nameAttr)}"]`,
    )) {
      found.add(node);
    }
  }
  return [...found];
}

function gatherByStructure(root: ParentNode, signature: ElementSignature): HTMLElement[] {
  const found = new Set<HTMLElement>();
  let selector = signature.tagName;
  if (signature.classList.length > 0) {
    selector += signature.classList
      .slice(0, 3)
      .map((className) => `.${escapeCssIdentifier(className)}`)
      .join("");
  }
  for (const node of uniqueIn(root, selector)) {
    found.add(node);
  }
  if (signature.parentCssPath) {
    for (const parent of queryCssPath(root, signature.parentCssPath)) {
      for (const child of Array.from(parent.querySelectorAll(signature.tagName))) {
        if (child instanceof HTMLElement) {
          found.add(child);
        }
      }
    }
  }
  return [...found];
}

interface CandidateScore {
  element: HTMLElement;
  contradicted: boolean;
  matchedKeys: string[];
  strongUnique: boolean;
  distinctiveContent: boolean;
  cssPathMatched: boolean;
  shifted: boolean;
  consistent: boolean;
}

function textOf(element: HTMLElement): string {
  const aria = element.getAttribute("aria-label");
  if (aria) {
    return normalize(aria);
  }
  if (element instanceof HTMLInputElement && element.labels && element.labels.length > 0) {
    return normalize(
      Array.from(element.labels)
        .map((label) => label.textContent)
        .join(" "),
    );
  }
  return normalize(element.textContent);
}

/**
 * Stable identifying content vs volatile presentation (counts, timestamps, badges).
 * Positional locators must not override this.
 */
export function identifyingContent(value: string | undefined): string {
  return normalize(value)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evaluateCandidate(
  element: HTMLElement,
  signature: ElementSignature,
  pathMatches: Set<HTMLElement>,
  pool: HTMLElement[],
): CandidateScore {
  const matchedKeys: string[] = [];
  let contradicted = false;
  if (element.tagName.toLowerCase() !== signature.tagName.toLowerCase()) {
    contradicted = true;
  }
  if (signature.idAttr && !isGeneratedIdentityValue(signature.idAttr)) {
    if (element.id === signature.idAttr) {
      matchedKeys.push("id");
    } else if (element.id && !isGeneratedIdentityValue(element.id)) {
      contradicted = true;
    }
  }
  for (const [key, value] of parseDatasetFingerprint(signature.datasetFingerprint)) {
    if (isGeneratedIdentityValue(value)) {
      continue;
    }
    const actual = element.dataset[key];
    if (actual === value) {
      matchedKeys.push(`data:${key}`);
    } else if (actual && !isGeneratedIdentityValue(actual)) {
      contradicted = true;
    }
  }
  if (signature.hrefAttr) {
    const href = descendantHref(element);
    if (href === signature.hrefAttr) {
      matchedKeys.push("href");
    } else if (href) {
      contradicted = true;
    }
  }
  if (signature.srcFingerprint) {
    const src = descendantSrc(element);
    if (src && (src === signature.srcFingerprint || src.includes(signature.srcFingerprint))) {
      matchedKeys.push("src");
    } else if (src) {
      contradicted = true;
    }
  }
  if (signature.nameAttr) {
    const name = element.getAttribute("name");
    if (name === signature.nameAttr) {
      matchedKeys.push("name");
    } else if (name) {
      contradicted = true;
    }
  }
  if (signature.ariaLabel) {
    const aria = element.getAttribute("aria-label")?.trim();
    if (aria === signature.ariaLabel) {
      matchedKeys.push("aria");
    } else if (aria) {
      contradicted = true;
    }
  }

  const expectedIdent =
    identifyingContent(signature.ariaLabel) || identifyingContent(signature.textFingerprint);
  const actualIdent = identifyingContent(textOf(element));
  const contentMatches = Boolean(expectedIdent) && expectedIdent === actualIdent;
  if (contentMatches) {
    matchedKeys.push("text");
  }
  const hasSemantic = matchedKeys.some(
    (key) => key === "id" || key.startsWith("data:") || key === "href" || key === "src" || key === "name" || key === "aria",
  );
  if (expectedIdent && actualIdent && expectedIdent !== actualIdent && !hasSemantic) {
    contradicted = true;
  }

  if (signature.parentFingerprint) {
    const parent = element.parentElement;
    const parentPrint = parent
      ? `${parent.tagName.toLowerCase()}${parent.id ? `#${parent.id}` : ""}${
          parent.classList.length > 0 ? `.${Array.from(parent.classList).slice(0, 3).join(".")}` : ""
        }`
      : "";
    if (parentPrint === signature.parentFingerprint) {
      matchedKeys.push("parent");
    }
  }

  const cssPathMatched = pathMatches.has(element);
  const shifted = structureShifted(element, signature);
  const strongKey = matchedKeys.some(
    (key) => key === "id" || key.startsWith("data:") || key === "href" || key === "src" || key === "name" || key === "aria",
  );
  const sameStrong = (key: string, candidate: HTMLElement): boolean => {
    if (key === "id") {
      return candidate.id === signature.idAttr;
    }
    if (key.startsWith("data:")) {
      const dataKey = key.slice(5);
      return candidate.dataset[dataKey] === parseDatasetFingerprint(signature.datasetFingerprint).find(([entry]) => entry === dataKey)?.[1];
    }
    if (key === "href") {
      return descendantHref(candidate) === signature.hrefAttr;
    }
    if (key === "src") {
      return descendantSrc(candidate) === signature.srcFingerprint;
    }
    if (key === "name") {
      return candidate.getAttribute("name") === signature.nameAttr;
    }
    if (key === "aria") {
      return candidate.getAttribute("aria-label")?.trim() === signature.ariaLabel;
    }
    return false;
  };
  const strongUnique =
    strongKey &&
    matchedKeys.some((key) => {
      if (key === "text" || key === "parent") {
        return false;
      }
      return pool.filter((candidate) => sameStrong(key, candidate)).length === 1;
    });
  const distinctiveContent =
    contentMatches &&
    Boolean(expectedIdent) &&
    pool.filter((candidate) => identifyingContent(textOf(candidate)) === expectedIdent).length === 1;

  return {
    element,
    contradicted,
    matchedKeys,
    strongUnique,
    distinctiveContent,
    cssPathMatched,
    shifted,
    consistent: !contradicted,
  };
}

function resultFor(
  identity: DurableVisualIdentity,
  kind: VisualResolveResult["kind"],
  details: {
    element?: HTMLElement;
    evidence: IdentityEvidence;
    candidateCount?: number;
  },
): VisualResolveResult {
  if (kind === "resolved" && details.element) {
    return {
      kind,
      nodeId: null,
      element: details.element,
      identity,
      evidence: details.evidence,
    };
  }
  if (kind === "ambiguous") {
    return {
      kind,
      nodeId: null,
      identity,
      candidateCount: details.candidateCount ?? details.evidence.candidateCount,
      evidence: details.evidence,
    };
  }
  return {
    kind: "unresolved",
    nodeId: null,
    identity,
    evidence: details.evidence,
  };
}

export function resolveDurableIdentity(
  root: ParentNode,
  identity: DurableVisualIdentity,
): VisualResolveResult {
  const signature = identity.signature;
  const pathMatches = queryCssPath(root, signature.cssPath);
  const pathSet = new Set(pathMatches);
  const pool = [
    ...pathMatches,
    ...gatherByStableKeys(root, signature),
    ...gatherByStructure(root, signature),
  ].filter((element, index, all) => all.indexOf(element) === index && element.isConnected);

  const scored = pool.map((element) => evaluateCandidate(element, signature, pathSet, pool));
  const viable = scored.filter((entry) => entry.consistent);

  const strong = viable.filter((entry) => entry.strongUnique);
  if (strong.length === 1 && strong[0]) {
    return resultFor(identity, "resolved", {
      element: strong[0].element,
      evidence: evidence({
        strategy: "stable-key",
        cssPathMatched: strong[0].cssPathMatched,
        structureShifted: strong[0].shifted,
        matchedKeys: strong[0].matchedKeys,
        candidateCount: pool.length,
      }),
    });
  }
  if (strong.length > 1) {
    return resultFor(identity, "ambiguous", {
      candidateCount: strong.length,
      evidence: evidence({
        strategy: "ambiguous",
        cssPathMatched: strong.some((entry) => entry.cssPathMatched),
        structureShifted: strong.some((entry) => entry.shifted),
        matchedKeys: strong[0]?.matchedKeys ?? [],
        candidateCount: strong.length,
        reason: "multiple_stable_keys",
      }),
    });
  }

  const distinctive = viable.filter((entry) => entry.distinctiveContent);
  if (distinctive.length === 1 && distinctive[0]) {
    return resultFor(identity, "resolved", {
      element: distinctive[0].element,
      evidence: evidence({
        strategy: "distinctive-content",
        cssPathMatched: distinctive[0].cssPathMatched,
        structureShifted: distinctive[0].shifted,
        matchedKeys: distinctive[0].matchedKeys,
        candidateCount: pool.length,
      }),
    });
  }
  if (distinctive.length > 1) {
    return resultFor(identity, "ambiguous", {
      candidateCount: distinctive.length,
      evidence: evidence({
        strategy: "ambiguous",
        cssPathMatched: distinctive.some((entry) => entry.cssPathMatched),
        structureShifted: true,
        matchedKeys: distinctive[0]?.matchedKeys ?? [],
        candidateCount: distinctive.length,
        reason: "multiple_content_matches",
      }),
    });
  }

  const stablePath = viable.filter((entry) => entry.cssPathMatched && !entry.shifted);
  if (stablePath.length === 1 && stablePath[0]) {
    return resultFor(identity, "resolved", {
      element: stablePath[0].element,
      evidence: evidence({
        strategy: "stable-path",
        cssPathMatched: true,
        structureShifted: false,
        matchedKeys: stablePath[0].matchedKeys,
        candidateCount: pathMatches.length,
      }),
    });
  }

  if (pathMatches.length === 1 && pathMatches[0]) {
    const only = scored.find((entry) => entry.element === pathMatches[0]);
    if (only && !only.consistent) {
      return resultFor(identity, "unresolved", {
        evidence: evidence({
          strategy: "unresolved",
          cssPathMatched: true,
          structureShifted: only.shifted,
          matchedKeys: only.matchedKeys,
          candidateCount: pool.length,
          reason: "cssPath_identity_mismatch",
        }),
      });
    }
  }

  if (viable.length === 0) {
    return resultFor(identity, "unresolved", {
      evidence: evidence({
        strategy: "unresolved",
        cssPathMatched: pathMatches.length === 1,
        structureShifted: pathMatches[0] ? structureShifted(pathMatches[0], signature) : true,
        matchedKeys: [],
        candidateCount: pool.length,
        reason: pathMatches.length === 0 ? "cssPath_no_match" : "insufficient_identity_evidence",
      }),
    });
  }

  if (viable.length > 1) {
    return resultFor(identity, "ambiguous", {
      candidateCount: viable.length,
      evidence: evidence({
        strategy: "ambiguous",
        cssPathMatched: viable.some((entry) => entry.cssPathMatched),
        structureShifted: viable.some((entry) => entry.shifted),
        matchedKeys: viable[0]?.matchedKeys ?? [],
        candidateCount: viable.length,
        reason: "cssPath_not_unique",
      }),
    });
  }

  const only = viable[0];
  if (!only || only.shifted) {
    return resultFor(identity, "unresolved", {
      evidence: evidence({
        strategy: "unresolved",
        cssPathMatched: only?.cssPathMatched ?? false,
        structureShifted: true,
        matchedKeys: only?.matchedKeys ?? [],
        candidateCount: pool.length,
        reason: "insufficient_identity_evidence",
      }),
    });
  }

  return resultFor(identity, "resolved", {
    element: only.element,
    evidence: evidence({
      strategy: "stable-path",
      cssPathMatched: only.cssPathMatched,
      structureShifted: false,
      matchedKeys: only.matchedKeys,
      candidateCount: pool.length,
    }),
  });
}

export function identityConsistent(element: HTMLElement, identity: DurableVisualIdentity): boolean {
  const scored = evaluateCandidate(element, identity.signature, new Set([element]), [element]);
  return scored.consistent;
}

export function summarizeIdentity(identity: DurableVisualIdentity): string {
  const signature = identity.signature;
  const parts = [signature.tagName];
  if (signature.idAttr) {
    parts.push(`#${signature.idAttr}`);
  }
  if (signature.datasetFingerprint) {
    parts.push(`[${signature.datasetFingerprint}]`);
  }
  if (signature.textFingerprint) {
    parts.push(`text:${signature.textFingerprint.slice(0, 24)}`);
  }
  return parts.join("");
}
