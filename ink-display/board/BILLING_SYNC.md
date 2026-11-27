# Mixpanel billing snapshot sync

Capture the visible, fully loaded Data Usage page from the signed-in browser. The only accepted source URL is `https://mixpanel.com/project/3373228/app/settings/org/plan/data-usage`; the accepted organization is `Diagramly.Ai`. Pass a JSON envelope containing `source_url`, `text` (visible page body), and `observed_at` (timezone-aware ISO timestamp of the capture):

```sh
/Users/pengxiao/.local/share/kindle-quota/venv/bin/python board/billing_sync.py ingest --stdin --verify < /private/path/capture.json
```

`--input-file /private/path/capture.json` is equivalent. Treat capture files as private. The command emits one compact JSON summary and never echoes page text, config, token, or the authenticated board URL. `observed_at` and `checked_at` in the summary identify the successful observation in Australia/Melbourne. Capture must be at most ten minutes old and cannot be in the future.

The parser uses exact displayed counts, not rounded percentages. K/M plan limits are expanded to integers. It requires both billing metrics and matching displayed period ends. A displayed November 30 end becomes the exclusive December 1 end used by the board. The existing snapshot's cycle start is reused only for the same exclusive end. On first setup or rollover, supply `--period-start YYYY-MM-DD` only after verifying that start from official billing evidence. The command never guesses month boundaries. A lower usage count is valid; an older observation or conflicting facts at the same timestamp are rejected.

Writes use a same-directory temporary file with mode 0600, fsync, a process lock, and atomic replacement. Invalid input leaves the snapshot unchanged. History remains owned by the existing Mixpanel source fetcher. The Store detects a newer snapshot mtime on its next service loop without waiting for the usual five-minute interval; failed fetches retain the existing 60-second retry delay.

`--verify` waits internally for at most 60 seconds (`--timeout` can shorten this). It checks the consumed cache timestamp, cycle and exact numbers, then compares the served image's Mixpanel crop against an isolated rendering of that cached panel. Pillow and the board renderer are used only for image verification. Status `pending` means ingestion succeeded but both checks have not completed; flags identify the completed checks. It is not a claim that the display updated. `saved` means verification was not requested; `verified` means both checks passed. `changed` reports changes to billing facts, cycle, organization or source URL. A fresh observation with identical facts still updates `checked_at` and is written, while `changed` stays false. An identical timestamp and facts is idempotent.

After a pending result, retry verification without fetching or writing another observation:

```sh
/Users/pengxiao/.local/share/kindle-quota/venv/bin/python board/billing_sync.py verify --timeout 45
```

This reads the existing private snapshot and checks cache and served crop. It leaves the snapshot bytes and timestamp unchanged. Its status is `pending` or `verified`, with the same verification flags. Missing or invalid saved snapshots produce a sanitized error.

`sync --verify` first tries one bounded agent-browser auto-connect using a unique session with strict tab pinning. It explicitly creates a uniquely labelled chrome://version tab, checks the visible profile path ends in `/Profile 8`, navigates that owned tab to the official URL, waits for complete visible billing text, and ingests the resulting envelope. It closes that explicit tab label and its own session. It does not launch Chrome, enable MCP, read cookies, or change authentication. If attachment or capture fails, it returns `needs_browser` with exit code 2; the calling workflow can capture through its existing CUA extension session and use `ingest --stdin --verify`. It does not repeatedly probe CDP. Browser capture itself is bounded separately from the verification wait. After capture, ingestion plus verification is one command. Error summaries exit 1; saved/pending/verified summaries exit 0. Do not turn `pending` into success in the caller.

Run tests with:

```sh
/Users/pengxiao/.local/share/kindle-quota/venv/bin/python -m unittest discover -s board -p 'test_billing_sync.py'
python3 -m unittest discover -s board -p 'test_store.py'
```
