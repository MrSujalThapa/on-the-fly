const SAFE_HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

export interface GradientPreset {
  id: string;
  label: string;
  startColor: string;
  endColor: string;
  angleDeg: number;
}

export interface ParsedLinearGradient {
  startColor: string;
  endColor: string;
  angleDeg: number;
}

export type ShadowPresetId = "none" | "soft" | "medium" | "strong" | "glow";

export interface ShadowPreset {
  id: ShadowPresetId;
  label: string;
  baseBlur: number;
  baseOffsetY: number;
  spread: number;
  color: string;
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "sunset", label: "Sunset", startColor: "#FF6B6B", endColor: "#FFE66D", angleDeg: 135 },
  { id: "ocean", label: "Ocean", startColor: "#3B82F6", endColor: "#06B6D4", angleDeg: 135 },
  { id: "forest", label: "Forest", startColor: "#22C55E", endColor: "#065F46", angleDeg: 145 },
  { id: "lavender", label: "Lavender", startColor: "#A78BFA", endColor: "#F472B6", angleDeg: 120 },
  { id: "slate", label: "Slate", startColor: "#64748B", endColor: "#CBD5E1", angleDeg: 180 },
  { id: "gold", label: "Gold", startColor: "#F59E0B", endColor: "#FDE68A", angleDeg: 160 },
];

export const GRADIENT_ANGLE_PRESETS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

export const SHADOW_PRESETS: ShadowPreset[] = [
  { id: "none", label: "None", baseBlur: 0, baseOffsetY: 0, spread: 0, color: "rgba(0,0,0,0)" },
  { id: "soft", label: "Soft", baseBlur: 8, baseOffsetY: 2, spread: 0, color: "rgba(0,0,0,0.12)" },
  { id: "medium", label: "Medium", baseBlur: 24, baseOffsetY: 8, spread: 0, color: "rgba(0,0,0,0.18)" },
  { id: "strong", label: "Strong", baseBlur: 40, baseOffsetY: 16, spread: 0, color: "rgba(0,0,0,0.28)" },
  { id: "glow", label: "Glow", baseBlur: 24, baseOffsetY: 0, spread: 0, color: "rgba(59,130,246,0.45)" },
];

export function sanitizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!SAFE_HEX_COLOR.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function buildLinearGradientValue(
  startColor: string,
  endColor: string,
  angleDeg: number,
): string | null {
  const start = sanitizeHexColor(startColor);
  const end = sanitizeHexColor(endColor);
  if (!start || !end) {
    return null;
  }

  const angle = normalizeAngle(angleDeg);
  return `linear-gradient(${String(angle)}deg, ${start}, ${end})`;
}

export function buildGradientFromPreset(preset: GradientPreset): string {
  return `linear-gradient(${String(preset.angleDeg)}deg, ${preset.startColor}, ${preset.endColor})`;
}

export function parseLinearGradientValue(value: string): ParsedLinearGradient | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") {
    return null;
  }

  const match = /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)$/i.exec(
    trimmed,
  );
  if (!match) {
    return null;
  }

  return {
    angleDeg: Number(match[1]),
    startColor: match[2] ?? "#000000",
    endColor: match[3] ?? "#ffffff",
  };
}

export function buildBoxShadowValue(presetId: ShadowPresetId, intensity = 1): string {
  if (presetId === "none") {
    return "none";
  }

  const preset = SHADOW_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    return "none";
  }

  const scale = clamp(intensity, 0.25, 2);
  const offsetY = Math.round(preset.baseOffsetY * scale);
  const blur = Math.round(preset.baseBlur * scale);
  const spread = Math.round(preset.spread * scale);
  return `0 ${String(offsetY)}px ${String(blur)}px ${String(spread)}px ${preset.color}`;
}

export function parseBoxShadowPreset(value: string): { presetId: ShadowPresetId; intensity: number } {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") {
    return { presetId: "none", intensity: 1 };
  }

  for (const preset of SHADOW_PRESETS) {
    if (preset.id === "none") {
      continue;
    }
    const baseline = buildBoxShadowValue(preset.id, 1);
    if (trimmed === baseline) {
      return { presetId: preset.id, intensity: 1 };
    }
  }

  return { presetId: "medium", intensity: 1 };
}

function normalizeAngle(angleDeg: number): number {
  const normalized = angleDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
