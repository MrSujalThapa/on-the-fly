import { describe, expect, it } from "vitest";
import {
  DomRuntimeAdapter,
  type ReplayOperationDiagnostic,
} from "../../../src/editor/dom/dom-runtime-adapter.js";
import { matchElementBySignatureDetailed } from "../../../src/editor/dom/signature-matcher.js";
import { buildPersistableElementSignature } from "../../../src/editor/measurement/signature-builder.js";
import type { HideOperation } from "../../../src/editor/operations.js";
import { createTestDocument } from "./test-document.js";

const PAGE_KEY = "https://example.com/profile";

function hideOperation(id: string, signature: ReturnType<typeof buildPersistableElementSignature>): HideOperation {
  return {
    id,
    type: "hide",
    pageKey: PAGE_KEY,
    target: { signature },
    payload: { hidden: true },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

describe("hide replay matching", () => {
  it("replays hide for text/card targets after refresh-like DOM shifts", () => {
    const { root } = createTestDocument(`
      <main>
        <article class="card"><h2>Plans</h2><p class="intro">Hello world</p></article>
      </main>
    `);
    const paragraph = root.querySelector("p.intro") as HTMLElement;
    const signature = buildPersistableElementSignature(paragraph);

    root.querySelector("main")?.insertAdjacentHTML(
      "afterbegin",
      `<div class="banner">Promo</div>`,
    );

    const matched = matchElementBySignatureDetailed(root, signature);
    expect(matched.diagnostics.resolved).toBe(true);
    expect(matched.element?.textContent).toBe("Hello world");

    const adapter = new DomRuntimeAdapter(root);
    const replay = adapter.replayOperationsWithDiagnostics([hideOperation("hide-card", signature)]);
    expect(replay.results[0]?.ok).toBe(true);
    expect(paragraph.style.display).toBe("none");
  });

  it("replays hide for an image using parent text and src fingerprint", () => {
    const { root } = createTestDocument(`
      <main>
        <section class="profile">
          <h2>Jane Doe</h2>
          <img class="avatar" alt="Jane profile" src="/avatars/jane.jpg" width="64" height="64" />
        </section>
      </main>
    `);
    const image = root.querySelector("img.avatar") as HTMLImageElement;
    const signature = buildPersistableElementSignature(image);
    expect(signature.altAttr).toBe("Jane profile");
    expect(signature.srcFingerprint).toBe("avatars/jane.jpg");
    expect(signature.ancestorTextContext).toContain("Jane Doe");

    root.querySelector("section.profile")?.insertAdjacentHTML(
      "afterbegin",
      `<img class="decoy" src="/avatars/other.jpg" alt="Other" />`,
    );
    signature.cssPath = "main section.profile > img.avatar:nth-of-type(9)";

    const matched = matchElementBySignatureDetailed(root, signature);
    expect(matched.diagnostics.resolved).toBe(true);
    expect(matched.diagnostics.matchStrategy).toBe("fallback-scored");
    expect(matched.element?.getAttribute("alt")).toBe("Jane profile");

    const adapter = new DomRuntimeAdapter(root);
    const replay = adapter.replayOperationsWithDiagnostics([hideOperation("hide-avatar", signature)]);
    expect(replay.results[0]?.ok).toBe(true);
    expect(image.style.display).toBe("none");
  });

  it("replays profile-picture-like images when cssPath changes but alt/src remain", () => {
    const { root } = createTestDocument(`
      <main>
        <div class="header">
          <img class="profile-pic" alt="Alex" src="https://cdn.example.com/users/alex.png" />
        </div>
      </main>
    `);
    const image = root.querySelector("img.profile-pic") as HTMLImageElement;
    const signature = buildPersistableElementSignature(image);

    signature.cssPath = "main div.header > img.profile-pic:nth-of-type(99)";

    const matched = matchElementBySignatureDetailed(root, signature);
    expect(matched.diagnostics.resolved).toBe(true);
    expect(matched.element?.getAttribute("alt")).toBe("Alex");
  });

  it("logs unresolved hide ops without breaking replay of other operations", () => {
    const { root } = createTestDocument(`
      <main>
        <p class="keep">Keep me</p>
        <p class="missing">Remove me</p>
      </main>
    `);
    const keep = root.querySelector("p.keep") as HTMLElement;
    const missing = root.querySelector("p.missing") as HTMLElement;
    const keepSignature = buildPersistableElementSignature(keep);
    const missingSignature = buildPersistableElementSignature(missing);

    missing.remove();

    const adapter = new DomRuntimeAdapter(root);
    const replay = adapter.replayOperationsWithDiagnostics([
      hideOperation("hide-missing", missingSignature),
      hideOperation("hide-keep", keepSignature),
    ]);

    expect(replay.results[0]?.ok).toBe(false);
    expect(replay.results[1]?.ok).toBe(true);
    expect(keep.style.display).toBe("none");

    const missingDiagnostic = replay.diagnostics.find(
      (entry: ReplayOperationDiagnostic) => entry.operationId === "hide-missing",
    );
    expect(missingDiagnostic?.resolved).toBe(false);
    expect(missingDiagnostic?.failureReason).toBeTruthy();
  });
});
