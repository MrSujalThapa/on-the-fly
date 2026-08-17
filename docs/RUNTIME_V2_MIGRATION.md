# Runtime V2 migration map

Executable map of the **current** production MOVE pipeline as of `rewrite/runtime-v2` (base `f82355d` plus dead-architecture deletion). Not a redesign.

Classification:

- **KEEP** — reusable as-is under Runtime V2
- **COMPATIBILITY — KEEP BEHIND NEW ENGINE** — layout/DOM primitives the new executor should call
- **LEGACY — REPLACE** — orchestration Runtime V2 must not inherit
- **DELETE LATER** — leftover coupling, not this phase

## MOVE pipeline

```
pointer event
  → selection
  → transform controller
  → operation construction
  → DOM mutation
  → history / session state
  → persistence
  → replay
  → overlay refresh
```

### 1. Pointer event

| | |
|---|---|
| Canonical module | `src/content/edit-session.ts` (`handlePointerDown/Move/Up`) + `src/content/edit-mode-pointer-pipeline.ts` + `src/editor/selection/pointer-interaction.ts` |
| Inputs | `PointerEvent` (`clientX/Y`, `pointerId`, modifiers) |
| Outputs | gesture (`pending` / move / lasso / click); `movePending` / `moveActive` |
| Mutable state | `activeGesture`, `movePending`, `moveActive`, `captureTarget`, lasso rAF |
| HTMLElement? | yes — capture target |
| Mutates DOM? | pipeline writes `userSelect`/`touchAction` on `html`/`body` (editor chrome, not an operation) |
| Persists? | no |
| Can fail? | pointer capture can fail (logged) |
| Upstream | `EditSession.start()` attaches pipeline |
| Downstream | `SelectionController` (click/lasso) or `TransformController.beginMove/updateMove/endMove` |
| Class | **LEGACY — REPLACE** (session pointer SM). `pointer-interaction.ts` **KEEP**. Pipeline lock **DELETE LATER** (extract, do not copy into V2). |

### 2. Selection

| | |
|---|---|
| Canonical module | `src/editor/selection/selection-controller.ts` + resolvers (`selection-resolver.ts`, `dom-target-matching.ts`) |
| Inputs | point / lasso rect, `VisualLayoutGraph` |
| Outputs | `EditorSelection`, `SelectionResolveResult` (nodes + signatures) |
| Mutable state | selection, `lastTargets`, active virtual group |
| HTMLElement? | resolves live elements during hit-testing; does not own a long-lived registry |
| Mutates DOM? | no |
| Persists? | no (group restore reads persisted ops) |
| Can fail? | whole-page rejection; unmatched point → empty selection |
| Upstream | `EditSession.handlePointerUp` / lasso |
| Downstream | `EditSession.handleSelectionChange` → `TransformController.setSelection` |
| Class | resolver/graph **KEEP**. `SelectionController` **LEGACY — REPLACE** as owner of selection snapshots. Parallel snapshots in `EditSession` **DELETE LATER**. |

### 3. Transform controller (gesture + plan)

| | |
|---|---|
| Canonical module | `src/content/transform-controller.ts` |
| Inputs | pointer coords; `TransformSelectionInput`; live `elementRegistry` (`VisualNodeId` → `HTMLElement`) |
| Outputs | live drag preview; committed `MoveOperation[]` |
| Mutable state | `moveDrag` (HTMLElement + inline snapshots), `elementRegistry`, rAF preview |
| HTMLElement? | **yes — long-lived registry and drag list** |
| Mutates DOM? | **yes** during preview (`style.transform`); restores snapshots before commit |
| Persists? | no |
| Can fail? | `beginMove` false if no resolvable element; apply can skip failed ops |
| Upstream | `EditSession` pointer SM |
| Downstream | `DomRuntimeAdapter.applyOperation(op, overrideElement)`; `onApply` → `EditSession.recordOperations` |
| Class | **LEGACY — REPLACE** as orchestrator. Strategy predicates it calls are **COMPATIBILITY**. |

Live MOVE commit (`endMove`): restore preview → `planMove` (interaction-safe-fixed / transform-only / detach / in-flow) → `buildMoveOperation` → `freezeCommittedOperation` → `adapter.applyOperation(op, element)`.

### 4. Operation construction

