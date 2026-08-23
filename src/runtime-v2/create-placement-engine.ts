import {
  OTF_DETACH_ATTR,
  shouldDetachForPredictedRect,
} from "../editor/dom/managed-detach.js";
import { isInteractionSafeFixed } from "../editor/dom/interactive-fixed-placement.js";
import {
  requiresInteractionSafeFixedMove,
  requiresTransformOnlyMove,
} from "../editor/dom/interactive-safety.js";
import { OTF_TRANSFORM_ONLY_ATTR } from "../editor/dom/types.js";
import type {
  IntendedRect,
  MovePlacementPlan,
  MovePlacementRequest,
  PlacementEngine,
} from "./placement-engine.js";

function translateRect(rect: IntendedRect, dx: number, dy: number): IntendedRect {
  return {
    x: rect.x + dx,
    y: rect.y + dy,
    width: rect.width,
    height: rect.height,
  };
}

function readExisting(element: HTMLElement, request: MovePlacementRequest) {
  return {
    detached: request.existing?.detached ?? element.getAttribute(OTF_DETACH_ATTR) === "true",
    interactionSafeFixed:
      request.existing?.interactionSafeFixed ?? isInteractionSafeFixed(element),
    transformOnly:
      request.existing?.transformOnly ?? element.getAttribute(OTF_TRANSFORM_ONLY_ATTR) === "true",
  };
}

function pageOffset(element: HTMLElement): { scrollX: number; scrollY: number } {
  const view = element.ownerDocument.defaultView;
  return {
    scrollX: view?.scrollX ?? 0,
    scrollY: view?.scrollY ?? 0,
  };
}

/**
 * MOVE strategies:
 *
 * in-flow (default for block/flex/grid children):
 *   visual translate, original flow slot remains, viewport coordinates,
 *   repeated moves compose via metadata.finalRect, rollback restores snapshot.
 *
 * transform-only:
 *   already-managed transform-only or host-positioned elements that must keep
 *   their CSS position; same composition as in-flow.
 *
 * interaction-safe-fixed:
 *   only when the element is already in that compatibility mode.
 *   Not selected from tag names like `a` / `button`.
 *
 * detached:
 *   only when the element is already OTF-detached. Not the default MOVE.
 */
export function createPlacementEngine(): PlacementEngine {
  return {
    planMove(request: MovePlacementRequest): MovePlacementPlan {
      const expected = translateRect(request.currentRect, request.dx, request.dy);
      const existing = readExisting(request.element, request);
      const shouldDetach =
        !existing.detached &&
        shouldDetachForPredictedRect(request.element, [request.element], expected);

      if (
        existing.interactionSafeFixed ||
        (shouldDetach && requiresInteractionSafeFixedMove(request.element))
      ) {
        return {
          strategy: "interaction-safe-fixed",
          dx: request.dx,
          dy: request.dy,
          intendedRect: expected,
          expectedRect: expected,
          coordinateSpace: "viewport",
          flowSlotRemains: true,
          rollback: "restore-dom-snapshot",
          payload: {
            dx: request.dx,
            dy: request.dy,
            interactionSafeFixed: true,
            transformOnly: false,
            detached: false,
            fixedViewportLeft: expected.x,
            fixedViewportTop: expected.y,
            fixedWidth: expected.width,
            fixedHeight: expected.height,
          },
        };
      }

      if (existing.detached && requiresTransformOnlyMove(request.element)) {
        return {
          strategy: "transform-only",
          dx: request.dx,
          dy: request.dy,
          intendedRect: expected,
          expectedRect: expected,
          coordinateSpace: "viewport",
          flowSlotRemains: true,
          rollback: "restore-dom-snapshot",
          payload: {
            dx: request.dx,
            dy: request.dy,
            detached: true,
            transformOnly: true,
            interactionSafeFixed: false,
          },
        };
      }

      if (
        existing.detached ||
        (shouldDetach && !requiresTransformOnlyMove(request.element))
      ) {
        const { scrollX, scrollY } = pageOffset(request.element);
        return {
          strategy: "detached",
          dx: request.dx,
          dy: request.dy,
          intendedRect: expected,
          expectedRect: expected,
          coordinateSpace: "page",
          flowSlotRemains: false,
          rollback: "restore-dom-snapshot",
          payload: {
            dx: request.dx,
            dy: request.dy,
            detached: true,
            transformOnly: false,
            interactionSafeFixed: false,
            detachedLeft: expected.x + scrollX,
            detachedTop: expected.y + scrollY,
          },
        };
      }

      const strategy = existing.transformOnly ? "transform-only" : "in-flow";
      return {
        strategy,
        dx: request.dx,
        dy: request.dy,
        intendedRect: expected,
        expectedRect: expected,
        coordinateSpace: "viewport",
        flowSlotRemains: true,
        rollback: "restore-dom-snapshot",
        payload: {
          dx: request.dx,
          dy: request.dy,
          detached: shouldDetach,
          transformOnly: true,
          interactionSafeFixed: false,
        },
      };
    },
  };
}
