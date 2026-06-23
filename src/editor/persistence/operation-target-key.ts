import type { ElementSignature } from "../element-signature.js";
import type { EditorTarget } from "../editor-target.js";
import type { EditorOperation } from "../operations.js";

const HELPER_ID_ATTR_PREFIX = "otf-helper-";

function extractHelperIdFromSignature(signature: ElementSignature | undefined): string | null {
  if (!signature) {
    return null;
  }

  if (signature.idAttr?.startsWith(HELPER_ID_ATTR_PREFIX)) {
    return signature.idAttr.slice(HELPER_ID_ATTR_PREFIX.length);
  }

  if (signature.classList.includes("otf-helper-object")) {
    const fromCssPath = /otf-helper-([a-zA-Z0-9_-]+)/.exec(signature.cssPath);
    if (fromCssPath?.[1]) {
      return fromCssPath[1];
    }
  }

  return null;
}

function leafCssSegment(cssPath: string): string {
  const parts = cssPath.split(" > ");
  return parts[parts.length - 1] ?? cssPath;
}

/**
 * Builds a target identity that stays stable when an element is reparented
 * (for example after a managed detach). Full cssPath keys break z-index
 * coalesce/replay because the path changes while the element is the same.
 */
export function stableSignatureTargetKey(signature: ElementSignature | undefined): string | null {
  if (!signature) {
    return null;
  }

  const helperId = extractHelperIdFromSignature(signature);
  if (helperId) {
    return `helper:${helperId}`;
  }

  if (signature.idAttr) {
    return `id:${signature.idAttr}`;
  }

  const parts = [
    signature.tagName,
    leafCssSegment(signature.cssPath),
    [...signature.classList].sort().join("."),
    signature.textFingerprint ?? "",
    signature.srcFingerprint ?? "",
    signature.role ?? "",
    signature.ariaLabel ?? "",
  ];
  return `el:${parts.join("|")}`;
}

export function stableTargetKeyFromEditorTarget(target: EditorTarget | undefined): string | null {
  if (!target) {
    return null;
  }

  const fromSignature = stableSignatureTargetKey(target.signature);
  if (fromSignature) {
    return fromSignature;
  }

  if (target.nodeId) {
    return `node:${target.nodeId}`;
  }

  return null;
}

/** Stable key for matching operations that affect the same DOM target. */
export function operationTargetKey(operation: EditorOperation): string | null {
  if (operation.type === "insertHelperObject") {
    return `helper:${operation.payload.helperId}`;
  }

  if (operation.type === "duplicate") {
    return `clone:${operation.payload.cloneId}`;
  }

  const signature = operation.target.signature;
  const helperId = extractHelperIdFromSignature(signature);
  if (helperId) {
    return `helper:${helperId}`;
  }

  if (signature?.idAttr) {
    return `id:${signature.idAttr}`;
  }

  if (operation.target.nodeId) {
    return `node:${operation.target.nodeId}`;
  }

  return stableSignatureTargetKey(signature);
}
