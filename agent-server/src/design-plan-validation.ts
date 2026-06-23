import {
  DESIGN_ACTION_KINDS,
  DESIGN_FILLS,
  DESIGN_INTENSITIES,
  DESIGN_MOODS,
  DESIGN_PLACEMENTS,
  DESIGN_PLAN_LIMITS,
  DESIGN_RADIUS,
  DESIGN_SHADOWS,
  DESIGN_SPACING,
  isDesignActionKind,
  type AgentDesignPlan,
  type DesignAction,
  type DesignActionParams,
} from "../../src/shared/agent-design-plan.js";

export type DesignPlanValidationResult =
  | { ok: true; plan: AgentDesignPlan }
  | { ok: false; errors: string[] };

export function validateDesignPlanShape(value: unknown): DesignPlanValidationResult {
  if (!isRecord(value)) {
    return { ok: false, errors: ["designPlan must be an object"] };
  }

  if (!Array.isArray(value.actions)) {
    return { ok: false, errors: ["designPlan.actions must be an array"] };
  }

  if (value.actions.length === 0) {
    return { ok: false, errors: ["designPlan.actions must include at least one action"] };
  }

  if (value.actions.length > DESIGN_PLAN_LIMITS.maxActions) {
    return {
      ok: false,
      errors: [`designPlan.actions exceeds max actions (${String(DESIGN_PLAN_LIMITS.maxActions)})`],
    };
  }

  const actions: DesignAction[] = [];
  const errors: string[] = [];

  value.actions.forEach((entry, index) => {
    const prefix = `designPlan.actions[${String(index)}]`;
    if (!isRecord(entry)) {
      errors.push(`${prefix} must be an object`);
      return;
    }

    if (!isDesignActionKind(entry.kind)) {
      errors.push(`${prefix}.kind must be one of: ${DESIGN_ACTION_KINDS.join(", ")}`);
      return;
    }

    const paramsResult = validateDesignActionParams(entry.params, `${prefix}.params`);
    if (!paramsResult.ok) {
      errors.push(...paramsResult.errors);
      return;
    }

    actions.push({
      kind: entry.kind,
      ...(paramsResult.params ? { params: paramsResult.params } : {}),
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, plan: { actions } };
}

function validateDesignActionParams(
  value: unknown,
  prefix: string,
): { ok: true; params?: DesignActionParams } | { ok: false; errors: string[] } {
  if (value === undefined) {
    return { ok: true };
  }

  if (!isRecord(value)) {
    return { ok: false, errors: [`${prefix} must be an object`] };
  }

  const params: DesignActionParams = {};
  const errors: string[] = [];

  const placement = readEnumParam(DESIGN_PLACEMENTS, value.placement, prefix, "placement");
  if (!placement.ok) {
    errors.push(...placement.errors);
  } else if (placement.value !== undefined) {
    params.placement = placement.value;
  }

  const intensity = readEnumParam(DESIGN_INTENSITIES, value.intensity, prefix, "intensity");
  if (!intensity.ok) {
    errors.push(...intensity.errors);
  } else if (intensity.value !== undefined) {
    params.intensity = intensity.value;
  }

  const mood = readEnumParam(DESIGN_MOODS, value.mood, prefix, "mood");
  if (!mood.ok) {
    errors.push(...mood.errors);
  } else if (mood.value !== undefined) {
    params.mood = mood.value;
  }

  const fill = readEnumParam(DESIGN_FILLS, value.fill, prefix, "fill");
  if (!fill.ok) {
    errors.push(...fill.errors);
  } else if (fill.value !== undefined) {
    params.fill = fill.value;
  }

  const shadow = readEnumParam(DESIGN_SHADOWS, value.shadow, prefix, "shadow");
  if (!shadow.ok) {
    errors.push(...shadow.errors);
  } else if (shadow.value !== undefined) {
    params.shadow = shadow.value;
  }

  const radius = readEnumParam(DESIGN_RADIUS, value.radius, prefix, "radius");
  if (!radius.ok) {
    errors.push(...radius.errors);
  } else if (radius.value !== undefined) {
    params.radius = radius.value;
  }

  const spacing = readEnumParam(DESIGN_SPACING, value.spacing, prefix, "spacing");
  if (!spacing.ok) {
    errors.push(...spacing.errors);
  } else if (spacing.value !== undefined) {
    params.spacing = spacing.value;
  }

  for (const key of Object.keys(value)) {
    if (
      key !== "placement" &&
      key !== "intensity" &&
      key !== "mood" &&
      key !== "fill" &&
      key !== "shadow" &&
      key !== "radius" &&
      key !== "spacing"
    ) {
      errors.push(`${prefix}.${key} is not an allowed semantic param`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return Object.keys(params).length > 0 ? { ok: true, params } : { ok: true };
}

function readEnumParam<T extends string>(
  allowed: readonly T[],
  raw: unknown,
  prefix: string,
  key: string,
): { ok: true; value?: T; errors?: never } | { ok: false; errors: string[]; value?: never } {
  if (raw === undefined) {
    return { ok: true };
  }
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    return { ok: false, errors: [`${prefix}.${key} must be one of: ${allowed.join(", ")}`] };
  }
  return { ok: true, value: raw as T };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
