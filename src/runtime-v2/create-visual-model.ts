import type { VisualNodeId } from "../editor/ids.js";
import { isExtensionRoot } from "../editor/measurement/scan-guards.js";
import { rectFromElement } from "./geometry.js";
import { discoverFromElement, discoverFromPath } from "./visual-hierarchy.js";
import {
  buildDurableIdentity,
  identityConsistent,
  resolveDurableIdentity,
} from "./visual-identity.js";
import type { IntendedRect } from "./placement-engine.js";
import type {
  VisualCapabilities,
  VisualModel,
  VisualNode,
  VisualResolveResult,
  VisualRole,
} from "./visual-model.js";

let nodeCounter = 0;

function nextNodeId(): VisualNodeId {
  nodeCounter += 1;
  return `otf-vn-${nodeCounter.toString(36)}`;
}

function capabilitiesFor(role: VisualRole): VisualCapabilities {
  return { movable: role === "unit" || role === "collection" || role === "section" };
}

function withNodeId(result: VisualResolveResult, nodeId: VisualNodeId): VisualResolveResult {
  return { ...result, nodeId };
}

export function createVisualModel(root: Document): VisualModel {
  const nodes = new Map<VisualNodeId, VisualNode>();
  const cache = new Map<VisualNodeId, WeakRef<HTMLElement>>();
  const liveIds = new WeakMap<HTMLElement, VisualNodeId>();

  const readCache = (id: VisualNodeId): HTMLElement | null => {
    const ref = cache.get(id);
    if (!ref) {
      return null;
    }
    const element = ref.deref() ?? null;
    if (!element || !element.isConnected) {
      cache.delete(id);
      return null;
    }
    return element;
  };

  const writeCache = (id: VisualNodeId, element: HTMLElement): void => {
    if (!element.isConnected) {
      cache.delete(id);
      return;
    }
    cache.set(id, new WeakRef(element));
    liveIds.set(element, id);
  };

  const upsertNode = (
    binding: HTMLElement,
    role: VisualRole,
    parentId: VisualNodeId | null,
  ): VisualNodeId => {
    const existingId = liveIds.get(binding);
    const existing = existingId ? nodes.get(existingId) : undefined;
    if (existing && existing.role === role) {
      writeCache(existing.id, binding);
      if (parentId && existing.parentId !== parentId) {
        nodes.set(existing.id, { ...existing, parentId });
      }
      return existing.id;
    }

    const id = existing?.id ?? nextNodeId();
    const node: VisualNode = {
      id,
      durableIdentity: buildDurableIdentity(binding, root),
      role,
      parentId,
      childIds: existing?.childIds ?? [],
      capabilities: capabilitiesFor(role),
    };
    nodes.set(id, node);
    writeCache(id, binding);
    return id;
  };

  const linkChild = (parentId: VisualNodeId, childId: VisualNodeId): void => {
    const parent = nodes.get(parentId);
    const child = nodes.get(childId);
    if (!parent || !child) {
      return;
    }
    if (!parent.childIds.includes(childId)) {
      nodes.set(parentId, { ...parent, childIds: [...parent.childIds, childId] });
    }
    if (child.parentId !== parentId) {
      nodes.set(childId, { ...child, parentId });
    }
  };

  const materialize = (discovery: ReturnType<typeof discoverFromPath>): VisualNodeId | null => {
    if (!discovery) {
      return null;
    }
    let parentId: VisualNodeId | null = null;
    if (discovery.parentBinding && discovery.parentRole) {
      parentId = upsertNode(discovery.parentBinding, discovery.parentRole, null);
    }
    const id = upsertNode(discovery.binding, discovery.role, parentId);
    if (parentId) {
      linkChild(parentId, id);
    }
    return id;
  };

  return {
    pick(clientX, clientY) {
      const stack = root.elementsFromPoint(clientX, clientY);
      const usable = stack.filter((node) => !(node instanceof Element) || !isExtensionRoot(node));
      return materialize(discoverFromPath(usable));
    },
    adopt(element) {
      if (!element.isConnected || isExtensionRoot(element)) {
        return null;
      }
      return materialize(discoverFromElement(element));
    },
    get(id) {
      return nodes.get(id) ?? null;
    },
    parentOf(id) {
      return nodes.get(id)?.parentId ?? null;
    },
    childrenOf(id) {
      return nodes.get(id)?.childIds ?? [];
    },
    bind(id) {
      const resolved = this.resolveNode(id);
      return resolved.kind === "resolved" ? resolved.element : null;
    },
    measure(ids) {
      const rects = new Map<VisualNodeId, IntendedRect>();
      for (const id of ids) {
        const element = this.bind(id);
        if (element) {
          rects.set(id, rectFromElement(element));
        }
      }
      return rects;
    },
    durableIdentityOf(id) {
      return nodes.get(id)?.durableIdentity ?? null;
    },
    resolveNode(id) {
      const node = nodes.get(id);
      if (!node) {
        return {
          kind: "unresolved",
          nodeId: id,
          identity: { signature: { cssPath: "", tagName: "", classList: [], boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 } } },
          evidence: {
            strategy: "unresolved",
            candidateCount: 0,
            cssPathMatched: false,
            structureShifted: false,
            matchedKeys: [],
            reason: "unknown_node",
          },
        };
      }
      const cached = readCache(id);
      if (cached && identityConsistent(cached, node.durableIdentity)) {
        return {
          kind: "resolved",
          nodeId: id,
          element: cached,
          identity: node.durableIdentity,
          evidence: {
            strategy: "live-cache",
            candidateCount: 1,
            cssPathMatched: true,
            structureShifted: false,
            matchedKeys: ["cache"],
          },
        };
      }
      const resolved = resolveDurableIdentity(root, node.durableIdentity);
      if (resolved.kind === "resolved") {
        writeCache(id, resolved.element);
      }
      return withNodeId(resolved, id);
    },
    resolveIdentity(identity) {
      const resolved = resolveDurableIdentity(root, identity);
      if (resolved.kind !== "resolved") {
        return resolved;
      }
      const existingId = liveIds.get(resolved.element);
      if (existingId) {
        writeCache(existingId, resolved.element);
        return withNodeId(resolved, existingId);
      }
      const adopted = this.adopt(resolved.element);
      return adopted ? withNodeId(resolved, adopted) : resolved;
    },
    cache(id, element) {
      writeCache(id, element);
    },
    invalidate(id) {
      cache.delete(id);
    },
  };
}
