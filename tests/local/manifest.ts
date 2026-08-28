import type { FixtureTarget, MutationKind } from "./harness.js";

export type TargetName = FixtureTarget | "clone" | "created" | "current";

export type Step =
  | { op: "select"; target: TargetName }
  | { op: "shift-select"; target: TargetName }
  | { op: "move"; dx: number; dy: number }
  | { op: "resize"; dx: number; dy: number; handle?: string }
  | { op: "rotate"; dx: number; dy: number }
  | { op: "front" }
  | { op: "back" }
  | { op: "style"; value?: string }
  | { op: "duplicate" }
  | { op: "create"; kind: string }
  | { op: "delete" }
  | { op: "delete-source" }
  | { op: "undo" }
  | { op: "redo" }
  | { op: "save" }
  | { op: "reload" }
  | { op: "lasso"; mode: "rectangle" | "freeform" }
  | { op: "lasso-again"; mode: "rectangle" | "freeform" }
  | { op: "group" }
  | { op: "ungroup" }
  | { op: "mutate"; kind: MutationKind }
  | { op: "copy-paste" }
  | { op: "wait"; ms: number };

export interface Scenario {
  readonly id: string;
  readonly family: "HOST" | "CLONE" | "CREATED" | "MULTI" | "GROUP";
  readonly steps: readonly Step[];
}

const sel = (target: TargetName): Step => ({ op: "select", target });
const shsel = (target: TargetName): Step => ({ op: "shift-select", target });
const mv = (dx: number, dy: number): Step => ({ op: "move", dx, dy });
const rs = (dx: number, dy: number): Step => ({ op: "resize", dx, dy });
const rot = (dx: number, dy: number): Step => ({ op: "rotate", dx, dy });
const front = (): Step => ({ op: "front" });
const back = (): Step => ({ op: "back" });
const style = (): Step => ({ op: "style" });
const dup = (): Step => ({ op: "duplicate" });
const create = (kind: string): Step => ({ op: "create", kind });
const del = (): Step => ({ op: "delete" });
const delSource = (): Step => ({ op: "delete-source" });
const undo = (): Step => ({ op: "undo" });
const redo = (): Step => ({ op: "redo" });
const save = (): Step => ({ op: "save" });
const reload = (): Step => ({ op: "reload" });
const lasso = (mode: "rectangle" | "freeform"): Step => ({ op: "lasso", mode });
const lassoAgain = (mode: "rectangle" | "freeform"): Step => ({ op: "lasso-again", mode });
const group = (): Step => ({ op: "group" });
const ungroup = (): Step => ({ op: "ungroup" });
const mutate = (kind: MutationKind): Step => ({ op: "mutate", kind });
const copyPaste = (): Step => ({ op: "copy-paste" });

function scenario(id: string, family: Scenario["family"], steps: Step[]): Scenario {
  return { id, family, steps };
}

/**
 * Host-element operation histories. Targets are chosen so the same chain runs
 * against structurally different hosts (interactive pill, boxless-wrapped link,
 * card block, min-content box, pre-rotated host, stacked/overflowing box).
 */
