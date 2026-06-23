import { describe, expect, it, vi } from "vitest";
import { createStyleTextController } from "../../src/content/style-text-controller.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createTestSignature } from "../editor/fixtures.js";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";

describe("StyleTextController", () => {
  it("applies style operations and notifies onApply", () => {
    const { document, root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const element = root.querySelector("p.intro") as HTMLElement;
    const onApply = vi.fn();

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-1",
        signature: createTestSignature({ cssPath: "main p.intro" }),
        rect: { x: 0, y: 0, width: 100, height: 20 },
        element,
      }],
      resolveTextTarget: () => null,
      onApply,
    });

    const applied = controller.applyStyle("backgroundColor", "rgb(255, 0, 0)");
    expect(applied).toHaveLength(1);
    expect(element.style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(onApply).toHaveBeenCalledWith(applied);
  });

  it("applies text operations while preserving leaf formatting contract", () => {
    const { document, root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const element = root.querySelector("p.intro") as HTMLElement;
    const target = {
      nodeId: "node-1",
      signature: createTestSignature({ cssPath: "main p.intro" }),
      rect: { x: 0, y: 0, width: 100, height: 20 },
      element,
    };

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [target],
      resolveTextTarget: () => target,
    });

    const applied = controller.applyText("Updated copy");
    expect(applied).toHaveLength(1);
    expect(applied[0]?.type).toBe("text");
    if (applied[0]?.type === "text") {
      expect(applied[0].payload.preserveFormat).toBe(true);
    }
    expect(element.textContent).toBe("Updated copy");
  });

  it("applies text operations to promoted blocks with inline children", () => {
    const { document, root } = createTestDocument(
      `<main><p id="note">Someone at <a>Radical Ventures</a> viewed your profile.</p></main>`,
    );
    const element = root.querySelector("#note") as HTMLElement;
    const target = {
      nodeId: "node-1",
      signature: createTestSignature({ cssPath: "main p#note" }),
      rect: { x: 0, y: 0, width: 240, height: 20 },
      element,
    };

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [target],
      resolveTextTarget: () => target,
    });

    const applied = controller.applyText("Updated notification text");
    expect(applied).toHaveLength(1);
    expect(element.textContent).toBe("Updated notification text");
  });

  it("applies text color to descendants inside a container selection", () => {
    const { document, root } = createTestDocument(`
      <main><div id="card"><span id="title">Title</span><span id="body">Body</span></div></main>
    `);
    const card = root.querySelector("#card") as HTMLElement;
    const title = root.querySelector("#title") as HTMLElement;
    const body = root.querySelector("#body") as HTMLElement;

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-card",
        signature: createTestSignature({ cssPath: "main div#card" }),
        rect: { x: 0, y: 0, width: 100, height: 40 },
        element: card,
      }],
      resolveTextTarget: () => null,
    });

    const applied = controller.applyStyle("color", "rgb(255, 0, 0)");
    expect(applied.length).toBe(2);
    expect(title.style.color).toBe("rgb(255, 0, 0)");
    expect(body.style.color).toBe("rgb(255, 0, 0)");
  });

  it("applies text color to a container's own text and nested spans/links", () => {
    const { document, root } = createTestDocument(
      `<main><p id="note">Canada hasn't sold out a single World Cup match yet. <a id="link">See the latest.</a></p></main>`,
    );
    const note = root.querySelector("#note") as HTMLElement;
    const link = root.querySelector("#link") as HTMLElement;

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-note",
        signature: createTestSignature({ cssPath: "main p#note" }),
        rect: { x: 0, y: 0, width: 320, height: 20 },
        element: note,
      }],
      resolveTextTarget: () => null,
    });

    const applied = controller.applyStyle("color", "rgb(255, 0, 0)");
    expect(applied.length).toBe(2);
    expect(note.style.color).toBe("rgb(255, 0, 0)");
    expect(link.style.color).toBe("rgb(255, 0, 0)");
  });

  it("restores previous inline descendant colors on undo and re-applies on redo", () => {
    const { document, root } = createTestDocument(
      `<main><div id="card"><span id="title" style="color: rgb(0, 0, 255)">Title</span><span id="body" style="color: rgb(0, 128, 0)">Body</span></div></main>`,
    );
    const card = root.querySelector("#card") as HTMLElement;
    const title = root.querySelector("#title") as HTMLElement;
    const body = root.querySelector("#body") as HTMLElement;
    const adapter = new DomRuntimeAdapter(root);

    const controller = createStyleTextController({
      document,
      adapter,
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-card",
        signature: createTestSignature({ cssPath: "main div#card" }),
        rect: { x: 0, y: 0, width: 100, height: 40 },
        element: card,
      }],
      resolveTextTarget: () => null,
    });

    const applied = controller.applyStyle("color", "rgb(255, 0, 0)");
    expect(applied.length).toBe(2);
    expect(title.style.color).toBe("rgb(255, 0, 0)");
    expect(body.style.color).toBe("rgb(255, 0, 0)");

    for (const operation of [...applied].reverse()) {
      expect(adapter.revertOperation(operation).ok).toBe(true);
    }
    expect(title.style.color).toBe("rgb(0, 0, 255)");
    expect(body.style.color).toBe("rgb(0, 128, 0)");

    for (const operation of applied) {
      expect(adapter.applyOperation(operation, null).ok).toBe(true);
    }
    expect(title.style.color).toBe("rgb(255, 0, 0)");
    expect(body.style.color).toBe("rgb(255, 0, 0)");
  });

  it("applies background to the selected container surface, not descendant text", () => {
    const { document, root } = createTestDocument(`
      <main><div id="card"><span id="title">Title</span><span id="body">Body</span></div></main>
    `);
    const card = root.querySelector("#card") as HTMLElement;
    const title = root.querySelector("#title") as HTMLElement;
    const body = root.querySelector("#body") as HTMLElement;

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-card",
        signature: createTestSignature({ cssPath: "main div#card" }),
        rect: { x: 0, y: 0, width: 100, height: 40 },
        element: card,
      }],
      resolveTextTarget: () => null,
    });

    const applied = controller.applyStyle("backgroundColor", "rgb(0, 128, 255)");
    expect(applied.length).toBe(1);
    expect(card.style.backgroundColor).toBe("rgb(0, 128, 255)");
    expect(title.style.backgroundColor).toBe("");
    expect(body.style.backgroundColor).toBe("");
  });

  it("applies helper-friendly shadow and gradient style operations", () => {
    const { document, root } = createTestDocument(`<main><div id="panel">Panel</div></main>`);
    const panel = root.querySelector("#panel") as HTMLElement;

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-panel",
        signature: createTestSignature({ cssPath: "main div#panel" }),
        rect: { x: 0, y: 0, width: 100, height: 40 },
        element: panel,
      }],
      resolveTextTarget: () => null,
    });

    const shadow = controller.applyStyle("boxShadow", "0px 8px 24px rgba(0, 0, 0, 0.2)");
    const gradient = controller.applyStyle(
      "backgroundImage",
      "linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)",
    );

    expect(shadow).toHaveLength(1);
    expect(gradient).toHaveLength(1);
    expect(panel.style.boxShadow).toBe("0px 8px 24px rgba(0, 0, 0, 0.2)");
    expect(panel.style.backgroundImage).toContain("linear-gradient");
  });

  it("applies background to each group member surface", () => {
    const { document, root } = createTestDocument(`
      <main><div id="card-a">A</div><div id="card-b">B</div></main>
    `);
    const cardA = root.querySelector("#card-a") as HTMLElement;
    const cardB = root.querySelector("#card-b") as HTMLElement;

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [
        {
          nodeId: "node-a",
          signature: createTestSignature({ cssPath: "main div#card-a" }),
          rect: { x: 0, y: 0, width: 100, height: 40 },
          element: cardA,
        },
        {
          nodeId: "node-b",
          signature: createTestSignature({ cssPath: "main div#card-b" }),
          rect: { x: 0, y: 0, width: 100, height: 40 },
          element: cardB,
        },
      ],
      resolveTextTarget: () => null,
    });

    const applied = controller.applyStyle("backgroundColor", "rgb(12, 34, 56)");
    expect(applied.length).toBe(2);
    expect(cardA.style.backgroundColor).toBe("rgb(12, 34, 56)");
    expect(cardB.style.backgroundColor).toBe("rgb(12, 34, 56)");
  });

  it("ignores empty opacity input and clamps valid values", () => {
    const { document, root } = createTestDocument(`<main><div id="card">Card</div></main>`);
    const card = root.querySelector("#card") as HTMLElement;

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-card",
        signature: createTestSignature({ cssPath: "main div#card" }),
        rect: { x: 0, y: 0, width: 100, height: 40 },
        element: card,
      }],
      resolveTextTarget: () => null,
    });

    expect(controller.applyStyle("opacity", "")).toEqual([]);
    expect(card.style.opacity).toBe("");

    const applied = controller.applyStyle("opacity", "0.5");
    expect(applied).toHaveLength(1);
    expect(card.style.opacity).toBe("0.5");

    const clamped = controller.applyStyle("opacity", "2");
    expect(clamped).toHaveLength(1);
    expect(card.style.opacity).toBe("1");
  });
});
