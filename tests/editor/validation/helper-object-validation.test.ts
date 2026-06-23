import { describe, expect, it } from "vitest";
import { validateOperation } from "../../../src/editor/validation/validate-operation.js";
import { createInsertHelperObjectOperation } from "../fixtures.js";

describe("insertHelperObject validation", () => {
  it("accepts structured helper object payloads", () => {
    const result = validateOperation(createInsertHelperObjectOperation());

    expect(result.ok).toBe(true);
  });

  it("rejects raw CSS-like fill values", () => {
    const result = validateOperation({
      ...createInsertHelperObjectOperation(),
      payload: {
        ...createInsertHelperObjectOperation().payload,
        fill: "linear-gradient(red, blue)",
      },
    } as unknown as ReturnType<typeof createInsertHelperObjectOperation>);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("invalid_payload");
    }
  });

  it("rejects unsafe color/url payloads", () => {
    const result = validateOperation({
      ...createInsertHelperObjectOperation(),
      payload: {
        ...createInsertHelperObjectOperation().payload,
        fill: {
          type: "solid",
          color: "url(javascript:alert(1))",
        },
      },
    } as unknown as ReturnType<typeof createInsertHelperObjectOperation>);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("invalid_payload");
    }
  });

  it("rejects invalid geometry", () => {
    const result = validateOperation(
      createInsertHelperObjectOperation({
        payload: {
          ...createInsertHelperObjectOperation().payload,
          rect: { x: 0, y: 0, width: -1, height: 100 },
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("invalid_payload");
    }
  });
});
