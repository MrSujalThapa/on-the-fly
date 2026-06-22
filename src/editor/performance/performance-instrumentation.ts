/** Set to `true` locally when investigating editor latency. */
export const PERFORMANCE_DEBUG = false;

export type PerformanceSampleKind =
  | "selection"
  | "lasso"
  | "transform-frame"
  | "geometry-rebuild"
  | "replay";

export interface PerformanceSample {
  kind: PerformanceSampleKind;
  durationMs: number;
  detail?: Record<string, unknown>;
}

export interface PerformanceInstrumentation {
  begin(kind: "selection" | "lasso"): () => void;
  record(kind: PerformanceSampleKind, durationMs: number, detail?: Record<string, unknown>): void;
  getSamples(kind?: PerformanceSampleKind): readonly PerformanceSample[];
  reset(): void;
}

export function logPerformanceDebug(message: string, data?: unknown): void {
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- intentional dev toggle */
  if (!PERFORMANCE_DEBUG) {
    return;
  }
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  if (data === undefined) {
    console.debug(`[OTF perf] ${message}`);
    return;
  }

  console.debug(`[OTF perf] ${message}`, data);
}

export function createPerformanceInstrumentation(): PerformanceInstrumentation {
  const samples: PerformanceSample[] = [];

  return {
    begin(kind) {
      const startedAt = performance.now();
      return () => {
        const durationMs = performance.now() - startedAt;
        this.record(kind, durationMs);
      };
    },
    record(kind, durationMs, detail) {
      const sample: PerformanceSample = detail
      ? { kind, durationMs, detail }
      : { kind, durationMs };
      samples.push(sample);
      logPerformanceDebug(kind, { durationMs, ...detail });
    },
    getSamples(kind) {
      if (kind === undefined) {
        return samples;
      }
      return samples.filter((sample) => sample.kind === kind);
    },
    reset() {
      samples.length = 0;
    },
  };
}
