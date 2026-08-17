import type { ElementSignature } from "../element-signature.js";
import type { EditorTarget } from "../editor-target.js";
import { stableSignatureTargetKey } from "../persistence/operation-target-key.js";
import { OTF_CLONE_ATTR } from "../duplicate/duplicate-element.js";
import { OTF_HELPER_ATTR } from "./types.js";
import {
  matchElementBySignatureDetailed,
  summarizeElementSignature,
  type SignatureMatchDiagnostics,
  type SignatureMatchResult,
} from "./signature-matcher.js";

export type ElementResolveStrategy =
  | SignatureMatchDiagnostics["matchStrategy"]
  | "cache"
  | "clone-id"
  | "helper-id"
  | "verified-live";

export interface ElementResolveDiagnostics extends Omit<SignatureMatchDiagnostics, "matchStrategy"> {
  matchStrategy: ElementResolveStrategy;
  signatureSummary: string;
  signatureKey: string | null;
  ambiguous: boolean;
  cacheHit: boolean;
}

export interface ElementResolveResult {
  element: HTMLElement | null;
  diagnostics: ElementResolveDiagnostics;
}

export interface ElementResolveContext {
  /** Preferred live node from the active selection/gesture (must still verify). */
  preferredElement?: HTMLElement | null;
  cloneId?: string | null;
  helperId?: string | null;
  /**
   * When true, near-tied scored matches are rejected instead of silently
   * returning the lowest-score candidate.
   */
  rejectAmbiguous?: boolean;
}

function emptyDiagnostics(
  overrides: Partial<ElementResolveDiagnostics> = {},
): ElementResolveDiagnostics {
  return {
    resolved: false,
    matchStrategy: "unresolved",
    signatureSummary: "no-signature",
    signatureKey: null,
    ambiguous: false,
    cacheHit: false,
    ...overrides,
  };
}

function fromSignatureMatch(
  match: SignatureMatchResult,
  signature: ElementSignature | undefined,
  key: string | null,
): ElementResolveResult {
  return {
    element: match.element,
    diagnostics: {
      ...match.diagnostics,
      signatureSummary: summarizeElementSignature(signature),
      signatureKey: key,
      ambiguous: match.diagnostics.failureReason === "ambiguous_candidates",
      cacheHit: false,
    },
  };
}

/**
 * Single identity boundary: ElementSignature is durable identity; HTMLElement is
 * a cache of a successful resolution.
 */
export class ElementResolver {
  private readonly root: ParentNode;
  private readonly cache = new Map<string, HTMLElement>();

  constructor(root: ParentNode) {
    this.root = root;
  }

  signatureKey(signature: ElementSignature | undefined): string | null {
    return stableSignatureTargetKey(signature);
  }

  resolve(
    signature: ElementSignature | undefined,
    context: ElementResolveContext = {},
  ): HTMLElement | null {
    return this.resolveDetailed(signature, context).element;
  }

  resolveDetailed(
    signature: ElementSignature | undefined,
    context: ElementResolveContext = {},
  ): ElementResolveResult {
    if (!signature) {
      return {
        element: null,
        diagnostics: emptyDiagnostics({ failureReason: "missing_signature" }),
      };
    }

    const key = this.signatureKey(signature);
    const summary = summarizeElementSignature(signature);

    if (context.helperId) {
      const helper = this.lookupByAttribute(OTF_HELPER_ATTR, context.helperId);
      if (helper) {
        this.remember(key, helper);
        return {
          element: helper,
          diagnostics: emptyDiagnostics({
            resolved: true,
            matchStrategy: "helper-id",
            signatureSummary: summary,
            signatureKey: key,
            resolvedTag: helper.tagName.toLowerCase(),
            resolvedClasses: Array.from(helper.classList),
          }),
        };
      }
    }

    if (context.cloneId) {
      const clone = this.lookupByAttribute(OTF_CLONE_ATTR, context.cloneId);
      if (clone) {
        this.remember(key, clone);
        return {
          element: clone,
          diagnostics: emptyDiagnostics({
            resolved: true,
            matchStrategy: "clone-id",
            signatureSummary: summary,
            signatureKey: key,
            resolvedTag: clone.tagName.toLowerCase(),
            resolvedClasses: Array.from(clone.classList),
          }),
        };
      }
    }

    const preferred = context.preferredElement;
    if (preferred?.isConnected && this.isCompatibleBinding(signature, preferred)) {
      this.remember(key, preferred);
      return {
        element: preferred,
        diagnostics: emptyDiagnostics({
          resolved: true,
          matchStrategy: "verified-live",
          signatureSummary: summary,
          signatureKey: key,
          resolvedTag: preferred.tagName.toLowerCase(),
          resolvedClasses: Array.from(preferred.classList),
        }),
      };
    }

    if (key) {
      const cached = this.cache.get(key);
      if (cached?.isConnected && this.isCompatibleBinding(signature, cached)) {
        return {
          element: cached,
          diagnostics: emptyDiagnostics({
            resolved: true,
            matchStrategy: "cache",
            signatureSummary: summary,
            signatureKey: key,
            cacheHit: true,
            resolvedTag: cached.tagName.toLowerCase(),
            resolvedClasses: Array.from(cached.classList),
          }),
        };
      }
      if (cached && !cached.isConnected) {
        this.cache.delete(key);
      }
    }

    const match = matchElementBySignatureDetailed(this.root, signature);
    if (
      context.rejectAmbiguous !== false &&
      match.diagnostics.failureReason === "ambiguous_candidates"
    ) {
      return fromSignatureMatch(match, signature, key);
    }

    if (match.element && key) {
      this.remember(key, match.element);
    }

    return fromSignatureMatch(match, signature, key);
  }

