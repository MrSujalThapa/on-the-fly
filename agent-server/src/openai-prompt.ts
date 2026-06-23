import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";
import { DESIGN_ACTION_KINDS } from "../../src/shared/agent-design-plan.js";
import { buildCompactDesignContext } from "./design-context-summary.js";

const SYSTEM_PROMPT = [
  "On the Fly local design agent. Output AgentDesignPlan JSON only — never editor operations, HTML, CSS, selectors, ids, or coordinates.",
  `Actions: ${DESIGN_ACTION_KINDS.join(", ")}.`,
  "Params (optional): placement, intensity, mood, fill, shadow, radius, spacing.",
  "Pick 1-3 semantic actions. Compiler handles targets, bounds, layers, and styles.",
  "Redirect simple toolbar edits via warnings, not raw style ops.",
].join(" ");

export function buildOpenAiSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildOpenAiUserPrompt(request: AgentEditRequest): string {
  return JSON.stringify(buildCompactDesignContext(request));
}
