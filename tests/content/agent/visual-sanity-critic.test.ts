import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { runVisualSanityCritic } from "../../../src/content/agent/visual-sanity-critic.js";
import { createInsertHelperObjectOperation, createTestSignature } from "../../editor/fixtures.js";
import { createTestDocument } from "../../editor/dom/test-document.js";
import { OTF_HELPER_ATTR } from "../../../src/editor/dom/types.js";

describe("runVisualSanityCritic", () => {
  it("flags offscreen helper objects as hard failures", () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const adapter = new DomRuntimeAdapter(document);
    const operation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        helperId: "offscreen-helper",
        rect: { x: -8450, y: 0, width: 17000, height: 100 },
        zIndex: 2,
      },
      target: {
        nodeId: "offscreen-helper",
        signature: createTestSignature({
          cssPath: "#otf-helper-offscreen-helper",
          tagName: "div",
          idAttr: "otf-helper-offscreen-helper",
        }),
      },
    });

    adapter.replayOperations([operation]);

    const result = runVisualSanityCritic({
      document,
      operations: [operation],
      selectionBounds: { x: 0, y: 0, width: 100, height: 24 },
      selectedElements: [copy],
      viewport: { width: 1024, height: 768 },
    });

    expect(result.hardFailures.join(" ")).toMatch(/offscreen|layout damage/);
    expect(document.querySelector(`[${OTF_HELPER_ATTR}]`)).not.toBeNull();
  });

  it("flags extreme z-index and shadow values as warnings", () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const adapter = new DomRuntimeAdapter(document);
    const operation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        helperId: "heavy-helper",
        rect: { x: 0, y: 0, width: 140, height: 80 },
        zIndex: 1500,
        boxShadow: {
          offsetX: 0,
          offsetY: 0,
          blurRadius: 120,
          spreadRadius: 0,
          color: "rgba(0, 0, 0, 0.4)",
        },
      },
    });

    adapter.replayOperations([operation]);

    const result = runVisualSanityCritic({
      document,
      operations: [operation],
      selectionBounds: { x: 0, y: 0, width: 100, height: 24 },
      selectedElements: [copy],
      viewport: { width: 1024, height: 768 },
    });

    expect(result.hardFailures).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/z-index|shadow blur/);
  });

  it("flags helper objects far from selected bounds", () => {
    const result = runVisualSanityCritic({
      document: createTestDocument(`<main></main>`).document,
      operations: [
        createInsertHelperObjectOperation({
          source: "agent",
          status: "preview",
          payload: {
            ...createInsertHelperObjectOperation().payload,
            rect: { x: 900, y: 900, width: 120, height: 80 },
          },
        }),
      ],
      selectionBounds: { x: 0, y: 0, width: 100, height: 24 },
      selectedElements: [],
      viewport: { width: 1024, height: 768 },
    });

    expect(result.warnings.join(" ") + result.hardFailures.join(" ")).toMatch(
      /far from the selected bounds|outside the selected area/,
    );
  });

  it("allows a normal helper panel behind the selected area", () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const adapter = new DomRuntimeAdapter(document);
    const operation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
      payload: {
        ...createInsertHelperObjectOperation().payload,
        helperId: "normal-helper",
        rect: { x: 0, y: 0, width: 140, height: 80 },
        zIndex: 1,
        opacity: 0.9,
      },
    });

    adapter.replayOperations([operation]);

    const result = runVisualSanityCritic({
      document,
      operations: [operation],
      selectionBounds: { x: 0, y: 0, width: 100, height: 24 },
      selectedElements: [copy],
      viewport: { width: 1024, height: 768 },
    });

    expect(result.hardFailures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
