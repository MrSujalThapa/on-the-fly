import { describe, expect, it } from "vitest";
import { dropCoveredAncestors } from "../../src/runtime-v2/lasso-selection.js";

describe("lasso leaf selection", () => {
  it("keeps nested hits and drops ancestors that cover them", () => {
    const parent = document.createElement("div");
    const first = document.createElement("button");
    const second = document.createElement("button");
    parent.append(first, second);
    expect(dropCoveredAncestors([
      { id: "parent", element: parent },
      { id: "first", element: first },
      { id: "second", element: second },
    ])).toEqual(["first", "second"]);
  });

  it("keeps independently placed siblings that do not contain each other", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    expect(dropCoveredAncestors([
      { id: "first", element: first },
      { id: "second", element: second },
    ])).toEqual(["first", "second"]);
  });
});
