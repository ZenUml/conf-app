---
name: download-attachment
description: Download a Confluence page attachment to local disk. First explains the 5 ways an attachment can be downloaded (so the developer learns the trade-offs), then automates the easiest one. Use when investigating customer issues that require the original PNG/PDF/file backed up against a customContent, recovering source from PNG iTXt embedded metadata, or any time a Confluence attachment needs to land on disk. Triggers on "download the attachment", "get the PNG", "save attachment to disk", "extract iTXt", "pull attachment", or any follow-up step after `find-macros-on-page` reveals a backup attachment.
---

# Download Confluence Attachment

Two halves: **(a)** a short explainer of how attachments can be downloaded — so you can pick manually next time — and **(b)** a single command that does it for you.

## (a) How a developer can download — 5 ways

### 1. Browser address bar (manual, instant, zero setup)
Paste the URL into Chrome. Your live Atlassian session authenticates; the file lands in `~/Downloads/`. URL pattern:
```
https://<host>/wiki/download/attachments/<pageId>/<filename>?version=<n>
```

### 2. Right-side Details panel (manual UI, 4 clicks)
The "Attachments" tab was removed from the page top menu. To find it:
1. Open the page
2. On the page's right edge: click **Open Details Panel** (small icon in the floating action bar — auto-hides; hover to reveal)
3. Scroll the panel to **Connections** → click the count next to **Attachments**
4. On the attachments page, click the file → **Download** in the preview dialog

### 3. Legacy attachments page URL (manual, 1 navigation)
Same destination as method 2 but skips the discovery dance:
```
https://<host>/wiki/pages/viewpageattachments.action?pageId=<pageId>
```
Bookmark it.

### 4. `@forge/bridge` `requestConfluence` (programmatic, in-app only)
What our running app uses to read attachments. Sidesteps every auth headache — but only available from inside the Forge iframe. Not usable from CLI / scripts.

### 5. This skill's `download.mjs` (programmatic, no Forge runtime needed)
Opens the URL in your default browser (so it uses your live session — same as method 1), watches `~/Downloads/` for the new file, moves it to your chosen path. Returns the absolute path on stdout.

## Why other "obvious" routes don't work

| Attempt | Result |
|---|---|
| `curl` + Basic-auth API token | **401**. `/wiki/download/attachments/...` requires OAuth, not Basic auth. |
| `fetch()` in a Playwright page | **CORS error**. The URL 302-redirects to `api.media.atlassian.com/file/<id>/binary?token=<JWT>` which returns `Access-Control-Allow-Origin: *` — incompatible with `credentials: 'include'`. |
| `XMLHttpRequest` in a page | Same CORS failure. `responseURL` blanks before the redirect is observable. |
| Playwright MCP `browser_navigate` to download URL | Auth works; browser starts a real download; the MCP throws "Download is starting" because it has no `page.on('download', …)` handler exposed. |

These all looked promising from the metadata route — the v2 `_links.download` URL — but each hits the OAuth-or-CORS wall. The `open`-and-watch approach in method 5 bypasses the whole class of problem by piggybacking on the user's real browser session, the same way method 1 does.

## (b) Just download it

```bash
node .claude/skills/download-attachment/scripts/download.mjs \
  --site lite-stg \
  --page 84475940 \
  --filename zenuml-84181014.png \
  --out /tmp/recovered.png
```

Output: the absolute path of the saved file on stdout (everything else on stderr).

### Args

| Flag | Required | Notes |
|---|---|---|
| `--site` | yes | Short name (`lite-dev`, `lite-stg`, `zenuml-stg`, `zenuml`) or hostname. |
| `--page` | yes | Numeric page ID. |
| `--filename` | yes | Exact attachment filename (e.g. `zenuml-84181014.png`). Get it from `find-macros-on-page` orphan output or the v2 `/attachments` API. |
| `--out` | no | Output path. Can be a directory (file kept under its original name) or a full file path. Defaults to the current working directory. |
| `--timeout-sec` | no | How long to wait for the file to appear in `~/Downloads/`. Default 30. |

## How it works internally

1. Snapshot the filenames in `~/Downloads/` (so we can later spot the new one).
2. Open the download URL in the default browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows). The browser uses your authenticated session.
3. Poll `~/Downloads/` every 500 ms for a new file (preferring an exact filename match, but also handling Chrome's rename-on-conflict like `zenuml-84181014 (1).png`).
4. Move the new file to `--out`.

## Caveats

- **macOS / Linux / Windows**: works on all three but only tested on macOS.
- **Browser must have an active Atlassian session**. If the URL opens to a login prompt, log in and re-run.
- **Chrome's `Always ask where to save` setting**: if enabled, the browser shows a save dialog and the file never lands in `~/Downloads/` until you click. Either turn it off or wait for the prompt.
- **Multiple concurrent downloads**: if more than one file appears in `~/Downloads/` during the watch window, the script picks the one whose name best matches `--filename`. Avoid running this in parallel with other downloads.
- **Files >50 MB or slow links**: bump `--timeout-sec`.

## Related skills

- `find-macros-on-page` — locates the macro's `customContentId` and surfaces orphan-backup attachments. Hand the attachment filename from that output to this skill.
- After downloading a `zenuml-*.png` written by our PNG-embedded-source feature, extract the source from the iTXt chunk:
  ```python
  import struct, zlib
  with open("/tmp/recovered.png","rb") as f: d = f.read()
  i = 8
  while i < len(d):
      ln = struct.unpack(">I", d[i:i+4])[0]
      t = d[i+4:i+8].decode()
      if t == "iTXt":
          body = d[i+8:i+8+ln]
          kw, rest = body.split(b"\x00", 1)
          cflag = rest[0]
          _, rest = rest[2:].split(b"\x00", 1)
          _, text = rest.split(b"\x00", 1)
          if cflag: text = zlib.decompress(text)
          print(f"{kw.decode()}: {text.decode()[:500]}")
      i += 8 + ln + 4
      if t == "IEND": break
  ```
