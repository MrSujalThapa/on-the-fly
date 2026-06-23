import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";

export type AgentEditRequestValidationResult =
  | { ok: true; request: AgentEditRequest }
  | { ok: false; errors: string[] };

export function validateAgentEditRequestShape(value: unknown): AgentEditRequestValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["request body must be an object"] };
  }

  if (!isNonEmptyString(value.pageKey)) {
    errors.push("pageKey is required");
  }
  if (!isNonEmptyString(value.instruction)) {
    errors.push("instruction is required");
  }
  if (!isRecord(value.selection) || !Array.isArray(value.selection.selectedNodeIds)) {
    errors.push("selection.selectedNodeIds is required");
  }
  if (!Array.isArray(value.selectedNodes)) {
    errors.push("selectedNodes must be an array");
  }
  if (!Array.isArray(value.nearbyNodes)) {
    errors.push("nearbyNodes must be an array");
  }
  if (!Array.isArray(value.existingOperations)) {
    errors.push("existingOperations must be an array");
  }
  if (
    value.screenshotCropDataUrl !== undefined &&
    typeof value.screenshotCropDataUrl !== "string"
  ) {
    errors.push("screenshotCropDataUrl must be a string when provided");
  }

  return errors.length === 0
    ? { ok: true, request: value as unknown as AgentEditRequest }
    : { ok: false, errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
