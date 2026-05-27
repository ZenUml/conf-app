#!/usr/bin/env python3
"""
Retrospective extraction script.

Reads Claude conversation JSONL logs and extracts substantive user messages,
filtering out commands, skill-loads, task notifications, and other noise.

Usage:
  python3 scripts/retrospective_extract.py \
    --project ~/.claude/projects/-Users-pengxiao-workspaces-zenuml-conf-app \
    --output /tmp/corpus.jsonl \
    --checkpoint ~/.claude/retrospective-state.json \
    --limit 20        # process newest N files; omit for all new files
    --dry-run         # print stats only, no output written
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SKIP_PREFIXES = (
    "/",                               # slash commands
    "Base directory for this skill:",  # skill-load boilerplate
    "<local-command-caveat>",
    "<command-message>",
    "<command-name>",
    "<task-notification>",
    "<bash-stdout>",
    "<bash-stderr>",
    "<bash-input>",
    "Stop hook feedback:",
    "This session is being continued",
    "Summary:",
)

SKIP_CONTAINS = (
    "Base directory for this skill:",
    "<system-reminder>",
    "ARGUMENTS:",
    "local-command-caveat",
)

MIN_LENGTH = 60


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_checkpoint(path: Path) -> dict:
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {"processed": {}, "last_run": None}


def save_checkpoint(path: Path, state: dict):
    state["last_run"] = datetime.now(timezone.utc).isoformat()
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def is_noise(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < MIN_LENGTH:
        return True
    for prefix in SKIP_PREFIXES:
        if stripped.startswith(prefix):
            return True
    for fragment in SKIP_CONTAINS:
        if fragment in stripped:
            return True
    return False


def extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text", ""))
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(p for p in parts if p)
    return ""


def process_file(jsonl_path: Path) -> list[dict]:
    entries = []
    with open(jsonl_path, encoding="utf-8", errors="replace") as f:
        for line_number, raw in enumerate(f, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if obj.get("type") != "user":
                continue
            if obj.get("isMeta"):
                continue

            message = obj.get("message", {})
            if not isinstance(message, dict):
                continue
            if message.get("role") != "user":
                continue

            text = extract_text(message.get("content", "")).strip()
            if not text or is_noise(text):
                continue

            entries.append({
                "file": str(jsonl_path),
                "line_number": line_number,
                "session_id": obj.get("sessionId", ""),
                "timestamp": obj.get("timestamp", ""),
                "text": text,
            })

    return entries


def main():
    parser = argparse.ArgumentParser(description="Extract user messages from Claude JSONL logs")
    parser.add_argument("--project", required=True, help="Path to Claude project logs directory")
    parser.add_argument("--output", default="/tmp/corpus.jsonl", help="Output corpus file")
    parser.add_argument("--checkpoint", default=os.path.expanduser("~/.claude/retrospective-state.json"))
    parser.add_argument("--limit", type=int, default=None, help="Max number of files to process")
    parser.add_argument("--dry-run", action="store_true", help="Print stats only, do not write output")
    args = parser.parse_args()

    project_dir = Path(args.project).expanduser()
    checkpoint_path = Path(args.checkpoint).expanduser()

    if not project_dir.exists():
        print(f"ERROR: project directory not found: {project_dir}", file=sys.stderr)
        sys.exit(1)

    jsonl_files = sorted(
        project_dir.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,  # newest first
    )

    checkpoint = load_checkpoint(checkpoint_path)
    processed = checkpoint.get("processed", {})

    new_files = [f for f in jsonl_files if sha256(f) != processed.get(str(f))]
    if args.limit:
        new_files = new_files[: args.limit]

    print(f"Found {len(jsonl_files)} total files, {len(new_files)} new/changed to process")

    all_entries = []
    new_hashes = {}
    for f in new_files:
        entries = process_file(f)
        all_entries.extend(entries)
        new_hashes[str(f)] = sha256(f)
        print(f"  {f.name[:12]}… → {len(entries)} messages")

    print(f"\nTotal extracted messages: {len(all_entries)}")

    if args.dry_run:
        print("(dry-run: no files written)")
        return

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as out:
        for entry in all_entries:
            out.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"Corpus written to: {output_path}")

    # Update checkpoint with newly processed files
    processed.update(new_hashes)
    checkpoint["processed"] = processed
    if not args.dry_run:
        save_checkpoint(checkpoint_path, checkpoint)
        print(f"Checkpoint updated: {checkpoint_path}")


if __name__ == "__main__":
    main()
