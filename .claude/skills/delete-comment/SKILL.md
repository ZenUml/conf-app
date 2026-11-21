---
name: delete-comment
description: "Audits every code comment in a directory or file set, sorts each into Tautology, Stale, Excuse or Decision Record, deletes them, files GitHub issues for the hacks Excuse comments covered, moves Decision Records into docs/adr, and tightens the comment ratchet. Use for /delete-comment <path>, \"delete comments\", \"comment audit\", or when the comment ratchet (pnpm lint:comments) or local/no-comments lint fails."
argument-hint: "<file-or-directory>..."
---

# Delete comments

Code comments are banned in this repo. `local/no-comments` (`scripts/comments/no-comments-rule.mjs`) is an ESLint error in the directories already cleaned (the `local/no-comments` block at the end of `eslint.config.mjs`). Everywhere else, `pnpm lint:comments` (`scripts/comments/ratchet.mjs`, run in the `PR checks` workflow) enforces per-file counts in `scripts/comments/baseline.json`: a file may lose comments but never gain them. Directives (`eslint-disable`, `@ts-expect-error`, `/// <reference>`, `prettier-ignore`, `@vitest-environment`, shebangs, `@license`) are allowed.

Work on one coherent scope per PR, such as a directory, so the ADRs and issues stay reviewable. Without an argument, ask which scope to audit; `node scripts/comments/strip.mjs --dry-run <dir>` shows how many comments a scope holds.

## 1. List and read

Run `node scripts/comments/strip.mjs --dry-run <scope>` to list every comment with its location. Read each file in full: whether a comment is stale or an excuse depends on the code around it and on code it names elsewhere.

## 2. Classify every comment

- **Tautology**: repeats what the code, a name or a test title already says. Section banners, "Mock X", "Write to cache", "Factory function", JSDoc that restates a signature.
- **Stale**: names code, behavior, files or history that no longer match. Verify it: open the named file, grep the named symbol, and use `git log -S` to date a change. A comment that says "older builds" or "compatibility with existing code" is stale when nothing older is left to support.
- **Excuse**: lets a hack stand. Typical signs in this repo: a compatibility branch for a backend version deployed long ago (backend and frontend ship from the same pipeline, so date the backend change with `git log -S`), a constant that "mirrors" another instead of importing it, test fixtures inside production data, string-matching an error message to recover a status, a fallback to a path another comment says is wrong. Check that the hack is still reachable before you file it.
- **Decision Record**: the reason for a non-obvious choice that the code cannot show, such as a measured limit, a contract with another system, a rejected alternative, or the incident that taught the rule.

When a comment is partly a decision and partly an excuse, record the decision and file the excuse.

## 3. Act

- **Decision Record**: write it into `docs/adr`. Extend an ADR that already covers the topic; otherwise create the next number, one ADR per module or topic, in the format of `docs/adr/0013-macro-metrics-counting.md` (title, Date, Status, Related, Context, numbered Decisions). Keep the evidence: issue numbers, dates, measured values.
- **Excuse**: search for an existing issue first (`gh issue list -R ZenUml/conf-app --search "<symbol>" --state all`). Link to an open match instead of filing a duplicate. Otherwise run `gh issue create -R ZenUml/conf-app --label needs-triage` with the file and line, the quoted comment, what the hack does, the evidence that it is no longer needed or is wrong, and the fix. Filing issues is part of this skill's request, so it needs no extra approval.
- **Tautology / Stale**: delete.

Follow the client-privacy rule in ADRs and issues: no real tenant names, hostnames or cloudIds.

## 4. Delete and lock in

1. Run `node scripts/comments/strip.mjs <scope>`. It deletes every non-directive comment in the scope and the blank lines they leave. Read the diff: a comment inside an expression can leave odd spacing.
2. Run the scope's unit tests (`npx vitest run <scope>`).
3. Add the scope to the `files` of the `local/no-comments` block in `eslint.config.mjs`, then run `npx eslint <scope>`.
4. Run `pnpm lint:comments:update`, then `pnpm lint:comments`. The update only lowers counts; it refuses to raise one.

## 5. Report

Put the ledger at the top of the PR description: the count per category, a table of every comment (location, category, where it went), the issues filed or linked, the ADRs written, and the lines removed (`git diff --stat`).
