#!/usr/bin/env python3
"""Read-only four-source customer feedback sweep for conf-app.

Runs, in one command, the queries the customer-feedback skill needs:
  marketplace  Marketplace feedback export (cancellation / unsubscribe reasons)
  d1           D1 FeedbackReport rows (in-product feature/problem reports)
  mixpanel     CSAT submissions and feedback-report workflow events
  jsm          ZEN service-desk tickets created or updated in the window
  gmail        not reachable from a script (connector only) -> not_queried

Every source records read_status (ok / empty / failed / unavailable /
not_queried), status (HTTP code or exit code), row count, queried_at and
window. One source failing never stops the others. Secrets are read from
env files and never printed.

Usage:
  python3 .claude/skills/customer-feedback/scripts/sweep.py \
      [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out DIR] [--json]

Defaults: the last 7 complete UTC days. Raw payloads and sweep.json go to
--out (default: a new temp dir). Reconciliation and judgement stay manual;
see SKILL.md.
"""
import argparse
import base64
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

MARKETPLACE_VENDOR_ID = "1215266"
JSM_SITE = "https://zenuml.atlassian.net"
JSM_PROJECT = "ZEN"
D1_DB = "conf-zenuml-prod"
# Our own staging / dogfood sites, excluded from Mixpanel feedback events.
INTERNAL_DOMAIN_RE = r"^(zenuml|whimet|full-stg|lite-stg|lite-dev|dia-stg|diagramly$)"
EXPLICIT_EVENTS = ["csat_submitted", "magic_layout_feedback_submitted", "magic_layout_feedback_updated"]
PROCESS_EVENTS = ["feedback_report_submit_succeeded", "feedback_report_submit_failed"]
BEHAVIOUR_EVENTS = ["csat_displayed", "csat_dismissed"]
TIMEOUT_S = 180


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main_checkout():
    out = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        capture_output=True, text=True, cwd=os.path.dirname(os.path.abspath(__file__)),
    )
    if out.returncode != 0:
        sys.exit("cannot resolve main checkout: " + out.stderr.strip())
    return os.path.dirname(out.stdout.strip())


def load_env(path):
    env = {}
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def result(name, window, **kw):
    base = {"source": name, "window": window, "queried_at": now_iso(), "read_status": "not_queried",
            "status": None, "rows": 0, "note": "", "payload": None, "summary": {}}
    base.update(kw)
    return base


def http_json(url, user, token, out_path):
    auth = base64.b64encode(f"{user}:{token}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = resp.read()
            code = resp.status
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError) as e:
        return f"error:{type(e).__name__}", None
    with open(out_path, "wb") as fh:
        fh.write(body)
    return code, json.loads(body)


def run_marketplace(env, window, out):
    r = result("marketplace", window)
    user, token = env.get("FORGE_EMAIL"), env.get("FORGE_API_TOKEN")
    if not (user and token):
        r.update(read_status="unavailable", note="FORGE_EMAIL/FORGE_API_TOKEN missing in .env.forge.local")
        return r
    q = urllib.parse.urlencode({"accept": "json", "startDate": window["from"], "endDate": window["to"]})
    url = f"https://marketplace.atlassian.com/rest/2/vendors/{MARKETPLACE_VENDOR_ID}/reporting/feedback/details/export?{q}"
    path = os.path.join(out, "marketplace.json")
    code, data = http_json(url, user, token, path)
    r["status"] = code
    if code != 200 or not isinstance(data, list):
        r.update(read_status="failed", note="non-200 or non-list body")
        return r
    r.update(read_status="ok" if data else "empty", rows=len(data), payload=path)
    r["summary"] = {"by_type": count([x.get("feedbackType") for x in data]),
                    "by_addon": count([x.get("addonKey") for x in data]),
                    "with_message": sum(1 for x in data if x.get("message"))}
    return r


