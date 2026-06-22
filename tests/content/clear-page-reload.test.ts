import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import * as storageClient from "../../src/content/storage-client.js";
import { createTestDocument } from "../editor/dom/test-document.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clear page hard reload", () => {
  it("deletes persisted operations before triggering a reload", async () => {
    const { document } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const view = document.defaultView;
    if (!view) {
      throw new Error("missing window");
    }

    const order: string[] = [];
    vi.spyOn(storageClient, "clearPageOperations").mockImplementation(async () => {
      order.push("delete");
      return true;
    });
    const reloadSpy = vi.spyOn(view.location, "reload").mockImplementation(() => {
      order.push("reload");
    });

    const controller = new PageCustomizationController(document);
    const reloaded = await controller.clearPage();

    expect(reloaded).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // Persisted deletion must complete before the reload is requested.
    expect(order).toEqual(["delete", "reload"]);
  });

  it("does not reload when persisted deletion fails", async () => {
    const { document } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const view = document.defaultView;
    if (!view) {
      throw new Error("missing window");
    }

    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(false);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reloadSpy = vi.spyOn(view.location, "reload").mockImplementation(() => undefined);

    const controller = new PageCustomizationController(document);
    const reloaded = await controller.clearPage();

    expect(reloaded).toBe(false);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
