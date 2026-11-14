---
name: refine-a-skill
description: Revise an existing skill after a real failure — a correction the user typed, a mistake repeated across sessions, or a rule that was followed in text but downgraded in practice. Use when the user says "refine the skill", "improve the skill", "update the skill so this doesn't happen again", "add this to the skill", "把这条加进 skill", "改一下 X 技能", or names a skill that just misbehaved. For trigger-accuracy and description tuning, or for eval-driven optimization against test cases, use skill-creator instead. For deciding WHICH memory layer a lesson belongs in, use add-rule first.
---

# Refine a Skill

A skill is revised from evidence of it failing, never from an impression that it could read better.

## 1. Recover the incident

Cheapest source first. Never skip a tier.

1. **This session.** Quote the exact turn where the skill produced the wrong behavior.
2. **This project.** `rg -i "<term>" ~/.claude/projects/<cwd-slug>/*.jsonl` — milliseconds.
3. **All history.** `/search-conversation-history`. Minutes and a subagent dispatch; use it only when
   tiers 1 and 2 return nothing.

Stop if no incident is found. A revision without one is a rewrite, and rewrites lose working rules.

## 2. Locate the clause that failed

Name the specific sentence that should have prevented the behavior, and which of these it was:

- **Absent** — no clause covered the case.
- **Present but unread** — buried, or in a section the situation did not route to.
- **Present but downgraded** — read, then treated as advice. This is the common one and the most
  expensive to fix by wording alone.

## 3. Ask whether it can be enforced instead of stated

Mandatory question, discretionary answer. Record one line naming the candidates considered — a hook,
a script bundled with the skill, a state field, an existing validator — and why each was rejected.
Prose is permitted. Skipping the question is not: a sentence can be downgraded at runtime, a check
that exits non-zero cannot.

## 4. Write the minimal edit

- **Net zero.** The file must not end longer than it started. Adding a rule means deleting or merging
  equal weight, or stating in one line why the growth is unavoidable.
- **Imperative, no provenance.** State the rule and its why-clause. Dates, incident names, and session
  ids stay out of the body; they belong in the commit message.
- **Run `add-rule`'s pre-write checks**: dedup sweep across every memory layer, path validation of
  every file, command, and skill name referenced, testable phrasing, placement by the file's own
  precedence.

## 5. Replay it

Both states, or the result proves nothing.

1. Dispatch a fresh subagent — one that has not seen this conversation — with the **pre-edit** skill
   text and a restatement of the situation, and ask only what it does next. Expect the failure.
   Restate what happened, never why it happened: a restatement carrying the diagnosis hands the
   subagent the steps under test, and the comparison then measures nothing. Put everything it needs
   in the prompt and require it to answer from judgment alone — a subagent here can read the skill
   under test, so a baseline that used any tool is void, whatever it concluded.
2. Repeat with the **post-edit** text. Expect the required action.

Record both answers. If the pre-edit run already does the right thing, the edit is unproven; find the
real cause before keeping it. For structure, run `skill-creator`'s `quick_validate.py` under
`/usr/bin/python3` — the default `python3` has no PyYAML.

## 6. Commit and report

Commit the edited paths by name. Never `git add -A` — the config repo carries unrelated drift, and a
sweeping commit buries the revision in it. The commit message carries what the body does not: the
incident, the clause that failed, and which of the three failure modes it was.

Report in five lines or fewer: the clause changed, the mechanism answer, both replay results, the
line delta, the commit SHA.