def run_d1(root, window, out):
    r = result("d1", window)
    acc = load_env(os.path.join(root, ".env")).get("CLOUDFLARE_ACCOUNT_ID")
    if not acc:
        r.update(read_status="unavailable", note="CLOUDFLARE_ACCOUNT_ID missing in repo-root .env")
        return r
    to_excl = (dt.date.fromisoformat(window["to"]) + dt.timedelta(days=1)).isoformat()
    sql = ("SELECT reportReference, createdAt, clientDomain, forgeAppId, surface, hostModule, diagramType, "
           "description, screenshotExpiresAt, CASE WHEN screenshotData IS NOT NULL THEN 1 ELSE 0 END AS hasShot "
           f"FROM FeedbackReport WHERE createdAt >= '{window['from']}' AND createdAt < '{to_excl}' ORDER BY createdAt")
    cmd = ["npx", "wrangler", "d1", "execute", D1_DB, "--remote", "--env", "production", "--json", "--command", sql]
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID=acc)
    try:
        p = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        r.update(read_status="failed", status="timeout", note=f"wrangler exceeded {TIMEOUT_S}s")
        return r
    r["status"] = p.returncode
    path = os.path.join(out, "d1_feedback.json")
    with open(path, "w") as fh:
        fh.write(p.stdout)
    try:
        rows = json.loads(p.stdout[p.stdout.index("["):])[0]["results"]
    except Exception:
        r.update(read_status="failed", note="could not parse wrangler JSON: " + p.stderr.strip()[:200])
        return r
    r.update(read_status="ok" if rows else "empty", rows=len(rows), payload=path)
    r["summary"] = {"by_surface": count([x.get("surface") for x in rows]),
                    "with_screenshot": sum(1 for x in rows if x.get("hasShot"))}
    return r


