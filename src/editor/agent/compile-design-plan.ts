import type { AgentEditRequest } from "../../shared/agent-contracts.js";
import type {
  AgentDesignPlan,
  DesignAction,
  DesignActionParams,
  DesignFill,
  DesignIntensity,
  DesignMood,
  DesignRadius,
  DesignShadow,
} from "../../shared/agent-design-plan.js";
import { DESIGN_PLAN_LIMITS } from "../../shared/agent-design-plan.js";
import { applyScopeLayeringToOperations } from "./helper-layering.js";
import { createEmptyBoundingBoxHint } from "../element-signature.js";
import type { EditorTarget } from "../editor-target.js";
import { GRADIENT_PANEL_HELPER_ROLE } from "../helper-object-contract.js";
import type {
  EditorOperation,
  HelperObjectBoxShadow,
  HelperObjectFill,
  InsertHelperObjectOperation,
  StyleOperation,
  ZIndexOperation,
} from "../operations.js";
import type { AgentScopeRect } from "../validation/validate-agent-scope.js";

const HELPER_PADDING_PX = 24;
const MIN_HELPER_SIZE_PX = 40;

export interface CompileDesignPlanResult {
  ok: true;
  operations: EditorOperation[];
}

export interface CompileDesignPlanFailure {
  ok: false;
  errors: string[];
}

export type CompileDesignPlanOutcome = CompileDesignPlanResult | CompileDesignPlanFailure;