const HOST_CHAINS: Array<{ name: string; steps: (t: TargetName) => Step[] }> = [
  { name: "move-resize", steps: (t) => [sel(t), mv(40, 26), rs(34, 20)] },
  { name: "resize-move", steps: (t) => [sel(t), rs(38, 22), mv(-46, 18)] },
  { name: "rotate-move", steps: (t) => [sel(t), rot(52, 26), mv(96, 0)] },
  { name: "rotate-resize", steps: (t) => [sel(t), rot(48, 22), rs(36, 24)] },
  { name: "resize-rotate-resize", steps: (t) => [sel(t), rs(32, 18), rot(46, 20), rs(28, 22)] },
  { name: "move-rotate-move", steps: (t) => [sel(t), mv(36, 22), rot(50, 24), mv(-92, 8)] },
  { name: "move-resize-rotate-move", steps: (t) => [sel(t), mv(30, 18), rs(30, 20), rot(44, 18), mv(88, -6)] },
  { name: "resize-move-resize", steps: (t) => [sel(t), rs(30, 16), mv(42, 20), rs(-22, 26)] },
  { name: "move-move", steps: (t) => [sel(t), mv(34, 20), mv(-28, -14)] },
  { name: "resize-resize", steps: (t) => [sel(t), rs(28, 16), rs(26, 20)] },
  { name: "rotate-rotate", steps: (t) => [sel(t), rot(40, 18), rot(36, 22)] },
  { name: "move-resize-move-resize", steps: (t) => [sel(t), mv(28, 16), rs(26, 18), mv(-34, 12), rs(24, 20)] },
  { name: "rotate-resize-move", steps: (t) => [sel(t), rot(44, 20), rs(30, 22), mv(90, 6)] },
  { name: "move-front-move", steps: (t) => [sel(t), mv(32, 18), front(), mv(-30, 14)] },
  { name: "front-move", steps: (t) => [sel(t), front(), mv(44, 22)] },
  { name: "move-back", steps: (t) => [sel(t), mv(36, 20), back()] },
  { name: "rotate-front-move", steps: (t) => [sel(t), rot(46, 20), front(), mv(94, 4)] },
  { name: "back-front-move", steps: (t) => [sel(t), back(), front(), mv(38, 18)] },
  { name: "style-resize", steps: (t) => [sel(t), style(), rs(32, 20)] },
  { name: "style-move", steps: (t) => [sel(t), style(), mv(42, 22)] },
  { name: "move-style-rotate", steps: (t) => [sel(t), mv(30, 18), style(), rot(46, 20)] },
  { name: "resize-undo-redo-move", steps: (t) => [sel(t), rs(34, 20), undo(), redo(), sel(t), mv(40, 20)] },
  { name: "move-undo-move", steps: (t) => [sel(t), mv(38, 22), undo(), sel(t), mv(30, -18)] },
  { name: "move-resize-undo-resize", steps: (t) => [sel(t), mv(32, 18), rs(30, 20), undo(), sel(t), rs(28, 24)] },
  { name: "rotate-undo-rotate", steps: (t) => [sel(t), rot(44, 20), undo(), sel(t), rot(40, 24)] },
  { name: "move-delete", steps: (t) => [sel(t), mv(34, 20), del()] },
  { name: "resize-delete-undo", steps: (t) => [sel(t), rs(32, 18), del(), undo()] },
  { name: "move-save-reload-move", steps: (t) => [sel(t), mv(40, 24), save(), reload(), sel(t), mv(-34, 16)] },
  { name: "resize-save-reload-resize", steps: (t) => [sel(t), rs(36, 22), save(), reload(), sel(t), rs(26, 18)] },
  { name: "rotate-save-reload-rotate", steps: (t) => [sel(t), rot(48, 22), save(), reload(), sel(t), rot(38, 20)] },
  { name: "move-save-reload-delete", steps: (t) => [sel(t), mv(38, 22), save(), reload(), sel(t), del()] },
  { name: "move-resize-save-reload-move-save", steps: (t) => [sel(t), mv(30, 18), rs(28, 20), save(), reload(), sel(t), mv(36, -14), save()] },
  { name: "move-save-reload-duplicate", steps: (t) => [sel(t), mv(36, 20), save(), reload(), sel(t), dup(), mv(30, 24)] },
  { name: "mutate-rerender-move", steps: (t) => [sel(t), mv(36, 20), mutate("rerender-row"), sel(t), mv(-30, 16)] },
  { name: "mutate-replace-resize", steps: (t) => [sel(t), rs(34, 20), mutate("replace-subtree"), sel(t), rs(26, 18)] },
  { name: "mutate-remove-reinsert-move", steps: (t) => [sel(t), mv(34, 18), mutate("remove-reinsert"), sel(t), mv(28, -16)] },
  { name: "mutate-add-sibling-resize", steps: (t) => [sel(t), mv(30, 18), mutate("add-sibling"), sel(t), rs(30, 22)] },
  { name: "mutate-reflow-move", steps: (t) => [sel(t), mv(32, 20), mutate("reflow-siblings"), sel(t), mv(-26, 14)] },
  { name: "mutate-churn-move", steps: (t) => [sel(t), rot(44, 20), mutate("churn-cards"), sel(t), mv(88, 6)] },
  { name: "mutate-remove-sibling-resize", steps: (t) => [sel(t), mutate("add-sibling"), sel(t), mv(30, 18), mutate("remove-sibling"), sel(t), rs(28, 20)] },
  { name: "save-mutate-reload-move", steps: (t) => [sel(t), mv(38, 22), save(), mutate("rerender-row"), reload(), sel(t), mv(-30, 18)] },
  { name: "move-mutate-save-reload", steps: (t) => [sel(t), mv(34, 20), mutate("reflow-siblings"), save(), reload(), sel(t), rs(26, 18)] },
];