def run_mixpanel(root, window, out):
    r = result("mixpanel", window)
    script = os.path.join(root, ".claude/skills/mixpanel/scripts/mp_query.py")
    if not os.path.exists(script):
        r.update(read_status="unavailable", note="mp_query.py not found in main checkout")
        return r
    names = EXPLICIT_EVENTS + PROCESS_EVENTS + BEHAVIOUR_EVENTS
    jql = (
        "function main() {\n"
        f"  return Events({{from_date:'{window['from']}',to_date:'{window['to']}',"
        f"event_selectors:{json.dumps([{'event': n} for n in names])}}})\n"
        f"  .filter(function(e){{var d=e.properties.client_domain||'';return !/{INTERNAL_DOMAIN_RE}/.test(d);}})\n"
        "  .map(function(e){var p=e.properties;return {t:new Date(e.time).toISOString(),n:e.name,"
        "d:p.client_domain,pt:p.product_type,u:e.distinct_id,s:p.feedback_score,tx:p.feedback_text,"
        "surf:p.surface,ans:p.feedback_answer||p.answer,ref:p.report_reference||p.reportReference,"
        "page:p.page_id,cc:p.custom_content_id,macro:p.macro_uuid,env:p.environment_type};});\n}\n"
    )
    js = os.path.join(out, "mixpanel.js")
    path = os.path.join(out, "mixpanel.json")
    with open(js, "w") as fh:
        fh.write(jql)
    try:
        p = subprocess.run([sys.executable, script, "--file", js, "--output", path],
                           cwd=root, capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        r.update(read_status="failed", status="timeout", note=f"mp_query exceeded {TIMEOUT_S}s")
        return r
    r["status"] = p.returncode
    try:
        with open(path) as fh:
            rows = json.load(fh)
    except Exception:
        r.update(read_status="failed", note=(p.stderr or p.stdout).strip()[:200])
        return r
    by = count([x.get("n") for x in rows])
    explicit = [x for x in rows if x.get("n") in EXPLICIT_EVENTS]
    r.update(read_status="ok" if rows else "empty", rows=len(rows), payload=path)
    r["summary"] = {
        "explicit_feedback": {n: by.get(n, 0) for n in EXPLICIT_EVENTS},
        "process_events": {n: by.get(n, 0) for n in PROCESS_EVENTS},
        "behaviour_events": {n: by.get(n, 0) for n in BEHAVIOUR_EVENTS},
        "csat_displayed_sites": len({x.get("d") for x in rows if x.get("n") == "csat_displayed"}),
        "explicit_records": [
            {k: x.get(k) for k in ("t", "n", "d", "pt", "s", "tx", "surf", "ans", "page", "cc", "macro")}
            for x in sorted(explicit, key=lambda x: x.get("t") or "")
        ],
    }
    return r


def run_jsm(env, window, out):
    r = result("jsm", window)
    user, token = env.get("JSM_EMAIL"), env.get("JSM_API_TOKEN")
    if not (user and token):
        r.update(read_status="unavailable", note="JSM_EMAIL/JSM_API_TOKEN missing in .env.forge.local")
        return r
    # JQL date literals use the Jira user's timezone, not UTC. Query one day
    # wider on each side, then keep issues whose created/updated falls in the
    # UTC window (Jira timestamps carry their offset).
    start = dt.datetime.fromisoformat(window["from"] + "T00:00:00+00:00")
    end = dt.datetime.fromisoformat(window["to"] + "T00:00:00+00:00") + dt.timedelta(days=1)
    lo = (start.date() - dt.timedelta(days=1)).isoformat()
    hi = (end.date() + dt.timedelta(days=1)).isoformat()
    jql = (f"project = {JSM_PROJECT} AND ((created >= '{lo}' AND created < '{hi}') "
           f"OR (updated >= '{lo}' AND updated < '{hi}')) ORDER BY created DESC")
    q = urllib.parse.urlencode({"jql": jql, "maxResults": 100, "fields": "summary,status,created,updated"})
    path = os.path.join(out, "jsm.json")
    code, data = http_json(f"{JSM_SITE}/rest/api/3/search/jql?{q}", user, token, path)
    r["status"] = code
    if code != 200 or not isinstance(data, dict):
        r.update(read_status="failed", note="non-200 or non-object body")
        return r

    def in_window(ts):
        if not ts:
            return False
        t = dt.datetime.strptime(ts[:19] + ts[-5:], "%Y-%m-%dT%H:%M:%S%z")
        return start <= t < end

    issues = [i for i in data.get("issues", [])
              if in_window(i["fields"].get("created")) or in_window(i["fields"].get("updated"))]
    r.update(read_status="ok" if issues else "empty", rows=len(issues), payload=path)
    if not data.get("isLast", True):
        r["note"] = "more than 100 issues; results truncated"
    r["summary"] = {"issues": [
        {"key": i.get("key"), "created": short_ts(i["fields"].get("created")),
         "updated": short_ts(i["fields"].get("updated")),
         "status": (i["fields"].get("status") or {}).get("name"),
         "summary": (i["fields"].get("summary") or "")[:100]}
        for i in issues]}
    return r


def short_ts(ts):
    """Jira timestamp to minute precision in UTC, e.g. 2026-11-05T14:48Z."""
    if not ts:
        return ""
    t = dt.datetime.strptime(ts[:19] + ts[-5:], "%Y-%m-%dT%H:%M:%S%z")
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def count(values):
    out = {}
    for v in values:
        out[str(v)] = out.get(str(v), 0) + 1
    return out


def default_window():
    today = dt.datetime.now(dt.timezone.utc).date()
    return (today - dt.timedelta(days=7)).isoformat(), (today - dt.timedelta(days=1)).isoformat()


def main():
    d_from, d_to = default_window()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="d_from", default=d_from, help="first UTC day, inclusive")
    ap.add_argument("--to", dest="d_to", default=d_to, help="last UTC day, inclusive")
    ap.add_argument("--out", default=None, help="directory for raw payloads and sweep.json")
    ap.add_argument("--json", action="store_true", help="print sweep.json to stdout instead of the table")
    a = ap.parse_args()
    for d in (a.d_from, a.d_to):
        dt.date.fromisoformat(d)
    out = a.out or tempfile.mkdtemp(prefix="feedback-sweep-")
    os.makedirs(out, exist_ok=True)
    root = main_checkout()
    forge_env = load_env(os.path.join(root, ".env.forge.local"))
    window = {"from": a.d_from, "to": a.d_to, "timezone": "UTC"}

    results = []
    for fn, args in ((run_marketplace, (forge_env, window, out)), (run_d1, (root, window, out)),
                     (run_mixpanel, (root, window, out)), (run_jsm, (forge_env, window, out))):
        try:
            results.append(fn(*args))
        except Exception as e:  # one source must never stop the others
            results.append(result(fn.__name__.replace("run_", ""), window, read_status="failed",
                                  note=f"{type(e).__name__}: {e}"[:200]))
    results.append(result("gmail", window, note="connector only; search it in the session (see SKILL.md)"))

    doc = {"window": window, "queried_at": now_iso(), "out_dir": out, "sources": results}
    with open(os.path.join(out, "sweep.json"), "w") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)

    if a.json:
        print(json.dumps(doc, ensure_ascii=False, indent=2))
        return
    print(f"window {a.d_from}..{a.d_to} UTC   out {out}")
    print(f"{'source':<12}{'read_status':<13}{'status':<9}{'rows':>5}  note")
    for r in results:
        print(f"{r['source']:<12}{r['read_status']:<13}{str(r['status']):<9}{r['rows']:>5}  {r['note']}")
    mp = next(r for r in results if r["source"] == "mixpanel")
    if mp["summary"]:
        s = mp["summary"]
        print("mixpanel explicit:", s["explicit_feedback"])
        print("mixpanel process: ", s["process_events"])
        print("mixpanel behaviour:", s["behaviour_events"], f"(displayed on {s['csat_displayed_sites']} sites)")
    js = next(r for r in results if r["source"] == "jsm")
    for i in js["summary"].get("issues", []):
        print(f"jsm {i['key']} {i['status']} created {i['created']} updated {i['updated']}")
    print("details: sweep.json (explicit records, issue summaries) and raw payloads in out dir")


if __name__ == "__main__":
    main()
