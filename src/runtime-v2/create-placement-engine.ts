import { readLocalLayoutSize, readStoredTransformState } from "../editor/dom/element-snapshot.js";
import {
  OTF_DETACH_ATTR,
  resolveIndependentZIndex,
  shouldDetachForPredictedRect,
} from "../editor/dom/managed-detach.js";
import { isInteractionSafeFixed } from "../editor/dom/interactive-fixed-placement.js";
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

function aabbFromLocalSize(
  origin: { x: number; y: number },
  local: { width: number; height: number },
  rotate: number,
): IntendedRect {
  const radians = (rotate * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    x: origin.x,
    y: origin.y,
    width: local.width * cos + local.height * sin,
    height: local.width * sin + local.height * cos,
  };
}

function readExisting(element: HTMLElement, request: MovePlacementRequest) {
  return {
    independent:
      request.existing?.detached === true ||
      request.existing?.interactionSafeFixed === true ||
      element.getAttribute(OTF_DETACH_ATTR) === "true" ||
      isInteractionSafeFixed(element),
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
 * Runtime V2 has two placement semantics: attached in-flow, or independent
 * body-managed placement. Legacy fixed/transform-only markers are read only
 * so the next MOVE migrates them into the independent realization.
 */
export function createPlacementEngine(): PlacementEngine {
  return {
    isIndependent(element) {
      return readExisting(element, {
        element,
        currentRect: { x: 0, y: 0, width: 0, height: 0 },
        dx: 0,
        dy: 0,
      }).independent;
    },
    planMove(request: MovePlacementRequest): MovePlacementPlan {
      const expected = translateRect(request.currentRect, request.dx, request.dy);
      const existing = readExisting(request.element, request);
      const shouldDetach =
        !existing.independent &&
        shouldDetachForPredictedRect(request.element, [request.element], expected);

      if (existing.independent || request.forceIndependent === true || shouldDetach) {
        const { scrollX, scrollY } = pageOffset(request.element);
        const local = readLocalLayoutSize(request.element);
        const rotate = readStoredTransformState(request.element)?.rotate ?? 0;
        const expected = aabbFromLocalSize(
          { x: request.currentRect.x + request.dx, y: request.currentRect.y + request.dy },
          local,
          rotate,
        );
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
            detachedWidth: local.width,
            detachedHeight: local.height,
            detachedZIndex: resolveIndependentZIndex(request.element),
          },
        };
      }

      return {
        strategy: "in-flow",
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
          transformOnly: false,
          interactionSafeFixed: false,
        },
      };
    },
  };
}
