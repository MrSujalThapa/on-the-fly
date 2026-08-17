/**
 * Characterization of visual movement and element identity (Phase 2, M1–M7).
 * Asserts live geometry and logical identity, not merely that an operation was emitted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import { matchElementBySignature } from "../../src/editor/dom/signature-matcher.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import { createEditSession } from "../../src/content/edit-session.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import {
  absoluteDescendantFixture,
  ambiguousSignatureFixture,
  frameworkRerenderFixture,
  interactiveCardFixture,
  nestedFlexFixture,
  nestedGridFixture,
  relativeParentFixture,
  repeatedSiblingCardsFixture,
  sectionContainerFixture,
  stickyDescendantFixture,
  type VisualFixture,
} from "./visual-fixtures.js";
import {
  capturePlacement,
  createMoveSession,
  fixtureIdOf,
  intendedRect,
  mockPageOperationStore,
  readMoveStrategy,
  rectsClose,
  resolveSignature,
  saveAndReplay,
  selectAndMove,
  siblingRectDelta,
  VisualLayoutWorld,
} from "./visual-movement-harness.js";

const DX = 48;
const DY = 36;

/**
 * Invariants that fail on current HEAD. Classifications (Phase 2 A–H):
 * B — selected live node is correct, durable signature is not
 * D — move strategy produces wrong layout semantics / composition
 * F — replay/re-resolution binds a different logical element
 * G — host replacement leaves an orphaned live reference
 * H — stale overlay geometry
 *
 * Remove an entry only when the invariant holds. A passing known-failure is a
 * test failure so we cannot silently “lose” a characterization.
 */
const KNOWN_FAILURES: Record<string, "B" | "D" | "F" | "G" | "H"> = {
  "nested-flex:M1-signature": "F",
  "nested-flex:M3": "D",
  "nested-flex:M6": "F",
  "nested-grid:M1-signature": "F",
  "nested-grid:M3": "D",
  "nested-grid:M6": "F",
  "repeated-sibling-cards:M1-signature": "F",
  "repeated-sibling-cards:M3": "D",
  "repeated-sibling-cards:M6": "F",
  "absolute-descendant:M2": "D",
  "absolute-descendant:M3": "D",
  "absolute-descendant:M5": "D",
  "framework-rerender:M3": "D",
  "ambiguous-signature:M1-signature": "F",
  "ambiguous-signature:M6": "F",
  "repeated-siblings-dedicated:M6": "F",
  "ambiguous-dedicated:M1-signature": "F",
  "ambiguous-dedicated:M6": "F",
  "framework-rerender:M7": "G",
  "overlay:V12-scroll": "H",
};

function expectInvariant(id: string, held: boolean): void {
  const classification = KNOWN_FAILURES[id];
  if (classification) {
    expect(held, `${id} (${classification}) should still fail`).toBe(false);
    return;
  }
  expect(held, id).toBe(true);
}

const fixtureFactories: Array<[string, () => VisualFixture]> = [
  ["nested-flex", nestedFlexFixture],
  ["nested-grid", nestedGridFixture],
  ["interactive-card", interactiveCardFixture],
  ["repeated-sibling-cards", repeatedSiblingCardsFixture],
  ["section-container", sectionContainerFixture],
  ["relative-parent", relativeParentFixture],
  ["absolute-descendant", absoluteDescendantFixture],
  ["sticky-descendant", stickyDescendantFixture],
  ["framework-rerender", frameworkRerenderFixture],
  ["ambiguous-signature", ambiguousSignatureFixture],
];

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

function readOutlineRect(shell: EditorShell): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const outline = shell.getShadowRoot()?.querySelector(".otf-selection-outline");
  if (!(outline instanceof HTMLElement)) {
    return null;
  }
  return {
    x: Number.parseFloat(outline.style.left),
    y: Number.parseFloat(outline.style.top),
    width: Number.parseFloat(outline.style.width),
    height: Number.parseFloat(outline.style.height),
  };
}

