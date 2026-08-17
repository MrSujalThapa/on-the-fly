# Legacy E2E product-contract baseline

Recorded against `rewrite/runtime-v2` (f82355d runtime + dead-architecture deletion). Geometry is live `getBoundingClientRect()`. Pointer events, layout, persistence, and extension messaging are not mocked.

Harness: Playwright Chromium, unpacked `dist/`, headed (headless MV3 load is unreliable here).

| scenario | legacy | owner | notes |
|---|---|---|---|
| E1 exact target | FAIL | IDENTITY | Dragging card 3 also translated cards 1/2/4 by the same dx/dy (likely container promotion / group). |
| E2 first move | PASS | — | One drag moved the live rect by the intended delta. |
| E3 repeated move | PASS | — | +100 then +50 composed to ~+150. |
| E4 flex preservation | FAIL | PLACEMENT | Unrelated flex siblings shifted; detach/in-flow side effects. |
| E4 grid preservation | FAIL | PLACEMENT | Unrelated grid siblings shifted. |
| E4 section preservation | PASS | — | Header/aside/footer stayed put. |
| E5 save/reload | PASS | — | Replayed geometry matched committed. |
| E6 multiple edits | PASS | — | Three cards survived save/reload. |
| E7 undo/redo | PASS | — | Live geometry restored then reapplied. |
| E8 React replacement | PASS | — | Synthetic replace kept the moved rect on this fixture. Not proof of general framework identity. |
| E9 overlay scroll | FAIL | OVERLAY | Outline rect did not match the live target (large mismatch before scroll). |
| E10 nested scroll | FAIL | OVERLAY | Outline did not track the overflow-scrolled target. |
| E11 resize overlay | FAIL | OVERLAY | Outline did not stay aligned after viewport resize. |
| E12 stress | PASS | — | 20 deterministic moves then save/reload matched committed layout. |

Infrastructure (extension load, fixture server, real layout) passed. Contract failures above are product baseline, not harness setup failures.
