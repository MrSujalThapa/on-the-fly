import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { createPageIdentity, computeDocumentPageKey } from "../../src/content/page-identity.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createEditSession, type EditSession } from "../../src/content/edit-session.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import * as storageClient from "../../src/content/storage-client.js";
import type { EditorOperation } from "../../src/editor/operations.js";
import { createStyleOperation } from "../editor/fixtures.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";

function createDocumentAt(url: string, html: string): Document {
  const window = new Window({ url, innerWidth: 1024, innerHeight: 768 });
  const document = window.document as unknown as Document;
  document.body.innerHTML = html;
  return document;
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: { clientX: number; clientY: number; buttons?: number },
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
      buttons: init.buttons ?? 0,
      pointerId: 1,
      clientX: init.clientX,
      clientY: init.clientY,
    }),
  );
}

function mockPageStore() {
  const store = new Map<string, EditorOperation[]>();
  vi.spyOn(storageClient, "loadPageOperations").mockImplementation((pageKey) => {
    return Promise.resolve([...(store.get(pageKey) ?? [])]);
  });
  vi.spyOn(storageClient, "replacePageOperations").mockImplementation((pageKey, operations) => {
    store.set(pageKey, [...operations]);
    return Promise.resolve({ ok: true, operationCount: operations.length });
  });
  return store;
}

function styleOp(pageKey: string, value: string): EditorOperation {
  return createStyleOperation({
    id: `style-${pageKey}-${value}`,
    pageKey,
    payload: { property: "color", value },
  });
}

