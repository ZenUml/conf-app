---
name: feedback-attribution
description: Link one piece of customer feedback (CSAT score, feature/problem report, comment) to the diagram, page or failure it is about, and state how sure the link is. Use when the user asks "which diagram is this feedback about", "is this complaint related to X", "is the link right", "give me a confidence", or when a customer-feedback finding must be tied to a defect before filing or fixing it. Builds on customer-feedback (finding the feedback) and replay-forensics (browser evidence).
---

# Feedback attribution

Feedback rarely carries the ID of the thing it is about. The page-banner CSAT carries `page_id`
but `custom_content_id: null`, so "this 1-star is about diagram X" is always an inference. This
skill turns that inference into an explicit relationship class and a confidence table.

**Rule:** never write "this is the diagram" unless the feedback event and the diagram share an
identifier. Same user + same page + same time window is at most **suspected**. Classes come from
`customer-feedback/SKILL.md` step 4: `verified` / `suspected` / `unrelated`.

## Steps

1. **Read the feedback event's own identifiers.** Run the context window (below) and read the
   "Feedback events" block: `macro_uuid`, `custom_content_id`, `content_id`, `page_id`, `surface`,
   `feedback_text`. A page-banner `macro_uuid` (`...static-zenuml-page-banner`) is the banner
   module, not a diagram.
   - Shared diagram ID present: `verified`. Stop here.
   - Only `page_id`: continue.
2. **List candidates.** Every diagram the same `distinct_id` touched in the window, grouped by
   `(page_id, custom_content_id)`. A candidate on the feedback's page is marked `*`.
3. **Eliminate.** For each candidate, write down why it stays or goes:
   - different page from the feedback, and the user was not on it at submit time
   - no failure event (`convert_to_png` error, `save_failed`, `macro_render_failed`, ...)
   - its content cannot produce the complaint (e.g. "icons not showing" and the diagram's
     stored source holds no image references; read it from the D1 mirror or Confluence)
4. **Match the complaint text to a mechanism.** Name the code path that would produce what the
   user describes, and whether you reproduced it (Storybook, tunnel, staging). A reproduction on
   the same content is the strongest evidence short of a shared ID.
5. **Pull browser evidence** with replay-forensics when the session was recorded
   (`session_replay_source` not `off`, `$mp_replay_id` present on the events).
6. **Write the verdict** in the format below.

## Context window script

```bash
python3 .claude/skills/feedback-attribution/scripts/context_window.py \
  --site <client_domain> --distinct-id <distinct_id> \
  --at <feedback time, ISO UTC> --minutes 10 \
  --json-out <scratchpad>/events.json
```

- Read-only JQL through `mixpanel/scripts/mp_query.py`; needs `.env.mixpanel` (falls back to the
  main checkout's copy).
- Times are UTC. The script widens the project-timezone date range by a day and filters on epoch
  time, so the window is exact.
- `--json-out` feeds `replay-forensics/scripts/replay_parse.py --events`.
- `read_status=empty` means the query worked and found nothing; check site spelling
  (bare subdomain) and `distinct_id` before concluding "no activity".

Output: feedback identifiers, an event table (macro, cc_id, page, type, surface, label, replay
source, replay id), and a candidate table with events / saves / views / png_fail counts.
`saves` counts `macro_save_succeeded`, `macro_create_succeeded` and `macro_publish_completed`,
so one Publish can count 2.

## Verdict format

State the class first, then two separate claims, because they fail independently:

| Claim | Evidence for | Evidence against / gap | Confidence |
|---|---|---|---|
| A. The feedback is about diagram `<cc placeholder>` | same page, only candidate with failures, ... | no shared ID | e.g. 85% |
| B. The complaint means mechanism `<M>` | text matches; reproduced on same content; replay shows ... | other causes not excluded | e.g. 85% |
| A and B together | | | product, e.g. ~70% |

Then list each **remaining uncertainty source** with its rough share of the gap (for example:
"user may mean a diagram on another page", "replay records only console output, so CSP is
inferred", "a second failing diagram has no icons"). The user asks "where is the other 30%" —
answer it before they ask.

Keep confidence numbers as judgement, labelled as such; never present them as measured.

## Pitfalls

- Saying "the 1-star is about this diagram" after finding one plausible candidate. Earlier
  investigations did this and had to be walked back to `suspected (strong)`.
- Counting `toPng_failed` as user-visible. PNG capture failure is invisible in the viewer; tie it to
  the complaint through content (what the PNG would contain), not through the event alone.
- Zero failures after a fix does not prove the fix: capture runs only when the attachment is stale.
  Count attempts too.
- Public repo: write placeholders (`example-tenant`, `<page_id>`) in any committed file. Real IDs
  stay in the session or in the `private/` submodule.
