import { describe, expect, it } from "vitest";
import { viewportRectToInteractionPlacement } from "../../../src/editor/dom/fixed-position-anchor.js";
import { createTestDocument } from "./test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";

describe("fixed position anchor", () => {
  it("uses absolute coords when a transformed app shell ancestor exists", () => {
    const { document } = createTestDocument(`
      <div id="application-outlet" style="transform: translateZ(0)">
        <nav><button id="jobs">Jobs</button></nav>
      </div>
    `);
    const outlet = document.querySelector("#application-outlet") as HTMLElement;
    const jobs = document.querySelector("#jobs") as HTMLButtonElement;
    layoutElement(outlet, { x: 40, y: 80, width: 700, height: 500 });
    layoutElement(jobs, { x: 95, y: 471, width: 56, height: 32 });

    const placement = viewportRectToInteractionPlacement(jobs, {
      x: 95,
      y: 471,
      width: 56,
      height: 32,
    });

    expect(placement.mode).toBe("containing-block-absolute");
    expect(placement.position).toBe("absolute");
    expect(jobs.style.position).toBe("absolute");
    expect(jobs.getBoundingClientRect().x).toBeCloseTo(95, 0);
    expect(jobs.getBoundingClientRect().y).toBeCloseTo(471, 0);
  });
});
