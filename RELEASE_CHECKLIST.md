# On the Fly — Chrome Store Release Checklist

Use this checklist before uploading a public build to the Chrome Web Store.

## Build verification (automated)

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run release:public` (build + verify + zip)
- [ ] Confirm `release/on-the-fly-v*.zip` contains manifest, icons, popup, options, background, and content scripts at zip root (no extra folder wrapper)

## Public build safety

- [ ] `npm run verify:public` passes
- [ ] Manifest permissions are only `storage` and `activeTab`
- [ ] No `host_permissions` for localhost or backend URLs
- [ ] Options → Diagnostics shows **Agent: Disabled** and **Build mode: Public**
- [ ] No network calls during manual editing (check DevTools Network while editing a page)

## Install and update

- [ ] Load unpacked from `dist/` on a fresh profile
- [ ] Enable editor on a normal https page
- [ ] Update test: load a newer unpacked build over the previous folder and confirm saved edits still replay

## Explicit save persistence

- [ ] Manual edit → refresh **without Save** → change is gone
- [ ] Manual edit → **S + drag** (region save) or **Save all** button → refresh → change replays
- [ ] Plain **S** alone does not persist edits
- [ ] `S` shortcut saves when not typing in a page input
- [ ] Save all button and mode indicator show unsaved count while drafts exist

## Clear, export, import

- [ ] **Clear page** removes saved + unsaved ops and reloads to original page
- [ ] **Export backup** downloads JSON from Options
- [ ] **Import backup** restores operations after validation
- [ ] Popup **Clear** matches content-script clear behavior

## Cross-site manual QA matrix

Test manual editing (no agent) on at least four real site categories:

- [ ] News / article page
- [ ] SaaS marketing / landing page
- [ ] Dashboard or app page (logged-in UI if available)
- [ ] Social or profile page

For each site verify: select, move, resize, hide, style/text edit, undo/redo, interact mode (`I`), escape recovery, save + refresh replay, clear page.

## Storage migration

- [ ] Export backup from current version
- [ ] Import into a clean install
- [ ] Saved operations replay after import + refresh

## Privacy copy

- [ ] Options → Privacy section is visible and accurate
- [ ] Store listing privacy text matches local-only storage behavior

## Known limits (document for reviewers)

- Edits are per browser profile and device only
- Uninstalling or clearing extension data removes unsaved and saved edits unless exported
- Agent workflow exists only in local developer builds, not the published package
