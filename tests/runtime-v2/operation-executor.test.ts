import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createVisualModel } from "../../src/runtime-v2/create-visual-model.js";
import { createOperationExecutor } from "../../src/runtime-v2/create-operation-executor.js";
import { createOperationLedger } from "../../src/runtime-v2/create-operation-ledger.js";
import { createPlacementEngine } from "../../src/runtime-v2/create-placement-engine.js";

describe("OperationExecutor", () => {
  it("rolls back and leaves the ledger unchanged when geometry cannot be achieved", () => {
    const { document, root } = createTestDocument(
      `<article class="card" style="transform: none !important">Locked</article>`,
    );
    const element = root.querySelector("article");
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const visualModel = createVisualModel(document);
    const nodeId = visualModel.adopt(element);
    expect(nodeId).toBeTruthy();
    if (!nodeId) {
      return;
    }
    const ledger = createOperationLedger();
    const executor = createOperationExecutor({
      document,
      visualModel,
      ledger,
      placement: createPlacementEngine(),
    });

    const result = executor.executeMove({
      nodeId,
      dx: 80,
      dy: 40,
      pageKey: "https://example.com/",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rolledBack).toBe(true);
    }
    expect(ledger.activeOperations()).toHaveLength(0);
    expect(ledger.isDirty()).toBe(false);
    expect(element.getAttribute("data-otf-transform")).toBeNull();
  });

  it("does not commit when the node cannot be resolved uniquely", () => {
    const { document, root } = createTestDocument(`<article class="card" data-logical-id="gone">Gone</article>`);
    const element = root.querySelector("article");
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const visualModel = createVisualModel(document);
    const nodeId = visualModel.adopt(element);
    expect(nodeId).toBeTruthy();
    if (!nodeId) {
      return;
    }
    const ledger = createOperationLedger();
    const executor = createOperationExecutor({
      document,
      visualModel,
      ledger,
      placement: createPlacementEngine(),
    });
    element.remove();
    visualModel.invalidate(nodeId);

    const result = executor.executeMove({
      nodeId,
      dx: 10,
      dy: 10,
      pageKey: "https://example.com/",
    });

    expect(result.ok).toBe(false);
    expect(ledger.activeOperations()).toHaveLength(0);
  });
});
