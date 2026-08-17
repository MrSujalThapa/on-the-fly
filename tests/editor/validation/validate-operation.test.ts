import { describe, expect, it } from "vitest";
import { validateOperation, validateOperationForDom } from "../../../src/editor/index.js";
import { createHideOperation, createStyleOperation, createTestSignature } from "../fixtures.js";

describe("validateOperation", () => {
  it("accepts a valid style operation", () => {
    const result = validateOperation(createStyleOperation());
    expect(result.ok).toBe(true);
  });

  it("rejects dangerous selectors", () => {
    const result = validateOperation(
      createStyleOperation({
        target: {
          nodeId: "node-danger",
          signature: createTestSignature({ cssPath: "body", tagName: "body" }),
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("dangerous"))).toBe(true);
  });

  it("rejects unknown operation types", () => {
    const invalid = {
      ...createStyleOperation(),
      type: "unknown",
    } as unknown as ReturnType<typeof createStyleOperation>;

    const result = validateOperation(invalid);
    expect(result.ok).toBe(false);
  });

  it("rejects missing targets and invalid style properties", () => {
    const missingTarget = validateOperation(
      createStyleOperation({
        target: {},
      }),
    );
    expect(missingTarget.ok).toBe(false);

    const invalidStyle = validateOperation({
      ...createStyleOperation(),
      payload: {
        property: "not-a-style-prop",
        value: "red",
      },
    } as unknown as ReturnType<typeof createStyleOperation>);
    expect(invalidStyle.ok).toBe(false);
  });

  it("rejects invalid signatures on targets", () => {
    const result = validateOperation(
      createStyleOperation({
        target: {
          signature: createTestSignature({ cssPath: ":root", tagName: "div" }),
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("dangerous_selector");
    }
  });
});

describe("validateOperationForDom", () => {
  it("rejects unsupported DOM operations and nodeId-only targets", () => {
    const unsupported = validateOperationForDom({
      ...createHideOperation(),
      type: "ungroup",
      payload: { groupId: "group-1" },
    });

    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) {
      expect(unsupported.codes).toContain("unsupported_dom_operation");
    }

    const nodeOnly = validateOperationForDom(
      createStyleOperation({
        target: { nodeId: "node-1" },
      }),
    );
    expect(nodeOnly.ok).toBe(false);
    if (!nodeOnly.ok) {
      expect(nodeOnly.codes).toContain("missing_target");
    }
  });
});
