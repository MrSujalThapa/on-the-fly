import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";
import {
  formatAllowedHelperRoles,
  GRADIENT_PANEL_HELPER_ROLE,
  HELPER_OBJECT_ROLES,
} from "../../src/editor/helper-object-contract.js";

export function buildOpenAiSystemPrompt(): string {
  const roleList = formatAllowedHelperRoles();
  return [
    "You are the local On the Fly design agent for higher-level visual composition only.",
    "You must output structured draft editor operations — never raw HTML, CSS, JavaScript, or duplicate operations.",
    "",
    "Use the agent for coordinated visual improvements such as:",
    "- Adding soft background panels or decorative containers behind selected elements.",
    "- Improving spacing, hierarchy, and premium feel through multiple safe operations.",
    "- Creating subtle helper objects (insertHelperObject) with structured fills, borders, radius, and shadows.",
    "",
    "Do NOT use the agent for simple one-step toolbar edits. If the user asks for basic color, font size, move, resize, or layer tweaks,",
    "return zero operations and explain in summary/warnings that they should use the manual toolbar instead.",
    "",
    "Allowed operation types: style, move, resize, rotate, zIndex, hide, insertHelperObject.",
    "Never emit duplicate, text changes, insertImage, group, ungroup, crop, or arbitrary code.",
    "",
    "insertHelperObject contract:",
    `- payload.role must be one of: ${roleList}. Use "${GRADIENT_PANEL_HELPER_ROLE}" for gradient/background panels behind a selection.`,
    "- payload.helperId is required (for example helper-panel-1). target.nodeId must equal payload.helperId.",
    "- target.signature must use cssPath #otf-helper-<helperId>, tagName div, classList [\"otf-helper-object\"].",
    "- payload.rect must cover the selected bounds (slightly padded). payload.fill is required (solid or linearGradient).",
    "- When selection.activeGroupId is present, set target.groupId to that group id and size payload.rect to the full group bounds.",
    "- Use only target ids listed in allowedTargetIds from the user context. Never invent ids outside that list for scoped style/move ops.",
    "",
    "Rules:",
    "- Build changes only from the provided selected-area context.",
    "- Do not target the whole page (no html/body selectors).",
    "- Do not invent targets outside selected nodes or nearby context.",
    "- Prefer insertHelperObject for background panels and decorative containers.",
    "- Style changes must use safe contract properties only (color, backgroundColor, borderRadius, opacity, boxShadow, filter).",
    "- All operations must have source: agent and status: preview or draft.",
    "- Keep operation count small (usually 1-4).",
    "- Include a concise summary and any warnings.",
  ].join("\n");
}

export function buildOpenAiUserPrompt(request: AgentEditRequest): string {
  const selectedSummary = request.selectedNodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    rect: node.rect,
    cssPath: node.signature.cssPath,
    tagName: node.signature.tagName,
    classList: node.signature.classList,
    computed: node.computed,
  }));

  const nearbySummary = request.nearbyNodes.slice(0, 8).map((node) => ({
    id: node.id,
    kind: node.kind,
    rect: node.rect,
    cssPath: node.signature.cssPath,
    tagName: node.signature.tagName,
  }));

  const allowedTargetIds = resolveAllowedTargetIds(request);

  return JSON.stringify(
    {
      instruction: request.instruction,
      pageKey: request.pageKey,
      selection: request.selection,
      selectedNodes: selectedSummary,
      nearbyNodes: nearbySummary,
      existingOperationsCount: request.existingOperations.length,
      allowedTargetIds,
      guidance: {
        preferHelperObjectsForBackgrounds: true,
        maxOperations: 8,
        redirectSimpleEditsToToolbar: true,
        helperObjectRoles: [...HELPER_OBJECT_ROLES],
        gradientPanelRole: GRADIENT_PANEL_HELPER_ROLE,
        helperObjectTarget: {
          nodeIdMustMatchHelperId: true,
          signatureCssPathPattern: "#otf-helper-<helperId>",
          useActiveGroupIdWhenPresent: true,
          allowedSelectedNodeIds: allowedTargetIds.selectedNodeIds,
          activeGroupId: allowedTargetIds.activeGroupId ?? null,
        },
      },
    },
    null,
    2,
  );
}

export function resolveAllowedTargetIds(request: AgentEditRequest): {
  selectedNodeIds: string[];
  activeGroupId?: string;
  nearbyNodeIds: string[];
} {
  return {
    selectedNodeIds: [...request.selection.selectedNodeIds],
    ...(request.selection.activeGroupId ? { activeGroupId: request.selection.activeGroupId } : {}),
    nearbyNodeIds: request.nearbyNodes.map((node) => node.id),
  };
}
