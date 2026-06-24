import type { ElementSignature } from "../element-signature.js";
import type { EditorTarget } from "../editor-target.js";
import type { EditorOperation, ZIndexOperation } from "../operations.js";
import { operationTargetKey, stableSignatureTargetKey } from "./operation-target-key.js";

function leafCssSegment(cssPath: string): string {
  const parts = cssPath.split(" > ");
  return parts[parts.length - 1] ?? cssPath;
}

/** Content identity shared by signatures for the same element across reparent. */
export function contentIdentityTargetKey(signature: ElementSignature | undefined): string | null {
  if (!signature) {
    return null;
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
  return `content:${parts.join("|")}`;
}

export function zIndexOperationsShareTarget(
  left: ZIndexOperation,
  right: ZIndexOperation,
): boolean {
  const leftKey = operationTargetKey(left);
  const rightKey = operationTargetKey(right);
  if (leftKey && rightKey && leftKey === rightKey) {
    return true;
  }

  const leftSig = left.target.signature;
  const rightSig = right.target.signature;
  if (leftSig?.idAttr && leftSig.idAttr === rightSig?.idAttr) {
    return true;
  }

  const leftNodeId = left.target.nodeId;
  const rightNodeId = right.target.nodeId;
  if (leftNodeId && rightNodeId && leftNodeId === rightNodeId) {
    return true;
  }

  const leftContent = contentIdentityTargetKey(leftSig);
  const rightContent = contentIdentityTargetKey(rightSig);
  return Boolean(leftContent && rightContent && leftContent === rightContent);
}

export function editorTargetsShareIdentity(
  left: EditorTarget | undefined,
  right: EditorTarget | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  if (left.nodeId && right.nodeId && left.nodeId === right.nodeId) {
    return true;
  }

  const leftSig = left.signature;
  const rightSig = right.signature;
  if (leftSig?.idAttr && leftSig.idAttr === rightSig?.idAttr) {
    return true;
  }

  const leftStable = stableSignatureTargetKey(leftSig);
  const rightStable = stableSignatureTargetKey(rightSig);
  if (leftStable && rightStable && leftStable === rightStable) {
    return true;
  }

  const leftContent = contentIdentityTargetKey(leftSig);
  const rightContent = contentIdentityTargetKey(rightSig);
  return Boolean(leftContent && rightContent && leftContent === rightContent);
}

export function filterSupersededZIndexOperations(
  operations: EditorOperation[],
  incomingZIndexOperations: readonly ZIndexOperation[],
): EditorOperation[] {
  if (incomingZIndexOperations.length === 0) {
    return operations;
  }

  return operations.filter((operation) => {
    if (operation.type !== "zIndex") {
      return true;
    }

    return !incomingZIndexOperations.some((incoming) =>
      zIndexOperationsShareTarget(operation, incoming),
    );
  });
}

export function keepLatestZIndexOperationsByTarget(
  operations: EditorOperation[],
): EditorOperation[] {
  const lastIndexByGroup: number[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation?.type !== "zIndex") {
      continue;
    }

    let groupIndex = -1;
    for (let group = 0; group < lastIndexByGroup.length; group += 1) {
      const representativeIndex = lastIndexByGroup[group];
      if (representativeIndex === undefined) {
        continue;
      }
      const representative = operations[representativeIndex];
      if (
        representative?.type === "zIndex" &&
        zIndexOperationsShareTarget(representative, operation)
      ) {
        groupIndex = group;
        break;
      }
    }

    if (groupIndex === -1) {
      lastIndexByGroup.push(index);
    } else {
      lastIndexByGroup[groupIndex] = index;
    }
  }

  const keepIndices = new Set(lastIndexByGroup);
  return operations.filter((operation, index) => {
    if (operation.type !== "zIndex") {
      return true;
    }
    return keepIndices.has(index);
  });
}
