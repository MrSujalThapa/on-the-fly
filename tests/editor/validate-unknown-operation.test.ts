import { describe, expect, it } from "vitest";
import { validateUnknownOperation } from "../../src/editor/validation/validate-unknown-operation.js";
import { createStyleOperation } from "./fixtures.js";

describe("validateUnknownOperation", () => {
  it("accepts valid serialized operations", () => {
    const result = validateUnknownOperation(createStyleOperation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operation.id).toBe("op-style-1");
    }
  });

  it("rejects non-object payloads", () => {
    const result = validateUnknownOperation(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("invalid_shape");
    }
  });

  it("rejects unknown operation types from JSON", () => {
    const result = validateUnknownOperation({
      ...createStyleOperation(),
      type: "warp",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("unknown_type");
    }
  });

  it("rejects dangerous selectors in nested signatures", () => {
    const result = validateUnknownOperation({
      ...createStyleOperation(),
      target: {
        nodeId: "node-danger",
        signature: {
          cssPath: "html",
          tagName: "html",
          classList: [],
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("dangerous_selector");
    }
  });

  it("rejects malformed move payloads", () => {
    const result = validateUnknownOperation({
      ...createStyleOperation(),
      type: "move",
      payload: { dx: "bad", dy: 4 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("invalid_payload");
    }
  });
});