const HOST_TARGETS: TargetName[] = [
  "pill-alpha",
  "pill-beta",
  "pill-gamma",
  "pill-delta",
  "profile",
  "card-one",
  "card-two",
  "nested",
  "auto-width",
  "min-content",
  "flex-grow",
  "relative",
  "stacked-low",
  "overflow-child",
];

/** Chains rerun against extra structural classes, not repeated on the same host. */
const HOST_EXTRA_TARGETS: Record<string, TargetName[]> = {
  "move-resize": ["profile", "min-content"],
  "resize-move": ["card-one", "overflow-child"],
  "rotate-move": ["nested", "overflow-child", "pre-transformed"],
  "rotate-resize": ["pill-delta", "flex-grow"],
  "resize-rotate-resize": ["auto-width", "stacked-low"],
  "move-rotate-move": ["card-two", "pill-gamma"],
  "move-resize-rotate-move": ["relative", "profile"],
  "resize-move-resize": ["pill-alpha", "nested"],
};

const CLONE_CHAINS: Array<{ name: string; steps: (t: TargetName) => Step[] }> = [
  { name: "dup-resize", steps: (t) => [sel(t), dup(), rs(36, 22)] },
  { name: "dup-resize-resize", steps: (t) => [sel(t), dup(), rs(30, 18), rs(26, 20)] },
  { name: "dup-move-resize", steps: (t) => [sel(t), dup(), mv(50, 30), rs(30, 20)] },
  { name: "dup-rotate-move", steps: (t) => [sel(t), dup(), rot(50, 24), mv(94, 4)] },
  { name: "dup-rotate-resize", steps: (t) => [sel(t), dup(), rot(46, 22), rs(32, 22)] },
  { name: "dup-move-rotate-resize", steps: (t) => [sel(t), dup(), mv(46, 26), rot(44, 20), rs(28, 20)] },
  { name: "dup-style-resize", steps: (t) => [sel(t), dup(), style(), rs(32, 20)] },
  { name: "dup-front-resize", steps: (t) => [sel(t), dup(), front(), rs(30, 22)] },
  { name: "dup-back-move", steps: (t) => [sel(t), dup(), back(), mv(48, 26)] },
  { name: "dup-delete-source", steps: (t) => [sel(t), dup(), mv(46, 28), delSource()] },
  { name: "dup-twice-delete-original", steps: (t) => [sel(t), dup(), mv(44, 26), sel(t), dup(), mv(-40, 30), delSource()] },
  { name: "dup-delete-source-undo-redo", steps: (t) => [sel(t), dup(), mv(44, 26), delSource(), undo(), redo()] },
  { name: "dup-delete-clone-undo", steps: (t) => [sel(t), dup(), mv(42, 24), sel("clone"), del(), undo()] },
  { name: "dup-move-undo-redo", steps: (t) => [sel(t), dup(), mv(46, 26), undo(), redo()] },
  { name: "dup-save-reload-move", steps: (t) => [sel(t), dup(), mv(48, 28), save(), reload(), sel("clone"), mv(-36, 18)] },
  { name: "dup-save-reload-resize", steps: (t) => [sel(t), dup(), mv(44, 26), save(), reload(), sel("clone"), rs(30, 20)] },
  { name: "dup-save-reload-rotate", steps: (t) => [sel(t), dup(), mv(44, 26), save(), reload(), sel("clone"), rot(46, 22)] },
  { name: "dup-save-reload-delete", steps: (t) => [sel(t), dup(), mv(46, 26), save(), reload(), sel("clone"), del()] },
  { name: "dup-rotate-save-reload-rotate", steps: (t) => [sel(t), dup(), rot(48, 22), save(), reload(), sel("clone"), rot(40, 20)] },
  { name: "dup-mutate-move", steps: (t) => [sel(t), dup(), mv(44, 26), mutate("rerender-row"), sel("clone"), mv(-34, 16)] },
  { name: "dup-resize-mutate-move", steps: (t) => [sel(t), dup(), rs(32, 20), mutate("replace-subtree"), sel("clone"), mv(52, 22)] },
  { name: "dup-move-save-reload-resize", steps: (t) => [sel(t), dup(), mv(50, 28), save(), reload(), sel("clone"), rs(28, 18), save()] },
  { name: "dup-copy-paste-resize", steps: (t) => [sel(t), dup(), mv(44, 26), copyPaste(), rs(30, 20)] },
  { name: "dup-layer-move-move", steps: (t) => [sel(t), dup(), back(), mv(46, 26), mv(-30, 14)] },
  { name: "dup-move-then-source-move", steps: (t) => [sel(t), dup(), mv(48, 28), sel(t), mv(-34, 18)] },
];

