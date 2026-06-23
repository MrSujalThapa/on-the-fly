# On the Fly

On the Fly is a local-first Chrome extension for visually editing live websites. Select real page elements, move, resize, restyle, edit text, layer objects, and keep changes in your browser—no hosted backend or account required.

## What it does

- Turn any normal webpage into a lightweight visual editor sandbox
- Select elements with click; multi-select with Shift+click
- Move, resize, rotate, crop, hide, and restyle selections
- Edit text while preserving page formatting where possible
- Undo/redo with Ctrl/Cmd+Z and Ctrl/Cmd+Y
- Toggle **Interact mode** (`I`) so site navbars, drawers, and buttons work normally
- **Clear page** to remove all saved and unsaved edits for the current page

## Install (development / unpacked)

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run build:public` for the Chrome Store-safe build (agent disabled).
4. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `dist/` folder.

For day-to-day local development with the optional AI agent, use `npm run build` instead (see [Local developer agent](#local-developer-agent-optional) below).

## Using the editor

1. Open any normal https page.
2. Click the extension icon and choose **Enable editor**.
3. Click elements to select them. Double-click a selection to open the compact toolbar.
4. Make changes—they stay in the current session as **unsaved** drafts until you save.
5. Click **Save all** in the editor overlay to persist every unsaved change, or press **`S` and drag** a region to save only edits inside that area.
6. Refresh or restart the browser—only **saved** changes replay automatically.
7. Use **Clear** in the popup or toolbar to remove all saved and unsaved changes and reload the page.

### Shortcuts (edit mode)

| Shortcut | Action |
|---|---|
| `S` + drag | Enter save-window mode; persist draft ops inside the drawn region |
| `I` | Toggle interact / edit mode |
| `T` | Toggle toolbar |
| `Escape` | Cancel preview, close panels, or clear selection |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Y | Redo |

## Local-first storage and privacy

- All saved edits stay on your device in extension-owned **IndexedDB** and lightweight settings in `chrome.storage.local`.
- The published extension does **not** call AI services, analytics, or a hosted backend.
- Manual editing works offline after install.
- Unsaved session edits are lost on refresh unless you **Save** first.
- **Export backup** and **Import backup** in extension Options let you copy JSON backups manually.
- Uninstalling the extension or clearing extension data removes stored edits unless you exported a backup.

See **Options → Privacy** in the extension for the full disclosure.

## Clear, export, and import

- **Clear page** — Deletes saved and unsaved operations for the current page URL and reloads to restore the original site.
- **Export backup** — Downloads a JSON file with your local sites, pages, operations, and assets (subject to local size limits).
- **Import backup** — Validates schema and operation types before writing; review warnings in Options after import.

## Production release build

```bash
npm run release:public
```

This runs the public build, verification checks, and packages `release/on-the-fly-v<version>.zip` for Chrome Web Store upload.

Before release, follow [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md).

## Local developer agent (optional)

The public Chrome Web Store build has AI **disabled**. For local development only:

1. Copy `.env.example` to `.env` in the repo root and configure your local agent server URL if needed.
2. Run `npm run build` (not `build:public`) to enable localhost host permissions.
3. Start the optional local agent server from `agent-server/` with your own API key in `agent-server/.env` (never commit keys).
4. On a page, Shift+double-click a selection to open the agent panel (local dev build only).

Agent previews are temporary. **Approve** adds operations to the current session only; **Save all** or **`S` + drag** persists them. **Reject** or **Escape** reverts the preview.

The agent server is for local development and is not included in the published extension package.

## Development scripts

| Command | Purpose |
|---|---|
| `npm run build:public` | Store-safe build (agent off, no localhost permissions) |
| `npm run build` | Local dev build with agent hooks |
| `npm run verify:public` | Fail if public `dist/` includes dev-only permissions or agent flags |
| `npm run package:public` | Zip `dist/` for store upload |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite |

## License

See repository license file if present. Planning docs under `docs/` are local-only and not required to use the extension.
