#!/usr/bin/env python3
"""Post a spot-check report and its screenshots to the branch's open PR.

Screenshots go to the `pr-evidence` branch under `pr-<n>/spot-check-<UTC stamp>/`
(the convention in `.claude/skills/pr-review-support-materials/SKILL.md`), through the
GitHub contents API, so no local checkout or push is needed. The comment links every image
to the evidence commit SHA, so later uploads cannot replace what the reviewer sees.

Usage, from the repo root:
    python3 .claude/skills/spot-check/scripts/post_evidence.py \
        --report /tmp/spot-check/conf-app/report.md \
        --site lite-stg.atlassian.net [--build v2026.10.301200] [--commit <sha>] [--pr <n>] [--dry-run]

The report is Markdown. Each assertion is a list item that starts with PASS, FAIL or
SKIPPED; a SKIPPED item must give its reason after a dash or colon. Screenshots are local
image refs (`![caption](01-page.png)`), resolved relative to the report file.

Exit codes: 0 posted (or dry run), 1 bad report, 2 no PR for the branch (report in chat
only), 3 report names a non-internal *.atlassian.net host, 4 screenshot file missing,
5 gh failure.
"""
import argparse, base64, datetime, json, os, re, subprocess, sys, tempfile

EVIDENCE_BRANCH = "pr-evidence"
HOST_RE = re.compile(r"\b[a-z0-9][a-z0-9-]*\.atlassian\.net\b", re.IGNORECASE)
DOMAIN_RE = re.compile(r"domain:\s*['\"]([^'\"]+\.atlassian\.net)['\"]")
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
ASSERTION_RE = re.compile(r"^\s*[-*]\s+\**(PASS|FAIL|SKIPPED)\b\**(.*)$", re.MULTILINE)
REASON_RE = re.compile(r"\s[—–-]\s+\S|\(.+\)")  # "<what> — <why>" or "(<why>)"


class ReportError(Exception):
    pass


class GhError(Exception):
    pass


def load_allowlist(apps_ts_text):
    """Internal Confluence hosts: every `domain:` in tests/e2e-tests/config/apps.ts."""
    return {d.lower() for d in DOMAIN_RE.findall(apps_ts_text)} | {"example.atlassian.net"}


def disallowed_hosts(text, allowlist):
    seen = []
    for host in HOST_RE.findall(text):
        host = host.lower()
        if host not in allowlist and host not in seen:
            seen.append(host)
    return seen


def check_assertions(report):
    counts = {"PASS": 0, "FAIL": 0, "SKIPPED": 0}
    for outcome, rest in ASSERTION_RE.findall(report):
        counts[outcome] += 1
        if outcome == "SKIPPED" and not REASON_RE.search(rest):
            raise ReportError(f"SKIPPED needs a reason after a dash: {rest.strip()!r}")
    if not sum(counts.values()):
        raise ReportError("no assertion lines (`- PASS|FAIL|SKIPPED: ...`) in the report")
    return counts


def local_image_refs(report):
    refs = []
    for _, target in IMAGE_RE.findall(report):
        if not re.match(r"^[a-z]+://", target) and target not in refs:
            refs.append(target)
    return refs


def destinations(refs, evidence_dir):
    out, used = {}, set()
    for ref in refs:
        name, n = os.path.basename(ref), 2
        while name in used:
            name, n = f"{n}-{os.path.basename(ref)}", n + 1
        used.add(name)
        out[ref] = f"{evidence_dir}/{name}"
    return out


def rewrite_refs(report, mapping):
    return IMAGE_RE.sub(
        lambda m: f"![{m.group(1)}]({mapping.get(m.group(2), m.group(2))})", report)


def pinned_url(repo, sha, path):
    return f"https://github.com/{repo}/blob/{sha}/{path}?raw=true"


def compose_body(report, pr, site, build, commit, date, counts, evidence_url):
    tested = commit or pr["headRefOid"]
    lines = [
        f"## Spot check — {date}",
        "",
        f"- Branch: `{pr['headRefName']}` @ `{tested[:12]}`",
        f"- Site: `{site}`",
    ]
    if build:
        lines.append(f"- Build: `{build}`")
    lines += [
        f"- Result: {counts['PASS']} PASS · {counts['FAIL']} FAIL · {counts['SKIPPED']} SKIPPED",
        f"- Evidence: {evidence_url}",
        "",
        report.strip(),
        "",
        "<sub>Posted by the spot-check skill (`post_evidence.py`). Ad hoc check, not a checked-in E2E test.</sub>",
    ]
    return "\n".join(lines) + "\n"


