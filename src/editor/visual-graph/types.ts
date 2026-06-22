import type { MatchViewport } from "../dom/types.js";
import type { VisualNodeId } from "../ids.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { VisualNodeKind } from "../visual-node.js";

export type InvalidationReason = "scroll" | "resize" | "mutation" | "edit" | "manual";

export interface GraphQueryOptions {
  includePageLevel?: boolean;
  kinds?: VisualNodeKind[];
}

export interface VisualLayoutGraphSnapshot {
  nodes: ReadonlyMap<VisualNodeId, import("../visual-node.js").VisualNode>;
  rootNodeIds: readonly VisualNodeId[];
  viewport: MatchViewport;
  builtAt: number;
  version: number;
}

export interface RectQueryOptions extends GraphQueryOptions {
  mode?: "overlap" | "center" | "contain";
}

export interface GeometryCacheState {
  dirty: boolean;
  version: number;
  lastInvalidationReason: InvalidationReason | null;
  lastBuiltAt: number | null;
}

export type ScheduleFn = (callback: () => void, delayMs: number) => number;
export type CancelFn = (handle: number) => void;

export interface InvalidationSchedulerOptions {
  onFlush: (reasons: InvalidationReason[]) => void;
  throttleMs?: number;
  debounceMs?: number;
  schedule?: ScheduleFn;
  cancel?: CancelFn;
}

export interface GeometryCacheOptions {
  root: ParentNode;
  scanOptions?: import("../measurement/types.js").ScanOptions;
  now?: () => number;
}

export interface DomInvalidationListenerOptions {
  window: Window;
  root: ParentNode;
  scheduler: import("./invalidation-scheduler.js").InvalidationScheduler;
  mutationRoot?: Node;
}

export type MeasurementRectInput = MeasurementRect;