| | |
|---|---|
| Canonical module | `src/editor/transform/operation-factory.ts` (`buildMoveOperation`) + payload filled in `transform-controller.ts` |
| Inputs | `TransformTarget`, dx/dy, pageKey, strategy flags, original/final rects |
| Outputs | frozen `MoveOperation` |
| Mutable state | none |
| HTMLElement? | no (target already chosen) |
| Mutates DOM? | no |
| Persists? | no |
| Can fail? | validation later at apply |
| Class | factory **KEEP**. Strategy payload assembly **LEGACY — REPLACE** (belongs in PlacementEngine). |

### 5. DOM mutation

| | |
|---|---|
| Canonical module | `src/editor/dom/dom-runtime-adapter.ts` → `src/editor/dom/handlers/transform-handler.ts` (`applyMoveOperation`) |
| Inputs | `MoveOperation`, optional **override HTMLElement** |
| Outputs | `DomApplyResult` + stored effect / origin snapshot |
| Mutable state | adapter `effects`, `elementRefs`, `originSnapshots`, `ElementSnapshotStore` |
| HTMLElement? | yes — effects map holds elements |
| Mutates DOM? | **yes — only intended mutation path for MOVE** |
| Persists? | no |
| Can fail? | yes (`DomApplyFailure`: unresolved, validation, handler throw) |
| Upstream | `TransformController.endMove`; replay via `PageCustomizationController` |
| Downstream | session `recordOperations` on success |
| Class | adapter **LEGACY — REPLACE** (override bypass, HTMLElement effects). Handlers + snapshots + detach/fixed placement **COMPATIBILITY — KEEP BEHIND NEW ENGINE**. |

`overrideElement` skips signature resolve when connected (`dom-runtime-adapter.ts`). Replay has no override.

### 6. History / ledger / session state

| | |
|---|---|
| Canonical module | `src/content/edit-session.ts` `recordOperations` + `src/content/session-operation-state.ts` + `src/content/session-history.ts` + `src/editor/dom/operation-batch-snapshot.ts` |
| Inputs | applied `EditorOperation[]` |
| Outputs | draft ops appended; undo batch with before/after snapshots |
| Mutable state | `operationState` (saved/draft/preview arrays); `sessionHistory` stacks |
| HTMLElement? | snapshots hold placement/style, not a live registry |
| Mutates DOM? | undo/redo restore snapshots via adapter |
| Persists? | not yet — drafts are in-memory until Save |
| Can fail? | restore can fail per element |
| Class | **LEGACY — REPLACE**. Snapshot capture/restore primitives **KEEP**. |

There is **no single ledger**. Drafts, saved, preview, and undo stacks are synchronized by `EditSession`. The deleted `editor/history/history-manager.ts` was never this path.

### 7. Persistence

| | |
|---|---|
| Canonical module | `src/content/edit-session.ts` `saveAll` → `PageCustomizationController.syncOperationsToStorage` → `src/content/storage-client.ts` → background IndexedDB |
| Inputs | promoted saved operations + pageKey |
| Outputs | `SavePageOperationsResult` |
| Mutable state | IndexedDB page state; in-memory `pageOperations` |
| HTMLElement? | no |
| Mutates DOM? | no |
| Persists? | **yes** |
| Can fail? | yes (`ok: false`, cap trim) |
| Class | storage-client + IDB gateway **KEEP** (contracts). `PageCustomizationController` **LEGACY — REPLACE** as replay+identity+storage god object. |

### 8. Replay

| | |
|---|---|
| Canonical module | `src/content/page-customization-controller.ts` `ensureReplayed` + `src/editor/dom/replay-readiness.ts` + `DomRuntimeAdapter.replayOperationsWithDiagnostics` |
| Inputs | persisted ops, document |
| Outputs | applied DOM; diagnostic counts |
| Mutable state | `replayed` flag, generation token, adapter effects |
| HTMLElement? | resolves by signature each replay |
| Mutates DOM? | **yes** |
| Persists? | reads only |
| Can fail? | unresolved targets, apply failures; incomplete replay is logged |
| Class | readiness wait **KEEP**. Replay loop **LEGACY — REPLACE** (OperationExecutor + ledger). |

### 9. Overlay refresh

