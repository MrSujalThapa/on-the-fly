export interface BoundingBoxHint {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface ElementSignature {
  cssPath: string;
  tagName: string;
  idAttr?: string;
  classList: string[];
  role?: string;
  ariaLabel?: string;
  textFingerprint?: string;
  parentFingerprint?: string;
  boundingBoxHint: BoundingBoxHint;
}

export function createEmptyBoundingBoxHint(): BoundingBoxHint {
  return {
    xRatio: 0,
    yRatio: 0,
    widthRatio: 0,
    heightRatio: 0,
  };
}