const CLONE_TARGETS: TargetName[] = [
  "pill-alpha",
  "pill-beta",
  "pill-gamma",
  "profile",
  "card-one",
  "nested",
  "auto-width",
  "min-content",
  "relative",
  "stacked-low",
];

const CREATED_CHAINS: Array<{ name: string; kind: string; steps: Step[] }> = [
  { name: "create-resize", kind: "rectangle", steps: [rs(40, 26)] },
  { name: "create-move-resize", kind: "rectangle", steps: [mv(56, 30), rs(32, 22)] },
  { name: "create-rotate-move", kind: "circle", steps: [rot(52, 24), mv(96, 4)] },
  { name: "create-rotate-resize", kind: "circle", steps: [rot(46, 22), rs(34, 24)] },
  { name: "create-front-move", kind: "badge", steps: [front(), mv(52, 26)] },
  { name: "create-back-resize", kind: "badge", steps: [back(), rs(32, 20)] },
  { name: "create-copy-paste-resize", kind: "button", steps: [copyPaste(), rs(30, 22)] },
  { name: "create-delete-undo", kind: "button", steps: [mv(48, 24), del(), undo()] },
  { name: "create-save-reload-move", kind: "text", steps: [mv(54, 28), save(), reload(), sel("created"), mv(-38, 18)] },
  { name: "create-save-reload-resize", kind: "text", steps: [mv(50, 26), save(), reload(), sel("created"), rs(30, 20)] },
  { name: "create-save-reload-delete", kind: "card", steps: [mv(48, 26), save(), reload(), sel("created"), del()] },
  { name: "create-style-move", kind: "container", steps: [style(), mv(54, 28)] },
  { name: "create-mutate-move", kind: "rectangle", steps: [mv(50, 26), mutate("rerender-row"), sel("created"), mv(-36, 16)] },
  { name: "create-undo-redo-move", kind: "heading", steps: [mv(48, 24), undo(), redo(), sel("created"), mv(32, 18)] },
  { name: "create-move-rotate-resize", kind: "input", steps: [mv(46, 24), rot(44, 20), rs(30, 20)] },
  { name: "create-resize-save-reload-rotate", kind: "search", steps: [rs(36, 22), save(), reload(), sel("created"), rot(46, 22)] },
  { name: "create-divider-move-resize", kind: "divider", steps: [mv(52, 26), rs(40, 12)] },
  { name: "create-header-resize-move", kind: "header", steps: [rs(38, 20), mv(-44, 26)] },
];

