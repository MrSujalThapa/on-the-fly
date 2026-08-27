export type Family =
  | "host"
  | "clone"
  | "created"
  | "layer"
  | "delete"
  | "lasso"
  | "persist"
  | "deep";

export type TargetName =
  | "mentions"
  | "jobs"
  | "posts"
  | "all"
  | "filter-bar"
  | "profile"
  | "notification"
  | "view-settings"
  | "clone"
  | "created"
  | "source";

export type CreatedKind = "rectangle" | "container" | "button";

export type Step =
  | { op: "select"; target: TargetName }
  | { op: "move"; dx: number; dy: number }
  | { op: "resize"; dx?: number; dy?: number }
  | { op: "rotate"; dx?: number; dy?: number }
  | { op: "duplicate" }
  | { op: "delete" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "front" }
  | { op: "back" }
  | { op: "style" }
  | { op: "save" }
  | { op: "reload" }
  | { op: "create"; kind: CreatedKind }
  | { op: "group" }
  | { op: "ungroup" }
  | { op: "lasso"; mode: "rectangle" | "freeform" }
  | { op: "lasso-again"; mode: "rectangle" | "freeform" }
  | { op: "shift-select"; target: TargetName }
  | { op: "wait"; ms: number }
  | { op: "warmup"; count: number };

export interface Scenario {
  readonly id: string;
  readonly family: Family;
  readonly title: string;
  readonly steps: readonly Step[];
}

function s(id: string, family: Family, title: string, steps: readonly Step[]): Scenario {
  return { id, family, title, steps };
}

