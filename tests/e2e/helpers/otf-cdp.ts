import type { CDPSession, Page } from "@playwright/test";

export interface CdpRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface CdpNode {
  nodeId?: number;
  backendNodeId?: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
}

export function cdpAttr(node: CdpNode, name: string): string | null {
  const attributes = node.attributes ?? [];
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) {
      return attributes[index + 1] ?? null;
    }
  }
  return null;
}

export function cdpClassList(node: CdpNode): string[] {
  return (cdpAttr(node, "class") ?? "").split(/\s+/u).filter(Boolean);
}

export function findCdpNode(
  node: CdpNode,
  match: (candidate: CdpNode) => boolean,
): CdpNode | null {
  if (match(node)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const hit = findCdpNode(child, match);
    if (hit) {
      return hit;
    }
  }
  for (const shadow of node.shadowRoots ?? []) {
    const hit = findCdpNode(shadow, match);
    if (hit) {
      return hit;
    }
  }
  if (node.contentDocument) {
    return findCdpNode(node.contentDocument, match);
  }
  return null;
}

export function findCdpByClass(node: CdpNode, className: string): CdpNode | null {
  return findCdpNode(node, (candidate) => cdpClassList(candidate).includes(className));
}

export function countCdpByClass(node: CdpNode, className: string): number {
  let count = cdpClassList(node).includes(className) ? 1 : 0;
  for (const child of node.children ?? []) {
    count += countCdpByClass(child, className);
  }
  for (const shadow of node.shadowRoots ?? []) {
    count += countCdpByClass(shadow, className);
  }
  if (node.contentDocument) {
    count += countCdpByClass(node.contentDocument, className);
  }
  return count;
}

function packedRect(value: string | null): CdpRect | null {
  if (!value) {
    return null;
  }
  const parts = value.split(",").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width < 1 || height < 1) {
    return null;
  }
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
  };
}

function quadRect(quad: number[]): CdpRect | null {
  if (quad.length < 8) {
    return null;
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]].filter((value): value is number => value !== undefined);
  const ys = [quad[1], quad[3], quad[5], quad[7]].filter((value): value is number => value !== undefined);
  if (xs.length < 4 || ys.length < 4) {
    return null;
  }
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (right - left < 1 || bottom - top < 1) {
    return null;
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    top,
    left,
    right,
    bottom,
  };
}

export async function describeOtfHost(session: CDPSession): Promise<CdpNode | null> {
  await session.send("DOM.enable");
  const document = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await session.send("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: "#on-the-fly-root-host",
  });
  if (!nodeId) {
    return null;
  }
  const described = await session.send("DOM.describeNode", {
    nodeId,
    depth: 24,
    pierce: true,
  });
  return described.node as CdpNode;
}

export async function cdpBox(session: CDPSession, node: CdpNode): Promise<CdpRect | null> {
  const fromAttr = packedRect(cdpAttr(node, "data-otf-renderer")) ?? packedRect(cdpAttr(node, "data-otf-model"));
  if (fromAttr) {
    return fromAttr;
  }
  let nodeId = node.nodeId;
  if (!nodeId && node.backendNodeId) {
    const pushed = await session.send("DOM.pushNodesByBackendIdsToFrontend", {
      backendNodeIds: [node.backendNodeId],
    });
    nodeId = pushed.nodeIds[0];
  }
  if (!nodeId) {
    return null;
  }
  const model = await session.send("DOM.getBoxModel", { nodeId }).catch(() => null);
  if (!model) {
    return null;
  }
  const quad = model.model.border.length >= 8 ? model.model.border : model.model.content;
  return quadRect(quad);
}

export async function withOtfHost<T>(
  page: Page,
  read: (session: CDPSession, host: CdpNode | null) => Promise<T>,
  fallback: T,
): Promise<T> {
  const session = await page.context().newCDPSession(page);
  try {
    const host = await describeOtfHost(session);
    return await read(session, host);
  } catch {
    return fallback;
  } finally {
    await session.detach().catch(() => undefined);
  }
}