export function compileDesignPlan(
  plan: AgentDesignPlan,
  request: AgentEditRequest,
): CompileDesignPlanOutcome {
  if (request.selectedNodes.length === 0) {
    return { ok: false, errors: ["design plan cannot compile without selected nodes"] };
  }

  if (plan.actions.length === 0) {
    return { ok: false, errors: ["design plan must include at least one action"] };
  }

  const operations: EditorOperation[] = [];
  const errors: string[] = [];
  const bounds = computeSelectionBounds(request.selectedNodes);
  const now = Date.now();

  plan.actions.forEach((action, actionIndex) => {
    const compiled = compileDesignAction(action, request, bounds, now, actionIndex);
    if (compiled.errors.length > 0) {
      errors.push(...compiled.errors);
      return;
    }
    operations.push(...compiled.operations);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (operations.length === 0) {
    return { ok: false, errors: ["design plan produced no operations"] };
  }

  if (operations.length > DESIGN_PLAN_LIMITS.maxCompiledOperations) {
    return {
      ok: false,
      errors: [
        `compiled operations exceed max (${String(DESIGN_PLAN_LIMITS.maxCompiledOperations)})`,
      ],
    };
  }

  const layered = applyScopeLayeringToOperations(operations, request, now);

  return { ok: true, operations: layered };
}

function compileDesignAction(
  action: DesignAction,
  request: AgentEditRequest,
  bounds: AgentScopeRect,
  now: number,
  actionIndex: number,
): { operations: EditorOperation[]; errors: string[] } {
  const params = action.params ?? {};
  const prefix = `actions[${String(actionIndex)}]`;

  switch (action.kind) {
    case "add_surface":
      return compileAddSurface(request, bounds, params, now, actionIndex, prefix);
    case "adjust_elevation":
      return compileAdjustElevation(request, params, now, actionIndex);
    case "adjust_spacing":
      return compileAdjustSpacing(request, params, now, actionIndex);
    case "adjust_color_treatment":
      return compileAdjustColorTreatment(request, params, now, actionIndex);
    case "improve_hierarchy":
      return compileImproveHierarchy(request, params, now, actionIndex);
    case "restyle_selection":
      return compileRestyleSelection(request, params, now, actionIndex);
    case "emphasize_section":
      return compileEmphasizeSection(request, bounds, params, now, actionIndex, prefix);
    default:
      return { operations: [], errors: [`${prefix}.kind is not supported`] };
  }
}

function compileAddSurface(
  request: AgentEditRequest,
  bounds: AgentScopeRect,
  params: DesignActionParams,
  now: number,
  actionIndex: number,
  prefix: string,
): { operations: EditorOperation[]; errors: string[] } {
  const helperId = createHelperId(request, actionIndex);
  const rect = buildHelperRect(bounds, params.placement ?? "behind");
  const fill = resolveFill(params.fill ?? "gradient", params.mood ?? "neutral", params.intensity ?? "subtle");
  const shadow = resolveBoxShadow(params.shadow ?? "soft", params.intensity ?? "subtle");
  const borderRadius = resolveBorderRadius(params.radius ?? "rounded");

  const operation: InsertHelperObjectOperation = {
    id: `agent-op-${helperId}`,
    type: "insertHelperObject",
    pageKey: request.pageKey,
    target: buildHelperObjectTarget(helperId, request),
    payload: {
      helperId,
      role: GRADIENT_PANEL_HELPER_ROLE,
      rect,
      fill,
      borderRadius,
      opacity: resolveOpacity(params.intensity ?? "subtle", params.fill === "glass" ? 0.82 : 0.96),
      ...(shadow ? { boxShadow: shadow } : {}),
      zIndex: params.placement === "overlay" ? 5 : 1,
      border: resolveBorder(params.mood ?? "neutral"),
      label: "Agent design surface",
    },
    createdAt: now,
    source: "agent",
    status: "preview",
  };

  if (rect.width <= 0 || rect.height <= 0) {
    return { operations: [], errors: [`${prefix} helper rect has zero dimensions`] };
  }

  return { operations: [operation], errors: [] };
}

function compileAdjustElevation(
  request: AgentEditRequest,
  params: DesignActionParams,
  now: number,
  actionIndex: number,
): { operations: EditorOperation[]; errors: string[] } {
  const shadow = resolveBoxShadow(params.shadow ?? "medium", params.intensity ?? "moderate");
  const operations: EditorOperation[] = [];

  for (const [nodeIndex, node] of request.selectedNodes.entries()) {
    if (shadow) {
      operations.push(
        createStyleOperation(request, node, now, actionIndex, nodeIndex, "boxShadow", formatBoxShadow(shadow)),
      );
    }
    operations.push(
      createZIndexOperation(request, node, now, actionIndex, nodeIndex, resolveZIndexBump(params.intensity ?? "moderate")),
    );
  }

  return { operations, errors: [] };
}

function compileAdjustSpacing(
  request: AgentEditRequest,
  params: DesignActionParams,
  now: number,
  actionIndex: number,
): { operations: EditorOperation[]; errors: string[] } {
  const radius = resolveBorderRadius(params.radius ?? "subtle");
  const operations: EditorOperation[] = [];

  for (const [nodeIndex, node] of request.selectedNodes.entries()) {
    operations.push(
      createStyleOperation(request, node, now, actionIndex, nodeIndex, "borderRadius", radius),
    );
    if (params.spacing === "relaxed" || params.spacing === "spacious") {
      operations.push(
        createStyleOperation(
          request,
          node,
          now,
          actionIndex,
          nodeIndex,
          "opacity",
          params.spacing === "spacious" ? "0.98" : "0.99",
        ),
      );
    }
  }

  return { operations, errors: [] };
}

function compileAdjustColorTreatment(
  request: AgentEditRequest,
  params: DesignActionParams,
  now: number,
  actionIndex: number,
): { operations: EditorOperation[]; errors: string[] } {
  const palette = resolveMoodPalette(params.mood ?? "neutral");
  const operations: EditorOperation[] = [];

  for (const [nodeIndex, node] of request.selectedNodes.entries()) {
    operations.push(
      createStyleOperation(
        request,
        node,
        now,
        actionIndex,
        nodeIndex,
        "backgroundColor",
        palette.background,
      ),
    );
    if (params.intensity !== "subtle") {
      operations.push(
        createStyleOperation(request, node, now, actionIndex, nodeIndex, "color", palette.foreground),
      );
    }
  }

  return { operations, errors: [] };
}

function compileImproveHierarchy(
  request: AgentEditRequest,
  params: DesignActionParams,
  now: number,
  actionIndex: number,
): { operations: EditorOperation[]; errors: string[] } {
  const operations: EditorOperation[] = [];
  const activeId = request.selection.activeNodeId ?? request.selection.selectedNodeIds[0];

  for (const [nodeIndex, node] of request.selectedNodes.entries()) {
    const isActive = node.id === activeId;
    operations.push(
      createStyleOperation(
        request,
        node,
        now,
        actionIndex,
        nodeIndex,
        "opacity",
        isActive ? "1" : resolveInactiveOpacity(params.intensity ?? "moderate"),
      ),
    );
    if (isActive) {
      operations.push(
        createStyleOperation(
          request,
          node,
          now,
          actionIndex,
          nodeIndex,
          "fontWeight",
          params.intensity === "strong" ? "700" : "600",
        ),
      );
      operations.push(
        createZIndexOperation(request, node, now, actionIndex, nodeIndex, resolveZIndexBump(params.intensity ?? "moderate")),
      );
    }
  }

  return { operations, errors: [] };
}

function compileRestyleSelection(
  request: AgentEditRequest,
  params: DesignActionParams,
  now: number,
  actionIndex: number,
): { operations: EditorOperation[]; errors: string[] } {
  const palette = resolveMoodPalette(params.mood ?? "premium");
  const shadow = resolveBoxShadow(params.shadow ?? "soft", params.intensity ?? "subtle");
  const radius = resolveBorderRadius(params.radius ?? "rounded");
  const operations: EditorOperation[] = [];

  for (const [nodeIndex, node] of request.selectedNodes.entries()) {
    operations.push(
      createStyleOperation(request, node, now, actionIndex, nodeIndex, "borderRadius", radius),
    );
    operations.push(
      createStyleOperation(
        request,
        node,
        now,
        actionIndex,
        nodeIndex,
        "backgroundColor",
        palette.background,
      ),
    );
    if (shadow) {
      operations.push(
        createStyleOperation(request, node, now, actionIndex, nodeIndex, "boxShadow", formatBoxShadow(shadow)),
      );
    }
  }

  return { operations, errors: [] };
}

function compileEmphasizeSection(
  request: AgentEditRequest,
  bounds: AgentScopeRect,
  params: DesignActionParams,
  now: number,
  actionIndex: number,
  prefix: string,
): { operations: EditorOperation[]; errors: string[] } {
  const helperId = createHelperId(request, actionIndex);
  const rect = buildHelperRect(bounds, "around");
  const palette = resolveMoodPalette(params.mood ?? "premium");
  const shadow = resolveBoxShadow(params.shadow ?? "medium", params.intensity ?? "moderate");

  const operation: InsertHelperObjectOperation = {
    id: `agent-op-${helperId}`,
    type: "insertHelperObject",
    pageKey: request.pageKey,
    target: buildHelperObjectTarget(helperId, request),
    payload: {
      helperId,
      role: "highlightBox",
      rect,
      fill: {
        type: "solid",
        color: palette.accent,
      },
      borderRadius: resolveBorderRadius(params.radius ?? "rounded"),
      opacity: resolveOpacity(params.intensity ?? "moderate", 0.18),
      ...(shadow ? { boxShadow: shadow } : {}),
      zIndex: 2,
      border: {
        width: params.intensity === "strong" ? 2 : 1,
        color: palette.foreground,
        style: "solid",
      },
      label: "Agent emphasis",
    },
    createdAt: now,
    source: "agent",
    status: "preview",
  };

  if (rect.width <= 0 || rect.height <= 0) {
    return { operations: [], errors: [`${prefix} helper rect has zero dimensions`] };
  }

  return { operations: [operation], errors: [] };
}

function createStyleOperation(
  request: AgentEditRequest,
  node: AgentEditRequest["selectedNodes"][number],
  now: number,
  actionIndex: number,
  nodeIndex: number,
  property: StyleOperation["payload"]["property"],
  value: string,
): StyleOperation {
  return {
    id: `agent-op-${String(now)}-a${String(actionIndex)}-n${String(nodeIndex)}-${property}`,
    type: "style",
    pageKey: request.pageKey,
    target: buildNodeTarget(node, request),
    payload: { property, value },
    createdAt: now,
    source: "agent",
    status: "preview",
  };
}

function createZIndexOperation(
  request: AgentEditRequest,
  node: AgentEditRequest["selectedNodes"][number],
  now: number,
  actionIndex: number,
  nodeIndex: number,
  value: number,
): ZIndexOperation {
  return {
    id: `agent-op-${String(now)}-a${String(actionIndex)}-n${String(nodeIndex)}-z`,
    type: "zIndex",
    pageKey: request.pageKey,
    target: buildNodeTarget(node, request),
    payload: { layer: value },
    createdAt: now,
    source: "agent",
    status: "preview",
  };
}

function buildNodeTarget(
  node: AgentEditRequest["selectedNodes"][number],
  request: AgentEditRequest,
): EditorTarget {
  const target: EditorTarget = {
    nodeId: node.id,
    signature: node.signature,
  };
  if (request.selection.activeGroupId) {
    target.groupId = request.selection.activeGroupId;
  }
  return target;
}

function buildHelperObjectTarget(helperId: string, request: AgentEditRequest): EditorTarget {
  const elementId = `otf-helper-${helperId}`;
  const target: EditorTarget = {
    nodeId: helperId,
    signature: {
      cssPath: `#${elementId}`,
      tagName: "div",
      classList: ["otf-helper-object"],
      idAttr: elementId,
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
  };
  if (request.selection.activeGroupId) {
    target.groupId = request.selection.activeGroupId;
  }
  return target;
}

function buildHelperRect(bounds: AgentScopeRect, placement: "behind" | "around" | "overlay"): AgentScopeRect {
  const padding =
    placement === "around" ? HELPER_PADDING_PX * 2 : HELPER_PADDING_PX;
  return {
    x: Math.max(0, bounds.x - padding),
    y: Math.max(0, bounds.y - padding),
    width: Math.max(MIN_HELPER_SIZE_PX, bounds.width + padding * 2),
    height: Math.max(MIN_HELPER_SIZE_PX, bounds.height + padding * 2),
  };
}

function createHelperId(request: AgentEditRequest, actionIndex: number): string {
  const scopeKey = request.selection.activeGroupId
    ? request.selection.activeGroupId
    : [...request.selection.selectedNodeIds].sort().join("-") || "selection";
  const sanitized = scopeKey.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48);
  return `design-${sanitized}-${String(actionIndex)}-${String(Date.now())}`;
}

function resolveFill(
  fill: DesignFill,
  mood: DesignMood,
  intensity: DesignIntensity,
): HelperObjectFill {
  const palette = resolveMoodPalette(mood);

  if (fill === "solid") {
    return { type: "solid", color: palette.background };
  }

  if (fill === "glass") {
    return {
      type: "linearGradient",
      angleDeg: 145,
      stops: [
        { color: "rgba(255, 255, 255, 0.72)", position: 0 },
        { color: palette.glass, position: 100 },
      ],
    };
  }

  const strong = intensity === "strong";
  return {
    type: "linearGradient",
    angleDeg: strong ? 120 : 135,
    stops: [
      { color: palette.gradientStart, position: 0 },
      { color: palette.gradientEnd, position: 100 },
    ],
  };
}

function resolveMoodPalette(mood: DesignMood): {
  background: string;
  foreground: string;
  accent: string;
  glass: string;
  gradientStart: string;
  gradientEnd: string;
} {
  switch (mood) {
    case "warm":
      return {
        background: "rgba(255, 247, 237, 0.96)",
        foreground: "#9a3412",
        accent: "rgba(251, 191, 36, 0.22)",
        glass: "rgba(254, 243, 199, 0.35)",
        gradientStart: "#fff7ed",
        gradientEnd: "#fed7aa",
      };
    case "cool":
      return {
        background: "rgba(239, 246, 255, 0.96)",
        foreground: "#1e3a8a",
        accent: "rgba(59, 130, 246, 0.18)",
        glass: "rgba(219, 234, 254, 0.35)",
        gradientStart: "#ffffff",
        gradientEnd: "#dbeafe",
      };
    case "premium":
      return {
        background: "rgba(248, 250, 252, 0.98)",
        foreground: "#0f172a",
        accent: "rgba(148, 163, 184, 0.24)",
        glass: "rgba(226, 232, 240, 0.32)",
        gradientStart: "#ffffff",
        gradientEnd: "#e2e8f0",
      };
    case "playful":
      return {
        background: "rgba(250, 245, 255, 0.96)",
        foreground: "#6b21a8",
        accent: "rgba(192, 132, 252, 0.22)",
        glass: "rgba(233, 213, 255, 0.35)",
        gradientStart: "#fdf4ff",
        gradientEnd: "#e9d5ff",
      };
    case "dark":
      return {
        background: "rgba(15, 23, 42, 0.92)",
        foreground: "#e2e8f0",
        accent: "rgba(51, 65, 85, 0.45)",
        glass: "rgba(30, 41, 59, 0.55)",
        gradientStart: "#1e293b",
        gradientEnd: "#0f172a",
      };
    case "neutral":
    default:
      return {
        background: "rgba(248, 250, 252, 0.96)",
        foreground: "#334155",
        accent: "rgba(148, 163, 184, 0.2)",
        glass: "rgba(241, 245, 249, 0.35)",
        gradientStart: "#ffffff",
        gradientEnd: "#f1f5f9",
      };
  }
}

function resolveBoxShadow(
  shadow: DesignShadow,
  intensity: DesignIntensity,
): HelperObjectBoxShadow | null {
  if (shadow === "none") {
    return null;
  }

  const scale = intensity === "strong" ? 1.35 : intensity === "subtle" ? 0.75 : 1;
  const presets: Record<Exclude<DesignShadow, "none">, HelperObjectBoxShadow> = {
    soft: {
      offsetX: 0,
      offsetY: Math.round(8 * scale),
      blurRadius: Math.round(24 * scale),
      spreadRadius: 0,
      color: "rgba(15, 23, 42, 0.10)",
    },
    medium: {
      offsetX: 0,
      offsetY: Math.round(12 * scale),
      blurRadius: Math.round(32 * scale),
      spreadRadius: 0,
      color: "rgba(15, 23, 42, 0.14)",
    },
    strong: {
      offsetX: 0,
      offsetY: Math.round(16 * scale),
      blurRadius: Math.round(40 * scale),
      spreadRadius: 2,
      color: "rgba(15, 23, 42, 0.18)",
    },
  };

  return presets[shadow === "soft" ? "soft" : shadow === "strong" ? "strong" : "medium"];
}

function formatBoxShadow(shadow: HelperObjectBoxShadow): string {
  const spread = shadow.spreadRadius ?? 0;
  return `${String(shadow.offsetX)}px ${String(shadow.offsetY)}px ${String(shadow.blurRadius)}px ${String(spread)}px ${shadow.color}`;
}

function resolveBorderRadius(radius: DesignRadius): string {
  switch (radius) {
    case "none":
      return "0px";
    case "subtle":
      return "8px";
    case "pill":
      return "999px";
    case "rounded":
    default:
      return "16px";
  }
}

function resolveBorder(mood: DesignMood): NonNullable<InsertHelperObjectOperation["payload"]["border"]> {
  const palette = resolveMoodPalette(mood);
  return {
    width: 1,
    color: palette.foreground === "#e2e8f0" ? "#334155" : "#e2e8f0",
    style: "solid",
  };
}

function resolveOpacity(intensity: DesignIntensity, base: number): number {
  if (intensity === "strong") {
    return Math.min(1, base + 0.02);
  }
  if (intensity === "subtle") {
    return Math.max(0.7, base - 0.06);
  }
  return base;
}

function resolveZIndexBump(intensity: DesignIntensity): number {
  switch (intensity) {
    case "strong":
      return 8;
    case "subtle":
      return 2;
    case "moderate":
    default:
      return 4;
  }
}

function resolveInactiveOpacity(intensity: DesignIntensity): string {
  switch (intensity) {
    case "strong":
      return "0.72";
    case "subtle":
      return "0.88";
    case "moderate":
    default:
      return "0.82";
  }
}

function computeSelectionBounds(nodes: AgentEditRequest["selectedNodes"]): AgentScopeRect {
  const first = nodes[0];
  if (!first) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = first.rect.x;
  let minY = first.rect.y;
  let maxX = first.rect.x + first.rect.width;
  let maxY = first.rect.y + first.rect.height;

  for (const node of nodes.slice(1)) {
    minX = Math.min(minX, node.rect.x);
    minY = Math.min(minY, node.rect.y);
    maxX = Math.max(maxX, node.rect.x + node.rect.width);
    maxY = Math.max(maxY, node.rect.y + node.rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}
