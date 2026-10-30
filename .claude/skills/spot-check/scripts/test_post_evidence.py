#!/usr/bin/env python3
"""Unit checks for post_evidence.py. No network, no credentials; `gh` is replaced by a fake.

Run from the repo root:
    python3 .claude/skills/spot-check/scripts/test_post_evidence.py
or:
    python3 -m unittest discover -s .claude/skills/spot-check/scripts
(`python3 -m unittest <path>` fails with "Empty module name" on a path under `.claude/`.)
"""
import contextlib, io, json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post_evidence as pe  # noqa: E402

APPS_TS = """
  lite: { domain: 'lite-stg.atlassian.net' },
  dev: { domain: 'lite-dev.atlassian.net' },
  prod: { domain: 'zenuml.atlassian.net' },
"""

REPORT = """Spot check plan: title renders

- PASS: title shows after first save
  ![title after save](01-title.png)
- SKIPPED: edit path — not deployed to staging yet
"""


class Allowlist(unittest.TestCase):
    def test_reads_domains_from_apps_ts(self):
        self.assertEqual(
            pe.load_allowlist(APPS_TS),
            {"lite-stg.atlassian.net", "lite-dev.atlassian.net", "zenuml.atlassian.net",
             "example.atlassian.net"},
        )

    def test_flags_host_outside_allowlist(self):
        allow = pe.load_allowlist(APPS_TS)
        text = "see https://lite-stg.atlassian.net/wiki and acme-corp.atlassian.net/wiki"
        self.assertEqual(pe.disallowed_hosts(text, allow), ["acme-corp.atlassian.net"])

    def test_host_match_is_case_insensitive(self):
        allow = pe.load_allowlist(APPS_TS)
        self.assertEqual(pe.disallowed_hosts("Lite-Stg.Atlassian.net", allow), [])


class Assertions(unittest.TestCase):
    def test_counts_outcomes(self):
        self.assertEqual(pe.check_assertions(REPORT), {"PASS": 1, "FAIL": 0, "SKIPPED": 1})

    def test_skipped_without_reason_is_rejected(self):
        with self.assertRaisesRegex(pe.ReportError, "SKIPPED"):
            pe.check_assertions("- PASS: a\n- SKIPPED: edit path\n")

    def test_report_without_assertions_is_rejected(self):
        with self.assertRaisesRegex(pe.ReportError, "no assertion"):
            pe.check_assertions("just notes\n")


class Images(unittest.TestCase):
    def test_finds_local_refs_only(self):
        text = "![a](01.png) ![b](https://example.com/x.png) ![c](sub/02.png)"
        self.assertEqual(pe.local_image_refs(text), ["01.png", "sub/02.png"])

    def test_rewrites_refs_to_pinned_urls(self):
        out = pe.rewrite_refs("![a](01.png)\n![a again](01.png)", {"01.png": "https://h/x.png"})
        self.assertEqual(out, "![a](https://h/x.png)\n![a again](https://h/x.png)")

    def test_pinned_url_uses_commit_sha(self):
        self.assertEqual(
            pe.pinned_url("ZenUml/conf-app", "abc123", "pr-7/spot-check-x/01.png"),
            "https://github.com/ZenUml/conf-app/blob/abc123/pr-7/spot-check-x/01.png?raw=true",
        )

    def test_destination_names_do_not_collide(self):
        self.assertEqual(
            pe.destinations(["a/01.png", "b/01.png", "02.png"], "pr-7/spot-check-x"),
            {"a/01.png": "pr-7/spot-check-x/01.png",
             "b/01.png": "pr-7/spot-check-x/2-01.png",
             "02.png": "pr-7/spot-check-x/02.png"},
        )


class Body(unittest.TestCase):
    def test_header_names_target_and_counts(self):
        body = pe.compose_body(
            report="- PASS: x",
            pr={"headRefName": "feat/x", "headRefOid": "0123456789abcdef"},
            site="lite-stg.atlassian.net", build="v2026.10.301200", commit=None,
            date="2026-10-30 01:02 UTC", counts={"PASS": 1, "FAIL": 0, "SKIPPED": 0},
            evidence_url="https://github.com/o/r/tree/sha/pr-7/spot-check-x",
        )
        self.assertTrue(body.startswith("## Spot check — 2026-10-30 01:02 UTC"))
        self.assertIn("`feat/x` @ `0123456789ab`", body)
        self.assertIn("`lite-stg.atlassian.net`", body)
        self.assertIn("`v2026.10.301200`", body)
        self.assertIn("1 PASS · 0 FAIL · 0 SKIPPED", body)
        self.assertIn("https://github.com/o/r/tree/sha/pr-7/spot-check-x", body)