describe("page identity", () => {
  const controllers: PageCustomizationController[] = [];
  const identities: Array<{ dispose: () => void }> = [];
  const sessions: EditSession[] = [];
  const shells: EditorShell[] = [];

  afterEach(() => {
    for (const session of sessions.splice(0)) {
      session.stop();
    }
    for (const shell of shells.splice(0)) {
      shell.unmount();
    }
    for (const controller of controllers.splice(0)) {
      controller.dispose();
    }
    for (const identity of identities.splice(0)) {
      identity.dispose();
    }
    vi.restoreAllMocks();
  });

  it("notifies on pushState, replaceState, and popstate pathname changes", () => {
    const document = createDocumentAt("https://example.com/page-a", "<main></main>");
    const identity = createPageIdentity(document);
    identities.push(identity);
    const changes: Array<{ next: string; previous: string }> = [];
    identity.subscribe((next, previous) => {
      changes.push({ next, previous });
    });

    expect(identity.current()).toBe("https://example.com/page-a");
    expect(computeDocumentPageKey(document)).toBe("https://example.com/page-a");

    document.defaultView?.history.pushState({}, "", "/page-a?x=1");
    expect(identity.current()).toBe("https://example.com/page-a");
    expect(changes).toEqual([]);

    document.defaultView?.history.pushState({}, "", "/page-b");
    expect(identity.current()).toBe("https://example.com/page-b");
    expect(changes).toEqual([
      { next: "https://example.com/page-b", previous: "https://example.com/page-a" },
    ]);

    document.defaultView?.history.replaceState({}, "", "/page-c");
    expect(identity.current()).toBe("https://example.com/page-c");
    expect(changes.at(-1)).toEqual({
      next: "https://example.com/page-c",
      previous: "https://example.com/page-b",
    });

    document.defaultView?.history.pushState({}, "", "/page-a");
    document.defaultView?.history.back();
    expect(identity.current()).toBe("https://example.com/page-c");
  });

  it("scopes saved operations to the route that produced them", async () => {
    const store = mockPageStore();
    const document = createDocumentAt("https://example.com/page-a", "<main></main>");
    const controller = new PageCustomizationController(document);
    controllers.push(controller);
    await controller.ensureReplayed();

    const pageAKey = "https://example.com/page-a";
    const pageBKey = "https://example.com/page-b";
    const pageAOp = styleOp(pageAKey, "rgb(255, 0, 0)");
    controller.setPageOperations([pageAOp]);
    await controller.syncOperationsToStorage();

    expect(store.get(pageAKey)?.map((operation) => operation.id)).toEqual([pageAOp.id]);
    expect(store.has(pageBKey)).toBe(false);

    document.defaultView?.history.pushState({}, "", "/page-b");
    await controller.whenPageKeySettled();
    expect(controller.getPageKey()).toBe(pageBKey);
    expect(controller.getPageOperations()).toEqual([]);

    const pageBOp = styleOp(pageBKey, "rgb(0, 0, 255)");
    controller.setPageOperations([pageBOp]);
    await controller.syncOperationsToStorage();

    expect(store.get(pageAKey)?.map((operation) => operation.id)).toEqual([pageAOp.id]);
    expect(store.get(pageBKey)?.map((operation) => operation.id)).toEqual([pageBOp.id]);

    document.defaultView?.history.pushState({}, "", "/page-a");
    await controller.whenPageKeySettled();
    expect(controller.getPageKey()).toBe(pageAKey);
    expect(controller.getPageOperations().map((operation) => operation.id)).toEqual([pageAOp.id]);

    const reloadedA = new PageCustomizationController(
      createDocumentAt("https://example.com/page-a", "<main></main>"),
    );
    controllers.push(reloadedA);
    await reloadedA.ensureReplayed();
    expect(reloadedA.getPageOperations().map((operation) => operation.id)).toEqual([pageAOp.id]);

    const reloadedB = new PageCustomizationController(
      createDocumentAt("https://example.com/page-b", "<main></main>"),
    );
    controllers.push(reloadedB);
    await reloadedB.ensureReplayed();
    expect(reloadedB.getPageOperations().map((operation) => operation.id)).toEqual([pageBOp.id]);
  });

  it("flushes unsaved drafts to the previous route instead of dropping them", async () => {
    const store = mockPageStore();
    const document = createDocumentAt(
      "https://example.com/page-a",
      `<main><p id="copy">Hello</p></main>`,
    );
    const copy = document.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    document.elementsFromPoint = () => [copy, document.body, document.documentElement];

    const controller = new PageCustomizationController(document);
    controllers.push(controller);
    await controller.ensureReplayed();

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    shells.push(shell);
    const session = createEditSession({ shell, root: document, pageCustomization: controller });
    sessions.push(session);
    await session.start();

    dispatchPointer(copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");
    expect(session.hasUnsavedChanges()).toBe(true);

    document.defaultView?.history.pushState({}, "", "/page-b");
    await controller.whenPageKeySettled();

    expect(controller.getPageKey()).toBe("https://example.com/page-b");
    expect(session.hasUnsavedChanges()).toBe(false);
    const flushed = store.get("https://example.com/page-a") ?? [];
    expect(flushed.length).toBeGreaterThan(0);
    expect(flushed.every((operation) => operation.pageKey === "https://example.com/page-a")).toBe(
      true,
    );
    expect(store.get("https://example.com/page-b") ?? []).toEqual([]);
  });

  it("keeps session edits scoped after save, SPA navigation, and reload", async () => {
    const store = mockPageStore();
    const document = createDocumentAt(
      "https://example.com/page-a",
      `<main><p id="copy">Hello</p></main>`,
    );
    const copy = document.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    document.elementsFromPoint = () => [copy, document.body, document.documentElement];

    const controller = new PageCustomizationController(document);
    controllers.push(controller);
    await controller.ensureReplayed();

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    shells.push(shell);
    const session = createEditSession({ shell, root: document, pageCustomization: controller });
    sessions.push(session);
    await session.start();

    dispatchPointer(copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");
    expect(await session.saveAll()).toBe(true);

    document.defaultView?.history.pushState({}, "", "/page-b");
    await controller.whenPageKeySettled();
    expect(controller.getPageKey()).toBe("https://example.com/page-b");
    expect(session.hasUnsavedChanges()).toBe(false);
    expect(controller.getPageOperations()).toEqual([]);

    dispatchPointer(copy, "pointerdown", { clientX: 40, clientY: 18, buttons: 1 });
    dispatchPointer(copy, "pointerup", { clientX: 40, clientY: 18, buttons: 0 });
    session.applyStyle("color", "rgb(0, 0, 255)");
    expect(await session.saveAll()).toBe(true);

    const pageA = store.get("https://example.com/page-a") ?? [];
    const pageB = store.get("https://example.com/page-b") ?? [];
    expect(pageA.length).toBeGreaterThan(0);
    expect(pageB.length).toBeGreaterThan(0);
    expect(pageA.every((operation) => operation.pageKey === "https://example.com/page-a")).toBe(true);
    expect(pageB.every((operation) => operation.pageKey === "https://example.com/page-b")).toBe(true);
    expect(pageA.some((operation) => operation.type === "style")).toBe(true);
    expect(pageB.some((operation) => operation.type === "style")).toBe(true);

    document.defaultView?.history.pushState({}, "", "/page-a");
    await controller.whenPageKeySettled();
    expect(controller.getPageOperations().map((operation) => operation.id).sort()).toEqual(
      pageA.map((operation) => operation.id).sort(),
    );
  });

  it("refuses to persist operations stamped for a different page key", async () => {
    const replace = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    const document = createDocumentAt("https://example.com/page-a", "<main></main>");
    const controller = new PageCustomizationController(document);
    controllers.push(controller);

    const foreign = createStyleOperation({ pageKey: "https://example.com/other" });
    controller.setPageOperations([foreign]);
    const result = await controller.syncOperationsToStorage();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("page_key_mismatch");
    expect(replace).not.toHaveBeenCalled();
  });
});
