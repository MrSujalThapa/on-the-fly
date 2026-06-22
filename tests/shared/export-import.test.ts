import { describe, expect, it } from "vitest";
import {
  friendlyImportError,
  OTF_EXPORT_SCHEMA_VERSION,
  parseImportJson,
  serializeExportPayload,
  validateImportOperations,
  validateExportPayload,
} from "../../src/shared/export-import.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type { MoveOperation } from "../../src/editor/operations.js";

const PAGE_KEY = "https://example.com/pricing";

function moveOp(id: string): MoveOperation {
  return {
    id,
    type: "move",
    pageKey: PAGE_KEY,
    target: {
      nodeId: id,
      signature: {
        cssPath: "main p.intro",
        tagName: "p",
        classList: ["intro"],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: { dx: 1, dy: 2 },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

describe("export/import validation", () => {
  it("serializes and parses a valid export payload", () => {
    const payload = {
      schemaVersion: OTF_EXPORT_SCHEMA_VERSION,
      exportedAt: 1,
      dbName: "on_the_fly_v1",
      sites: [],
      pages: [],
      customizations: [],
      operations: [],
      assets: [],
    };

    const serialized = serializeExportPayload(payload);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) {
      return;
    }

    const parsed = parseImportJson(serialized.json);
    expect(parsed.ok).toBe(true);
  });

  it("rejects unsupported schema versions", () => {
    const result = validateExportPayload({
      schemaVersion: 99,
      exportedAt: 1,
      dbName: "on_the_fly_v1",
      sites: [],
      pages: [],
      customizations: [],
      operations: [],
      assets: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe("unsupported_schema");
    expect(friendlyImportError(result.error)).toContain("unsupported");
  });

  it("rejects dangerous operations during import validation", () => {
    const invalid = { ...moveOp("bad"), type: "frobnicate" } as unknown as MoveOperation;
    const result = validateImportOperations([invalid]);
    expect(result.ok).toBe(false);
  });

  it("returns friendly errors for oversize imports", () => {
    const huge = "x".repeat(9 * 1024 * 1024);
    const result = parseImportJson(huge);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe("import_too_large");
    expect(friendlyImportError(result.error)).toContain("too large");
  });
});
