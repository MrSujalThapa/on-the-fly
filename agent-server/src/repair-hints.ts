import { DESIGN_ACTION_KINDS } from "../../src/shared/agent-design-plan.js";

export function enrichRepairErrors(errors: string[]): string[] {
  const enriched: string[] = [];

  for (const error of errors) {
    enriched.push(error);

    if (error.includes("draftOperations are not accepted")) {
      enriched.push(
        "Return designPlan.actions with semantic design actions only — never raw editor operations.",
      );
      enriched.push(`Allowed action kinds: ${DESIGN_ACTION_KINDS.join(", ")}.`);
      continue;
    }

    if (error.includes("designPlan.actions") || error.includes("designPlan must")) {
      enriched.push(
        "Each action needs kind from the allowed list. params may include placement, intensity, mood, fill, shadow, radius, spacing.",
      );
      enriched.push("Do not include target ids, rects, cssPath, helperId, or operation types.");
      continue;
    }

    if (error.includes("design plan cannot compile") || error.includes("design plan produced no operations")) {
      enriched.push("Include at least one supported design action that matches the user instruction.");
    }
  }

  return enriched;
}

export function isCloseEnoughToRepair(message: string): boolean {
  const repairablePatterns = [
    "draftOperations are not accepted",
    "designPlan is required",
    "designPlan.actions",
    "designPlan must",
    "design plan cannot compile",
    "design plan produced no operations",
    "model output was not valid JSON",
    "model output must be an object",
    "is not an allowed semantic param",
    ".kind must be one of",
  ];

  return repairablePatterns.some((pattern) => message.includes(pattern));
}
