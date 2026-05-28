# Retrospective Pipeline

Extract learnings from Claude conversation logs and synthesize them into memory updates, skill updates, and a dated retrospective doc. Run monthly or on demand.

## Arguments

```
/retrospective [--limit N]   # N = max files to process this run (default: new files only)
/retrospective --limit 20    # iteration 1 (newest 20 files)
/retrospective --limit 40    # iteration 2 (files 21–40 via checkpoint)
/retrospective               # subsequent runs — only new files since last run
```

## Step 1 — Extract user messages

Run the Python extraction script:

```bash
python3 scripts/retrospective_extract.py \
  --project ~/.claude/projects/-Users-pengxiao-workspaces-zenuml-conf-app \
  --output /tmp/corpus.jsonl \
  --checkpoint ~/.claude/retrospective-state.json \
  [--limit N] \
  [--dry-run]
```

The script:
- Reads JSONL files sorted newest-first
- Skips files already in the checkpoint (by SHA-256 hash)
- Extracts only substantive user messages (>60 chars, non-command, non-skill-load)
- Outputs `corpus.jsonl` with fields: `{file, line_number, session_id, timestamp, text}`

**Dry-run first** to confirm message count is reasonable (expect 150–500 per 20 files). If count is <50, check skip filters; if >1000, consider reducing --limit.

## Step 2 — Synthesize

Read `/tmp/corpus.jsonl`. For each message, classify into one of:

| Category | Description |
|----------|-------------|
| `correction` | User corrected wrong AI behavior |
| `design_preference` | UI/product/UX principle stated |
| `positive_confirmation` | User confirmed a non-obvious approach |
| `process_feedback` | How AI should operate (investigation, tools, workflow) |

**When context is needed** (ambiguous message, implicit reference to AI output):
```
Read(file=<entry.file>, offset=<entry.line_number - 5>, limit=40)
```
This retrieves the surrounding AI turns for context.

**Focus signals** (high value, extract carefully):
- Repeated reminders ("you must first...", "I told you to...")
- Explicit corrections ("that's wrong", "not this branch")
- Design decisions stated as rules ("only in the editor, not viewer")
- Confirmed approaches the user didn't push back on

## Step 3 — Write outputs

### a. Memory updates
For each new finding not already in mem0, call `mcp__mem0__add_memory`:
- One memory per distinct insight (don't batch)
- Include category, the principle, and a brief why/example
- Skip findings already captured in existing memory files

### b. Skill update — `/working-principles`
File: `.claude/skills/working-principles/SKILL.md`

- Add new rules under the relevant section
- Update stale rules (e.g., if a rule has been superseded by new behavior)
- Remove rules that are no longer applicable
- Keep the file scannable: bullet points, not paragraphs

### c. Retrospective doc
File: `docs/retrospective-<YYYY-MM-DD>.md`

Write delta findings only — things not already in the previous retrospective or in working-principles. Structure:

```markdown
# Retrospective Delta — <date>
## Files processed: N (files X–Y by recency)

### New corrections found
### New design preferences found
### New positive confirmations found
### Process feedback

### Memory entries added: N
### Working-principles changes: N
```

## Step 4 — Update checkpoint

The Python script handles this automatically after writing corpus.jsonl (unless `--dry-run`). Verify by checking `~/.claude/retrospective-state.json` contains the newly processed file hashes.

## Iteration schedule

| Invocation | --limit | Covers |
|------------|---------|--------|
| First run | `--limit 20` | Newest 20 files |
| Second run | `--limit 20` | Files 21–40 (via checkpoint skip) |
| Third run | *(none)* | Files 41–77 |
| Monthly | *(none)* | Only new sessions since last run |
