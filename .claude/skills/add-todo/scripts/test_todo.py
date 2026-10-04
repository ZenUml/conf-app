"""Offline tests for the shared todo store used by add-todo and list-todos."""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import todo  # noqa: E402

NOW = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)


class TodoStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "todos.json")

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            todo.main(["--file", self.path, *argv], now=NOW)
        return out.getvalue()

    def items(self):
        with open(self.path) as f:
            return json.load(f)["items"]

    def test_add_creates_file_and_assigns_incrementing_ids(self):
        self.run_cli("add", "First", "--notes", "from chat")
        self.run_cli("add", "Second")
        items = self.items()
        self.assertEqual([i["id"] for i in items], [1, 2])
        self.assertEqual(items[0]["title"], "First")
        self.assertEqual(items[0]["notes"], "from chat")
        self.assertEqual(items[0]["status"], "open")
        self.assertIsNone(items[0]["completed_at"])

    def test_done_marks_completed(self):
        self.run_cli("add", "Task")
        self.run_cli("done", "1")
        item = self.items()[0]
        self.assertEqual(item["status"], "done")
        self.assertEqual(item["completed_at"], NOW.isoformat())

    def test_done_unknown_id_fails(self):
        self.run_cli("add", "Task")
        with self.assertRaises(SystemExit):
            self.run_cli("done", "99")

    def test_list_shows_open_and_recently_done_only(self):
        for title in ("open task", "recent done", "old done"):
            self.run_cli("add", title)
        data = {"items": self.items()}
        data["items"][1].update(status="done", completed_at=(NOW - timedelta(days=6)).isoformat())
        data["items"][2].update(status="done", completed_at=(NOW - timedelta(days=8)).isoformat())
        with open(self.path, "w") as f:
            json.dump(data, f)
        out = self.run_cli("list")
        self.assertIn("open task", out)
        self.assertIn("recent done", out)
        self.assertNotIn("old done", out)
        self.assertLess(out.index("open task"), out.index("recent done"))

    def test_list_on_missing_file_reports_empty(self):
        self.assertIn("No todos", self.run_cli("list"))


if __name__ == "__main__":
    unittest.main()
