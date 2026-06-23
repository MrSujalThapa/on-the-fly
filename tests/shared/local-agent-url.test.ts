// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  isAllowedLocalAgentUrl,
  resolveAgentEndpointUrl,
} from "../../src/shared/local-agent-url.js";

describe("local agent URL gate", () => {
  it("allows localhost loopback hosts", () => {
    expect(isAllowedLocalAgentUrl("http://127.0.0.1:4317")).toBe(true);
    expect(isAllowedLocalAgentUrl("http://localhost:4317")).toBe(true);
    expect(isAllowedLocalAgentUrl("http://[::1]:4317")).toBe(true);
  });

  it("rejects non-localhost URLs", () => {
    expect(isAllowedLocalAgentUrl("http://example.com:4317")).toBe(false);
    expect(isAllowedLocalAgentUrl("https://192.168.1.10:4317")).toBe(false);
    expect(isAllowedLocalAgentUrl("file:///tmp/agent")).toBe(false);
  });

  it("rejects URLs with embedded credentials", () => {
    expect(isAllowedLocalAgentUrl("http://user:pass@127.0.0.1:4317")).toBe(false);
  });

  it("resolves agent endpoint paths safely", () => {
    expect(resolveAgentEndpointUrl("http://127.0.0.1:4317", "/agent/edit")).toBe(
      "http://127.0.0.1:4317/agent/edit",
    );
  });
});
