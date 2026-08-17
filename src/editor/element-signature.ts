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
  titleAttr?: string;
  altAttr?: string;
  textFingerprint?: string;
  srcFingerprint?: string;
  parentFingerprint?: string;
  parentCssPath?: string;
  ancestorTextContext?: string;
  boundingBoxHint: BoundingBoxHint;
  /** 2 = VisualModel logical identity. Missing/1 = Phase B locator-era signatures. */
  identityVersion?: number;
  siblingOrdinal?: number;
  siblingCount?: number;
  datasetFingerprint?: string;
  hrefAttr?: string;
  nameAttr?: string;
}

export function createEmptyBoundingBoxHint(): BoundingBoxHint {
  return {
    xRatio: 0,
    yRatio: 0,
    widthRatio: 0,
    heightRatio: 0,
  };
}
