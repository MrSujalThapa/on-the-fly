import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { logSelectionDebug } from "../../src/editor/selection/selection-debug.js";
import { setDiagnosticsEnabled } from "../../src/shared/diagnostics.js";
import * as storageClient from "../../src/content/storage-client.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createStyleOperation } from "../editor/fixtures.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";

interface SinkEvent {
  message: string;
  data: unknown;
}

function captureSink(): SinkEvent[] {
  const events: SinkEvent[] = [];
  vi.spyOn(console, "debug").mockImplementation((first?: unknown, second?: unknown) => {
    if (typeof first === "string" && first.startsWith("[OTF] ")) {
      events.push({ message: first.slice("[OTF] ".length), data: second });
    }
  });
  return events;
}

function messages(events: SinkEvent[]): string[] {
  return events.map((event) => event.message);
}

function dispatchPointer(
  win: typeof globalThis,
  target: EventTarget,
  type: string,
  init: { clientX: number; clientY: number; buttons?: number },
): void {
  target.dispatchEvent(
    new win.PointerEvent(type, {
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

function styleOperationFor(cssPath: string, idAttr: string) {
  return createStyleOperation({
    target: {
      nodeId: `node-${idAttr}`,
      signature: {
        cssPath,
        tagName: "p",
        classList: [],
        idAttr,
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
    },
    payload: { property: "color", value: "rgb(255, 0, 0)" },
  });
}

describe("existing diagnostics reach the development sink", () => {
  beforeEach(() => {
    setDiagnosticsEnabled(true);
  });

  afterEach(() => {
    setDiagnosticsEnabled(false);
    vi.restoreAllMocks();
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
  });

  it("reports replay and target resolution for a saved operation", async () => {
    const { document } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([
      styleOperationFor("main p#copy", "copy"),
    ]);
    const events = captureSink();

    const controller = new PageCustomizationController(document);
    await controller.ensureReplayed(logSelectionDebug);

    expect(messages(events)).toEqual(
      expect.arrayContaining(["page-replay-target-wait", "page-replay-op", "page-replay"]),
    );

    const replayOp = events.find((event) => event.message === "page-replay-op")?.data as {
      resolved: boolean;
      signatureSummary: string;
    };
    expect(replayOp.resolved).toBe(true);
    expect(replayOp.signatureSummary).toContain("#copy");

    const replay = events.find((event) => event.message === "page-replay")?.data as {
      count: number;
      failed: number;
    };
    expect(replay.count).toBe(1);
    expect(replay.failed).toBe(0);
  });

  it("reports the skip path when a saved operation cannot resolve its target", async () => {
    const { document } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([
      styleOperationFor("main p#missing", "missing"),
    ]);
    const events = captureSink();

    const controller = new PageCustomizationController(document);
    await controller.ensureReplayed(logSelectionDebug);

    const replayOp = events.find((event) => event.message === "page-replay-op")?.data as {
      resolved: boolean;
      failureReason?: string;
    };
    expect(replayOp.resolved).toBe(false);
    expect(replayOp.failureReason).toBeTruthy();

    const replay = events.find((event) => event.message === "page-replay")?.data as {
      unresolved: number;
    };
    expect(replay.unresolved).toBe(1);
  });

  it("reports pointer, selection and operation-apply events during a drag", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><section id="card"><p id="copy">alpha copy</p></section></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const card = doc.querySelector("#card") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 400 });
    layoutElement(card, { x: 20, y: 20, width: 200, height: 100 });
    layoutElement(copy, { x: 30, y: 40, width: 150, height: 20 });

    doc.elementsFromPoint = vi.fn(() => [copy, card, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const events = captureSink();

    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 45, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 45, buttons: 0 });
    dispatchPointer(win, copy, "pointerdown", { clientX: 50, clientY: 50, buttons: 1 });
    dispatchPointer(win, copy, "pointermove", { clientX: 90, clientY: 90, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 90, clientY: 90, buttons: 0 });

    expect(messages(events)).toEqual(
      expect.arrayContaining([
        "pointerdown",
        "click-resolve",
        "transform-target",
        "transform-move-start",
        "move-strategy",
        "transform-move-commit",
      ]),
    );

    session.stop();
    shell.unmount();
  });

  it("emits nothing while diagnostics are disabled", async () => {
    setDiagnosticsEnabled(false);
    const { document } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([
      styleOperationFor("main p#copy", "copy"),
    ]);
    const events = captureSink();

    const controller = new PageCustomizationController(document);
    await controller.ensureReplayed(logSelectionDebug);

    expect(events).toEqual([]);
  });
});
