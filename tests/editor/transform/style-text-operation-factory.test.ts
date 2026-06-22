import { describe, expect, it } from "vitest";
import { buildStyleOperation, buildTextOperation } from "../../../src/editor/transform/operation-factory.js";
import { createTestSignature } from "../fixtures.js";
import type { TransformTarget } from "../../../src/editor/transform/transform-target.js";

const PAGE_KEY = "https://example.com/";

function createTarget(): TransformTarget {
  return {
    nodeId: "node-1",
    signature: createTestSignature(),
    rect: { x: 0, y: 0, width: 100, height: 20 },
  };
}

describe("style/text operation factory", () => {
  it("builds style operations with property payloads", () => {
    const operation = buildStyleOperation(createTarget(), "borderRadius", "8px", { pageKey: PAGE_KEY });
    expect(operation.type).toBe("style");
    expect(operation.payload.property).toBe("borderRadius");
    expect(operation.payload.value).toBe("8px");
  });

  it("builds text operations with preserveFormat", () => {
    const operation = buildTextOperation(createTarget(), "Updated", { pageKey: PAGE_KEY }, "Hello");
    expect(operation.type).toBe("text");
    expect(operation.payload.value).toBe("Updated");
    expect(operation.payload.preserveFormat).toBe(true);
    expect(operation.payload.previousValue).toBe("Hello");
  });
});
