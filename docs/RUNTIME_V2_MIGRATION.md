# Runtime V2 Migration

## Phase B2 — Canonical Visual Model

### Implementation question

> Which useful pieces should become internals of VisualModel, and which existing systems are only legacy/runtime-specific and must not remain second owners?

**Absorb into VisualModel (internals, not public owners):**

| Existing piece | Why it belongs inside VisualModel |
|---|---|
| `ElementRegistry` (handles, WeakRef cache, unique CSS path, unresolved/ambiguous) | Durable identity + live DOM binding are one question: “what object is this, and where is it now?” |
| `pointer-hit.ts` text-leaf promotion | Default selection is visual-unit policy, not an input or hit-test owner |
| Persistable `ElementSignature` + unique CSS path | Locators are evidence, not identity. VisualModel owns scoring, contradiction, and rebind |
| Measurement helpers (`scan-guards`, bounding boxes, fingerprints) | Live geometry and giant-wrapper rejection are part of the same object model |
| Wrapper-collapse / collection / content-promotion ideas from legacy `visual-graph/container-detection.ts` | Structural policy for “what is the editable object?” — reimplemented as VisualModel policy, not a second graph |

**Remain as existing Runtime V2 owners (not rewritten unless an invariant fails):**

- `PlacementEngine` — how a resolved binding moves
- `OperationExecutor` — mutate / verify / rollback
- `OperationLedger` — operation history
- `OverlayCoordinator` — derived chrome from VisualModel geometry
- `RuntimeLifecycle` — resource lifetime

**New independent owner:**

- `InputRouter` — EDIT vs INTERACT browser-event ownership. Orthogonal to the object model.

**Must not remain as parallel V2 owners:**

- `ElementRegistry` as a public composition-root identity system
- `SelectionEngine`
- VisualGraph V2 / `GeometryTracker` / `GroupManager` / `SaveCoordinator` / `CardDetector` / `CollectionManager`
- Overlay-owned authoritative target rects
- Hit-test promotion in `EditorRuntime` or `InputRouter`

**Legacy `src/editor/visual-graph/*`:** stays in the legacy runtime. Runtime V2 must not instantiate it. Reuse generalized signals only, inside VisualModel.

### Target composition

```text
Browser → InputRouter → VisualModel (identity/hierarchy/geometry)
                         → EditorRuntime
                              → PlacementEngine
                              → OperationExecutor → OperationLedger → Persistence
                              → OverlayCoordinator (consumes VisualModel.measure)
                         RuntimeLifecycle
```

### Visual policy thresholds

Centralized in `VISUAL_POLICY` (`src/runtime-v2/visual-hierarchy.ts`):

| Token | Meaning |
|---|---|
| `giantAreaRatio` | Viewport coverage at which a node is a page shell, not a default unit |
| `dominantCoverage` | Child fraction of parent that counts as a wrapper, not a sibling object |
| `wrapperOverlap` | Parent/child overlap needed to collapse a wrapper chain |
| `peerSizeSlack` | Relative size difference still allowed among repeated peers |
| `minCollectionPeers` | Similar siblings required to treat a parent as a collection |
| `contentPromoteMaxRatio` | Max content/control area vs unit before promoting the click to the unit |

No hostname, site class, or fixture-id selectors.

### Persistence

Persisted MOVE still uses `EditorTarget.signature`. VisualModel writes `identityVersion: 2` plus sibling/stable-key evidence. Replay treats missing version as v1 and still **verifies logical identity** — a unique CSS path is not automatic resolution.

### Ledger vs persistence (Phase B3)

Session `OperationLedger` keeps the full MOVE history for undo/redo.

Save writes a **canonical checkpoint**: one approved MOVE per durable target, with `originalRect` from the first active edit and `finalRect`/`dx`/`dy` from the last. Reload hydrates that checkpoint as the new baseline and does **not** reconstruct the historical pointer sequence.

