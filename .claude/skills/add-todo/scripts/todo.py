#!/usr/bin/env python3
"""Local todo store shared by the add-todo and list-todos skills.

Storage: <git common dir>/todos.json (e.g. conf-app/.git/todos.json). Inside .git it
is never tracked, and every worktree of the repo resolves to the same file.
Override with --file or the TODO_FILE environment variable.

  todo.py add "<title>" [--notes "<context>"]
  todo.py list [--days 7]
  todo.py done <id> [<id> ...]
  todo.py path
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone


def default_path():
    if os.environ.get("TODO_FILE"):
        return os.environ["TODO_FILE"]
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        sys.exit("Not inside a git repository; pass --file or set TODO_FILE.")
    return os.path.join(common, "todos.json")


def load(path):
    if not os.path.exists(path):
        return {"items": []}
    with open(path) as f:
        return json.load(f)


def save(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def local(ts):
    return datetime.fromisoformat(ts).astimezone().strftime("%Y-%m-%d %H:%M %Z")


def cmd_add(args, path, now):
    data = load(path)
    item = {
        "id": max((i["id"] for i in data["items"]), default=0) + 1,
        "title": args.title,
        "notes": args.notes,
        "status": "open",
        "created_at": now.isoformat(),
        "completed_at": None,
    }
    data["items"].append(item)
    save(path, data)
    print(f"Added #{item['id']}: {item['title']}")
    print(f"Stored in {path}")


def cmd_done(args, path, now):
    data = load(path)
    by_id = {i["id"]: i for i in data["items"]}
    missing = [n for n in args.ids if n not in by_id]
    if missing:
        sys.exit(f"No todo with id {', '.join(map(str, missing))}")
    for n in args.ids:
        by_id[n].update(status="done", completed_at=now.isoformat())
        print(f"Done #{n}: {by_id[n]['title']}")
    save(path, data)


def cmd_list(args, path, now):
    items = load(path)["items"]
    cutoff = now - timedelta(days=args.days)
    open_items = [i for i in items if i["status"] == "open"]
    done_items = sorted(
        (i for i in items if i["status"] == "done" and datetime.fromisoformat(i["completed_at"]) >= cutoff),
        key=lambda i: i["completed_at"], reverse=True,
    )
    if not open_items and not done_items:
        print(f"No todos (open, or done in the past {args.days} days). File: {path}")
        return
    print(f"Open ({len(open_items)})")
    for i in open_items:
        print(f"  [ ] #{i['id']} {i['title']}  (added {local(i['created_at'])})")
        if i.get("notes"):
            print(f"        {i['notes']}")
    print(f"Done in the past {args.days} days ({len(done_items)})")
    for i in done_items:
        print(f"  [x] #{i['id']} {i['title']}  (done {local(i['completed_at'])})")
    print(f"File: {path}")


def main(argv=None, now=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", help="todo JSON path (default: <git common dir>/todos.json)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    add = sub.add_parser("add")
    add.add_argument("title")
    add.add_argument("--notes", default="")
    lst = sub.add_parser("list")
    lst.add_argument("--days", type=int, default=7)
    done = sub.add_parser("done")
    done.add_argument("ids", type=int, nargs="+")
    sub.add_parser("path")
    args = parser.parse_args(argv)

    path = args.file or default_path()
    now = now or datetime.now(timezone.utc)
    if args.cmd == "path":
        print(path)
        return
    {"add": cmd_add, "list": cmd_list, "done": cmd_done}[args.cmd](args, path, now)


if __name__ == "__main__":
    main()