def run_gh(args, input_file=None):
    proc = subprocess.run(["gh", *args], capture_output=True, text=True)
    if proc.returncode:
        raise GhError((proc.stderr or proc.stdout).strip())
    return proc.stdout.strip()


def upload(gh, repo, path, data, message, tmpdir):
    body = os.path.join(tmpdir, "put.json")
    with open(body, "w") as fh:
        json.dump({"message": message, "branch": EVIDENCE_BRANCH,
                   "content": base64.b64encode(data).decode()}, fh)
    out = gh(["api", "-X", "PUT", f"repos/{repo}/contents/{path}", "--input", body],
             input_file=body)
    return json.loads(out)["commit"]["sha"]


def main(argv=None, gh=run_gh):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--report", required=True)
    ap.add_argument("--site", required=True, help="Confluence host checked, e.g. lite-stg.atlassian.net")
    ap.add_argument("--build", help="visible build/version label, e.g. v2026.10.301200")
    ap.add_argument("--commit", help="tested commit when it is not the PR head")
    ap.add_argument("--pr", help="PR number; default: the PR for the current branch")
    ap.add_argument("--repo", default="ZenUml/conf-app")
    ap.add_argument("--apps-ts", default="tests/e2e-tests/config/apps.ts")
    ap.add_argument("--dry-run", action="store_true", help="print the comment; upload and post nothing")
    a = ap.parse_args(argv)

    with open(a.report) as fh:
        report = fh.read()
    try:
        counts = check_assertions(report)
    except ReportError as e:
        print(f"bad report: {e}", file=sys.stderr)
        return 1

    with open(a.apps_ts) as fh:
        allow = load_allowlist(fh.read())
    bad = disallowed_hosts(f"{report}\n{a.site}", allow)
    if bad:
        print("refusing to post: non-internal Confluence host(s) "
              f"{', '.join(bad)} (docs/policies/client-privacy.md). Staging/dev sites only.",
              file=sys.stderr)
        return 3

    base = os.path.dirname(os.path.abspath(a.report))
    files = {}
    for ref in local_image_refs(report):
        p = os.path.join(base, ref)
        if not os.path.isfile(p):
            print(f"screenshot not found: {ref} (looked in {p})", file=sys.stderr)
            return 4
        files[ref] = p

    try:
        pr = json.loads(gh(["pr", "view", *([a.pr] if a.pr else []), "--repo", a.repo,
                            "--json", "number,url,headRefName,headRefOid"]))
    except GhError as e:
        print(f"no PR for this branch ({e}); report the spot check in chat only.", file=sys.stderr)
        return 2

    now = datetime.datetime.now(datetime.timezone.utc)
    evidence_dir = f"pr-{pr['number']}/spot-check-{now:%Y%m%d-%H%M%S}"
    dest = destinations(list(files), evidence_dir)
    date = f"{now:%Y-%m-%d %H:%M} UTC"

    if a.dry_run:
        body = compose_body(rewrite_refs(report, {r: pinned_url(a.repo, "<sha>", d) for r, d in dest.items()}),
                            pr, a.site, a.build, a.commit, date, counts,
                            f"https://github.com/{a.repo}/tree/<sha>/{evidence_dir}")
        print(body)
        return 0

    try:
        gh(["api", f"repos/{a.repo}/git/ref/heads/{EVIDENCE_BRANCH}"])
        with tempfile.TemporaryDirectory() as tmp:
            # No "#<n>": GitHub would add a "referenced this pull request" entry per file.
            msg = f"evidence: {evidence_dir}"
            for ref, path in files.items():
                with open(path, "rb") as fh:
                    upload(gh, a.repo, dest[ref], fh.read(), msg, tmp)
            # The README goes last: its commit's tree holds every image, so one SHA pins all.
            readme = compose_body(rewrite_refs(report, {r: os.path.basename(d) for r, d in dest.items()}),
                                  pr, a.site, a.build, a.commit, date, counts, "this directory")
            sha = upload(gh, a.repo, f"{evidence_dir}/README.md", readme.encode(), msg, tmp)
            body = compose_body(rewrite_refs(report, {r: pinned_url(a.repo, sha, d) for r, d in dest.items()}),
                                pr, a.site, a.build, a.commit, date, counts,
                                f"https://github.com/{a.repo}/tree/{sha}/{evidence_dir}")
            body_file = os.path.join(tmp, "comment.md")
            with open(body_file, "w") as fh:
                fh.write(body)
            url = gh(["pr", "comment", str(pr["number"]), "--repo", a.repo, "--body-file", body_file],
                     input_file=body_file)
    except GhError as e:
        print(f"gh failed: {e}", file=sys.stderr)
        return 5
    print(url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