const MULTI_CHAINS: Array<{ name: string; steps: Step[] }> = [
  { name: "multi2-move", steps: [sel("pill-alpha"), shsel("pill-beta"), mv(38, 24)] },
  { name: "multi2-resize-move", steps: [sel("pill-alpha"), shsel("pill-beta"), rs(30, 20), mv(34, 18)] },
  { name: "multi2-rotate-move", steps: [sel("pill-beta"), shsel("pill-gamma"), rot(46, 22), mv(92, 6)] },
  { name: "multi2-resize-rotate-move", steps: [sel("pill-beta"), shsel("pill-gamma"), rs(28, 18), rot(44, 20), mv(88, 4)] },
  { name: "multi3-move", steps: [sel("pill-alpha"), shsel("pill-beta"), shsel("pill-gamma"), mv(40, 26)] },
  { name: "multi3-resize", steps: [sel("pill-alpha"), shsel("pill-beta"), shsel("pill-gamma"), rs(34, 22)] },
  { name: "multi-cards-move", steps: [sel("card-one"), shsel("card-two"), mv(44, 26)] },
  { name: "multi-cards-resize-move", steps: [sel("card-one"), shsel("card-two"), rs(32, 20), mv(-38, 20)] },
  { name: "multi-mixed-move", steps: [sel("profile"), shsel("nested"), mv(42, 24)] },
  { name: "multi-mixed-resize", steps: [sel("auto-width"), shsel("min-content"), rs(30, 20)] },
  { name: "multi-style-move", steps: [sel("pill-alpha"), shsel("pill-beta"), style(), mv(36, 22)] },
  { name: "multi-delete", steps: [sel("pill-alpha"), shsel("pill-beta"), mv(34, 20), del()] },
  { name: "multi-move-undo-redo", steps: [sel("pill-alpha"), shsel("pill-beta"), mv(40, 24), undo(), redo()] },
  { name: "multi-save-reload-move", steps: [sel("pill-alpha"), shsel("pill-beta"), mv(40, 24), save(), reload(), sel("pill-alpha"), mv(-30, 16)] },
  { name: "multi-mutate-move", steps: [sel("pill-alpha"), shsel("pill-beta"), mv(38, 22), mutate("rerender-row"), sel("pill-alpha"), mv(-28, 14)] },
  { name: "lasso-rect-move", steps: [lasso("rectangle"), mv(38, 24)] },
  { name: "lasso-rect-resize", steps: [lasso("rectangle"), rs(32, 22)] },
  { name: "lasso-rect-rotate-move", steps: [lasso("rectangle"), rot(46, 22), mv(90, 4)] },
  { name: "lasso-freeform-move", steps: [lasso("freeform"), mv(40, 24)] },
  { name: "lasso-freeform-resize", steps: [lasso("freeform"), rs(30, 20)] },
  { name: "lasso-again-move", steps: [lasso("rectangle"), mv(34, 20), lassoAgain("rectangle"), mv(-30, 16)] },
  { name: "lasso-delete-undo", steps: [lasso("rectangle"), mv(32, 20), del(), undo()] },
  { name: "lasso-save-reload", steps: [lasso("rectangle"), mv(38, 22), save(), reload(), sel("pill-beta"), mv(-28, 14)] },
  { name: "lasso-style-move", steps: [lasso("rectangle"), style(), mv(36, 22)] },
  { name: "lasso-mutate-move", steps: [lasso("rectangle"), mv(36, 22), mutate("rerender-row"), sel("pill-beta"), mv(-30, 16)] },
];