class FakeGh:
    """Records gh calls and answers the ones post_evidence makes."""

    def __init__(self, pr_found=True):
        self.calls, self.pr_found, self.puts = [], pr_found, 0

    def __call__(self, args, input_file=None):
        self.calls.append(args)
        if args[:2] == ["pr", "view"]:
            if not self.pr_found:
                raise pe.GhError("no pull requests found for branch")
            return json.dumps({"number": 7, "url": "https://github.com/o/r/pull/7",
                               "headRefName": "feat/x", "headRefOid": "0123456789abcdef"})
        if args[0] == "api" and "PUT" in args:
            self.puts += 1
            with open(input_file) as fh:
                payload = json.load(fh)
            assert payload["branch"] == "pr-evidence"
            # "#7" in a commit message adds a "referenced this pull request" entry per file.
            assert "#" not in payload["message"], payload["message"]
            return json.dumps({"commit": {"sha": f"sha{self.puts}"}})
        if args[0] == "api":
            return json.dumps({"object": {"sha": "base"}})
        if args[:2] == ["pr", "comment"]:
            with open(input_file) as fh:
                self.posted = fh.read()
            return "https://github.com/o/r/pull/7#issuecomment-1"
        raise AssertionError(f"unexpected gh call {args}")


class Main(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        with open(os.path.join(self.dir, "01-title.png"), "wb") as fh:
            fh.write(b"\x89PNG\r\n\x1a\n")
        self.report = os.path.join(self.dir, "report.md")
        with open(self.report, "w") as fh:
            fh.write(REPORT)
        self.apps = os.path.join(self.dir, "apps.ts")
        with open(self.apps, "w") as fh:
            fh.write(APPS_TS)

    def run_main(self, gh, *extra):
        argv = ["--report", self.report, "--site", "lite-stg.atlassian.net",
                "--repo", "o/r", "--apps-ts", self.apps, *extra]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = pe.main(argv, gh=gh)
        return code, out.getvalue(), err.getvalue()

    def test_uploads_then_posts_with_last_commit_pinned(self):
        gh = FakeGh()
        code, out, _ = self.run_main(gh)
        self.assertEqual(code, 0)
        self.assertEqual(gh.puts, 2)  # the screenshot, then README.md
        self.assertIn("https://github.com/o/r/blob/sha2/pr-7/spot-check-", gh.posted)
        self.assertIn("https://github.com/o/r/tree/sha2/pr-7/spot-check-", gh.posted)
        self.assertNotIn("](01-title.png)", gh.posted)
        self.assertIn("issuecomment-1", out)

    def test_no_pr_exits_2_and_uploads_nothing(self):
        gh = FakeGh(pr_found=False)
        code, _, err = self.run_main(gh)
        self.assertEqual(code, 2)
        self.assertIn("chat", err)
        self.assertEqual(gh.puts, 0)

    def test_customer_host_exits_3_before_any_gh_call(self):
        with open(self.report, "a") as fh:
            fh.write("- PASS: also seen on acme-corp.atlassian.net\n")
        gh = FakeGh()
        code, _, err = self.run_main(gh)
        self.assertEqual(code, 3)
        self.assertIn("acme-corp.atlassian.net", err)
        self.assertEqual(gh.calls, [])

    def test_missing_image_exits_4(self):
        os.remove(os.path.join(self.dir, "01-title.png"))
        code, _, err = self.run_main(FakeGh())
        self.assertEqual(code, 4)
        self.assertIn("01-title.png", err)

    def test_dry_run_prints_body_without_writes(self):
        gh = FakeGh()
        code, out, _ = self.run_main(gh, "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(gh.puts, 0)
        self.assertFalse(any(c[:2] == ["pr", "comment"] for c in gh.calls))
        self.assertIn("## Spot check", out)


if __name__ == "__main__":
    unittest.main()
