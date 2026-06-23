import { describe, expect, it } from "vitest";
import { validateDesignPlanShape } from "../../agent-server/src/design-plan-validation.js";
import { DESIGN_ACTION_KINDS } from "../../src/shared/agent-design-plan.js";

describe("validateDesignPlanShape", () => {
  it("accepts flexible semantic params on design actions", () => {
    const result = validateDesignPlanShape({
      actions: [
        {
          kind: "add_surface",
          params: {
            placement: "behind",
            fill: "gradient",
            mood: "premium",
            shadow: "soft",
            radius: "rounded",
            intensity: "subtle",
          },
        },
        { kind: "adjust_elevation", params: { shadow: "medium" } },
        { kind: "restyle_selection" },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.actions).toHaveLength(3);
      expect(result.plan.actions[0]?.kind).toBe("add_surface");
      expect(result.plan.actions[0]?.params?.mood).toBe("premium");
    }
  });

  it("rejects unknown action kinds", () => {
    const result = validateDesignPlanShape({
      actions: [{ kind: "insertHelperObject" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain(DESIGN_ACTION_KINDS[0]);
    }
  });

  it("rejects unknown semantic params", () => {
    const result = validateDesignPlanShape({
      actions: [
        {
          kind: "add_surface",
          params: { cssPath: "#bad", helperId: "x" },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("not an allowed semantic param");
    }
  });

  it("rejects empty actions", () => {
    const result = validateDesignPlanShape({ actions: [] });
    expect(result.ok).toBe(false);
  });
});
