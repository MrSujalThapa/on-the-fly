import type { CropOperation } from "../../operations.js";
import {
  cropInsetsToClipPath,
  type CropInsets,
} from "../../transform/crop-geometry.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import { OTF_CROP_ATTR, type AppliedDomEffect } from "../types.js";

/**
 * Applies a crop as an inline `clip-path: inset(...)`. Clipping keeps the
 * element box and its content undistorted (unlike resize) and is fully
 * reversible. The crop insets are mirrored into a data attribute so the
 * transform controller can read the current crop as the base for the next
 * crop gesture.
 */
export function applyCropOperation(
  element: HTMLElement,
  operation: CropOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  snapshotStore.captureIfNeeded(element);

  const previousClipPath = element.style.clipPath;
  const previousWebkitClipPath = element.style.getPropertyValue("-webkit-clip-path");
  const previousCropAttr = element.getAttribute(OTF_CROP_ATTR);

  const insets: CropInsets = {
    top: operation.payload.top,
    right: operation.payload.right,
    bottom: operation.payload.bottom,
    left: operation.payload.left,
  };

  if (insets.top === 0 && insets.right === 0 && insets.bottom === 0 && insets.left === 0) {
    element.style.removeProperty("clip-path");
    element.style.removeProperty("-webkit-clip-path");
    element.removeAttribute(OTF_CROP_ATTR);
  } else {
    const clipPath = cropInsetsToClipPath(insets);
    element.style.clipPath = clipPath;
    element.style.setProperty("-webkit-clip-path", clipPath);
    element.setAttribute(OTF_CROP_ATTR, JSON.stringify(insets));
  }

  return [
    {
      kind: "clip",
      previousClipPath,
      previousWebkitClipPath,
      previousCropAttr,
    },
  ];
}

export function revertClipChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "clip" }>,
): void {
  if (change.previousClipPath) {
    element.style.clipPath = change.previousClipPath;
  } else {
    element.style.removeProperty("clip-path");
  }

  if (change.previousWebkitClipPath) {
    element.style.setProperty("-webkit-clip-path", change.previousWebkitClipPath);
  } else {
    element.style.removeProperty("-webkit-clip-path");
  }

  if (change.previousCropAttr === null) {
    element.removeAttribute(OTF_CROP_ATTR);
  } else {
    element.setAttribute(OTF_CROP_ATTR, change.previousCropAttr);
  }
}

export function readStoredCropInsets(element: HTMLElement): CropInsets {
  const raw = element.getAttribute(OTF_CROP_ATTR);
  if (!raw) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CropInsets>;
    return {
      top: typeof parsed.top === "number" ? parsed.top : 0,
      right: typeof parsed.right === "number" ? parsed.right : 0,
      bottom: typeof parsed.bottom === "number" ? parsed.bottom : 0,
      left: typeof parsed.left === "number" ? parsed.left : 0,
    };
  } catch {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}
