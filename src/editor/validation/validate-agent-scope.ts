import type { EditorOperation } from "../operations.js";
import { isDangerousCssPath, isDangerousTagName } from "./dangerous-selectors.js";

export interface AgentScopeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentScopeContext {
  selectedNodeIds: ReadonlySet<string>;
  nearbyNodeIds: ReadonlySet<string>;
  selectionBounds: AgentScopeRect;
  pageLevelNodeIds?: ReadonlySet<string>;
}

export const AGENT_SCOPE_LIMITS = {
  helperPaddingPx: 120,
  maxHelperDistancePx: 320,
  maxHelperObjects: 4,
  maxZIndex: 9999,
} as const;

const SCOPED_OPERATION_TYPES = new Set([
  "style",
  "text",
  "move",
  "resize",
  "rotate",
  "crop",
  "hide",
  "zIndex",
  "group",
  "ungroup",
]);

export function buildAgentScopeContext(input: {
  selectedNodeIds: readonly string[];
  nearbyNodeIds: readonly string[];
  selectionBounds: AgentScopeRect;
  pageLevelNodeIds?: readonly string[];
}): AgentScopeContext {
  return {
    selectedNodeIds: new Set(input.selectedNodeIds),
    nearbyNodeIds: new Set(input.nearbyNodeIds),
    selectionBounds: input.selectionBounds,
    ...(input.pageLevelNodeIds
      ? { pageLevelNodeIds: new Set(input.pageLevelNodeIds) }
      : {}),
  };
}

export function validateAgentOperationsScope(
  operations: EditorOperation[],
  scope: AgentScopeContext,
): string[] {
  const errors: string[] = [];
  const allowedTargets = unionSets(scope.selectedNodeIds, scope.nearbyNodeIds);
  let helperCount = 0;

  for (const [index, operation] of operations.entries()) {
    const prefix = `operations[${String(index)}]`;

    if (operation.type === "insertHelperObject") {
      helperCount += 1;
      if (helperCount > AGENT_SCOPE_LIMITS.maxHelperObjects) {
        errors.push(`${prefix} exceeds max helper objects (${String(AGENT_SCOPE_LIMITS.maxHelperObjects)})`);
      }

      const helperErrors = validateHelperObjectScope(operation, scope, prefix);
      errors.push(...helperErrors);
      continue;
    }

    if (SCOPED_OPERATION_TYPES.has(operation.type)) {
      errors.push(...validateScopedTargetOperation(operation, scope, allowedTargets, prefix));
    }
  }

  return errors;
}

function validateScopedTargetOperation(
  operation: EditorOperation,
  scope: AgentScopeContext,
  allowedTargets: ReadonlySet<string>,
  prefix: string,
): string[] {
  const errors: string[] = [];
  const nodeId = operation.target.nodeId;

  if (typeof nodeId !== "string" || nodeId.trim().length === 0) {
    errors.push(`${prefix} must target a scoped visual node id`);
    return errors;
  }

  if (!allowedTargets.has(nodeId)) {
    errors.push(`${prefix} targets node "${nodeId}" outside selected/nearby scope`);
  }

  if (scope.pageLevelNodeIds?.has(nodeId) && !scope.selectedNodeIds.has(nodeId)) {
    errors.push(`${prefix} targets page-level container "${nodeId}" without explicit selection`);
  }

  const signature = operation.target.signature;
  if (signature) {
    if (isDangerousCssPath(signature.cssPath) || isDangerousTagName(signature.tagName)) {
      errors.push(`${prefix} targets unsafe page-level selector: ${signature.cssPath}`);
    }
  }

  return errors;
}

function validateHelperObjectScope(
  operation: Extract<EditorOperation, { type: "insertHelperObject" }>,
  scope: AgentScopeContext,
  prefix: string,
): string[] {
  const errors: string[] = [];
  const { rect, zIndex } = operation.payload;

  if (rect.width <= 0 || rect.height <= 0) {
    errors.push(`${prefix} helper rect has zero or negative dimensions`);
  }

  const expanded = expandRect(scope.selectionBounds, AGENT_SCOPE_LIMITS.helperPaddingPx);
  if (!rectIntersects(rect, expanded)) {
    errors.push(`${prefix} helper object is too far from selected bounds`);
  }

  const distance = rectDistanceToBounds(rect, scope.selectionBounds);
  if (distance > AGENT_SCOPE_LIMITS.maxHelperDistancePx) {
    errors.push(
      `${prefix} helper object center is ${String(Math.round(distance))}px from selected bounds (max ${String(AGENT_SCOPE_LIMITS.maxHelperDistancePx)}px)`,
    );
  }

  if (typeof zIndex === "number" && zIndex > AGENT_SCOPE_LIMITS.maxZIndex) {
    errors.push(`${prefix} helper z-index exceeds safe limit (${String(AGENT_SCOPE_LIMITS.maxZIndex)})`);
  }

  return errors;
}

function expandRect(rect: AgentScopeRect, padding: number): AgentScopeRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function rectIntersects(a: AgentScopeRect, b: AgentScopeRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectDistanceToBounds(rect: AgentScopeRect, bounds: AgentScopeRect): number {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const clampedX = clamp(centerX, bounds.x, bounds.x + bounds.width);
  const clampedY = clamp(centerY, bounds.y, bounds.y + bounds.height);
  return Math.hypot(centerX - clampedX, centerY - clampedY);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function unionSets(...sets: ReadonlySet<string>[]): ReadonlySet<string> {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
}