| | |
|---|---|
| Canonical module | `TransformController.renderSelection` / `refreshSelectionOutline` / `refreshOutlineFromDom` → `src/content/editor-shell.ts` (`renderSelectionOutlines`) |
| Inputs | `outlineRects` or live `getBoundingClientRect` of registry elements |
| Outputs | closed-shadow overlay DOM (`.otf-selection-outline`) |
| Mutable state | overlay nodes in closed shadow |
| HTMLElement? | reads live elements |
| Mutates DOM? | extension overlay only |
| Persists? | no |
| Can fail? | stale rects if not refreshed on scroll/resize |
| Class | **LEGACY — REPLACE**. Shell chrome **DELETE LATER** (keep until OverlayCoordinator exists). |

## If Runtime V2 performs a MOVE, call this — not EditSession / TransformController

Minimum reusable stack:

1. **Identity (transient resolve only)**  
   `buildElementSignature` · `matchElementBySignature` / `resolveTargetElementDetailed`  
   Do not store `HTMLElement` in the ledger.

2. **Placement plan (pure + layout reads)**  
   `requiresInteractionSafeFixedMove` · `requiresTransformOnlyMove` · `shouldDetachForPredictedRect` · `computeInteractionPlacementCoords` · `findCounterTransformDescendants`  
   `extractBoundingBox`  
   Plan only. Do not write history here.

3. **Operation value**  
   `buildMoveOperation` + validate (`validateOperation` / `validateOperationForDom`)

4. **Mutate**  
   `applyMoveOperation` in `handlers/transform-handler.ts`  
   plus `applyPersistedDetachPlacement` / `applyPersistedInteractionSafeFixed` as the handler already does.  
   Snapshot: `ElementSnapshotStore`, `captureElementDomSnapshot`.

5. **Verify**  
   real `getBoundingClientRect()` vs intended rect. On failure, restore snapshots.

6. **Commit**  
   one ledger append (new). Persist through `storage-client.ts` contracts, not a second in-memory op list.

7. **Overlay**  
   derived from live rect of the resolved handle — do not own identity.

Do **not** call: `EditSession`, `TransformController`, `session-operation-state`, `session-history`, `PageCustomizationController` (except eventually replacing its replay), `EditorShell` overlay API, agent controllers, `DomRuntimeAdapter.applyOperation` (override + effects registry).

## Module classification (production)

| Module | Class |
|---|---|
| `editor/operations.ts`, ids, signatures, targets, validation | KEEP |
| `editor/transform/operation-factory.ts`, geometry helpers | KEEP |
| `editor/measurement/*` | KEEP |
| `editor/dom/handlers/*` | COMPATIBILITY — KEEP BEHIND NEW ENGINE |
| `editor/dom/managed-detach.ts`, `interactive-fixed-placement.ts`, `fixed-position-anchor.ts`, `interactive-safety.ts`, `layer-overlap-resolver.ts` | COMPATIBILITY |
| `editor/dom/element-snapshot.ts`, `dom-placement-snapshot.ts`, `operation-batch-snapshot.ts` | COMPATIBILITY |
| `editor/dom/signature-matcher.ts`, `resolve-target.ts`, `replay-readiness.ts` | KEEP |
| `editor/persistence/*`, `content/storage-client.ts`, background IDB | KEEP (contracts) |
| `editor/visual-graph/*` | KEEP for selection; overlay should not own it |
| `editor/selection/pointer-interaction.ts`, resolvers, guards | KEEP |
| `editor/selection/selection-controller.ts` | LEGACY — REPLACE |
| `editor/dom/dom-runtime-adapter.ts` | LEGACY — REPLACE |
| `content/transform-controller.ts` | LEGACY — REPLACE |
| `content/edit-session.ts` | LEGACY — REPLACE |
| `content/session-operation-state.ts`, `session-history.ts` | LEGACY — REPLACE |
| `content/page-customization-controller.ts` | LEGACY — REPLACE |
| `content/editor-shell.ts`, `floating-toolbar.ts` | LEGACY — REPLACE (UI) |
| `content/agent/*` | out of scope (do not touch) |
| `editor/index.ts` barrel | DELETE LATER (not a runtime dep) |

## Product contract baseline (legacy)

See `tests/e2e/BASELINE.md`. Failures are product gaps for Runtime V2, not harness setup failures.

