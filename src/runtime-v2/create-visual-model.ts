import type { VisualNodeId } from "../editor/ids.js";
import { isExtensionRoot } from "../editor/measurement/scan-guards.js";
import { rectFromElement } from "./geometry.js";
import { discoverFromElement, discoverFromPath } from "./visual-hierarchy.js";
import {
  buildDurableIdentity,
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

function cloneEntityRoot(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>("[data-otf-element-id]")
    ?? element.closest<HTMLElement>("[data-otf-clone-id]")
    ?? element;
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
  ): VisualNodeId | null => {
    const existingId = liveIds.get(binding);
    const existing = existingId ? nodes.get(existingId) : undefined;
    if (existing) {
      writeCache(existing.id, binding);
      if (existing.role !== role || (parentId && existing.parentId !== parentId)) {
        nodes.set(existing.id, {
          ...existing,
          role,
          capabilities: capabilitiesFor(role),
          ...(parentId ? { parentId } : {}),
        });
      }
      return existing.id;
    }

    for (const [nodeId, node] of nodes) {
      if (nodeId === binding.getAttribute("data-otf-clone-id") || nodeId === binding.getAttribute("data-otf-element-id")) continue;
      const prior = readCache(nodeId);
      if (prior) continue;
      const resolved = resolveDurableIdentity(root, node.durableIdentity);
      if (resolved.kind === "resolved" && resolved.element === binding) {
        writeCache(nodeId, binding);
        return nodeId;
      }
    }

    const createdId = binding.getAttribute("data-otf-element-id")?.trim();
    const cloneId = binding.getAttribute("data-otf-clone-id")?.trim();
    const id = createdId || cloneId || nextNodeId();
    const ownedBinding = (createdId ?? cloneId) ? readCache(id) : null;
    if (
      ownedBinding &&
      ownedBinding !== binding &&
      ownedBinding.isConnected &&
      ownedBinding.ownerDocument.contains(ownedBinding)
    ) {
      return null;
    }
    if ((createdId || cloneId) && nodes.has(id)) {
      writeCache(id, binding);
      return id;
    }
    const node: VisualNode = {
      id,
      durableIdentity: buildDurableIdentity(binding, root),
      role,
      parentId,
      childIds: [],
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
    if (parentId && id) {
      linkChild(parentId, id);
    }
    return id;
  };

  return {
    pick(clientX, clientY) {
      const stack = root.elementsFromPoint(clientX, clientY).map((element) =>
        element instanceof HTMLElement ? cloneEntityRoot(element) : element,
      ).filter((element, index, all) => all.indexOf(element) === index);
      const usable = stack.filter((node) => !(node instanceof Element) || !isExtensionRoot(node));
      return materialize(discoverFromPath(usable));
    },
    adopt(element) {
      if (!element.isConnected || isExtensionRoot(element)) {
        return null;
      }
      const binding = cloneEntityRoot(element);
      const discovered = discoverFromElement(binding);
      if (discovered) {
        return materialize(discovered);
      }
      if (binding.getAttribute("data-otf-element-id") || binding.getAttribute("data-otf-clone-id")) {
        return upsertNode(binding, "unit", null);
      }
      return null;
    },
    get(id) {
      return nodes.get(id) ?? null;
    },
    parentOf(id) {
      const existingParent = nodes.get(id)?.parentId ?? null;
      if (existingParent) {
        return existingParent;
      }
      let current = readCache(id)?.parentElement;
      while (current instanceof HTMLElement) {
        const discovered = discoverFromElement(current);
        if (discovered) {
          const parentId = materialize(discovered);
          if (parentId) {
            linkChild(parentId, id);
            return parentId;
          }
        }
        current = current.parentElement;
      }
      return null;
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
      if (cached) {
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
      const reboundId = upsertNode(resolved.element, "unit", null);
      if (!reboundId) {
        return {
          kind: "ambiguous",
          nodeId: null,
          identity: resolved.identity,
          candidateCount: 2,
          evidence: { ...resolved.evidence, strategy: "ambiguous", candidateCount: 2, reason: "duplicate_clone_id" },
        };
      }
      return withNodeId(resolved, reboundId);
    },
    cache(id, element) {
      writeCache(id, element);
    },
    invalidate(id) {
      cache.delete(id);
    },
  };
}
