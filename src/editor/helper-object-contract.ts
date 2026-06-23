/** Single source of truth for insertHelperObject.role across editor, agent-server, and OpenAI schema. */
export const HELPER_OBJECT_ROLES = [
  "backgroundPanel",
  "decorativePanel",
  "highlightBox",
] as const;

export type HelperObjectRole = (typeof HELPER_OBJECT_ROLES)[number];

export const HELPER_OBJECT_ROLE_SET: ReadonlySet<string> = new Set(HELPER_OBJECT_ROLES);

export function isHelperObjectRole(value: unknown): value is HelperObjectRole {
  return typeof value === "string" && HELPER_OBJECT_ROLE_SET.has(value);
}

export function formatAllowedHelperRoles(): string {
  return HELPER_OBJECT_ROLES.join(", ");
}

/** Default role for gradient/background panels behind a selection. */
export const GRADIENT_PANEL_HELPER_ROLE: HelperObjectRole = "backgroundPanel";