const GROUP_CHAINS: Array<{ name: string; steps: Step[] }> = [
  { name: "group-resize-move", steps: [sel("pill-alpha"), shsel("pill-beta"), group(), rs(32, 20), mv(36, 22)] },
  { name: "group-rotate-move", steps: [sel("pill-alpha"), shsel("pill-beta"), group(), rot(46, 22), mv(90, 6)] },
  { name: "group-ungroup-resize-member", steps: [sel("pill-alpha"), shsel("pill-beta"), group(), mv(34, 20), ungroup(), sel("pill-alpha"), rs(28, 20)] },
  { name: "group-move-undo", steps: [sel("pill-alpha"), shsel("pill-beta"), group(), mv(38, 24), undo()] },
  { name: "group-save-reload-move", steps: [sel("pill-alpha"), shsel("pill-beta"), group(), mv(38, 24), save(), reload(), sel("pill-alpha"), mv(-30, 16)] },
  { name: "group-delete", steps: [sel("pill-alpha"), shsel("pill-beta"), group(), mv(32, 20), del()] },
  { name: "group-style-move", steps: [sel("card-one"), shsel("card-two"), group(), style(), mv(40, 24)] },
  { name: "group-cards-resize-move", steps: [sel("card-one"), shsel("card-two"), group(), rs(34, 22), mv(-36, 20)] },
  { name: "group-mutate-move", steps: [sel("pill-alpha"), shsel("pill-beta"), group(), mv(36, 22), mutate("rerender-row"), sel("pill-alpha"), mv(-28, 14)] },
  { name: "lasso-group-move", steps: [lasso("rectangle"), group(), mv(38, 24)] },
  { name: "lasso-group-ungroup-move", steps: [lasso("rectangle"), group(), mv(34, 20), ungroup(), sel("pill-beta"), mv(-28, 16)] },
  { name: "group-mixed-rotate-resize", steps: [sel("profile"), shsel("nested"), group(), rot(44, 20), rs(30, 20)] },
];

