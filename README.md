# On the Fly

is a tool used to turn any live or internal website into a figma style sandbox. Select real page elements, move, resize, restyle, edit text, layer objects, and keep changes persistant in your browser, no hosted backend or account required.

## What it does

- Turn any normal webpage into a lightweight visual editor sandbox
- Select elements with click; multi-select with Shift+click, group elements
- Move, resize, rotate, duplicated, and delete elements
- Crop, hide, layer, and restyle selections using the toolbar
- Edit text while preserving page formatting where possible
- Undo/redo with Ctrl/Cmd+Z and Ctrl/Cmd+Y
- Toggle **Interact mode** (`I`) so site navbars, drawers, and buttons work normally
- **Clear page** to remove all saved and unsaved edits for the current page
- Call an AI agent on a specific element/section to make changes 

## Install (development / unpacked)

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run build:public` for the Chrome Store-safe build (agent disabled).
4. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `dist/` folder.

For day-to-day local development with the optional AI agent, use `npm run build` instead (see [Local developer agent](#local-developer-agent-optional) below).

## Using the editor

1. Open any normal https page.
2. Click the extension icon and choose **Enable editor**.
3. Click elements to select them. Press t to open the compact toolbar.
4. Make changes—they stay in the current session as **unsaved** drafts until you save.
5. Click **Save all** in the editor overlay to persist every unsaved change, or press **`S` and drag** a region to save only edits inside that area.
6. Refresh or restart the browser—only **saved** changes replay automatically.
7. Use **Clear** in the popup or toolbar to remove all saved and unsaved changes and reload the page.
8. double click a section/group/element to call an agent - you can work in parallel while the agent is running

### Shortcuts (edit mode)

| Shortcut | Action |
|---|---|
| `S` + drag | Enter save-window mode; persist draft ops inside the drawn region |
| `I` | Toggle interact / edit mode |
| `T` | Toggle toolbar |
| `ctrl` + `shift` | select elements together |
| `ctrl` + `g` | group elements that are both selected using ctrl + shift|
| `ctrl` + `shift` + `g` | ungroup elements |
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

## Local developer agent optional

The public/local manual editor works without AI, accounts, backend services, or API keys.

The optional agent workflow is for local development only. It is not required to use the extension.

### Run local agent mode

1. Copy the agent environment file:

```bash
cp agent-server/.env.example agent-server/.env
```

2. Add your own API key to `agent-server/.env`.

3. Start the local agent development mode:

```bash
npm run dev:agent
```

4. Load the generated extension build from `dist/` in `chrome://extensions`.

5. On a page, enable edit mode, select an element or group, then use the local agent shortcut to open the agent panel.

Agent previews are temporary. Approving an agent result adds the generated operations to the current unsaved session only.

To persist changes:

* Use the Save button to save all dirty changes.
* Use `S` + drag to save only changes inside a selected region.
* Pressing `S` alone does not save.

## Development scripts

| Command                  | Purpose                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `npm run build:public`   | Build the local-first public/manual editor with agent disabled                             |
| `npm run dev:agent`      | Build/run local development mode with optional agent support                               |
| `npm run verify:public`  | Verify the public build does not include dev-only agent permissions or enabled agent flags |
| `npm run package:public` | Package the public build artifact for maintainers                                          |
| `npm run typecheck`      | Run TypeScript checks                                                                      |
| `npm run lint`           | Run ESLint                                                                                 |
| `npm test`               | Run the test suite                                                                         |

## Contributing

On the Fly is open source. Contributions are welcome through issues and pull requests.

Before opening a pull request:

```bash
npm install
npm run typecheck
npm run lint
npm test
```

For changes that affect extension behavior, include a short summary of what changed, what was tested, and any remaining risks.

Please do not commit API keys, `.env` files, local planning docs, build artifacts, or generated release zip files.
