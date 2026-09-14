---
name: list-todos
description: List the local todo items recorded by add-todo — every open item plus items finished in the past 7 days — and mark items done. Use when the user invokes /list-todos, says "list todos", "show my todos", "what's on my todo list", "待办有哪些", or says a todo is finished ("mark #3 done", "todo 3 is done").
---

# list-todos

Shares the store and script with add-todo (`<git common dir>/todos.json`, untracked, same file in every worktree).

## List

```bash
python3 .claude/skills/add-todo/scripts/todo.py list
```

Output: open items first (oldest first, with notes), then items done in the past 7 days (newest first), times in local timezone. `--days N` widens or narrows the done window only when the user asks for a different window.

Show the list to the user as the script printed it — every open item and every recently done item, each with its `#id`. Do not drop, merge, or re-rank items.

## Mark done

When the user says an item is finished, or you have just completed one in this session:

```bash
python3 .claude/skills/add-todo/scripts/todo.py done <id> [<id> ...]
```

Match by id. If the user names an item by text, run `list` first and confirm the id when more than one item matches.

## Store location

```bash
python3 .claude/skills/add-todo/scripts/todo.py path
```
