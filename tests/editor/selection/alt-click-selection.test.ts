import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { buildAltClickChain } from "../../../src/editor/selection/dom-target-matching.js";
import { resolveClickSelection } from "../../../src/editor/selection/selection-resolver.js";
import { createSelectionController } from "../../../src/editor/selection/selection-controller.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";

function createEmptyGraph(): VisualLayoutGraph {
  return VisualLayoutGraph.fromScanResult(
    { nodes: new Map(), rootNodeIds: [] },
    { width: 1024, height: 768 },
    1,
    1,
  );
}

/**
 * Builds a linked ad card: an anchor wrapping a heading and an image, mirroring
 * the real-world case where clicking the title/image selects the parent link.
 */
function createLinkedAdDocument(): {
  document: Document;
  anchor: HTMLAnchorElement;
  heading: HTMLElement;
  image: HTMLElement;
} {
  const window = new Window({ innerWidth: 1024, innerHeight: 768 });
  const document = window.document as unknown as Document;
  document.body.innerHTML = `
    <main>
      <a id="ad" class="ad-link" href="https://ads.example.com">
        <h4 class="ad-title">Sponsored title</h4>
        <img class="ad-image" alt="ad" src="x.png" />
      </a>
    </main>
  `;

  return {
    document,
    anchor: document.querySelector("#ad") as HTMLAnchorElement,
    heading: document.querySelector(".ad-title") as HTMLElement,
    image: document.querySelector(".ad-image") as HTMLElement,
  };
}

describe("alt-click child selection", () => {
  it("builds a deepest-child-first chain from a nested anchor", () => {
    const graph = createEmptyGraph();
    const { document, anchor, heading } = createLinkedAdDocument();
    const main = document.querySelector("main") as HTMLElement;
    const path = [heading, anchor, main, document.body];

    const chain = buildAltClickChain(graph, 50, 50, path, document);

    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain[0]?.signature.tagName).toBe("h4");
    expect(chain[1]?.signature.tagName).toBe("a");
  });

  it("selects the child heading instead of the parent link on alt-click", () => {
    const graph = createEmptyGraph();
    const { document, anchor, heading } = createLinkedAdDocument();
    const main = document.querySelector("main") as HTMLElement;
    const path = [heading, anchor, main, document.body];

    const result = resolveClickSelection(graph, 50, 50, false, undefined, path, {
      document,
      altKey: true,
      altCycleIndex: 0,
    });

    expect(result.resolvedNodes[0]?.signature.tagName).toBe("h4");
    expect(result.selection.source).toBe("click");
  });

  it("selects the child image instead of the parent link on alt-click", () => {
    const graph = createEmptyGraph();
    const { document, anchor, image } = createLinkedAdDocument();
    const main = document.querySelector("main") as HTMLElement;
    const path = [image, anchor, main, document.body];

    const result = resolveClickSelection(graph, 80, 80, false, undefined, path, {
      document,
      altKey: true,
      altCycleIndex: 0,
    });

    expect(result.resolvedNodes[0]?.signature.tagName).toBe("img");
    expect(result.resolvedNodes[0]?.kind).toBe("image");
  });

  it("selects a linked image on regular click without resolving to the anchor", () => {
    const graph = createEmptyGraph();
    const { document, anchor, image } = createLinkedAdDocument();
    const main = document.querySelector("main") as HTMLElement;
    const path = [image, anchor, main, document.body];
    document.elementsFromPoint = () => [image, anchor, main, document.body, document.documentElement];

    const result = resolveClickSelection(graph, 80, 80, false, undefined, path, {
      document,
    });

    expect(result.resolvedNodes[0]?.signature.tagName).toBe("img");
    expect(result.resolvedNodes[0]?.kind).toBe("image");
  });

  it("cycles child → parent link → container on repeated alt-click", () => {
    const graph = createEmptyGraph();
    const { document, anchor, heading } = createLinkedAdDocument();
    const main = document.querySelector("main") as HTMLElement;
    const path = [heading, anchor, main, document.body];

    const controller = createSelectionController({
      getGraph: () => graph,
      getDocument: () => document,
    });

    const first = controller.handlePointerClick(50, 50, false, path, true);
    expect(first.resolvedNodes[0]?.signature.tagName).toBe("h4");

    const second = controller.handlePointerClick(50, 50, false, path, true);
    expect(second.resolvedNodes[0]?.signature.tagName).toBe("a");

    const third = controller.handlePointerClick(50, 50, false, path, true);
    expect(third.resolvedNodes[0]?.signature.tagName).toBe("main");

    // Wraps back to the deepest child.
    const fourth = controller.handlePointerClick(50, 50, false, path, true);
    expect(fourth.resolvedNodes[0]?.signature.tagName).toBe("h4");
  });

  it("resets the cycle when alt-clicking elsewhere", () => {
    const graph = createEmptyGraph();
    const { document, anchor, heading } = createLinkedAdDocument();
    const main = document.querySelector("main") as HTMLElement;
    const path = [heading, anchor, main, document.body];

    const controller = createSelectionController({
      getGraph: () => graph,
      getDocument: () => document,
    });

    controller.handlePointerClick(50, 50, false, path, true);
    controller.handlePointerClick(50, 50, false, path, true);
    // Far away → cycle resets to the deepest child.
    const reset = controller.handlePointerClick(400, 400, false, path, true);
    expect(reset.resolvedNodes[0]?.signature.tagName).toBe("h4");
  });
});
