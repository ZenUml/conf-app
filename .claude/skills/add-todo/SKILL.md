---
name: add-todo
description: Record a todo item in a local, untracked JSON file shared by every worktree of this repo. With no argument, extracts the todo from the most recent conversation. Use when the user invokes /add-todo, says "add a todo", "todo:", "add this to my todos", "记个待办", or asks to note a follow-up for later. To view todos use list-todos.
---

# add-todo

Store: `<git common dir>/todos.json` (in this repo: `conf-app/.git/todos.json`). Inside `.git`, so never committed, and every `../conf-app-*` worktree shares it. `todo.py path` prints it.

```bash
python3 .claude/skills/add-todo/scripts/todo.py add "<title>" --notes "<context>"
```

Run from the repo root (or any worktree root).

## With an argument

The argument is the todo. Use it as `title` (trim to one line, imperative: "Recheck APTi payment after trial ends"). Put any extra detail the user gave in `--notes`.

## Without an argument — extract from the conversation

1. Read back through the most recent exchanges in this session.
2. Pick the one concrete follow-up that is still unfinished: a deferred request ("later", "next time", "after X"), a step you proposed that was not done, a check scheduled for a future date, or an open numbered option the user did not act on.
3. `title`: one imperative line naming the action and its object. Include an absolute date when the conversation named one (convert "tomorrow" to `2026-09-16` style).
4. `--notes`: the why plus refs — PR/issue numbers, file paths, the site or tenant — enough to act on it cold in a new session. Quote the user's own line when it is the source.
5. More than one clear candidate: add each as its own todo.
6. Nothing actionable in context (fresh session, after `/clear`): ask the user for the todo; do not invent one.

## After adding

Echo the id and title the script printed. Do not start working on the todo.

## Notes

- Client-privacy rule does not apply to the store (it is untracked), but never copy a todo title into a public-repo file.
- Mark an item done with `todo.py done <id>` — see list-todos.
