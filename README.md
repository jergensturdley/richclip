# RichClip

A lightweight Chrome extension to quickly copy selected text, links, and formatted snippets with a configurable selection toolbar and multiple output formats.

**Quick Start**
- Install the extension in Chrome using the `manifest.json` developer load (Load unpacked).
- Select text on a page to show the floating selection toolbar (can be configured to `full`, `compact`, or `off`).

**Features**
- Quick-copy selected text in multiple formats (Markdown by default).
- Configurable selection toolbar: full (expanded), compact (small pill), or off.
- Text case transforms and word-count badge in the toolbar.
- Settings persisted via `chrome.storage.local` and synced to the content script.

**Installation (developer)**
1. Open Chrome and go to `chrome://extensions/`.
2. Enable *Developer mode*.
3. Click *Load unpacked* and select the project folder (this repository).

**Usage**
- Open the popup to access quick copy tools, clipboard staging, and extension settings.
- Select text on any page to use the floating toolbar (unless disabled in settings).

**Settings (available in the popup)**
- `selectionToolbar`: controls the in-page selection UI; values: `full`, `compact`, `off`.
- `defaultFormat`: default output format for quick copies (e.g. `markdown`).
- `autoClose`: if true, close the popup automatically after a copy operation.

**Important Files**
- [manifest.json](manifest.json) — extension manifest and permissions
- [content.js](content.js) — content script that injects the floating toolbar
- [content.css](content.css) — styles for the in-page toolbar
- [popup.html](popup.html) / [popup.js](popup.js) — popup UI and settings
- [background.js](background.js) — background logic (if present)
- [.gitignore](.gitignore) — repo ignores (includes `snapshots/`)

**Development**
- Make edits to the files above and reload the unpacked extension in Chrome to test changes.
- For quick syntax checks, you can run Node's parser against JS files locally.

**Contributing**
- Open an issue or create a branch and submit a pull request with a clear description of changes.

**License**
- MIT (add a LICENSE file if you want an explicit license)
