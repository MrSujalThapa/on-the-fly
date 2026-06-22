import { describe, expect, it } from "vitest";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import { scanVisualNodes } from "../../../src/editor/measurement/dom-scanner.js";
import { getMatchViewport } from "../../../src/editor/dom/signature-matcher.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutTree } from "../measurement/layout-helpers.js";

describe("VisualLayoutGraph", () => {
  it("wraps scanned nodes and supports graph queries", () => {
    const { document } = createTestDocument(
      `<main><section><p class="intro">Hello</p><button>Go</button></section></main>`,
    );
    layoutTree(document.body);

    const scanResult = scanVisualNodes(document);
    const graph = VisualLayoutGraph.fromScanResult(
      scanResult,
      getMatchViewport(document),
      Date.now(),
      1,
    );

    const paragraph = Array.from(graph.getNodes()).find((node) =>
      node.signature.classList.includes("intro"),
    );
    expect(paragraph).toBeDefined();

    if (!paragraph) {
      return;
    }

    expect(graph.getNodeById(paragraph.id)?.id).toBe(paragraph.id);
    expect(graph.findNearestParent(paragraph.id)?.signature.tagName).toBe("section");
    expect(graph.findNearestContainer(paragraph.id)?.signature.tagName).toBe("section");

    const hits = graph.findNodesInRect({
      x: paragraph.rect.x - 4,
      y: paragraph.rect.y - 4,
      width: paragraph.rect.width + 8,
      height: paragraph.rect.height + 8,
    });
    expect(hits.some((node) => node.id === paragraph.id)).toBe(true);
  });
});
