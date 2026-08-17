export type SessionStatus = "authenticated" | "login-required" | "unknown";

export const AUTH_NOT_CONFIGURED_MESSAGE = "authenticated real-site profile is not configured";

export function publicUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

export function classifyLinkedInSession(input: {
  url: string;
  hasMentionsControl: boolean;
  hasPasswordField: boolean;
}): SessionStatus {
  let pathname = "";
  try {
    pathname = new URL(input.url).pathname.toLowerCase();
  } catch {
    return "unknown";
  }

  if (
    pathname.includes("/login") ||
    pathname.includes("/uas/login") ||
    pathname.includes("/checkpoint/lg") ||
    pathname.includes("/checkpoint/challenges")
  ) {
    return "login-required";
  }
  if (input.hasPasswordField && !input.hasMentionsControl) {
    return "login-required";
  }
  if (input.hasMentionsControl) {
    return "authenticated";
  }
  if (pathname.startsWith("/feed") || pathname.startsWith("/notifications") || pathname.startsWith("/in/")) {
    return "authenticated";
  }
  return "unknown";
}

export function classifyDevpostSession(input: {
  url: string;
  hasInProgressSection: boolean;
  hasPasswordField: boolean;
  hasSignedInNav: boolean;
}): SessionStatus {
  let pathname = "";
  try {
    pathname = new URL(input.url).pathname.toLowerCase();
  } catch {
    return "unknown";
  }

  if (pathname.includes("/users/sign_in") || pathname.includes("/users/sign_up")) {
    return "login-required";
  }
  if (input.hasPasswordField && !input.hasSignedInNav && !input.hasInProgressSection) {
    return "login-required";
  }
  if (input.hasInProgressSection || input.hasSignedInNav) {
    return "authenticated";
  }
  if (pathname === "/" || pathname === "/home") {
    return "login-required";
  }
  return "unknown";
}

export function requireAuthenticated(status: SessionStatus, site: string): void {
  if (status === "authenticated") {
    return;
  }
  throw new Error(
    `${AUTH_NOT_CONFIGURED_MESSAGE} (${site}: ${status}). Sign in with npm run real:browser, then retry.`,
  );
}
