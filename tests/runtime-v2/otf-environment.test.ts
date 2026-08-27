import { describe, expect, it } from "vitest";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { createOTFEnvironment } from "../../src/runtime-v2/environment/OTFEnvironment.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutManagedElement } from "../editor/measurement/layout-helpers.js";

describe("safe OTFEnvironment facade", () => {
  it("keeps observation pure and uses the VisualModel ElementId", async () => {
    const { document, root } = createTestDocument('<button id="target" role="button">Save</button>');
    const target = root.querySelector("#target");
    if (!(target instanceof HTMLElement)) throw new Error("missing target");
    layoutManagedElement(target, { x: 20, y: 30, width: 100, height: 40 });
    const runtime = createEditorRuntime(document);
    const id = runtime.select(target);
    if (!id) throw new Error("target not adopted");
    const env = createOTFEnvironment(document, runtime);
    const beforeHtml = target.outerHTML;
    const beforeSelection = runtime.selectedNodeIds();
    const beforeRevision = runtime.ledger.cursor;

    const observed = await env.observe({ scope: "selection" });
    const inspected = await env.inspectElement(id);
    const found = await env.findElements({ text: "save", role: "button" });

    expect(observed.elements[0]?.id).toBe(id);
    expect(inspected.id).toBe(id);
    expect(found).toEqual([id]);
    expect(target.outerHTML).toBe(beforeHtml);
    expect(runtime.selectedNodeIds()).toEqual(beforeSelection);
    expect(runtime.ledger.cursor).toBe(beforeRevision);
  });

  it("returns structured unsupported results without mutation", async () => {
    const { document, root } = createTestDocument('<div id="target">Target</div>');
    const target = root.querySelector("#target");
    if (!(target instanceof HTMLElement)) throw new Error("missing target");
    layoutManagedElement(target, { x: 0, y: 0, width: 80, height: 30 });
    const runtime = createEditorRuntime(document);
    const id = runtime.select(target);
    if (!id) throw new Error("target not adopted");
    const env = createOTFEnvironment(document, runtime);
    const result = await env.execute({ type: "resize", target: id });
    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_OPERATION" } });
    expect(runtime.ledger.cursor).toBe(0);
    expect(target.style.cssText).toBe("");
  });
});
