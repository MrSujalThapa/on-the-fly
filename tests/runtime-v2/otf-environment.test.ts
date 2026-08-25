import { describe, expect, it } from "vitest";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { OTFEnvironmentError } from "../../src/runtime-v2/environment/environment-errors.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutManagedElement } from "../editor/measurement/layout-helpers.js";

function patchRects(document: Document): void {
  const view = document.defaultView as Window & { HTMLElement: typeof HTMLElement };
  view.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const x = Number.parseFloat(this.style.left) || 0;
    const y = Number.parseFloat(this.style.top) || 0;
    const width = Number.parseFloat(this.style.width) || Number.parseFloat(this.style.minWidth) || 80;
    const height = Number.parseFloat(this.style.height) || Number.parseFloat(this.style.minHeight) || 24;
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) };
  };
}

function requireId(value: string | null | undefined): string {
  expect(value).toBeTruthy();
  if (!value) throw new Error("missing_id");
  return value;
}

describe("OTFEnvironment v1", () => {
  it("read methods observe without dirtying ledger, selection, or DOM", async () => {
    const { document, root } = createTestDocument(`<button id="a" role="button">Mentions</button>`);
    const target = root.querySelector("#a") as HTMLElement;
    layoutManagedElement(target, { x: 10, y: 10, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const id = requireId(runtime.select(target));
    const env = runtime.environment;
    const before = { cursor: runtime.ledger.cursor, dirty: runtime.ledger.isDirty(), html: target.outerHTML, selection: [...runtime.selectedNodeIds()] };
    const observation = await env.observe({ scope: "selection" });
    const inspected = await env.inspectElement(id);
    const found = await env.findElements({ text: "Mentions" });
    await env.getGeometry(id);
    await env.getComputedStyles(id);
    await env.getSessionState();
    await env.getChanges();
    expect(observation.selection).toEqual([id]);
    expect(inspected.origin).toBe("host");
    expect(found).toContain(id);
    expect(runtime.ledger.cursor).toBe(before.cursor);
    expect(runtime.ledger.isDirty()).toBe(before.dirty);
    expect(target.outerHTML).toBe(before.html);
    expect([...runtime.selectedNodeIds()]).toEqual(before.selection);
    runtime.stop();
  });

  it("maps ElementId to VisualModel and preserves created identity", async () => {
    const { document } = createTestDocument("");
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const created = await runtime.environment.execute({
      type: "create",
      kind: "rectangle",
      rect: { x: 8, y: 8, width: 120, height: 40 },
    });
    expect(created.ok).toBe(true);
    const id = requireId(created.target);
    expect(runtime.visualModel.get(id)).not.toBeNull();
    expect(runtime.visualModel.bind(id)?.getAttribute("data-otf-element-id")).toBe(id);
    expect((await runtime.environment.inspectElement(id)).origin).toBe("created");
    runtime.stop();
  });

  it.each([
    { name: "unresolved", id: "otf-vn-missing", code: "ELEMENT_NOT_FOUND" },
  ] as const)("returns structured $code without silent retargeting ($name)", async ({ id, code }) => {
    const { document, root } = createTestDocument(`<button id="a">Mentions</button><button id="b">My posts</button>`);
    layoutManagedElement(root.querySelector("#a") as HTMLElement, { x: 10, y: 10, width: 80, height: 24 });
    layoutManagedElement(root.querySelector("#b") as HTMLElement, { x: 100, y: 10, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const postsLeft = (root.querySelector("#b") as HTMLElement).getBoundingClientRect().x;
    const result = await runtime.environment.execute({ type: "move", target: id, delta: { x: 40, y: 0 } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(code);
    expect((root.querySelector("#b") as HTMLElement).getBoundingClientRect().x).toBe(postsLeft);
    runtime.stop();
  });

  it("execute uses the shared ledger so UI undo and checkpoint rollback agree", async () => {
    const { document, root } = createTestDocument(`<button id="a">Mentions</button>`);
    const target = root.querySelector("#a") as HTMLElement;
    layoutManagedElement(target, { x: 10, y: 10, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const id = requireId(runtime.select(target));
    const env = runtime.environment;
    const checkpoint = await env.checkpoint("before");
    const ui = runtime.move(id, 12, 0);
    expect(ui.ok).toBe(true);
    const cursorAfterUi = runtime.ledger.cursor;
    runtime.undo();
    const viaEnv = await env.execute({ type: "move", target: id, delta: { x: 12, y: 0 } });
    expect(viaEnv.ok).toBe(true);
    expect(runtime.ledger.cursor).toBe(cursorAfterUi);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.ledger.cursor).toBe(0);
    const styled = await env.execute({ type: "style", target: id, property: "backgroundColor", value: "rgb(255, 0, 0)" });
    expect(styled.ok).toBe(true);
    const rolled = await env.rollback(checkpoint);
    expect(rolled.ok).toBe(true);
    expect(runtime.ledger.cursor).toBe(0);
    expect(await env.getChanges()).toEqual([]);
    runtime.stop();
  });

  it("UI move and environment move produce equivalent committed geometry", async () => {
    const { document, root } = createTestDocument(`<button id="a">Mentions</button><button id="b">Copy</button>`);
    const a = root.querySelector("#a") as HTMLElement;
    const b = root.querySelector("#b") as HTMLElement;
    layoutManagedElement(a, { x: 10, y: 10, width: 80, height: 24 });
    layoutManagedElement(b, { x: 10, y: 50, width: 80, height: 24 });
    patchRects(document);
    const runtime = createEditorRuntime(document);
    runtime.start();
    const idA = requireId(runtime.select(a));
    expect(runtime.move(idA, 20, 8).ok).toBe(true);
    const afterUi = a.getBoundingClientRect();
    const idB = requireId(runtime.select(b));
    const envMove = await runtime.environment.execute({ type: "move", target: idB, delta: { x: 20, y: 8 } });
    expect(envMove.ok).toBe(true);
    const afterEnv = b.getBoundingClientRect();
    expect(afterEnv.x - 10).toBe(afterUi.x - 10);
    expect(afterEnv.y - 50).toBe(afterUi.y - 10);
    runtime.stop();
  });
});

describe("OTFEnvironment query errors", () => {
  it("fails explicitly for unsupported find fields", async () => {
    const { document } = createTestDocument(`<p>Hi</p>`);
    const runtime = createEditorRuntime(document);
    runtime.start();
    await expect(runtime.environment.findElements({ xpath: "//p" } as never)).rejects.toBeInstanceOf(OTFEnvironmentError);
    runtime.stop();
  });
});
