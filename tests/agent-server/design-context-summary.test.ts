import { describe, expect, it } from "vitest";
import { buildCompactDesignContext } from "../../agent-server/src/design-context-summary.js";
import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";

describe("buildCompactDesignContext", () => {
  it("omits cssPath, classList, and verbose signatures", () => {
    const request: AgentEditRequest = {
      pageKey: "https://example.com/",
      instruction: "Make premium",
      selection: { selectedNodeIds: ["node-1"], source: "click" },
      selectedNodes: [
        {
          id: "node-1",
          kind: "container",
          signature: {
            cssPath: "html body main section:nth-child(2) article.card.featured",
            tagName: "article",
            classList: ["card", "featured", "shadow"],
            boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
          },
          rect: { x: 10, y: 20, width: 120, height: 80 },
          computed: {
            color: "rgb(15, 23, 42)",
            backgroundColor: "rgb(255, 255, 255)",
            borderRadius: "12px",
            opacity: "1",
            zIndex: "auto",
            fontSize: "16px",
            fontWeight: "600",
          },
          childIds: [],
        },
      ],
      nearbyNodes: [
        {
          id: "near-1",
          kind: "text",
          signature: {
            cssPath: "main p.lede",
            tagName: "p",
            classList: ["lede"],
            boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
          },
          rect: { x: 200, y: 20, width: 80, height: 24 },
          computed: { color: "rgb(0,0,0)" },
          childIds: [],
        },
      ],
      existingOperations: [],
    };

    const compact = buildCompactDesignContext(request);
    const serialized = JSON.stringify(compact);

    expect(serialized).not.toContain("cssPath");
    expect(serialized).not.toContain("classList");
    expect(serialized).not.toContain("fontSize");
    expect(compact.theme.colors).toContain("rgb(15, 23, 42)");
    expect(compact.theme.backgrounds).toContain("rgb(255, 255, 255)");
    expect(compact.selection.bounds.width).toBe(120);
    expect(compact.nearby).toHaveLength(1);
    expect(compact.selected[0]?.color).toBe("rgb(15, 23, 42)");
  });
});
