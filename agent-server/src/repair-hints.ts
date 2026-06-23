import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";
import { formatAllowedHelperRoles } from "../../src/editor/helper-object-contract.js";
import { resolveAllowedTargetIds } from "./openai-prompt.js";

export function enrichRepairErrors(errors: string[], request: AgentEditRequest): string[] {
  const allowed = resolveAllowedTargetIds(request);
  const enriched: string[] = [];

  for (const error of errors) {
    enriched.push(error);

    if (error.includes("insertHelperObject.role is invalid")) {
      enriched.push(`Use insertHelperObject.role exactly one of: ${formatAllowedHelperRoles()}.`);
      const gotMatch = /got "([^"]+)"/u.exec(error);
      if (gotMatch?.[1]) {
        enriched.push(`Replace invalid role "${gotMatch[1]}" with a value from the allowed list.`);
      }
      continue;
    }

    if (
      error.includes("operation.target is missing or invalid") ||
      error.includes("must target a scoped visual node id") ||
      error.includes("cannot resolve helper object target")
    ) {
      enriched.push(
        `Valid selected target ids: ${allowed.selectedNodeIds.join(", ") || "(none)"}.`,
      );
      if (allowed.activeGroupId) {
        enriched.push(`When a group is selected, set target.groupId to "${allowed.activeGroupId}".`);
      }
      enriched.push(
        "For insertHelperObject, target.nodeId must equal payload.helperId and include signature cssPath #otf-helper-<helperId>.",
      );
    }
  }

  return enriched;
}

export function isCloseEnoughToRepair(message: string): boolean {
  const repairablePatterns = [
    "insertHelperObject.role is invalid",
    "operation.target is missing or invalid",
    "cannot resolve helper object target",
    "must target a scoped visual node id",
    "insertHelperObject.helperId is invalid",
    "insertHelperObject.fill",
    "insertHelperObject.rect",
    "helper rect has zero or negative dimensions",
    "draftOperations must be an array",
    "model output was not valid JSON",
    "model output must be an object",
  ];

  return repairablePatterns.some((pattern) => message.includes(pattern));
}
