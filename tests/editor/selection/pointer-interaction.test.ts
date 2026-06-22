import { describe, expect, it, vi } from "vitest";
import {
  beginPointerGesture,
  isLassoGesture,
  LASSO_DRAG_THRESHOLD_PX,
  normalizeLassoRect,
  resolvePointerGestureAction,
  shouldConsumeEditModePointerEvent,
  shouldSuppressEditModeClick,
  suppressPageInteractionEvent,
  updatePointerGesture,
} from "../../../src/editor/selection/pointer-interaction.js";

describe("pointer interaction", () => {
  it("uses a clear lasso drag threshold", () => {
    expect(LASSO_DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(4);
    expect(isLassoGesture(0, 0, LASSO_DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(isLassoGesture(0, 0, LASSO_DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
  });

  it("transitions from pending to lasso while dragging", () => {
    const started = beginPointerGesture(1, 10, 10, false);
    const pending = updatePointerGesture(started, 12, 10);
    expect(pending.kind).toBe("pending");

    const dragging = updatePointerGesture(started, 20, 10);
    expect(dragging.kind).toBe("lasso");
    expect(resolvePointerGestureAction(dragging, 20, 10)).toBe("lasso");
  });

  it("identifies suppressible pointer and click targets", () => {
    expect(
      shouldConsumeEditModePointerEvent({ button: 0, isExtensionRootTarget: false }),
    ).toBe(true);
    expect(
      shouldSuppressEditModeClick({ button: 0, isExtensionRootTarget: false }),
    ).toBe(true);
    expect(
      shouldSuppressEditModeClick({ button: 1, isExtensionRootTarget: false }),
    ).toBe(true);
    expect(
      shouldConsumeEditModePointerEvent({ button: 0, isExtensionRootTarget: true }),
    ).toBe(false);
    expect(shouldConsumeEditModePointerEvent({ button: 1, isExtensionRootTarget: false })).toBe(
      false,
    );
  });

  it("resolves small movement as click", () => {
    const started = beginPointerGesture(1, 10, 10, false);
    expect(resolvePointerGestureAction(started, 11, 11)).toBe("click");
  });

  it("normalizes lasso rects with minimum dimensions", () => {
    expect(normalizeLassoRect(10, 10, 20, 10)).toEqual({
      x: 10,
      y: 10,
      width: 10,
      height: 1,
    });
  });

  it("suppresses page events with immediate propagation stop", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const event = {
      preventDefault,
      stopPropagation,
      stopImmediatePropagation,
    } as unknown as Event;

    suppressPageInteractionEvent(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
  });
});
