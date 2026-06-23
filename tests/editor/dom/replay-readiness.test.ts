import { describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../../src/content/page-customization-controller.js";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { waitForReplayTargets } from "../../../src/editor/dom/replay-readiness.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { createTestDocument } from "./test-document.js";
import type { EditorOperation } from "../../../src/editor/operations.js";
import * as storageClient from "../../../src/content/storage-client.js";

function styleOp(id: string, cssPath: string): EditorOperation {
  return {
    id,
    type: "style",
    pageKey: "https://example.com/",
    target: {
      nodeId: id,
      signature: {
        cssPath,
        tagName: "p",
        classList: [],
        idAttr: "late",
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: { property: "color", value: "rgb(255, 0, 0)" },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

describe("replay readiness", () => {
  it("waits for late-mounted targets before replay applies once", async () => {
    const { document, root } = createTestDocument(`<main></main>`);
    const operations = [styleOp("style-late", "main p#late")];

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue(operations);

    const controller = new PageCustomizationController(document);
    const replayPromise = controller.ensureReplayed();

    await waitForReplayTargets(root, operations, { maxFrames: 2 });
    expect(root.querySelector("#late")).toBeNull();

    const main = root.querySelector("main") as HTMLElement;
    const late = document.createElement("p");
    late.id = "late";
    late.textContent = "Hello";
    main.appendChild(late);

    const result = await replayPromise;

    expect(result.count).toBe(1);
    expect(result.unresolved).toBe(0);
    expect(late.style.color).toBe("rgb(255, 0, 0)");
  });

  it("does not mutate operations when replaying twice on the same adapter", () => {
    const { root } = createTestDocument(`<main><section class="card">Card</section></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const move = {
      id: "move-1",
      type: "move" as const,
      pageKey: "https://example.com/",
      target: {
        nodeId: "card",
        signature: {
          cssPath: "main section.card",
          tagName: "section",
          classList: ["card"],
          boundingBoxHint: createEmptyBoundingBoxHint(),
        },
      },
      payload: { dx: 40, dy: 20 },
      createdAt: 1,
      source: "manual" as const,
      status: "approved" as const,
    };

    const first = adapter.replayOperationsWithDiagnostics([move]);
    expect(first.applied).toBe(1);

    const card = root.querySelector(".card") as HTMLElement;
    const transformAfterFirst = card.style.transform;

    const second = adapter.replayOperationsWithDiagnostics([move]);
    expect(second.skipped).toBe(1);
    expect(card.style.transform).toBe(transformAfterFirst);
    expect(move.payload).not.toHaveProperty("detached");
  });
});