/** Extra persistence and layering depth beyond the per-family chains. */
const EXTRA_SCENARIOS: Scenario[] = [
  scenario("PERSIST-01", "HOST", [sel("pill-alpha"), mv(36, 20), save(), sel("pill-beta"), rs(30, 20), save(), reload(), sel("pill-alpha"), mv(34, 18), save()]),
  scenario("PERSIST-02", "HOST", [sel("card-one"), rs(34, 22), save(), reload(), sel("card-one"), mv(38, 22), save(), reload(), sel("card-one"), rs(26, 18)]),
  scenario("PERSIST-03", "CLONE", [sel("pill-beta"), dup(), mv(46, 26), save(), reload(), sel("clone"), dup(), mv(-40, 24), save(), reload(), sel("clone"), rs(28, 20)]),
  scenario("PERSIST-04", "CREATED", [create("rectangle"), mv(52, 26), save(), reload(), sel("created"), rot(46, 22), save(), reload(), sel("created"), rs(30, 20)]),
  scenario("PERSIST-05", "HOST", [sel("relative"), rot(46, 22), mv(90, 6), save(), reload(), sel("relative"), mv(-84, -4)]),
  scenario("PERSIST-06", "MULTI", [sel("pill-alpha"), shsel("pill-beta"), shsel("pill-gamma"), mv(38, 22), save(), reload(), sel("pill-beta"), rs(28, 18), save()]),
  scenario("PERSIST-07", "HOST", [sel("pre-transformed"), rot(44, 20), rs(34, 22), save(), reload(), sel("pre-transformed"), rot(40, 18), save()]),
  scenario("PERSIST-08", "HOST", [sel("overflow-child"), mv(40, 22), save(), mutate("replace-subtree"), reload(), sel("overflow-child"), rs(26, 18)]),
  scenario("LAYER-01", "HOST", [sel("stacked-low"), front(), mv(40, 22), back(), mv(-32, 16)]),
  scenario("LAYER-02", "HOST", [sel("stacked-high"), back(), rs(30, 20), front(), mv(36, 20)]),
  scenario("LAYER-03", "CLONE", [sel("stacked-low"), dup(), front(), mv(44, 26), back(), rs(28, 20)]),
  scenario("LAYER-04", "HOST", [sel("pill-delta"), front(), rot(46, 22), mv(88, 6), back()]),
  scenario("MUTATE-01", "HOST", [sel("pill-beta"), mv(36, 20), mutate("rerender-row"), mutate("reflow-siblings"), sel("pill-beta"), mv(-30, 16)]),
  scenario("MUTATE-02", "HOST", [sel("card-two"), rs(32, 20), mutate("replace-subtree"), mutate("churn-cards"), sel("card-two"), mv(38, 22)]),
  scenario("MUTATE-03", "CLONE", [sel("pill-gamma"), dup(), mv(44, 26), mutate("add-sibling"), mutate("rerender-row"), sel("clone"), rs(28, 20)]),
  scenario("MUTATE-04", "HOST", [sel("nested"), mv(34, 20), mutate("remove-reinsert"), undo(), sel("nested"), mv(30, -16)]),
  scenario("MUTATE-05", "MULTI", [lasso("rectangle"), mv(34, 20), mutate("add-sibling"), lassoAgain("rectangle"), mv(-30, 16)]),
  scenario("DEEP-LOCAL-01", "HOST", [sel("pill-alpha"), mv(30, 18), rs(26, 18), rot(42, 18), mv(84, 4), rs(-20, 22), save(), reload(), sel("pill-alpha"), mv(-30, 14)]),
  scenario("DEEP-LOCAL-02", "CLONE", [sel("card-one"), dup(), mv(50, 28), rot(44, 20), rs(30, 20), style(), front(), mv(-40, 18), save(), reload(), sel("clone"), rs(24, 18)]),
  scenario("DEEP-LOCAL-03", "CREATED", [create("card"), mv(50, 26), rs(34, 22), rot(44, 20), copyPaste(), mv(-46, 24), save(), reload(), sel("created"), mv(30, 16)]),
];

function buildScenarios(): Scenario[] {
  const out: Scenario[] = [];
  HOST_CHAINS.forEach((chain, index) => {
    const target = HOST_TARGETS[index % HOST_TARGETS.length];
    if (!target) return;
    out.push(scenario(`HOST-${chain.name}-${target}`, "HOST", chain.steps(target)));
    for (const extra of HOST_EXTRA_TARGETS[chain.name] ?? []) {
      if (extra === target) continue;
      out.push(scenario(`HOST-${chain.name}-${extra}`, "HOST", chain.steps(extra)));
    }
  });
  CLONE_CHAINS.forEach((chain, index) => {
    const target = CLONE_TARGETS[index % CLONE_TARGETS.length];
    if (!target) return;
    out.push(scenario(`CLONE-${chain.name}-${target}`, "CLONE", chain.steps(target)));
  });
  for (const chain of CREATED_CHAINS) {
    out.push(scenario(`CREATED-${chain.name}`, "CREATED", [create(chain.kind), ...chain.steps]));
  }
  for (const chain of MULTI_CHAINS) {
    out.push(scenario(`MULTI-${chain.name}`, "MULTI", chain.steps));
  }
  for (const chain of GROUP_CHAINS) {
    out.push(scenario(`GROUP-${chain.name}`, "GROUP", chain.steps));
  }
  out.push(...EXTRA_SCENARIOS);
  return out;
}

export const SCENARIOS: readonly Scenario[] = buildScenarios();

export function stepSignature(scenario: Scenario): string {
  return scenario.steps
    .map((step) => Object.entries(step).map(([key, value]) => `${key}=${String(value)}`).join(":"))
    .join("|");
}
