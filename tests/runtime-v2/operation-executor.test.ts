import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createElementRegistry } from "../../src/runtime-v2/create-element-registry.js";
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

    const registry = createElementRegistry(document);
    const ledger = createOperationLedger();
    const executor = createOperationExecutor({
      document,
      registry,
      ledger,
      placement: createPlacementEngine(),
    });
    const handle = registry.register(element);

    const result = executor.executeMove({
      handle,
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

  it("does not commit when the handle cannot be resolved uniquely", () => {
    const { document, root } = createTestDocument(`<article class="card">Gone</article>`);
    const element = root.querySelector("article");
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const ledger = createOperationLedger();
    const executor = createOperationExecutor({
      document,
      registry,
      ledger,
      placement: createPlacementEngine(),
    });
    const handle = registry.register(element);
    element.remove();
    registry.invalidate(handle);

    const result = executor.executeMove({
      handle,
      dx: 10,
      dy: 10,
      pageKey: "https://example.com/",
    });

    expect(result.ok).toBe(false);
    expect(ledger.activeOperations()).toHaveLength(0);
  });
});
