import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import {
  OTF_MESSAGE,
  OTF_STORAGE_MESSAGE,
} from "../../src/shared/messages.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, "..", "..");

function installPopupDom(): Document {
  const html = readFileSync(join(rootDir, "src", "popup", "popup.html"), "utf8");
  const window = new Window({ innerWidth: 300, innerHeight: 250 });
  window.document.write(html);
  return window.document as unknown as Document;
}

async function flushPopupInit(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("popup interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn((message: { type: string; tabId?: number; enabled?: boolean }) => {
          if (message.type === OTF_MESSAGE.GET_EDIT_MODE) {
            return Promise.resolve({ ok: true, enabled: false, status: "inactive" });
          }
          if (message.type === OTF_MESSAGE.SET_EDIT_MODE) {
            return Promise.resolve({
              ok: true,
              enabled: message.enabled === true,
              status: message.enabled ? "active" : "inactive",
            });
          }
          if (message.type === OTF_MESSAGE.GET_SETTINGS) {
            return Promise.resolve({
              ok: true,
              settings: {},
              diagnostics: { agentEnabled: false },
            });
          }
          if (message.type === OTF_STORAGE_MESSAGE.GET_PAGE_OPERATION_COUNT) {
            return Promise.resolve({ ok: true, operationCount: 2 });
          }
          return Promise.resolve({ ok: false });
        }),
        openOptionsPage: vi.fn(() => Promise.resolve()),
      },
      tabs: {
        query: vi.fn(() => Promise.resolve([{ id: 42, url: "https://example.com/page" }])),
        sendMessage: vi.fn(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads popup logic and wires edit mode toggle", async () => {
    const document = installPopupDom();
    vi.stubGlobal("document", document);

    await import("../../src/popup/popup.js");
    await flushPopupInit();

    const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-button");
    expect(toggleButton?.disabled).toBe(false);
    expect(toggleButton?.querySelector("span")?.textContent).toBe("Enable editor");

    toggleButton?.click();
    await flushPopupInit();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: OTF_MESSAGE.SET_EDIT_MODE,
        enabled: true,
        tabId: 42,
      }),
    );
    expect(document.querySelector("#popup-root")?.getAttribute("data-state")).toBe("active");
    expect(toggleButton?.querySelector("span")?.textContent).toBe("Disable editor");
  });

  it("wires clear page and settings controls", async () => {
    const document = installPopupDom();
    vi.stubGlobal("document", document);

    await import("../../src/popup/popup.js");
    await flushPopupInit();

    const clearButton = document.querySelector<HTMLButtonElement>("#clear-page");
    expect(clearButton?.disabled).toBe(false);

    clearButton?.click();
    await flushPopupInit();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ type: OTF_MESSAGE.CLEAR_PAGE_REQUEST }),
    );

    document.querySelector<HTMLButtonElement>("#open-options")?.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
