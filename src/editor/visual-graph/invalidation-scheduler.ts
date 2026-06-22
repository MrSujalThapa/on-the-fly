import type {
  CancelFn,
  InvalidationReason,
  InvalidationSchedulerOptions,
  ScheduleFn,
} from "./types.js";

const THROTTLED_REASONS = new Set<InvalidationReason>(["scroll", "resize"]);
const DEBOUNCED_REASONS = new Set<InvalidationReason>(["mutation", "edit"]);

function defaultSchedule(callback: () => void, delayMs: number): number {
  return setTimeout(callback, delayMs) as unknown as number;
}

function defaultCancel(handle: number): void {
  clearTimeout(handle);
}

export class InvalidationScheduler {
  private readonly onFlush: (reasons: InvalidationReason[]) => void;
  private readonly throttleMs: number;
  private readonly debounceMs: number;
  private readonly schedule: ScheduleFn;
  private readonly cancel: CancelFn;
  private readonly pendingReasons = new Set<InvalidationReason>();
  private throttleTimer: number | null = null;
  private debounceTimer: number | null = null;

  constructor(options: InvalidationSchedulerOptions) {
    this.onFlush = options.onFlush;
    this.throttleMs = options.throttleMs ?? 100;
    this.debounceMs = options.debounceMs ?? 150;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;
  }

  request(reason: InvalidationReason): void {
    if (reason === "manual") {
      this.pendingReasons.add(reason);
      this.flush();
      return;
    }

    this.pendingReasons.add(reason);

    if (THROTTLED_REASONS.has(reason)) {
      this.scheduleThrottledFlush();
      return;
    }

    if (DEBOUNCED_REASONS.has(reason)) {
      this.scheduleDebouncedFlush();
    }
  }

  flush(): void {
    this.clearTimers();

    if (this.pendingReasons.size === 0) {
      return;
    }

    const reasons = Array.from(this.pendingReasons);
    this.pendingReasons.clear();
    this.onFlush(reasons);
  }

  dispose(): void {
    this.clearTimers();
    this.pendingReasons.clear();
  }

  private scheduleThrottledFlush(): void {
    if (this.throttleTimer !== null) {
      return;
    }

    this.throttleTimer = this.schedule(() => {
      this.throttleTimer = null;
      this.flush();
    }, this.throttleMs);
  }

  private scheduleDebouncedFlush(): void {
    if (this.debounceTimer !== null) {
      this.cancel(this.debounceTimer);
    }

    this.debounceTimer = this.schedule(() => {
      this.debounceTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  private clearTimers(): void {
    if (this.throttleTimer !== null) {
      this.cancel(this.throttleTimer);
      this.throttleTimer = null;
    }

    if (this.debounceTimer !== null) {
      this.cancel(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

export function createInvalidationScheduler(
  options: InvalidationSchedulerOptions,
): InvalidationScheduler {
  return new InvalidationScheduler(options);
}

export function resolvePrimaryInvalidationReason(
  reasons: InvalidationReason[],
): InvalidationReason {
  if (reasons.includes("manual")) {
    return "manual";
  }

  if (reasons.includes("edit")) {
    return "edit";
  }

  if (reasons.includes("mutation")) {
    return "mutation";
  }

  if (reasons.includes("resize")) {
    return "resize";
  }

  return "scroll";
}