describe("visual movement and identity characterization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe.each(fixtureFactories)("%s", (_name, factory) => {
      it("M1/M2: first drag targets the selected element and lands at the intended geometry", () => {
        const fixture = factory();
        const session = createMoveSession(fixture.document);
        const origin = extractBoundingBox(fixture.target);
        const siblingsBefore = fixture.importantRects();

        const { selected, operations, appliedElement } = selectAndMove(
          session,
          fixture.document,
          fixture.target,
          DX,
          DY,
        );

        expect(operations).toHaveLength(1);
        expect(appliedElement).toBe(fixture.target);
        expect(selected.element).toBe(fixture.target);

        const committed = extractBoundingBox(fixture.target);
        expectInvariant(`${fixture.name}:M2`, rectsClose(committed, intendedRect(origin, DX, DY)));

        const replayMatch = resolveSignature(fixture.document, operations[0]?.target.signature);
        expect(replayMatch.diagnostics.resolved).toBe(true);
        expectInvariant(`${fixture.name}:M1-signature`, replayMatch.element === fixture.target);

        const strategy = readMoveStrategy(operations[0]);
        const siblingsAfter = fixture.importantRects();
        const siblingShift = siblingRectDelta(siblingsBefore, siblingsAfter, "target");
        if (siblingShift.length > 0) {
          expect(
            strategy?.detached === true || strategy?.interactionSafeFixed === true,
            `${fixture.name}: unexplained sibling movement ${siblingShift.map((entry) => entry.key).join(",")}`,
          ).toBe(true);
        }

        session.dispose();
      });

      it("M3: a second drag composes from the committed geometry", () => {
        const fixture = factory();
        const session = createMoveSession(fixture.document);
        const origin = extractBoundingBox(fixture.target);

        selectAndMove(session, fixture.document, fixture.target, DX, DY);
        const afterFirst = extractBoundingBox(fixture.target);
        const firstHeld = rectsClose(afterFirst, intendedRect(origin, DX, DY));
        expectInvariant(`${fixture.name}:M2`, firstHeld);
        if (!firstHeld) {
          session.dispose();
          return;
        }

        const { operations } = selectAndMove(session, fixture.document, fixture.target, 24, 18);
        expect(operations).toHaveLength(1);
        const afterSecond = extractBoundingBox(fixture.target);
        expectInvariant(
          `${fixture.name}:M3`,
          rectsClose(afterSecond, intendedRect(origin, DX + 24, DY + 18)),
        );

        session.dispose();
      });

      it("M5/M6: save then replay restores the committed geometry on the same logical element", async () => {
        mockPageOperationStore();
        const fixture = factory();
        const session = createMoveSession(fixture.document);
        const selectedId = fixtureIdOf(fixture.target);

        const { operations } = selectAndMove(session, fixture.document, fixture.target, DX, DY);
        const committed = capturePlacement(fixture.target);
        expect(operations[0]?.target.signature).toBeDefined();

        const { replayed, replayTarget, replayDiagnostics } = await saveAndReplay(
          session.live,
          fixture.document,
          operations,
          () => {
            fixture.restoreHost();
          },
        );

        expect(replayDiagnostics?.diagnostics.resolved).toBe(true);
        expect(replayTarget).not.toBeNull();
        const identityHeld = selectedId
          ? fixtureIdOf(replayTarget as HTMLElement) === selectedId
          : replayTarget === fixture.target;
        expectInvariant(`${fixture.name}:M6`, identityHeld);
        if (identityHeld && replayTarget) {
          expectInvariant(
            `${fixture.name}:M5`,
            rectsClose(extractBoundingBox(replayTarget), committed.rect),
          );
        }

        session.dispose();
        replayed.dispose();
      });
  });

  it("M4: an in-flow nested-flex leaf move does not collapse remaining tiles", () => {
    const fixture = nestedFlexFixture();
    const session = createMoveSession(fixture.document);
    const siblingsBefore = fixture.importantRects();

    const { operations } = selectAndMove(session, fixture.document, fixture.target, 12, 8);
    const strategy = readMoveStrategy(operations[0]);
    const siblingsAfter = fixture.importantRects();
    const siblingShift = siblingRectDelta(siblingsBefore, siblingsAfter, "target");

    if (strategy?.detached || strategy?.interactionSafeFixed) {
      expect(siblingShift.length).toBeGreaterThan(0);
    } else {
      expect(siblingShift).toEqual([]);
    }

    session.dispose();
  });

  it("M1/M6: repeated sibling cards keep the selected card, not a class-similar neighbor", async () => {
    mockPageOperationStore();
    const fixture = repeatedSiblingCardsFixture(1);
    const session = createMoveSession(fixture.document);
    const selectedId = fixtureIdOf(fixture.target);
    expect(selectedId).toBe("card-1");

    const { selected, operations } = selectAndMove(
      session,
      fixture.document,
      fixture.target,
      DX,
      DY,
    );
    expect(selected.element).toBe(fixture.target);
    expect(fixtureIdOf(fixture.target)).toBe("card-1");

    const naive = matchElementBySignature(fixture.document, {
      cssPath: "main > section.feed > article.card",
      tagName: "article",
      classList: ["card", "item"],
      textFingerprint: "Project Description",
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });
    expect(naive === null || fixtureIdOf(naive) !== "card-1").toBe(true);

    const { replayed, replayTarget } = await saveAndReplay(
      session.live,
      fixture.document,
      operations,
      () => {
        fixture.restoreHost();
      },
    );
    expectInvariant(
      "repeated-siblings-dedicated:M6",
      fixtureIdOf(replayTarget as HTMLElement) === "card-1",
    );

    session.dispose();
    replayed.dispose();
  });

  it("M6: an ambiguous result list does not silently resolve a different row", async () => {
    mockPageOperationStore();
    const fixture = ambiguousSignatureFixture();
    const session = createMoveSession(fixture.document);
    expect(fixtureIdOf(fixture.target)).toBe("row-1");

    const { operations } = selectAndMove(session, fixture.document, fixture.target, DX, DY);
    const liveResolved = resolveSignature(fixture.document, operations[0]?.target.signature);
    expectInvariant(
      "ambiguous-dedicated:M1-signature",
      fixtureIdOf(liveResolved.element as HTMLElement) === "row-1",
    );

    const { replayed, replayTarget } = await saveAndReplay(
      session.live,
      fixture.document,
      operations,
      () => {
        fixture.restoreHost();
      },
    );
    expectInvariant(
      "ambiguous-dedicated:M6",
      fixtureIdOf(replayTarget as HTMLElement) === "row-1",
    );

    session.dispose();
    replayed.dispose();
  });

  it("M7: replacing the edited node rebinds or fails explicitly, and never mutates the orphan", () => {
    const fixture = frameworkRerenderFixture();
    const session = createMoveSession(fixture.document);
    const orphan = fixture.target;

    selectAndMove(session, fixture.document, orphan, DX, DY);
    const committed = capturePlacement(orphan);

    const replacement = fixture.replaceTarget();
    expect(orphan.isConnected).toBe(false);
    expect(replacement.isConnected).toBe(true);
    expect(replacement).not.toBe(orphan);

    const { operations } = selectAndMove(session, fixture.document, replacement, 16, 12);
    expect(operations).toHaveLength(1);
    expect(replacement.isConnected).toBe(true);
    expect(orphan.isConnected).toBe(false);

    const next = extractBoundingBox(replacement);
    expectInvariant(
      "framework-rerender:M7",
      rectsClose(next, intendedRect(committed.rect, 16, 12)),
    );

    const undone = session.live.getAdapter().revertOperation(operations[0]!);
    expect(undone.ok).toBe(true);
    expect(orphan.style.transform === committed.transform || !orphan.isConnected).toBe(true);
    expect(replacement.isConnected).toBe(true);

    session.dispose();
  });

  it("V.12: after selection, a scroll refresh keeps the outline on the live rect", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><section id="banner">Hello</section></main>`;
    const banner = doc.querySelector("#banner") as HTMLElement;
    const world = new VisualLayoutWorld(doc);
    world.bind(banner, { x: 40, y: 80, width: 200, height: 48 });

    doc.elementsFromPoint = () => [banner, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const pageCustomization = createTestPageCustomization(doc);
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization,
    });
    await session.start();

    dispatchPointer(win, banner, "pointerdown", { clientX: 50, clientY: 90, buttons: 1 });
    dispatchPointer(win, banner, "pointerup", { clientX: 50, clientY: 90, buttons: 0 });

    const before = readOutlineRect(shell);
    expect(before).not.toBeNull();
    expect(rectsClose(before as { x: number; y: number; width: number; height: number }, extractBoundingBox(banner))).toBe(
      true,
    );

    vi.useFakeTimers();
    world.setScroll(0, 40);
    win.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);

    const after = readOutlineRect(shell);
    const live = extractBoundingBox(banner);
    expect(after).not.toBeNull();
    expectInvariant(
      "overlay:V12-scroll",
      rectsClose(after as { x: number; y: number; width: number; height: number }, live),
    );

    vi.useRealTimers();
    session.stop();
    shell.unmount();
    pageCustomization.dispose();
    doc.body.innerHTML = "";
  });
});
