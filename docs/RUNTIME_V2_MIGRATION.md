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