Wrong-target resolution is rejected (`unresolved` / `ambiguous`) instead of falling back to the sibling at the old CSS path.

### Overlay coordinates

`VisualModel.measure()` returns viewport CSS pixels from `getBoundingClientRect`.
`OverlayCoordinator` paints `position: fixed` in that same space.
The overlay host is `position: fixed; inset: 0` on `documentElement`.

CSS `zoom` on `html` scales both the page and the overlay host together. CDP box models include zoom and must not be mixed with `getBoundingClientRect` values when classifying overlay drift.

## B4 — Real Failure Root Cause

### Sibling / save failure

Moving and saving Mentions, then editing My posts, could replace the earlier saved target. The correlated LinkedIn trace showed distinct live radio controls and distinct aria/text evidence, but both operations could carry the same render-generated Ember ID (for example `ember33`). `durableMoveKey()` treated that generated ID as durable and projected both live targets into the same checkpoint bucket.

Owner: canonical checkpoint target key, using identity evidence classified by VisualModel.

Violated invariant: distinct edited targets cannot share a durable key; generated framework IDs are locators, not durable identity.

### Repeated-save failure

The full real-site suite initially reported lost cumulative displacement even after replay verification passed. The trace showed each focused save/reload converged exactly. The suite cleared IndexedDB only after navigation had already replayed the previous test's operations into the live DOM, then reused that mutated DOM as the next test's origin.

Owner: authenticated real-site harness reset boundary, not runtime persistence.

Violated invariant: each real-site regression must establish an unmodified live baseline after clearing persisted state.

### Overlay failure

The current real LinkedIn trace did not reproduce blue-outline divergence. For initial selection, scroll, viewport resize, and layout change/reselection, the selected element rect, VisualModel measurement, OverlayCoordinator input, and rendered outline rect were equal in viewport CSS pixels with one outline present.

Owner: no failing runtime owner observed in the current build. Earlier CDP-based comparisons mixed zoom-aware box-model coordinates with `getBoundingClientRect()` viewport coordinates; those diagnostics were not a valid geometry oracle.

Invariant status: the active overlay currently consumes the same live `getBoundingClientRect()` geometry used by move verification. No additional geometry or observer path is justified by the observed trace.

## B4 Layer/Detach Convergence Root Causes

- **Layer isolation and post-layer moveability:** structured traces kept layer writes isolated to the selected pill. The later drag reached the same selected node, but execution failed geometry verification: `PlacementEngine` treated the logical `data-otf-detached` marker on an interactive pill as physical detachment on its second move and changed strategy from transform-only to body placement. Owner: `PlacementEngine` existing-placement classification. Invariant: logical interactive detachment remains transform-only across repeated moves and layer commands; its marker must not be reinterpreted as permission to reparent.
- **Interactive child escape:** standalone interactive children were marked logically detached but continued using an in-tree transform. That preserves framework event delegation, but cannot cross an ancestor overflow or stacking boundary. The placement policy already defines interaction-safe fixed placement, yet selected it only for elements previously in that mode. Owner: `PlacementEngine` strategy selection. Invariant: a standalone interactive target that crosses its container boundary keeps DOM identity while receiving independent fixed/anchored placement.
- **Detached preview snap:** move commit counter-transformed logically detached descendants, while pointer preview transformed only the old parent. The live trace moved View settings +60 px with its former parent during preview and returned it to the original coordinate on commit. Owner: `EditorRuntime` preview state. Invariant: preview and commit use the same parent/independent-descendant relationship model.
- **Cross-stacking layer verification:** the profile-card trace moved the selected sticky sidebar host across the fixed global navigation. Before the command, `elementsFromPoint` returned the navigation; after Front, it returned profile-card content, proving that the resolved host and real paint order—not raw z-index alone—are the oracle. No second stacking manager is warranted; repeated movement is covered by stable gesture ownership and placement-strategy classification.
