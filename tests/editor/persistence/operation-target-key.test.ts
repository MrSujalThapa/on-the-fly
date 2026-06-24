import { describe, expect, it } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import {
  operationTargetKey,
  stableSignatureTargetKey,
} from "../../../src/editor/persistence/operation-target-key.js";
import type { ZIndexOperation } from "../../../src/editor/operations.js";

const PAGE_KEY = "https://example.com/";

describe("operationTargetKey", () => {
  it("uses idAttr when present", () => {
    const key = stableSignatureTargetKey({
      cssPath: "main section.card > button#save",
      tagName: "button",
      idAttr: "save",
      classList: ["primary"],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });

    expect(key).toBe("id:save");
  });

  it("stays stable when only the parent cssPath changes", () => {
    const beforeMove = stableSignatureTargetKey({
      cssPath: "main section.card > button.premium",
      tagName: "button",
      classList: ["premium"],
      textFingerprint: "Reactivate Premium",
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });
    const afterDetach = stableSignatureTargetKey({
      cssPath: "body > button.premium",
      tagName: "button",
      classList: ["premium"],
      textFingerprint: "Reactivate Premium",
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });

    expect(beforeMove).toBe(afterDetach);
  });

  it("distinguishes different leaf selectors on the same page", () => {
    const a = stableSignatureTargetKey({
      cssPath: "main .a",
      tagName: "div",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });
    const b = stableSignatureTargetKey({
      cssPath: "main .b",
      tagName: "div",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });

    expect(a).not.toBe(b);
  });

  it("maps helper objects to helper ids", () => {
    const key = operationTargetKey({
      id: "helper-insert",
      type: "insertHelperObject",
      pageKey: PAGE_KEY,
      target: {
        nodeId: "helper-panel-1",
        signature: {
          cssPath: "body > div#otf-helper-helper-panel-1",
          tagName: "div",
          idAttr: "otf-helper-helper-panel-1",
          classList: ["otf-helper-object"],
          boundingBoxHint: createEmptyBoundingBoxHint(),
        },
      },
      payload: {
        helperId: "helper-panel-1",
        role: "backgroundPanel",
        rect: { x: 0, y: 0, width: 100, height: 100 },
        fill: { type: "solid", color: "#fff" },
        borderRadius: "8px",
        opacity: 1,
        label: "Panel",
      },
      createdAt: 1,
      source: "manual",
      status: "approved",
    });

    expect(key).toBe("helper:helper-panel-1");
  });

  it("coalesces zIndex ops across reparented signatures", () => {
    const sharedTarget = {
      nodeId: "premium",
      signature: {
        cssPath: "main section.card > button.premium",
        tagName: "button",
        classList: ["premium"],
        textFingerprint: "Go",
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    };
    const reparentedTarget = {
      nodeId: "premium",
      signature: {
        cssPath: "body > button.premium",
        tagName: "button",
        classList: ["premium"],
        textFingerprint: "Go",
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    };

    const first: ZIndexOperation = {
      id: "z-old",
      type: "zIndex",
      pageKey: PAGE_KEY,
      target: sharedTarget,
      payload: { layer: 0 },
      createdAt: 1,
      source: "manual",
      status: "approved",
    };
    const second: ZIndexOperation = {
      id: "z-new",
      type: "zIndex",
      pageKey: PAGE_KEY,
      target: reparentedTarget,
      payload: { layer: 100 },
      createdAt: 2,
      source: "manual",
      status: "approved",
    };

    expect(operationTargetKey(first)).toBe(operationTargetKey(second));
  });
});
