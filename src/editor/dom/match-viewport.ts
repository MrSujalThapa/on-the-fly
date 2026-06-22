import type { MatchViewport } from "./types.js";

export function getMatchViewport(root: ParentNode): MatchViewport {
  if ("documentElement" in root) {
    const doc = root as Document;
    const width =
      doc.documentElement.clientWidth ||
      doc.documentElement.scrollWidth ||
      doc.defaultView?.innerWidth ||
      0;
    const height =
      doc.documentElement.clientHeight ||
      doc.documentElement.scrollHeight ||
      doc.defaultView?.innerHeight ||
      0;

    return { width, height };
  }

  if (root instanceof HTMLElement) {
    return {
      width: root.clientWidth,
      height: root.clientHeight,
    };
  }

  return { width: 0, height: 0 };
}
