import { describe, expect, it } from "vitest";
import { classifyAgentInstruction } from "../../agent-server/src/intent-router.js";

describe("intent router", () => {
  it("routes simple toolbar requests to manual tool recommendation", () => {
    const result = classifyAgentInstruction("make text red");
    expect(result?.status).toBe("manual_tool_recommended");
    expect(result?.matchedIntent).toBe("text_color");
  });

  it("allows agent-worthy composition requests through", () => {
    expect(classifyAgentInstruction("make this selected card feel more premium")).toBeNull();
    expect(classifyAgentInstruction("add a soft background panel behind this section")).toBeNull();
    expect(classifyAgentInstruction("improve visual hierarchy in this area")).toBeNull();
  });

  it("prefers agent composition when both themes appear", () => {
    expect(classifyAgentInstruction("add gradient background panel behind this card")).toBeNull();
  });
});
