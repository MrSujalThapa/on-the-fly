import { getMatchViewport } from "../dom/signature-matcher.js";
import { scanVisualNodes } from "../measurement/dom-scanner.js";
import { enrichNodeContainerMetadata } from "./container-detection.js";
import type { InvalidationReason } from "./types.js";
import type { GeometryCacheOptions, GeometryCacheState } from "./types.js";
import { VisualLayoutGraph } from "./visual-layout-graph.js";

export class GeometryCache {
  private readonly root: ParentNode;
  private readonly scanOptions: GeometryCacheOptions["scanOptions"];
  private readonly now: () => number;
  private readonly onRebuild: GeometryCacheOptions["onRebuild"];
  private graph: VisualLayoutGraph | null = null;
  private dirty = true;
  private version = 0;
  private lastInvalidationReason: InvalidationReason | null = null;
  private lastBuiltAt: number | null = null;

  constructor(options: GeometryCacheOptions) {
    this.root = options.root;
    this.scanOptions = options.scanOptions;
    this.now = options.now ?? (() => Date.now());
    this.onRebuild = options.onRebuild;
  }

  invalidate(reason: InvalidationReason = "manual"): void {
    this.dirty = true;
    this.lastInvalidationReason = reason;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  getVersion(): number {
    return this.version;
  }

  getGraph(): VisualLayoutGraph | null {
    return this.graph;
  }

  getState(): GeometryCacheState {
    return {
      dirty: this.dirty,
      version: this.version,
      lastInvalidationReason: this.lastInvalidationReason,
      lastBuiltAt: this.lastBuiltAt,
    };
  }

  rebuild(): VisualLayoutGraph {
    const startedAt = performance.now();
    const result = scanVisualNodes(this.root, this.scanOptions ?? {});
    const viewport = this.scanOptions?.viewport ?? getMatchViewport(this.root);
    enrichNodeContainerMetadata(result.nodes, viewport);
    this.version += 1;
    this.lastBuiltAt = this.now();
    this.graph = VisualLayoutGraph.fromScanResult(
      result,
      viewport,
      this.lastBuiltAt,
      this.version,
    );
    this.dirty = false;
    this.onRebuild?.({
      durationMs: performance.now() - startedAt,
      reason: this.lastInvalidationReason,
      nodeCount: result.nodes.size,
    });
    return this.graph;
  }

  ensureFresh(): VisualLayoutGraph {
    if (this.dirty || !this.graph) {
      return this.rebuild();
    }

    return this.graph;
  }
}

export function createGeometryCache(options: GeometryCacheOptions): GeometryCache {
  return new GeometryCache(options);
}
