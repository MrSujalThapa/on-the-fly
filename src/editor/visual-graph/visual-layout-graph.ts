import type { MatchViewport } from "../dom/types.js";
import type { VisualNodeId } from "../ids.js";
import type { VisualNodeBuildResult } from "../measurement/types.js";
import type { VisualNode } from "../visual-node.js";
import {
  filterSelectableNodes,
  findNearestContainer,
  findNearestParent,
  findNodesInRect,
  getNodeById,
} from "./graph-queries.js";
import type {
  GraphQueryOptions,
  RectQueryOptions,
  VisualLayoutGraphSnapshot,
} from "./types.js";
import type { MeasurementRect } from "../measurement/types.js";

export class VisualLayoutGraph {
  private readonly nodes: Map<VisualNodeId, VisualNode>;
  private readonly rootNodeIds: VisualNodeId[];
  private readonly viewport: MatchViewport;
  private readonly builtAt: number;
  private readonly version: number;

  constructor(snapshot: VisualLayoutGraphSnapshot) {
    this.nodes = new Map(snapshot.nodes);
    this.rootNodeIds = [...snapshot.rootNodeIds];
    this.viewport = snapshot.viewport;
    this.builtAt = snapshot.builtAt;
    this.version = snapshot.version;
  }

  static fromScanResult(
    result: VisualNodeBuildResult,
    viewport: MatchViewport,
    builtAt: number,
    version: number,
  ): VisualLayoutGraph {
    return new VisualLayoutGraph({
      nodes: result.nodes,
      rootNodeIds: result.rootNodeIds,
      viewport,
      builtAt,
      version,
    });
  }

  getNodeById(nodeId: VisualNodeId): VisualNode | undefined {
    return getNodeById(this.nodes, nodeId);
  }

  getRootNodeIds(): readonly VisualNodeId[] {
    return this.rootNodeIds;
  }

  getViewport(): MatchViewport {
    return this.viewport;
  }

  getBuiltAt(): number {
    return this.builtAt;
  }

  getVersion(): number {
    return this.version;
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  getNodes(): Iterable<VisualNode> {
    return this.nodes.values();
  }

  getSelectableNodes(options: GraphQueryOptions = {}): VisualNode[] {
    return filterSelectableNodes(this.nodes.values(), options);
  }

  findNodesInRect(rect: MeasurementRect, options: RectQueryOptions = {}): VisualNode[] {
    return findNodesInRect(this.nodes.values(), rect, options);
  }

  findNearestParent(nodeId: VisualNodeId, options: GraphQueryOptions = {}): VisualNode | undefined {
    return findNearestParent(this.nodes, nodeId, options);
  }

  findNearestContainer(
    nodeId: VisualNodeId,
    options: GraphQueryOptions = {},
  ): VisualNode | undefined {
    return findNearestContainer(this.nodes, nodeId, options);
  }

  toSnapshot(): VisualLayoutGraphSnapshot {
    return {
      nodes: this.nodes,
      rootNodeIds: this.rootNodeIds,
      viewport: this.viewport,
      builtAt: this.builtAt,
      version: this.version,
    };
  }
}
