/** High-level design actions the model may emit. Code compiles these to EditorOperation[]. */

export const DESIGN_ACTION_KINDS = [
  "add_surface",
  "adjust_elevation",
  "adjust_spacing",
  "adjust_color_treatment",
  "improve_hierarchy",
  "restyle_selection",
  "emphasize_section",
] as const;

export type DesignActionKind = (typeof DESIGN_ACTION_KINDS)[number];

export const DESIGN_PLACEMENTS = ["behind", "around", "overlay"] as const;
export type DesignPlacement = (typeof DESIGN_PLACEMENTS)[number];

export const DESIGN_INTENSITIES = ["subtle", "moderate", "strong"] as const;
export type DesignIntensity = (typeof DESIGN_INTENSITIES)[number];

export const DESIGN_MOODS = ["neutral", "warm", "cool", "premium", "playful", "dark"] as const;
export type DesignMood = (typeof DESIGN_MOODS)[number];

export const DESIGN_FILLS = ["solid", "gradient", "glass"] as const;
export type DesignFill = (typeof DESIGN_FILLS)[number];

export const DESIGN_SHADOWS = ["none", "soft", "medium", "strong"] as const;
export type DesignShadow = (typeof DESIGN_SHADOWS)[number];

export const DESIGN_RADIUS = ["none", "subtle", "rounded", "pill"] as const;
export type DesignRadius = (typeof DESIGN_RADIUS)[number];

export const DESIGN_SPACING = ["tight", "normal", "relaxed", "spacious"] as const;
export type DesignSpacing = (typeof DESIGN_SPACING)[number];

export interface DesignActionParams {
  placement?: DesignPlacement;
  intensity?: DesignIntensity;
  mood?: DesignMood;
  fill?: DesignFill;
  shadow?: DesignShadow;
  radius?: DesignRadius;
  spacing?: DesignSpacing;
}

export interface DesignAction {
  kind: DesignActionKind;
  params?: DesignActionParams;
}

export interface AgentDesignPlan {
  actions: DesignAction[];
}

export const DESIGN_PLAN_LIMITS = {
  maxActions: 8,
  maxCompiledOperations: 12,
} as const;

const DESIGN_ACTION_KIND_SET: ReadonlySet<string> = new Set(DESIGN_ACTION_KINDS);

export function isDesignActionKind(value: unknown): value is DesignActionKind {
  return typeof value === "string" && DESIGN_ACTION_KIND_SET.has(value);
}
