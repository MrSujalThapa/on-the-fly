import {
  OTF_DETACH_ATTR,
  shouldDetachForPredictedRect,
} from "../editor/dom/managed-detach.js";
import { isInteractionSafeFixed } from "../editor/dom/interactive-fixed-placement.js";
import { requiresTransformOnlyMove } from "../editor/dom/interactive-safety.js";
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
 * in-flow (default for ordinary block/flex/grid children):
 *   visual translate, original flow slot remains, viewport coordinates,
 *   repeated moves compose via metadata.finalRect, rollback restores snapshot.
 *
 * transform-only:
 *   only for elements already committed to transform-only compatibility mode.
 *
 * interaction-safe-fixed:
 *   used when an element that must preserve its DOM/event tree is dragged out
 *   of its visual container. This includes grouped SPA controls and larger
 *   units containing interactive descendants. The target stays in its DOM tree
 *   but receives independent viewport/containing-block placement so the old
 *   parent no longer owns future OTF movement.
 *
 * detached:
 *   body-level managed placement for non-interactive targets that are dragged
 *   out of their visual container.
 */
export function createPlacementEngine(): PlacementEngine {
  return {
    planMove(request: MovePlacementRequest): MovePlacementPlan {
      const expected = translateRect(request.currentRect, request.dx, request.dy);
      const existing = readExisting(request.element, request);
      const shouldDetach =
        !existing.detached &&
        shouldDetachForPredictedRect(request.element, [request.element], expected);

      // Any target whose DOM/event relationship makes physical reparenting
      // unsafe must still become independently placeable when it leaves its
      // visual parent. Previously grouped controls and units containing links
      // fell through to transform-only, which left them trapped in the old
      // parent's clipping/stacking/coordinate context.
      if (
        existing.interactionSafeFixed ||
        (shouldDetach && requiresTransformOnlyMove(request.element))
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
          detached: false,
          transformOnly: strategy === "transform-only",
          interactionSafeFixed: false,
        },
      };
    },
  };
}
