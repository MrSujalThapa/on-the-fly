import {
  DESIGN_ACTION_KINDS,
  DESIGN_FILLS,
  DESIGN_INTENSITIES,
  DESIGN_MOODS,
  DESIGN_PLACEMENTS,
  DESIGN_RADIUS,
  DESIGN_SHADOWS,
  DESIGN_SPACING,
} from "../../src/shared/agent-design-plan.js";

const DESIGN_ACTION_PARAMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    placement: { type: "string", enum: [...DESIGN_PLACEMENTS] },
    intensity: { type: "string", enum: [...DESIGN_INTENSITIES] },
    mood: { type: "string", enum: [...DESIGN_MOODS] },
    fill: { type: "string", enum: [...DESIGN_FILLS] },
    shadow: { type: "string", enum: [...DESIGN_SHADOWS] },
    radius: { type: "string", enum: [...DESIGN_RADIUS] },
    spacing: { type: "string", enum: [...DESIGN_SPACING] },
  },
} as const;

const DESIGN_ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: [...DESIGN_ACTION_KINDS] },
    params: DESIGN_ACTION_PARAMS_SCHEMA,
  },
  required: ["kind"],
} as const;

const AGENT_DESIGN_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: DESIGN_ACTION_SCHEMA,
    },
  },
  required: ["actions"],
} as const;

/** JSON schema passed to OpenAI structured output — design plans only, never raw EditorOperation[]. */
export const AGENT_EDIT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    designPlan: AGENT_DESIGN_PLAN_SCHEMA,
    summary: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
  },
  required: ["designPlan", "summary", "warnings", "confidence"],
} as const;

export { DESIGN_ACTION_KINDS };
