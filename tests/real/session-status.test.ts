import { describe, expect, it } from "vitest";
import {
  AUTH_NOT_CONFIGURED_MESSAGE,
  classifyDevpostSession,
  classifyLinkedInSession,
  publicUrl,
  requireAuthenticated,
} from "./session-status.js";

describe("real-site session classification", () => {
  it("treats LinkedIn login and checkpoint paths as login-required", () => {
    expect(
      classifyLinkedInSession({
        url: "https://www.linkedin.com/login",
        hasMentionsControl: false,
        hasPasswordField: true,
      }),
    ).toBe("login-required");
    expect(
      classifyLinkedInSession({
        url: "https://www.linkedin.com/checkpoint/lg/login-submit",
        hasMentionsControl: false,
        hasPasswordField: false,
      }),
    ).toBe("login-required");
  });

  it("treats LinkedIn Mentions controls as authenticated", () => {
    expect(
      classifyLinkedInSession({
        url: "https://www.linkedin.com/notifications/",
        hasMentionsControl: true,
        hasPasswordField: false,
      }),
    ).toBe("authenticated");
  });

  it("treats Devpost sign-in as login-required", () => {
    expect(
      classifyDevpostSession({
        url: "https://devpost.com/users/sign_in",
        hasInProgressSection: false,
        hasPasswordField: true,
        hasSignedInNav: false,
      }),
    ).toBe("login-required");
  });

  it("treats Devpost home without signed-in nav as login-required", () => {
    expect(
      classifyDevpostSession({
        url: "https://devpost.com/",
        hasInProgressSection: false,
        hasPasswordField: false,
        hasSignedInNav: false,
      }),
    ).toBe("login-required");
  });

  it("treats Devpost signed-in nav as authenticated", () => {
    expect(
      classifyDevpostSession({
        url: "https://devpost.com/home",
        hasInProgressSection: false,
        hasPasswordField: false,
        hasSignedInNav: true,
      }),
    ).toBe("authenticated");
  });

  it("strips query strings from public URLs", () => {
    expect(publicUrl("https://www.linkedin.com/feed/?trk=secret")).toBe("https://www.linkedin.com/feed/");
  });

  it("fails closed with the configured-profile message", () => {
    expect(() => {
      requireAuthenticated("login-required", "LinkedIn");
    }).toThrow(AUTH_NOT_CONFIGURED_MESSAGE);
  });
});