export const SCENARIOS: readonly Scenario[] = [
  s("HOST-01", "host", "mentions resize → resize", [{ op: "select", target: "mentions" }, { op: "resize" }, { op: "resize", dx: 18, dy: 12 }]),
  s("HOST-02", "host", "jobs move → resize", [{ op: "select", target: "jobs" }, { op: "move", dx: 40, dy: 16 }, { op: "resize" }]),
  s("HOST-03", "host", "posts resize → move", [{ op: "select", target: "posts" }, { op: "resize" }, { op: "move", dx: 28, dy: 12 }]),
  s("HOST-04", "host", "mentions rotate → move", [{ op: "select", target: "mentions" }, { op: "rotate" }, { op: "move", dx: 200, dy: 0 }]),
  s("HOST-05", "host", "all move → rotate", [{ op: "select", target: "all" }, { op: "move", dx: 24, dy: 10 }, { op: "rotate" }]),
  s("HOST-06", "host", "jobs rotate → resize", [{ op: "select", target: "jobs" }, { op: "rotate" }, { op: "resize" }]),
  s("HOST-07", "host", "posts resize → rotate", [{ op: "select", target: "posts" }, { op: "resize" }, { op: "rotate" }]),
  s("HOST-08", "host", "mentions move → resize → move", [{ op: "select", target: "mentions" }, { op: "move", dx: 32, dy: 12 }, { op: "resize" }, { op: "move", dx: 20, dy: 8 }]),
  s("HOST-09", "host", "profile move → rotate → move", [{ op: "select", target: "profile" }, { op: "move", dx: 36, dy: 18 }, { op: "rotate" }, { op: "move", dx: 160, dy: 0 }]),
  s("HOST-10", "host", "notification resize → rotate → resize", [{ op: "select", target: "notification" }, { op: "resize" }, { op: "rotate" }, { op: "resize", dx: 16, dy: 10 }]),
  s("HOST-11", "host", "view-settings rotate → move → resize", [{ op: "select", target: "view-settings" }, { op: "rotate" }, { op: "move", dx: 48, dy: 12 }, { op: "resize" }]),
  s("HOST-12", "host", "filter-bar resize → move → rotate", [{ op: "lasso", mode: "rectangle" }, { op: "resize" }, { op: "move", dx: 24, dy: 14 }, { op: "rotate" }]),
  s("HOST-13", "host", "mentions layer → move → resize", [{ op: "select", target: "mentions" }, { op: "front" }, { op: "move", dx: 28, dy: 10 }, { op: "resize" }]),
  s("HOST-14", "host", "jobs move → layer → resize", [{ op: "select", target: "jobs" }, { op: "move", dx: 22, dy: 14 }, { op: "front" }, { op: "resize" }]),
  s("HOST-15", "host", "posts rotate → layer → move", [{ op: "select", target: "posts" }, { op: "rotate" }, { op: "back" }, { op: "move", dx: 40, dy: 0 }]),

  s("CLONE-01", "clone", "duplicate mentions → resize", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "resize" }]),
  s("CLONE-02", "clone", "duplicate jobs → resize → resize", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "resize" }, { op: "resize", dx: 14, dy: 10 }]),
  s("CLONE-03", "clone", "duplicate posts → move → resize", [{ op: "select", target: "posts" }, { op: "duplicate" }, { op: "move", dx: 36, dy: 16 }, { op: "resize" }]),
  s("CLONE-04", "clone", "duplicate profile → rotate → move", [{ op: "select", target: "profile" }, { op: "duplicate" }, { op: "rotate" }, { op: "move", dx: 180, dy: 0 }]),
  s("CLONE-05", "clone", "duplicate notification → rotate → resize", [{ op: "select", target: "notification" }, { op: "duplicate" }, { op: "rotate" }, { op: "resize" }]),
  s("CLONE-06", "clone", "duplicate mentions → resize → move", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "resize" }, { op: "move", dx: 24, dy: 12 }]),
  s("CLONE-07", "clone", "duplicate jobs → resize → rotate", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "resize" }, { op: "rotate" }]),
  s("CLONE-08", "clone", "duplicate posts → layer → resize", [{ op: "select", target: "posts" }, { op: "duplicate" }, { op: "front" }, { op: "resize" }]),
  s("CLONE-09", "clone", "duplicate profile → move → rotate → resize", [{ op: "select", target: "profile" }, { op: "duplicate" }, { op: "move", dx: 28, dy: 14 }, { op: "rotate" }, { op: "resize" }]),
  s("CLONE-10", "clone", "duplicate notification → rotate → move → resize", [{ op: "select", target: "notification" }, { op: "duplicate" }, { op: "rotate" }, { op: "move", dx: 40, dy: 10 }, { op: "resize" }]),
  s("CLONE-11", "clone", "duplicate mentions → resize → resize → move", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "resize" }, { op: "resize", dx: 12, dy: 8 }, { op: "move", dx: 18, dy: 8 }]),
  s("CLONE-12", "clone", "duplicate jobs → move → resize → resize", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "move", dx: 22, dy: 10 }, { op: "resize" }, { op: "resize", dx: 10, dy: 8 }]),
  s("CLONE-13", "clone", "duplicate posts → front → resize", [{ op: "select", target: "posts" }, { op: "duplicate" }, { op: "front" }, { op: "resize" }]),
  s("CLONE-14", "clone", "duplicate profile → back → front → resize", [{ op: "select", target: "profile" }, { op: "duplicate" }, { op: "back" }, { op: "front" }, { op: "resize" }]),
  s("CLONE-15", "clone", "duplicate notification → style → resize", [{ op: "select", target: "notification" }, { op: "duplicate" }, { op: "style" }, { op: "resize" }]),
  s("CLONE-16", "clone", "duplicate mentions → resize → style → resize", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "resize" }, { op: "style" }, { op: "resize", dx: 12, dy: 8 }]),
  s("CLONE-17", "clone", "duplicate jobs → delete source → resize clone", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "select", target: "clone" }, { op: "resize" }]),
  s("CLONE-18", "clone", "duplicate posts → delete clone → resize source", [{ op: "select", target: "posts" }, { op: "duplicate" }, { op: "delete" }, { op: "select", target: "source" }, { op: "resize" }]),
  s("CLONE-19", "clone", "duplicate mentions → undo → redo", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "undo" }, { op: "redo" }, { op: "resize" }]),
  s("CLONE-20", "clone", "duplicate profile → move → save → reload → resize", [{ op: "select", target: "profile" }, { op: "duplicate" }, { op: "move", dx: 30, dy: 12 }, { op: "save" }, { op: "reload" }, { op: "select", target: "clone" }, { op: "resize" }]),

  s("CREATE-01", "created", "rectangle create → resize", [{ op: "create", kind: "rectangle" }, { op: "resize" }]),
  s("CREATE-02", "created", "container create → resize → resize", [{ op: "create", kind: "container" }, { op: "resize" }, { op: "resize", dx: 16, dy: 12 }]),
  s("CREATE-03", "created", "button create → move → resize", [{ op: "create", kind: "button" }, { op: "move", dx: 40, dy: 18 }, { op: "resize" }]),
  s("CREATE-04", "created", "rectangle create → rotate → move", [{ op: "create", kind: "rectangle" }, { op: "rotate" }, { op: "move", dx: 160, dy: 0 }]),
  s("CREATE-05", "created", "container create → rotate → resize", [{ op: "create", kind: "container" }, { op: "rotate" }, { op: "resize" }]),
  s("CREATE-06", "created", "button create → move → rotate → move", [{ op: "create", kind: "button" }, { op: "move", dx: 24, dy: 10 }, { op: "rotate" }, { op: "move", dx: 140, dy: 0 }]),
  s("CREATE-07", "created", "rectangle create → style → resize", [{ op: "create", kind: "rectangle" }, { op: "style" }, { op: "resize" }]),
  s("CREATE-08", "created", "container create → resize → style → resize", [{ op: "create", kind: "container" }, { op: "resize" }, { op: "style" }, { op: "resize", dx: 12, dy: 8 }]),
  s("CREATE-09", "created", "button create → layer → resize", [{ op: "create", kind: "button" }, { op: "front" }, { op: "resize" }]),
  s("CREATE-10", "created", "rectangle create → move → layer → resize", [{ op: "create", kind: "rectangle" }, { op: "move", dx: 28, dy: 14 }, { op: "front" }, { op: "resize" }]),
  s("CREATE-11", "created", "container create → copy → paste → resize clone", [{ op: "create", kind: "container" }, { op: "duplicate" }, { op: "resize" }]),
  s("CREATE-12", "created", "button create → delete → undo", [{ op: "create", kind: "button" }, { op: "delete" }, { op: "wait", ms: 2000 }, { op: "undo" }]),
  s("CREATE-13", "created", "rectangle create → rotate → save → reload → move", [{ op: "create", kind: "rectangle" }, { op: "rotate" }, { op: "save" }, { op: "reload" }, { op: "select", target: "created" }, { op: "move", dx: 36, dy: 0 }]),
  s("CREATE-14", "created", "container create → resize → save → reload → resize", [{ op: "create", kind: "container" }, { op: "resize" }, { op: "save" }, { op: "reload" }, { op: "select", target: "created" }, { op: "resize", dx: 14, dy: 10 }]),
  s("CREATE-15", "created", "button create → move → resize → rotate → move", [{ op: "create", kind: "button" }, { op: "move", dx: 20, dy: 12 }, { op: "resize" }, { op: "rotate" }, { op: "move", dx: 120, dy: 0 }]),

  s("LAYER-01", "layer", "host front / clone back", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "back" }, { op: "select", target: "source" }, { op: "front" }]),
  s("LAYER-02", "layer", "clone front / host back", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "front" }, { op: "select", target: "source" }, { op: "back" }]),
  s("LAYER-03", "layer", "created front / host back", [{ op: "select", target: "posts" }, { op: "create", kind: "rectangle" }, { op: "front" }, { op: "select", target: "posts" }, { op: "back" }]),
  s("LAYER-04", "layer", "host front / created back", [{ op: "create", kind: "button" }, { op: "back" }, { op: "select", target: "mentions" }, { op: "front" }]),
  s("LAYER-05", "layer", "clone front / created back", [{ op: "select", target: "profile" }, { op: "duplicate" }, { op: "create", kind: "container" }, { op: "back" }, { op: "select", target: "clone" }, { op: "front" }]),
  s("LAYER-06", "layer", "created front / clone back", [{ op: "select", target: "notification" }, { op: "duplicate" }, { op: "back" }, { op: "create", kind: "rectangle" }, { op: "front" }]),
  s("LAYER-07", "layer", "front → back → front", [{ op: "create", kind: "button" }, { op: "front" }, { op: "back" }, { op: "front" }, { op: "resize" }]),
  s("LAYER-08", "layer", "back → front → back", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "back" }, { op: "front" }, { op: "back" }]),
  s("LAYER-09", "layer", "layer after MOVE", [{ op: "select", target: "jobs" }, { op: "move", dx: 36, dy: 14 }, { op: "front" }, { op: "resize" }]),
  s("LAYER-10", "layer", "layer after ROTATE", [{ op: "select", target: "posts" }, { op: "rotate" }, { op: "front" }, { op: "move", dx: 28, dy: 0 }]),

  s("DELETE-01", "delete", "duplicate → delete source", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "wait", ms: 2000 }, { op: "wait", ms: 8000 }]),
  s("DELETE-02", "delete", "duplicate → delete clone", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "delete" }, { op: "wait", ms: 2000 }, { op: "wait", ms: 8000 }]),
  s("DELETE-03", "delete", "duplicate twice → delete original", [{ op: "select", target: "posts" }, { op: "duplicate" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "wait", ms: 2000 }]),
  s("DELETE-04", "delete", "duplicate twice → delete middle clone", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "duplicate" }, { op: "select", target: "clone" }, { op: "delete" }, { op: "wait", ms: 2000 }]),
  s("DELETE-05", "delete", "move source → duplicate → delete source", [{ op: "select", target: "jobs" }, { op: "move", dx: 24, dy: 10 }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "wait", ms: 2000 }]),
  s("DELETE-06", "delete", "rotate source → duplicate → delete source", [{ op: "select", target: "posts" }, { op: "rotate" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "wait", ms: 2000 }]),
  s("DELETE-07", "delete", "duplicate → resize clone → delete source", [{ op: "select", target: "profile" }, { op: "duplicate" }, { op: "resize" }, { op: "select", target: "source" }, { op: "delete" }, { op: "wait", ms: 2000 }]),
  s("DELETE-08", "delete", "duplicate → delete source → undo → redo", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "undo" }, { op: "redo" }, { op: "wait", ms: 2000 }]),
  s("DELETE-09", "delete", "created → duplicate → delete created source", [{ op: "create", kind: "rectangle" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "wait", ms: 2000 }]),
  s("DELETE-10", "delete", "group mixed objects → delete → undo", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "shift-select", target: "source" }, { op: "group" }, { op: "delete" }, { op: "wait", ms: 2000 }, { op: "undo" }]),

  s("LASSO-01", "lasso", "rectangle lasso → move", [{ op: "lasso", mode: "rectangle" }, { op: "move", dx: 28, dy: 12 }]),
  s("LASSO-02", "lasso", "freeform lasso → move", [{ op: "lasso", mode: "freeform" }, { op: "move", dx: 24, dy: 10 }]),
  s("LASSO-03", "lasso", "freeform → use again → remains freeform", [{ op: "lasso", mode: "freeform" }, { op: "lasso-again", mode: "freeform" }]),
  s("LASSO-04", "lasso", "switch rectangle → use again → remains rectangle", [{ op: "lasso", mode: "rectangle" }, { op: "lasso-again", mode: "rectangle" }]),
  s("LASSO-05", "lasso", "lasso host + clone → resize", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "lasso", mode: "rectangle" }, { op: "resize" }]),
  s("LASSO-06", "lasso", "lasso host + created → move", [{ op: "create", kind: "rectangle" }, { op: "lasso", mode: "freeform" }, { op: "move", dx: 20, dy: 10 }]),
  s("LASSO-07", "lasso", "group host + clone → move", [{ op: "select", target: "jobs" }, { op: "duplicate" }, { op: "shift-select", target: "source" }, { op: "group" }, { op: "move", dx: 26, dy: 12 }]),
  s("LASSO-08", "lasso", "group → rotate → move", [{ op: "lasso", mode: "rectangle" }, { op: "group" }, { op: "rotate" }, { op: "move", dx: 36, dy: 0 }]),
  s("LASSO-09", "lasso", "group → resize → move", [{ op: "lasso", mode: "rectangle" }, { op: "group" }, { op: "resize" }, { op: "move", dx: 18, dy: 8 }]),
  s("LASSO-10", "lasso", "group → ungroup → individual resize", [{ op: "lasso", mode: "rectangle" }, { op: "group" }, { op: "ungroup" }, { op: "select", target: "mentions" }, { op: "resize" }]),

  s("PERSIST-01", "persist", "move → Save → reload → resize", [{ op: "select", target: "mentions" }, { op: "move", dx: 40, dy: 16 }, { op: "save" }, { op: "reload" }, { op: "select", target: "mentions" }, { op: "resize" }]),
  s("PERSIST-02", "persist", "resize → Save → reload → resize", [{ op: "select", target: "jobs" }, { op: "resize" }, { op: "save" }, { op: "reload" }, { op: "select", target: "jobs" }, { op: "resize", dx: 12, dy: 8 }]),
  s("PERSIST-03", "persist", "rotate → Save → reload → move", [{ op: "select", target: "posts" }, { op: "rotate" }, { op: "save" }, { op: "reload" }, { op: "select", target: "posts" }, { op: "move", dx: 48, dy: 0 }]),
  s("PERSIST-04", "persist", "duplicate → Save → reload → resize", [{ op: "select", target: "profile" }, { op: "duplicate" }, { op: "save" }, { op: "reload" }, { op: "select", target: "clone" }, { op: "resize" }]),
  s("PERSIST-05", "persist", "duplicate → resize → Save → reload → resize", [{ op: "select", target: "notification" }, { op: "duplicate" }, { op: "resize" }, { op: "save" }, { op: "reload" }, { op: "select", target: "clone" }, { op: "resize", dx: 12, dy: 8 }]),
  s("PERSIST-06", "persist", "delete source → Save → reload", [{ op: "select", target: "mentions" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "save" }, { op: "reload" }]),
  s("PERSIST-07", "persist", "created → move → Save → reload → resize", [{ op: "create", kind: "rectangle" }, { op: "move", dx: 30, dy: 12 }, { op: "save" }, { op: "reload" }, { op: "select", target: "created" }, { op: "resize" }]),
  s("PERSIST-08", "persist", "layer host/created → Save → reload", [{ op: "create", kind: "button" }, { op: "front" }, { op: "select", target: "jobs" }, { op: "back" }, { op: "save" }, { op: "reload" }]),
  s("PERSIST-09", "persist", "group transformations → Save → reload", [{ op: "lasso", mode: "rectangle" }, { op: "group" }, { op: "move", dx: 20, dy: 10 }, { op: "save" }, { op: "reload" }]),
  s("PERSIST-10", "persist", "mixed transforms → Save → reload → continue editing", [{ op: "select", target: "posts" }, { op: "move", dx: 18, dy: 8 }, { op: "resize" }, { op: "rotate" }, { op: "save" }, { op: "reload" }, { op: "select", target: "posts" }, { op: "move", dx: 22, dy: 0 }]),

  s("DEEP-01", "deep", "20+ prior ops then resize mentions", [{ op: "warmup", count: 20 }, { op: "select", target: "mentions" }, { op: "resize" }]),
  s("DEEP-02", "deep", "20+ prior ops then rotate → move", [{ op: "warmup", count: 20 }, { op: "select", target: "jobs" }, { op: "rotate" }, { op: "move", dx: 120, dy: 0 }]),
  s("DEEP-03", "deep", "30+ prior ops then duplicate → resize", [{ op: "warmup", count: 30 }, { op: "select", target: "posts" }, { op: "duplicate" }, { op: "resize" }]),
  s("DEEP-04", "deep", "30+ prior ops then created resize twice", [{ op: "warmup", count: 30 }, { op: "create", kind: "rectangle" }, { op: "resize" }, { op: "resize", dx: 12, dy: 8 }]),
  s("DEEP-05", "deep", "40+ prior ops then delete source", [{ op: "warmup", count: 40 }, { op: "select", target: "mentions" }, { op: "duplicate" }, { op: "select", target: "source" }, { op: "delete" }, { op: "wait", ms: 2000 }]),
  s("DEEP-06", "deep", "40+ prior ops then save reload resize", [{ op: "warmup", count: 40 }, { op: "create", kind: "button" }, { op: "save" }, { op: "reload" }, { op: "select", target: "created" }, { op: "resize" }]),
  s("DEEP-07", "deep", "50+ prior ops then move after rotate", [{ op: "warmup", count: 50 }, { op: "select", target: "profile" }, { op: "rotate" }, { op: "move", dx: 140, dy: 0 }]),
  s("DEEP-08", "deep", "50+ prior ops then clone resize after move", [{ op: "warmup", count: 50 }, { op: "select", target: "notification" }, { op: "duplicate" }, { op: "move", dx: 24, dy: 10 }, { op: "resize" }]),
  s("DEEP-09", "deep", "50+ prior ops then lasso group move", [{ op: "warmup", count: 50 }, { op: "lasso", mode: "freeform" }, { op: "move", dx: 18, dy: 8 }]),
  s("DEEP-10", "deep", "50+ prior ops then mixed continue", [{ op: "warmup", count: 50 }, { op: "create", kind: "container" }, { op: "move", dx: 20, dy: 8 }, { op: "resize" }, { op: "rotate" }, { op: "move", dx: 80, dy: 0 }]),
];

export function familyCounts(rows: readonly Scenario[]): Record<Family, number> {
  const counts: Record<Family, number> = {
    host: 0, clone: 0, created: 0, layer: 0, delete: 0, lasso: 0, persist: 0, deep: 0,
  };
  for (const row of rows) counts[row.family] += 1;
  return counts;
}