  resolveTarget(
    target: EditorTarget,
    context: ElementResolveContext = {},
  ): ElementResolveResult {
    return this.resolveDetailed(target.signature, context);
  }

  /**
   * True when `element` is an acceptable live binding for `signature`.
   * Used to convert overrideElement from a bypass into a verification gate.
   */
  verify(signature: ElementSignature | undefined, element: HTMLElement): boolean {
    if (!signature || !element.isConnected) {
      return false;
    }

    if (!this.isCompatibleBinding(signature, element)) {
      return false;
    }

    const match = matchElementBySignatureDetailed(this.root, signature);
    if (match.element === element) {
      return true;
    }

    // Signature uniquely points elsewhere — reject.
    if (match.element && match.element !== element && match.diagnostics.candidateCount === 1) {
      return false;
    }

    if (signature.idAttr && element.id === signature.idAttr) {
      return true;
    }

    if (signature.textFingerprint) {
      const expected = normalize(signature.textFingerprint);
      const actual = normalize(element.textContent ?? "");
      if (expected && actual === expected) {
        return true;
      }
    }

    // Strengthened cssPaths include :nth-of-type; if the live node still matches
    // that path uniquely among connected peers, accept.
    try {
      const hits = Array.from(
        resolveDocument(this.root).querySelectorAll(signature.cssPath),
      ).filter((node) => node instanceof HTMLElement);
      if (hits.length === 1 && hits[0] === element) {
        return true;
      }
    } catch {
      // ignore invalid selectors
    }

    return false;
  }

  /** Soft binding check for in-session preferred live nodes. */
  isCompatibleBinding(signature: ElementSignature, element: HTMLElement): boolean {
    if (signature.tagName && element.tagName.toLowerCase() !== signature.tagName.toLowerCase()) {
      return false;
    }
    if (signature.idAttr && element.id && element.id !== signature.idAttr) {
      return false;
    }
    if (signature.classList.length > 0) {
      const overlap = signature.classList.filter((className) =>
        element.classList.contains(className),
      ).length;
      if (overlap === 0) {
        return false;
      }
    }
    return true;
  }

  remember(key: string | null, element: HTMLElement): void {
    if (!key || !element.isConnected) {
      return;
    }
    this.cache.set(key, element);
  }

  rebind(key: string | null, element: HTMLElement | null): HTMLElement | null {
    if (!key) {
      return null;
    }
    if (!element || !element.isConnected) {
      this.cache.delete(key);
      return null;
    }
    this.cache.set(key, element);
    return element;
  }

  invalidate(key?: string | null): void {
    if (key) {
      this.cache.delete(key);
      return;
    }
    this.cache.clear();
  }

  getCached(key: string | null): HTMLElement | null {
    if (!key) {
      return null;
    }
    const cached = this.cache.get(key) ?? null;
    if (cached && !cached.isConnected) {
      this.cache.delete(key);
      return null;
    }
    return cached;
  }

  private lookupByAttribute(attribute: string, value: string): HTMLElement | null {
    const document = resolveDocument(this.root);
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const match = document.querySelector(`[${attribute}="${escaped}"]`);
    return match instanceof HTMLElement ? match : null;
  }
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function resolveDocument(root: ParentNode): Document {
  if (root instanceof Document) {
    return root;
  }
  return root.ownerDocument ?? document;
}

const sharedResolvers = new WeakMap<ParentNode, ElementResolver>();

/** One resolver per document/root; safe for session-lifetime caching. */
export function getElementResolver(root: ParentNode): ElementResolver {
  const existing = sharedResolvers.get(root);
  if (existing) {
    return existing;
  }
  const created = new ElementResolver(root);
  sharedResolvers.set(root, created);
  return created;
}

export function resolveElementBySignature(
  root: ParentNode,
  signature: ElementSignature | undefined,
  context: ElementResolveContext = {},
): HTMLElement | null {
  return getElementResolver(root).resolve(signature, context);
}

export function resolveElementBySignatureDetailed(
  root: ParentNode,
  signature: ElementSignature | undefined,
  context: ElementResolveContext = {},
): ElementResolveResult {
  return getElementResolver(root).resolveDetailed(signature, context);
}
