#!/usr/bin/env python3
"""Chronological timeline of every recorded fact for ONE Confluence tenant.

Sources the script reaches itself: Marketplace snapshot, Mixpanel (JQL), prod D1 (wrangler).
Anything else (support tickets, mailbox, tracker, session replay) comes in through --extra.
Every source ends up in a coverage table; a failed or skipped source is named, never empty.

    python3 timeline.py <subdomain | cloudId | E-xxx-xxx-xxx-xxx | license-details URL> \
        [--from 2026-11-01] [--to 2026-11-17] [--tz America/New_York] [--extra rows.json ...] \
        [--out DIR] [--print md|json|none] [--skip marketplace,mixpanel,d1]

Customer data stays out of the repo: --out must be outside the checkout (or under private/).
Pure functions (merge, coverage, gap flags, parsers) are unit-tested in test_timeline.py.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
SKILL_DIR = Path(__file__).resolve().parent.parent
SKILLS_DIR = SKILL_DIR.parent
MP_QUERY = SKILLS_DIR / "mixpanel" / "scripts" / "mp_query.py"
SNAPSHOT_REL = Path(".claude/skills/marketplace/scripts/marketplace.db")
SAMPLING_REL = Path("src/utils/analytics/eventSampling.ts")
BUDGET_REL = Path("src/lib/octoberBudgetWindow.js")
CATALOG_REL = Path("src/utils/analytics/catalog.ts")

MIXPANEL_TRACKING_START = date(2026, 4, 18)  # nothing earlier exists (mixpanel skill)
MP_CHUNK_DAYS = 14
D1_NAME = "conf-zenuml-prod"
D1_ROW_CAP = 2000
SILENT_MINUTES = 15
DEFAULT_LOOKBACK_DAYS = 90
MELBOURNE = "Australia/Melbourne"

SOURCES = ("marketplace", "mixpanel", "d1")

# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------


def parse_ts(value):
    """Normalise the timestamp formats seen in the sources to an aware UTC datetime.

    Handles ISO with Z or offset, 'YYYY-MM-DD HH:MM:SS' (UTC), date-only (00:00 UTC),
    epoch milliseconds and epoch seconds (ints, floats or digit strings). None on failure.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r"-?\d+(\.\d+)?", value.strip())):
        num = float(value)
        if num > 1e11:  # milliseconds
            num /= 1000.0
        try:
            return datetime.fromtimestamp(num, UTC)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=UTC)
    text = text.replace(" ", "T", 1) if re.match(r"\d{4}-\d{2}-\d{2} \d", text) else text
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def iso_z(ts):
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"


def parse_bound(text, end=False):
    """--from/--to: a date means the start (or end) of that UTC day; otherwise any parse_ts input."""
    if text is None:
        return None
    ts = parse_ts(text)
    if ts is None:
        raise ValueError(f"cannot parse time {text!r}")
    if end and re.fullmatch(r"\d{4}-\d{2}-\d{2}", text.strip()):
        ts = ts + timedelta(days=1) - timedelta(milliseconds=1)
    return ts


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------


def mk(ts, source, event, props=None, certainty="fact"):
    """One timeline row. Internal form keeps a datetime in `ts`."""
    if certainty not in ("fact", "derived"):
        raise ValueError("certainty must be fact or derived")
    clean = {k: v for k, v in (props or {}).items() if v is not None and v != ""}
    return {"ts": ts, "source": source, "event": event, "certainty": certainty, "props": clean}


def short_id(value, n=8):
    if value is None or value == "":
        return None
    text = str(value)
    return text if len(text) <= n else "…" + text[-n:]


def row_key(row):
    return (iso_z(row["ts"]), row["source"], row["event"], json.dumps(row["props"], sort_keys=True, default=str))


def merge_rows(lists, start=None, end=None):
    """Flatten, drop rows outside [start, end], drop exact duplicates, sort chronologically."""
    seen, out = set(), []
    for rows in lists:
        for row in rows:
            if start is not None and row["ts"] < start:
                continue
            if end is not None and row["ts"] > end:
                continue
            key = row_key(row)
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
    out.sort(key=lambda r: (r["ts"], r["source"], r["event"]))
    return out


def rows_by_source(rows):
    """Row counts inside the window, per source. Coverage `n` counts rows fetched before window clipping."""
    counts = {}
    for r in rows:
        counts[r["source"]] = counts.get(r["source"], 0) + 1
    return dict(sorted(counts.items()))


def public_row(row, tzs=()):
    out = {"ts_utc": iso_z(row["ts"]), "source": row["source"], "event": row["event"],
           "certainty": row["certainty"], "props": row["props"]}
    for label, zone in tzs:
        out[f"ts_{label}"] = row["ts"].astimezone(zone).strftime("%Y-%m-%d %H:%M:%S %Z")
    return out


def load_extra(path):
    """Rows gathered by other tools. Returns (rows, dropped). Accepts a list or {"rows": [...]}.

    Each row needs a time (ts_utc | ts | time | timestamp) and an event; `source` defaults to
    extra:<file stem>; `certainty` defaults to fact; unknown keys fold into props.
    """
    data = json.loads(Path(path).read_text())
    items = data.get("rows") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ValueError("expected a JSON list or an object with a 'rows' list")
    stem = Path(path).stem
    rows, dropped = [], 0
    for item in items:
        if not isinstance(item, dict):
            dropped += 1
            continue
        raw_ts = next((item[k] for k in ("ts_utc", "ts", "time", "timestamp") if item.get(k) not in (None, "")), None)
        ts = parse_ts(raw_ts)
        event = item.get("event") or item.get("name")
        if ts is None or not event:
            dropped += 1
            continue
        known = {"ts_utc", "ts", "time", "timestamp", "event", "name", "source", "certainty", "props"}
        props = dict(item.get("props") or {})
        props.update({k: v for k, v in item.items() if k not in known})
        certainty = item.get("certainty") if item.get("certainty") in ("fact", "derived") else "fact"
        rows.append(mk(ts, str(item.get("source") or f"extra:{stem}"), str(event), props, certainty))
    return rows, dropped


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------

STATUSES = ("found", "empty", "not_queried", "unavailable", "missing")


def coverage(source, status, n=0, detail=""):
    if status not in STATUSES:
        raise ValueError(status)
    return {"source": source, "status": status, "n": n, "detail": detail}


def classify_result(source, n=None, error=None, skipped=None, missing=None, note=""):
    """One result -> one coverage row. Precedence: skipped, missing, error, rows.

    An error is never reported as empty, and a table that is gone is `missing`, not empty.
    """
    if skipped:
        return coverage(source, "not_queried", 0, skipped)
    if missing:
        return coverage(source, "missing", 0, missing)
    if error:
        return coverage(source, "unavailable", 0, error)
    if n:
        return coverage(source, "found", n, note)
    return coverage(source, "empty", 0, note)


def coverage_label(c):
    detail = f" - {c['detail']}" if c["detail"] else ""
    return {
        "found": f"rows found ({c['n']})" + detail,
        "empty": "queried, empty" + detail,
        "not_queried": f"not queried ({c['detail']})",
        "unavailable": f"unavailable ({c['detail']})",
        "missing": f"missing ({c['detail']})",
    }[c["status"]]


def queried_ok(cov_list, source_prefix):
    """True when every coverage row for the source ran (found or empty)."""
    rel = [c for c in cov_list if c["source"] == source_prefix or c["source"].startswith(source_prefix + ":")]
    return bool(rel) and all(c["status"] in ("found", "empty") for c in rel)


# ---------------------------------------------------------------------------
# Identity and the Marketplace snapshot
# ---------------------------------------------------------------------------

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
ENTITLEMENT_RE = re.compile(r"E-[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}", re.I)  # shape seen on every snapshot license
SUBDOMAIN_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def parse_identifier(text):
    """-> (kind, value). kind: entitlement | cloud_id | subdomain. Strict: nothing else is accepted.

    Everything that reaches SQL or a JQL script passes through here, because wrangler's
    --command takes no bound parameters.
    """
    raw = (text or "").strip()
    if not raw:
        raise ValueError("empty identifier")
    m = ENTITLEMENT_RE.search(raw)
    if m and (raw.lower().startswith("http") or m.group(0).lower() == raw.lower()):
        return "entitlement", m.group(0).upper()
    if UUID_RE.match(raw):
        return "cloud_id", raw.lower()
    host = raw.lower()
    if host.startswith("http"):
        m = re.match(r"^https?://([^/]+)", host)
        host = m.group(1) if m else host
    if host.endswith(".atlassian.net"):
        host = host[: -len(".atlassian.net")]
    if SUBDOMAIN_RE.match(host):
        return "subdomain", host
    raise ValueError(f"unrecognised identifier {text!r}: expected a subdomain, cloudId, hostname or E-xxx entitlement")


def check_safe(values):
    for v in values:
        if not SAFE_ID_RE.match(str(v)):
            raise ValueError(f"refusing unsafe identifier value {v!r}")
    return list(values)


def new_identity():
    return {"subdomains": [], "cloud_ids": [], "entitlements": [], "hostnames": [], "origin": []}


def _add(lst, value):
    if value and value not in lst:
        lst.append(value)


def identity_from_licenses(licenses, ident=None):
    """Fold license raw dicts into an identity. `ident` seeds it with the caller's own input."""
    ident = ident or new_identity()
    for lic in licenses:
        _add(ident["cloud_ids"], (lic.get("cloudId") or "").lower() or None)
        host = (lic.get("cloudSiteHostname") or "").lower()
        if host:
            _add(ident["hostnames"], host)
            _add(ident["subdomains"], host[: -len(".atlassian.net")] if host.endswith(".atlassian.net") else host)
        for key in ("appEntitlementNumber", "hostEntitlementNumber"):
            _add(ident["entitlements"], (lic.get(key) or "").upper() or None)
    return ident


def snapshot_lookup(conn, kind, value):
    """License raw dicts matching the identifier. conn is a sqlite3 connection to marketplace.db."""
    if kind == "cloud_id":
        sql, args = "SELECT raw FROM licenses WHERE lower(cloudId)=?", (value,)
    elif kind == "subdomain":
        sql, args = "SELECT raw FROM licenses WHERE lower(json_extract(raw,'$.cloudSiteHostname'))=?", (value + ".atlassian.net",)
    else:
        sql = ("SELECT raw FROM licenses WHERE upper(json_extract(raw,'$.appEntitlementNumber'))=? "
               "OR upper(json_extract(raw,'$.hostEntitlementNumber'))=? "
               "OR lower(json_extract(raw,'$.appEntitlementId'))=lower(?) "
               "OR lower(json_extract(raw,'$.licenseId'))=lower(?)")
        args = (value, value, value, value)
    found = [json.loads(r[0]) for r in conn.execute(sql, args)]
    if kind == "cloud_id" and not found:  # a bare UUID can also be an entitlement id
        found = [json.loads(r[0]) for r in conn.execute(
            "SELECT raw FROM licenses WHERE lower(json_extract(raw,'$.appEntitlementId'))=? "
            "OR lower(json_extract(raw,'$.hostEntitlementId'))=?", (value, value))]
    return found


def snapshot_transactions(conn, cloud_ids):
    out = []
    for cid in cloud_ids:
        out += [json.loads(r[0]) for r in conn.execute("SELECT raw FROM transactions WHERE lower(cloudId)=?", (cid,))]
    return out


def marketplace_rows(licenses, transactions):
    """Timeline rows from licenses and transactions. Contacts and partner details are left out."""
    rows = []
    for lic in licenses:
        base = {"addon": lic.get("addonKey"), "license_type": lic.get("licenseType"), "status": lic.get("status"),
                "tier": lic.get("tier"), "entitlement": lic.get("appEntitlementNumber")}
        start = lic.get("maintenanceStartDate")
        pairs = [("license_start", start), ("license_latest_maintenance_start", lic.get("latestMaintenanceStartDate")),
                 ("license_latest_evaluation_start", lic.get("latestEvaluationStartDate")),
                 ("license_maintenance_end", lic.get("maintenanceEndDate")), ("license_record_updated", lic.get("lastUpdated"))]
        for event, raw_ts in pairs:
            ts = parse_ts(raw_ts)
            if ts is None:
                continue
            if event == "license_latest_maintenance_start" and raw_ts == start:
                continue
            rows.append(mk(ts, "marketplace:license", event, dict(base, in_grace_period=lic.get("inGracePeriod"))))
    for tx in transactions:
        pd = tx.get("purchaseDetails") or {}
        ts = parse_ts(pd.get("saleDate"))
        if ts is None:
            continue
        rows.append(mk(ts, "marketplace:transaction", "transaction_" + str(pd.get("saleType") or "unknown").lower(), {
            "addon": tx.get("addonKey"), "payment_status": tx.get("paymentStatus"), "tier": pd.get("tier"),
            "license_type": pd.get("licenseType"), "billing_period": pd.get("billingPeriod"),
            "purchase_price": pd.get("purchasePrice"), "vendor_amount": pd.get("vendorAmount"),
            "maintenance_start": pd.get("maintenanceStartDate"), "maintenance_end": pd.get("maintenanceEndDate")}))
    return rows


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def data_roots(extra=()):
    """Checkouts that may hold gitignored data (marketplace.db, wrangler, .env.mixpanel).

    A linked worktree has none of them; the primary checkout does. Order: explicit, this
    checkout, the primary checkout from git's common dir, then the conventional path.
    """
    roots = [Path(p).expanduser() for p in extra]
    roots.append(SKILLS_DIR.parent.parent)
    try:
        out = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                             cwd=SKILL_DIR, capture_output=True, text=True, timeout=10)
        if out.returncode == 0 and out.stdout.strip():
            roots.append(Path(out.stdout.strip()).parent)
    except (OSError, subprocess.SubprocessError):
        pass
    env = os.environ.get("CONF_APP_ROOT")
    if env:
        roots.insert(0, Path(env).expanduser())
    roots.append(Path("~/workspaces/zenuml/conf-app").expanduser())
    seen, uniq = set(), []
    for r in roots:
        key = str(r)
        if key not in seen:
            seen.add(key)
            uniq.append(r)
    return uniq


def find_file(rel, roots):
    for root in roots:
        p = root / rel
        if p.exists():
            return p
    return None


def out_dir_allowed(out, roots):
    """False when `out` sits inside a repo checkout, except under that checkout's private/."""
    target = Path(out).expanduser().resolve()
    for root in roots:
        try:
            base = root.resolve()
        except OSError:
            continue
        if target == base or base in target.parents:
            return base / "private" in (target, *target.parents)
    return True


# ---------------------------------------------------------------------------
# D1
# ---------------------------------------------------------------------------


class D1Error(Exception):
    pass


def parse_wrangler_json(text):
    """The JSON array in wrangler's stdout, which may carry banner or warning lines first."""
    decoder = json.JSONDecoder()
    for m in re.finditer(r"(?m)^\[", text):
        try:
            value, _ = decoder.raw_decode(text[m.start():])
        except ValueError:
            continue
        if isinstance(value, list):
            return value
    return None


class D1Client:
    """prod D1 through wrangler: the access path new_customers.py already uses.

    `wrangler d1 execute conf-zenuml-prod --env production --remote --json --command <sql>`,
    run from a checkout that has wrangler.toml and node_modules. One call per statement:
    multi-statement batches silently drop empty result sets, so a table could not be told
    from an empty one.
    """

    def __init__(self, roots):
        self.cwd = None
        self.argv = None
        for root in roots:
            if not (root / "wrangler.toml").exists():
                continue
            local = root / "node_modules" / ".bin" / "wrangler"
            if local.exists():
                self.cwd, self.argv = root, [str(local)]
                break
            if self.cwd is None:
                self.cwd, self.argv = root, ["npx", "wrangler"]

    def ready(self):
        return self.cwd is not None

    def query(self, sql):
        if not self.ready():
            raise D1Error("no checkout with wrangler.toml found (set CONF_APP_ROOT)")
        cmd = self.argv + ["d1", "execute", D1_NAME, "--env", "production", "--remote", "--json", "--command", sql]
        try:
            out = subprocess.run(cmd, cwd=self.cwd, capture_output=True, text=True, timeout=180)
        except (OSError, subprocess.SubprocessError) as exc:
            raise D1Error(f"wrangler did not run: {type(exc).__name__}")
        if out.returncode != 0:
            msg = (out.stderr or out.stdout).strip().splitlines()
            raise D1Error("wrangler failed: " + " ".join(msg[-3:])[:240])
        payload = parse_wrangler_json(out.stdout)
        if payload is None:
            raise D1Error("wrangler returned no JSON")
        first = payload[0] if payload else {}
        if not first.get("success", False):
            raise D1Error("D1 reported failure")
        return first.get("results") or []


def sql_in(values):
    return ", ".join("'" + v.replace("'", "''") + "'" for v in check_safe(values))


# Columns never selected: secrets and customer content bodies.
BLOCKED_COLUMNS = {"sharedsecret", "publickey", "body", "screenshotdata", "diagramsource", "mermaid", "artifact",
                   "claimtoken", "rawlabel", "title_hash"}


def _blocked(col):
    low = col.lower()
    return low in BLOCKED_COLUMNS or low.endswith("ciphertext") or "email" in low


# Per-table specs. keys: tenant columns by kind (cloud = cloudIds, domain = hostnames).
# times: (column, event name); event_col + prefix builds the event from a column instead.
# bound: column used to bound the SQL window (default: first time column); epoch columns
# are INTEGER ms/s. small: table is small enough that an unindexed scan is allowed.
TABLE_SPECS = [
    {"table": "AnalyticsEventFact", "keys": [("clientDomain", "domain"), ("cloudId", "cloud")], "times": [("eventTime", None)],
     "event_col": "event", "bound": "eventDate", "props": {"action": "action", "category": "eventCategory", "diagram_type": "diagramType",
     "space": "confluenceSpace", "content_id": "contentId", "app_version": "appVersion", "event_source": "eventSource",
     "license_state": "licenseState", "user": "userAccountId"}},
    {"table": "ForgeInstallation", "keys": [("cloudId", "cloud"), ("clientDomain", "domain")], "times": [("createdAt", None)],
     "event_col": "eventType", "prefix": "forge_installation_", "small": True,
     "props": {"app_id": "appId", "environment_id": "environmentId", "installer": "installerAccountId"}},
    {"table": "ClientInstallation", "keys": [("clientDomain", "domain")], "times": [("timestamp", None)],
     "event_col": "eventType", "prefix": "connect_installation_", "small": True,
     "props": {"addon_key": "key", "product_type": "productType"}},
    {"table": "CustomContent", "keys": [("cloudId", "cloud")], "times": [("createdAt", "custom_content_created")], "windowed": False,
     "props": {"content_id": "contentId", "title": "title", "diagram_type": "diagramType", "latest_version": "latestVersionNumber",
               "page_id": "pageId", "space_id": "spaceId", "status": "status", "type": "type"}},
    {"table": "FeedbackReport", "keys": [("cloudId", "cloud"), ("clientDomain", "domain")], "times": [("createdAt", "feedback_report")],
     "props": {"surface": "surface", "host_module": "hostModule", "diagram_type": "diagramType", "content_id": "contentId",
               "custom_content_id": "customContentId", "description": "description", "user": "accountId"}},
    {"table": "DiagramAudience", "keys": [("cloudId", "cloud")], "times": [("firstViewedAt", "diagram_first_viewed"), ("lastViewedAt", "diagram_last_viewed")],
     "props": {"custom_content_id": "customContentId", "view_days": "viewDays", "user": "accountId"}},
    {"table": "DiagramLikes", "keys": [("clientDomain", "domain")], "times": [("createdAt", "diagram_liked")], "small": True,
     "props": {"content_id": "diagramCustomContentId", "diagram_type": "diagramType", "space": "confluenceSpace", "user": "userAccountId"}},
    {"table": "UserBehaviorEvent", "keys": [("cloudId", "cloud"), ("clientDomain", "domain")], "times": [("createdAt", None)],
     "event_col": "action", "prefix": "behavior_",
     "props": {"space": "spaceKey", "content_id": "contentId", "payload": "payload", "user": "userAccountId"}},
    {"table": "DailyBehaviorCounter", "keys": [("cloudId", "cloud"), ("clientDomain", "domain")], "times": [("date", None)],
     "event_col": "action", "prefix": "daily_counter_", "granularity": "day",
     "props": {"space": "spaceKey", "event_count": "eventCount", "unique_users": "uniqueUsers", "unique_pages": "uniquePages"}},
    {"table": "SiteUsageSnapshot", "keys": [("cloudId", "cloud"), ("clientDomain", "domain")], "times": [("collectedAt", "site_usage_snapshot")],
     "props": {"year_month": "yearMonth", "total_macros": "totalMacros", "over_limit_spaces": "overLimitSpaceCount",
               "pricing_headcount": "pricingHeadcount", "completeness": "dataCompleteness", "final": "isFinal"}},
    {"table": "MagicWriteback", "keys": [("cloudId", "cloud")], "times": [("createdAt", "magic_writeback_stored")],
     "props": {"content_id": "contentId", "expires_at": "expiresAt"}},
    {"table": "ArchitectureTokenOccurrence", "keys": [("cloudId", "cloud")], "times": [("indexedAt", "architecture_token_indexed")],
     "props": {"content_id": "contentId", "decl_kind": "declKind", "run_id": "runId", "version": "contentVersion"}},
    {"table": "title_draft", "keys": [("cloud_id", "cloud")], "times": [("requested_at", "title_draft_requested"), ("generated_at", "title_draft_generated")],
     "props": {"status": "status", "kind": "kind", "confidence": "confidence", "page_id": "page_id"}},
    {"table": "TargetedSurveyClaim", "keys": [("cloudId", "cloud")], "times": [("createdAt", "targeted_survey_claimed")],
     "props": {"survey": "surveyUuid", "user": "accountId"}},
    {"table": "TargetedSurveyLease", "keys": [("cloudId", "cloud")], "times": [("expiresAtMs", "targeted_survey_lease_expiry")],
     "props": {"survey": "surveyUuid", "terminal": "terminal", "user": "accountId"}},
    {"table": "TargetedSurveyResponse", "keys": [("cloudId", "cloud")], "times": [("createdAt", "targeted_survey_responded")],
     "props": {"survey": "surveyUuid", "options": "optionIds", "response_text": "responseText", "user": "accountId"}},
    {"table": "FullscreenRecoveryRequest", "keys": [("cloudId", "cloud")], "small": True,
     "times": [("createdAt", "fullscreen_recovery_requested"), ("activatedAt", "fullscreen_recovery_activated"),
               ("expiresAt", "fullscreen_recovery_expires"), ("supportOutcomeAt", "fullscreen_recovery_support_outcome")],
     "props": {"feature": "feature", "space": "spaceKey", "content_id": "contentId", "support_outcome": "supportOutcome", "user": "accountId"}},
    {"table": "PreparedDiagram", "keys": [("cloudId", "cloud")], "times": [("createdAt", "prepared_diagram_created"), ("curatedAt", "prepared_diagram_curated")],
     "props": {"page_id": "pageId", "diagram_type": "diagramType", "title": "title"}},
    {"table": "ExtensionAction", "keys": [("cloudId", "cloud"), ("clientDomain", "domain")], "times": [("createdAt", None)], "small": True,
     "event_col": "action", "prefix": "extension_action_",
     "props": {"status": "status", "space": "spaceKey", "macro_count": "macroCount", "expires_at": "expiresAt", "ticket": "ticketKey"}},
    {"table": "lifecycle_contact", "keys": [("cloud_id", "cloud")], "small": True,
     "times": [("first_seen_at", "lifecycle_contact_first_seen"), ("eval_started_at", "lifecycle_eval_started"),
               ("eval_ends_at", "lifecycle_eval_ends"), ("last_seen_at", "lifecycle_contact_last_seen")],
     "props": {"app": "app", "seat_tier": "seat_tier", "license_type": "license_type", "step": "step", "suppressed": "suppressed"}},
    {"table": "lifecycle_touchpoint", "keys": [], "via": ("lifecycle_contact", "contact_email", "cloud_id", "cloud"), "small": True,
     "times": [("created_at", None)], "event_col": "kind", "prefix": "lifecycle_touchpoint_",
     "props": {"app": "app", "step": "step", "meta": "meta"}},
]
TEXT_CAP = 280


def discovery_sql(tables):
    names = sql_in(tables)
    return ("SELECT 'c' AS k, m.name AS t, p.name AS c, p.type AS ty FROM sqlite_master m, pragma_table_info(m.name) p "
            f"WHERE m.type='table' AND m.name IN ({names}) UNION ALL "
            "SELECT 'i', m.name, ii.name, '' FROM sqlite_master m, pragma_index_list(m.name) il, pragma_index_info(il.name) ii "
            f"WHERE m.type='table' AND m.name IN ({names}) AND ii.seqno=0")


def parse_discovery(rows):
    """-> {table: {"cols": {name: declared_type}, "lead": set(leading index columns)}}"""
    schema = {}
    for r in rows:
        entry = schema.setdefault(r["t"], {"cols": {}, "lead": set()})
        if r["k"] == "c":
            entry["cols"][r["c"]] = (r.get("ty") or "").upper()
        else:
            entry["lead"].add(r["c"])
    return schema


def choose_strategy(spec, schema_entry, ids, allow_scan=False):
    """Pick how to query one table. -> (strategy, key_col, kind, reason).

    strategy: 'key' (indexed tenant column), 'time_scan' (bounded by an indexed time column),
    'scan' (unindexed; only for small tables or --allow-scan), 'via' (join through another
    table), or None with a reason it cannot be queried.
    """
    cols, lead = schema_entry["cols"], schema_entry["lead"]
    if spec.get("via"):
        return "via", None, None, ""
    cands = []
    for col, kind in spec["keys"]:
        if col in cols and ids.get(kind):
            cands.append((col, kind))
    if not cands:
        have = [c for c, _ in spec["keys"] if c in cols]
        if not have:
            return None, None, None, "no tenant column in this table"
        return None, None, None, "no identifier of the kind this table keys on (" + "/".join(k for c, k in spec["keys"] if c in cols) + ")"
    for col, kind in cands:
        if col in lead:
            return "key", col, kind, ""
    bound = spec.get("bound") or spec["times"][0][0]
    if spec.get("windowed", True) and bound in lead:
        return "time_scan", cands[0][0], cands[0][1], ""
    if spec.get("small") or allow_scan:
        return "scan", cands[0][0], cands[0][1], ""
    return None, None, None, "no usable index on the tenant column or time column; pass --allow-scan to scan"


def _time_predicate(col, declared, window):
    """SQL window predicate for one time column; text compares on date prefixes, INTEGER on epoch."""
    start, end = window
    parts = []
    if declared == "INTEGER":
        expr = f"(CASE WHEN {col} > 100000000000 THEN {col} ELSE {col} * 1000 END)"
        if start:
            parts.append(f"{expr} >= {int(start.timestamp() * 1000)}")
        if end:
            parts.append(f"{expr} <= {int(end.timestamp() * 1000)}")
    else:
        if start:
            parts.append(f"{col} >= '{start.strftime('%Y-%m-%d')}'")
        if end:
            parts.append(f"{col} < '{(end + timedelta(days=1)).strftime('%Y-%m-%d')}'")
    return " AND ".join(parts)


def build_query(spec, schema_entry, strategy, key_col, kind, ids, window, cap=D1_ROW_CAP):
    cols = schema_entry["cols"]
    wanted = {c for c, _ in spec["times"]}
    wanted |= {c for c in spec["props"].values()}
    if spec.get("event_col"):
        wanted.add(spec["event_col"])
    select = [c for c in cols if c in wanted and not _blocked(c)]
    time_cols = [c for c, _ in spec["times"] if c in cols]
    if not time_cols:
        raise D1Error("no time column present")
    where = []
    if strategy == "via":
        via_table, link, via_key, via_kind = spec["via"]
        if not ids.get(via_kind):
            raise D1Error("no identifier for the linking table")
        where.append(f"{link} IN (SELECT {link} FROM {via_table} WHERE {via_key} IN ({sql_in(ids[via_kind])}))")
    else:
        where.append(f"{key_col} IN ({sql_in(ids[kind])})")
    if spec.get("windowed", True) and any(window):
        bound = spec.get("bound") or time_cols[0]
        if bound in cols:
            pred = _time_predicate(bound, cols[bound], window)
            if pred:
                where.append(pred)
    order = spec.get("bound") or time_cols[0]
    return (f"SELECT {', '.join(select)} FROM {spec['table']} WHERE {' AND '.join(where)} "
            f"ORDER BY {order if order in cols else time_cols[0]} DESC LIMIT {int(cap)}")


def rows_from_d1(spec, schema_entry, records):
    """Turn raw D1 records into timeline rows. Long free text is cut at TEXT_CAP characters."""
    out = []
    for rec in records:
        props = {}
        for name, col in spec["props"].items():
            if col not in rec or rec[col] in (None, ""):
                continue
            val = rec[col]
            if name == "user":
                val = short_id(val)
            elif isinstance(val, str) and len(val) > TEXT_CAP:
                val = val[:TEXT_CAP] + "…"
            props[name] = val
        if spec.get("granularity"):
            props["granularity"] = spec["granularity"]
        seen_ts = set()
        for col, fixed in spec["times"]:
            if col not in rec:
                continue
            ts = parse_ts(rec[col])
            if ts is None:
                continue
            if fixed:
                event = fixed
            elif spec.get("event_col"):
                event = f"{spec.get('prefix', '')}{rec.get(spec['event_col'], '')}"
            else:
                event = spec["table"]
            if (event, ts) in seen_ts:
                continue
            seen_ts.add((event, ts))
            out.append(mk(ts, f"d1:{spec['table']}", event, props))
    return out


def collect_d1(client, ids, window, specs=None, allow_scan=False, workers=4, cap=D1_ROW_CAP):
    """Query every table once. -> (rows, coverage_list, content_ids or None).

    `ids` = {"cloud": [cloudIds], "domain": [hostnames and bare subdomains]}. Each table is one
    statement; discovery failure marks every table unavailable, a table missing from the schema
    is `missing`, and an exception in one table never hides the others.
    """
    specs = specs or TABLE_SPECS
    names = [s["table"] for s in specs] + ["lifecycle_contact"]
    names = list(dict.fromkeys(names))
    try:
        schema = parse_discovery(client.query(discovery_sql(names)))
    except D1Error as exc:
        return [], [classify_result(f"d1:{s['table']}", error=str(exc)) for s in specs], None

    def run(spec):
        src = f"d1:{spec['table']}"
        entry = schema.get(spec["table"])
        if not entry or not entry["cols"]:
            return [], classify_result(src, missing="table not in prod schema"), None
        strategy, key_col, kind, reason = choose_strategy(spec, entry, ids, allow_scan)
        if strategy is None:
            return [], classify_result(src, skipped=reason), None
        if strategy == "via" and spec["via"][0] not in schema:
            return [], classify_result(src, missing=f"linking table {spec['via'][0]} not in prod schema"), None
        if strategy == "via" and not ids.get(spec["via"][3]):
            return [], classify_result(src, skipped="no cloudId resolved for the linking table"), None
        try:
            sql = build_query(spec, entry, strategy, key_col, kind, ids, window, cap)
            records = client.query(sql)
        except (D1Error, ValueError) as exc:
            return [], classify_result(src, error=str(exc)), None
        rows = rows_from_d1(spec, entry, records)
        note = {"key": f"via {key_col}", "time_scan": f"bounded scan on {spec.get('bound') or spec['times'][0][0]}, filtered by {key_col}",
                "scan": f"unindexed scan on {key_col}", "via": "via linked table"}[strategy]
        if len(records) >= cap:
            note += f"; TRUNCATED at {cap} newest rows"
        content = [str(r["contentId"]) for r in records if r.get("contentId") is not None] if spec["table"] == "CustomContent" else None
        return rows, classify_result(src, n=len(rows), note=note), content

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(run, specs))
    rows, covs, content_ids = [], [], None
    for spec, (r, c, content) in zip(specs, results):
        rows += r
        covs.append(c)
        if content is not None:
            content_ids = content
    return rows, covs, content_ids


# ---------------------------------------------------------------------------
# Mixpanel
# ---------------------------------------------------------------------------

MP_PROPS = ["macro_type", "event_category", "product_type", "surface", "confluence_space", "custom_content_id", "page_id",
            "app_version", "sample_rate", "session_replay_source", "session_replay_start_call_outcome", "creation_origin",
            "creation_flow_id", "journey_id", "authoring_outcome", "entry_point", "feature_area", "error_message", "reason",
            "failure_reason", "result", "source", "template_id", "operation_mode", "unplaced_count"]


def jql_script(subdomains, start, end):
    """JQL for every event of the tenant in [start, end] (UTC dates). Property subset only."""
    subs = check_safe(subdomains)
    props = json.dumps(MP_PROPS)
    wanted = json.dumps(subs)
    return (
        "var DOMAINS = " + wanted + ";\nvar KEEP = " + props + ";\n"
        "function main() {\n"
        f"  return Events({{from_date: '{start:%Y-%m-%d}', to_date: '{end:%Y-%m-%d}'}})\n"
        "    .filter(function (e) { return DOMAINS.indexOf(e.properties.client_domain) >= 0; })\n"
        "    .map(function (e) { var p = e.properties, o = {};\n"
        "      for (var i = 0; i < KEEP.length; i++) { if (p[KEEP[i]] !== undefined && p[KEEP[i]] !== null) o[KEEP[i]] = p[KEEP[i]]; }\n"
        "      for (var k in p) { if (/(_ms|_duration)$/.test(k) && p[k] !== undefined) o[k] = p[k]; }\n"
        "      return {n: e.name, t: e.time, d: e.distinct_id, u: p.user_account_id || null, p: o}; });\n"
        "}\n")


def split_range(start, end, days=MP_CHUNK_DAYS):
    """Inclusive date chunks of at most `days` days."""
    out, cur = [], start
    while cur <= end:
        stop = min(cur + timedelta(days=days - 1), end)
        out.append((cur, stop))
        cur = stop + timedelta(days=1)
    return out


def rows_from_mixpanel(records):
    rows = []
    for rec in records:
        ts = parse_ts(rec.get("t"))
        if ts is None or not rec.get("n"):
            continue
        props = dict(rec.get("p") or {})
        user = rec.get("u") or rec.get("d")
        if user and not str(user).startswith("$device") and user != "unknown_user_account_id":
            props["user"] = short_id(user)
        rows.append(mk(ts, "mixpanel", rec["n"], props))
    return rows


def run_mp_chunk(script, roots, pace=3):
    """Run one JQL script through mp_query.py --file. Returns parsed JSON or raises MPError."""
    if not MP_QUERY.exists():
        raise MPError("mp_query.py not found")
    with tempfile.TemporaryDirectory() as tmp:
        js, outp = Path(tmp, "q.js"), Path(tmp, "out.json")
        js.write_text(script)
        cwd = next((r for r in roots if (r / ".env.mixpanel").exists()), roots[0] if roots else None)
        out = subprocess.run([sys.executable, str(MP_QUERY), "--file", str(js), "--output", str(outp), "--pace", str(pace)],
                             cwd=cwd, capture_output=True, text=True, timeout=600)
        if out.returncode != 0:
            tail = (out.stderr or out.stdout).strip().splitlines()
            msg = tail[-1] if tail else "mp_query failed"
            raise MPError(msg[:200])
        try:
            return json.loads(outp.read_text())
        except (OSError, ValueError):
            raise MPError("mp_query wrote no JSON")


class MPError(Exception):
    pass


def collect_mixpanel(subdomains, window, runner, today=None):
    """-> (rows, coverage). `runner(script)` returns a list of records or raises MPError.

    Clamps to the tracking start. Chunk failures are counted: all failed -> unavailable;
    some failed -> found with an INCOMPLETE note. A clamped or empty window is `not queried`.
    """
    if not subdomains:
        return [], classify_result("mixpanel", skipped="no site subdomain resolved for client_domain")
    today = today or datetime.now(UTC).date()
    start = max((window[0] or datetime.combine(MIXPANEL_TRACKING_START, datetime.min.time(), UTC)).date(), MIXPANEL_TRACKING_START)
    end = min((window[1] or datetime.now(UTC)).date(), today)
    if start > end:
        return [], classify_result("mixpanel", skipped=f"window ends before Mixpanel tracking began ({MIXPANEL_TRACKING_START})")
    rows, failures, errors = [], 0, []
    chunks = split_range(start, end)
    for lo, hi in chunks:
        try:
            rows += rows_from_mixpanel(runner(jql_script(subdomains, lo, hi)))
        except MPError as exc:
            failures += 1
            errors.append(str(exc))
    note = f"{start}..{end} in {len(chunks)} chunk(s)"
    if failures == len(chunks):
        return [], classify_result("mixpanel", error=errors[0])
    if failures:
        note += f"; INCOMPLETE: {failures} of {len(chunks)} chunks failed ({errors[0]})"
    return rows, classify_result("mixpanel", n=len(rows), note=note)


# ---------------------------------------------------------------------------
# Sampling model (parsed from eventSampling.ts at call time)
# ---------------------------------------------------------------------------


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(?m)//.*$", "", src)


def _balanced(src, open_idx, open_ch, close_ch):
    depth = 0
    for i in range(open_idx, len(src)):
        if src[i] == open_ch:
            depth += 1
        elif src[i] == close_ch:
            depth -= 1
            if depth == 0:
                return src[open_idx + 1:i]
    return ""


def parse_rate_map(src, name):
    m = re.search(rf"const {name}\b[^=]*=\s*\{{", src)
    if not m:
        return {}
    body = _balanced(src, m.end() - 1, "{", "}")
    return {k: float(v) for k, v in re.findall(r"""["']?([A-Za-z_]\w*)["']?\s*:\s*([0-9]*\.?[0-9]+)""", body)}


def parse_set(src, name):
    m = re.search(rf"const {name}\b[^=]*=\s*new Set<string>\(\s*\[", src)
    if not m:
        return set()
    return set(re.findall(r"""["']([^"']+)["']""", _balanced(src, m.end() - 1, "[", "]")))


def parse_prefix_rules(src, name="PREFIX_RULES"):
    m = re.search(rf"const {name}\b[^=]*=\s*\[", src)
    if not m:
        return []
    body = _balanced(src, m.end() - 1, "[", "]")
    return [(p, float(r)) for p, r in re.findall(r"""\[\s*["']([^"']+)["']\s*,\s*([0-9]*\.?[0-9]+)\s*\]""", body)]


def parse_sample_constants(src):
    return {k: float(v) for k, v in re.findall(r"export const (\w+_SAMPLE_RATE)\s*=\s*([0-9]*\.?[0-9]+)", src)}


def parse_budget_start(window_src):
    m = re.search(r"OCTOBER_START_UTC\s*=\s*Date\.UTC\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", window_src or "")
    if not m:
        return None
    return datetime(int(m.group(1)), int(m.group(2)) + 1, int(m.group(3)), tzinfo=UTC)  # JS months are 0-based


# Event -> the per-occurrence constant that thins it (sampled per occurrence, not per name).
PER_OCCURRENCE = {"macro_viewed": "MACRO_VIEWED_REPEAT_SAMPLE_RATE", "title_draft_requested": "TITLE_DRAFT_LOOKUP_MISS_SAMPLE_RATE"}


def parse_sampling(sampling_src, window_src=None):
    src = strip_comments(sampling_src)
    return {
        "rates": parse_rate_map(src, "EVENT_SAMPLE_RATES"), "prefix": parse_prefix_rules(src),
        "stop": parse_set(src, "OCTOBER_STOP_EVENTS"), "retained": parse_set(src, "OCTOBER_RETAINED_EVENTS"),
        "reduced": parse_set(src, "OCTOBER_REDUCED_EVENTS"), "constants": parse_sample_constants(src),
        "budget_start": parse_budget_start(strip_comments(window_src or "")),
    }


def keep_rate(model, name, now=None):
    """Mirror of sampleRateFor in eventSampling.ts. Per-name keep probability right now."""
    now = now or datetime.now(UTC)
    if name in model["rates"]:
        rate = model["rates"][name]
    else:
        rate = next((r for p, r in model["prefix"] if name.startswith(p)), 1.0)
    start = model.get("budget_start")
    active = (now >= start) if start else bool(model["stop"] or model["reduced"])
    if not active:
        return rate
    if name in model["stop"]:
        return 0.0
    if name in model["retained"]:
        return rate
    if name in model["reduced"] or name.startswith("create_attachment"):
        return rate / 10
    return rate


# ---------------------------------------------------------------------------
# Gap flags
# ---------------------------------------------------------------------------

START_EVENTS = ("macro_create_started", "macro_edit_started")
SAVE_EVENTS = ("macro_create_succeeded", "macro_save_succeeded")
TERMINAL_EVENTS = SAVE_EVENTS + ("macro_create_cancelled", "macro_edit_cancelled", "macro_authoring_ended")
AUTHORING_EVENTS = START_EVENTS + TERMINAL_EVENTS
CREATE_EVENT_RE = re.compile(r"(^create_.*_end$|create.*_succeeded$|_created$)")
JOIN_KEYS = ("journey_id", "creation_flow_id")
REPLAY_OFF = {"off", "skipped_sampled"}


def mixpanel_rows(rows):
    return [r for r in rows if r["source"] == "mixpanel"]


def flag_sampled_events(rows, model, now=None, watch=AUTHORING_EVENTS):
    """Events seen (or on the authoring watch list) whose current keep-rate is below 1."""
    now = now or datetime.now(UTC)
    seen = {r["event"] for r in mixpanel_rows(rows)}
    items = []
    for name in sorted(seen | set(watch)):
        rate = keep_rate(model, name, now)
        if rate < 1:
            items.append({"event": name, "keep_rate": rate, "seen": name in seen})
    for name, const in PER_OCCURRENCE.items():
        rate = model["constants"].get(const)
        if rate is not None and rate < 1 and name in seen:
            items.append({"event": name, "keep_rate": rate, "seen": True, "note": f"sampled per occurrence ({const})"})
    stamped = sorted({r["event"] for r in mixpanel_rows(rows) if isinstance(r["props"].get("sample_rate"), (int, float)) and r["props"]["sample_rate"] < 1})
    return {"flag": "sampled_events", "items": items, "stamped_sample_rate_events": stamped,
            "note": "absence of these events is not evidence that the user did not act"}


def _join_values(row):
    return {(k, row["props"][k]) for k in JOIN_KEYS if row["props"].get(k)}


def pair_authoring(rows):
    """Pair each authoring start with its first terminal event.

    Join order: a shared journey_id or creation_flow_id; else the same user's first terminal
    event after the start and before that user's next start. -> list of {start, end|None, via}
    """
    mp = sorted(mixpanel_rows(rows), key=lambda r: r["ts"])
    starts = [r for r in mp if r["event"] in START_EVENTS]
    terms = [r for r in mp if r["event"] in TERMINAL_EVENTS]
    used, pairs = set(), []
    for s in starts:
        match, via = None, None
        keys = _join_values(s)
        if keys:
            for t in terms:
                if id(t) not in used and t["ts"] >= s["ts"] and keys & _join_values(t):
                    match, via = t, "join_key"
                    break
        if match is None and s["props"].get("user"):
            later = [x["ts"] for x in starts if x is not s and x["props"].get("user") == s["props"]["user"] and x["ts"] > s["ts"]]
            limit = min(later) if later else None
            for t in terms:
                if id(t) in used or t["ts"] < s["ts"] or t["props"].get("user") != s["props"]["user"]:
                    continue
                if limit is not None and t["ts"] >= limit:
                    break
                match, via = t, "user_order"
                break
        if match is not None:
            used.add(id(match))
        pairs.append({"start": s, "end": match, "via": via})
    return pairs


def flag_unterminated(pairs, now=None, recent_minutes=30):
    now = now or datetime.now(UTC)
    items = []
    for p in pairs:
        if p["end"] is None:
            s = p["start"]
            items.append({"event": s["event"], "ts_utc": iso_z(s["ts"]), "user": s["props"].get("user"),
                          "macro_type": s["props"].get("macro_type"),
                          "possibly_still_open": (now - s["ts"]) < timedelta(minutes=recent_minutes)})
    return {"flag": "start_without_terminal", "items": items,
            "note": "authoring events are not sampled; a gap means the tab closed before the terminal event was sent or a hook is missing"}


def flag_silent_stretch(rows, pairs, minutes=SILENT_MINUTES):
    """Largest silence between an authoring start and its save, from the same user's events."""
    mp = sorted(mixpanel_rows(rows), key=lambda r: r["ts"])
    items = []
    for p in pairs:
        s, e = p["start"], p["end"]
        if e is None or e["event"] not in SAVE_EVENTS:
            continue
        user = s["props"].get("user")
        inside = [r["ts"] for r in mp if s["ts"] <= r["ts"] <= e["ts"] and (user is None or r["props"].get("user") in (user, None))]
        points = sorted(set(inside) | {s["ts"], e["ts"]})
        gap, at = timedelta(0), None
        for a, b in zip(points, points[1:]):
            if b - a > gap:
                gap, at = b - a, a
        if gap > timedelta(minutes=minutes):
            items.append({"start_ts_utc": iso_z(s["ts"]), "save_ts_utc": iso_z(e["ts"]), "user": user,
                          "longest_silence_minutes": round(gap.total_seconds() / 60, 1), "silence_began_utc": iso_z(at)})
    return {"flag": "silent_stretch", "threshold_minutes": minutes, "items": items,
            "note": "only events from the same user count as activity; idle thinking time looks identical to a stuck editor"}


def flag_replay_missing(rows, limit=25):
    items, unknown, total = [], 0, 0
    for r in mixpanel_rows(rows):
        if r["event"] not in AUTHORING_EVENTS:
            continue
        total += 1
        src, outcome = r["props"].get("session_replay_source"), r["props"].get("session_replay_start_call_outcome")
        if src is None and outcome is None:
            unknown += 1
        elif src in REPLAY_OFF or outcome in REPLAY_OFF:
            items.append({"event": r["event"], "ts_utc": iso_z(r["ts"]), "user": r["props"].get("user"),
                          "session_replay_source": src, "start_call_outcome": outcome})
    return {"flag": "authoring_without_replay", "count": len(items), "authoring_events": total,
            "property_absent": unknown, "items": items[:limit], "truncated": len(items) > limit,
            "note": "no replay to inspect for these events; absent property means an older build, not 'off'"}


def flag_unplaced_writes(rows):
    mp = sorted(mixpanel_rows(rows), key=lambda r: r["ts"])
    adds = [r for r in mp if r["event"] == "diagram_added_to_page"]
    items = []
    for u in (r for r in mp if r["event"] == "unplaced_property_write"):
        cid, user = u["props"].get("custom_content_id"), u["props"].get("user")
        hit = None
        for a in adds:
            if a["ts"] < u["ts"]:
                continue
            if cid and a["props"].get("custom_content_id"):
                ok = cid == a["props"]["custom_content_id"]
            elif user and a["props"].get("user"):
                ok = user == a["props"]["user"]
            else:
                ok = False
            if ok:
                hit = a
                break
        items.append({"ts_utc": iso_z(u["ts"]), "user": user, "placed": hit is not None,
                      "delay_seconds": round((hit["ts"] - u["ts"]).total_seconds(), 1) if hit else None})
    return {"flag": "unplaced_property_write", "items": items, "unplaced": sum(1 for i in items if not i["placed"]),
            "note": "matched on custom_content_id, else same user; 'not placed' may also mean the placement event was filtered or the user left"}


def flag_d1_vs_mixpanel(rows, d1_content_ids, window, d1_truncated=False):
    """Content created in D1 with no Mixpanel create event in the window, and the reverse.

    When the D1 read hit the row cap, only the newest rows are known: the reverse direction
    (Mixpanel create with no D1 row) cannot be judged and is reported as null.
    """
    mp_create = [r for r in mixpanel_rows(rows) if CREATE_EVENT_RE.search(r["event"]) and r["props"].get("custom_content_id")]
    mp_ids = {str(r["props"]["custom_content_id"]) for r in mp_create}
    d1_rows = [r for r in rows if r["source"] == "d1:CustomContent" and r["event"] == "custom_content_created"]
    in_window = [r for r in d1_rows if (window[0] is None or r["ts"] >= window[0]) and (window[1] is None or r["ts"] <= window[1])]
    d1_only = sorted({str(r["props"].get("content_id")) for r in in_window} - mp_ids - {"None"})
    d1_all = {str(c) for c in (d1_content_ids or [])}
    mp_only = None if d1_truncated else sorted(mp_ids - d1_all)
    return {"flag": "d1_vs_mixpanel_content", "certainty": "derived", "d1_content_without_mixpanel_create": d1_only,
            "mixpanel_create_without_d1_content": mp_only, "d1_truncated": d1_truncated,
            "d1_rows_in_window": len(in_window), "mixpanel_create_events": len(mp_create),
            "note": "D1 is a mirror and Mixpanel loses events (ad blockers, closed tabs): each side is a lower bound, so a difference is a lead, not a verdict"}


def config_drift(catalog_src):
    """Lifecycle names this script relies on that are no longer in catalog.ts."""
    if not catalog_src:
        return None
    gone = [n for n in AUTHORING_EVENTS + ("unplaced_property_write", "diagram_added_to_page") if f'"{n}"' not in catalog_src]
    return {"flag": "config_drift", "missing_from_catalog": gone,
            "note": "the gap flags below use these names; update START/TERMINAL events in timeline.py"} if gone else None


def compute_gaps(rows, cov, model, d1_content_ids, window, catalog_src=None, now=None):
    gaps = []
    drift = config_drift(catalog_src)
    if drift:
        gaps.append(drift)
    mp_ok = queried_ok(cov, "mixpanel")
    if model is None:
        gaps.append({"flag": "sampled_events", "not_computed": "eventSampling.ts not found"})
    elif mp_ok:
        gaps.append(flag_sampled_events(rows, model, now))
    else:
        gaps.append({"flag": "sampled_events", "not_computed": "Mixpanel not queried; sampling cannot be judged against missing events"})
    if not mp_ok:
        for name in ("start_without_terminal", "silent_stretch", "authoring_without_replay", "unplaced_property_write"):
            gaps.append({"flag": name, "not_computed": "Mixpanel rows unavailable"})
    else:
        pairs = pair_authoring(rows)
        gaps += [flag_unterminated(pairs, now), flag_silent_stretch(rows, pairs), flag_replay_missing(rows), flag_unplaced_writes(rows)]
    if mp_ok and d1_content_ids is not None and queried_ok(cov, "d1:CustomContent"):
        truncated = any(c["source"] == "d1:CustomContent" and "TRUNCATED" in c["detail"] for c in cov)
        gaps.append(flag_d1_vs_mixpanel(rows, d1_content_ids, window, truncated))
    else:
        gaps.append({"flag": "d1_vs_mixpanel_content", "not_computed": "needs both Mixpanel and D1 CustomContent to have been queried"})
    return gaps


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def _cell(text, cap=200):
    s = str(text).replace("|", "\\|").replace("\n", " ")
    return s if len(s) <= cap else s[:cap] + "…"


def render_markdown(meta, rows, covs, gaps, tzs):
    lines = [f"# Customer timeline: {meta['label']}", ""]
    lines.append(f"Window (UTC): {meta['from']} to {meta['to']}  |  rows: {len(rows)}  |  generated: {meta['generated']}")
    ident = meta["identity"]
    lines.append(f"Resolved: subdomain(s) {', '.join(ident['subdomains']) or 'none'}; {len(ident['cloud_ids'])} cloudId(s); "
                 f"{len(ident['entitlements'])} entitlement(s)")
    if meta.get("rows_by_source"):
        lines.append("In the window, rows per source: " + ", ".join(f"{k} {v}" for k, v in meta["rows_by_source"].items())
                     + " (coverage counts rows fetched, before the window clips them)")
    for note in meta.get("notes", []):
        lines.append(f"Note: {note}")
    lines += ["", "## Source coverage", "", "| Source | Result |", "|---|---|"]
    lines += [f"| {c['source']} | {_cell(coverage_label(c), 300)} |" for c in covs]
    lines += ["", "## Gap flags", ""]
    for g in gaps:
        if "not_computed" in g:
            lines.append(f"- **{g['flag']}**: not computed ({g['not_computed']})")
            continue
        count = len(g["items"]) if "items" in g else (len(g.get("d1_content_without_mixpanel_create") or []) + len(g.get("mixpanel_create_without_d1_content") or []))
        lines.append(f"- **{g['flag']}**: {count} item(s). {g.get('note', '')}")
        for item in (g.get("items") or [])[:12]:
            lines.append("  - " + _cell(" ".join(f"{k}={v}" for k, v in item.items() if v is not None), 260))
        if g["flag"] == "d1_vs_mixpanel_content":
            rev = g["mixpanel_create_without_d1_content"]
            lines.append(f"  - D1 without Mixpanel create: {len(g['d1_content_without_mixpanel_create'])}; "
                         f"Mixpanel create without D1: {'not judged (D1 read truncated)' if rev is None else len(rev)}")
            for key in ("d1_content_without_mixpanel_create", "mixpanel_create_without_d1_content"):
                if g[key]:
                    lines.append(f"  - {key}: {', '.join(g[key][:20])}")
        if g["flag"] == "config_drift":
            lines.append("  - missing: " + ", ".join(g["missing_from_catalog"]))
    head = ["UTC"] + [f"{label}" for label, _ in tzs] + ["Source", "Event", "Certainty", "Props"]
    lines += ["", "## Timeline", "", "| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in rows:
        p = public_row(r, tzs)
        cells = [p["ts_utc"]] + [p[f"ts_{label}"] for label, _ in tzs]
        props = " ".join(f"{k}={v}" for k, v in r["props"].items())
        cells += [p["source"], p["event"], p["certainty"], props]
        lines.append("| " + " | ".join(_cell(c) for c in cells) + " |")
    return "\n".join(lines) + "\n"


def to_json(meta, rows, covs, gaps, tzs):
    return json.dumps({"meta": meta, "coverage": [dict(c, label=coverage_label(c)) for c in covs],
                       "gaps": gaps, "rows": [public_row(r, tzs) for r in rows]}, indent=2, default=str)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def read_text(path):
    try:
        return Path(path).read_text() if path else None
    except OSError:
        return None


def build_parser():
    ap = argparse.ArgumentParser(description="Chronological timeline of every recorded fact for one tenant.")
    ap.add_argument("identifier", help="subdomain, hostname, cloudId, E-xxx entitlement id, or a license-details URL")
    ap.add_argument("--from", dest="start", help="UTC date or datetime (default: first evidence)")
    ap.add_argument("--to", dest="end", help="UTC date (end of day) or datetime (default: now)")
    ap.add_argument("--tz", help="IANA zone for the customer's local time column, e.g. America/New_York")
    ap.add_argument("--extra", action="append", default=[], help="JSON rows gathered by other tools (repeatable)")
    ap.add_argument("--out", help="output directory (default: a temp dir outside the repo)")
    ap.add_argument("--print", dest="print_mode", choices=("md", "json", "none"), default="md")
    ap.add_argument("--skip", default="", help="comma list of marketplace,mixpanel,d1 to leave out")
    ap.add_argument("--allow-scan", action="store_true", help="allow unindexed scans on large D1 tables")
    ap.add_argument("--root", action="append", default=[], help="extra checkout to search for marketplace.db / wrangler.toml")
    ap.add_argument("--sampling-file", help="path to eventSampling.ts (default: this checkout)")
    ap.add_argument("--plan", action="store_true", help="resolve identity and show what would be queried; run no D1 or Mixpanel query")
    return ap


def main(argv=None):
    import sqlite3
    args = build_parser().parse_args(argv)
    try:
        kind, value = parse_identifier(args.identifier)
        window_in = (parse_bound(args.start), parse_bound(args.end, end=True))
        zones = [(f"local ({args.tz})", ZoneInfo(args.tz))] if args.tz else []
    except (ValueError, ZoneInfoNotFoundError) as exc:
        sys.exit(f"error: {exc}")
    zones.append(("Melbourne", ZoneInfo(MELBOURNE)))
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    roots = data_roots(args.root)
    covs, lists, notes = [], [], []

    # 1. identity + marketplace
    ident = new_identity()
    if kind == "subdomain":
        _add(ident["subdomains"], value)
    elif kind == "cloud_id":
        _add(ident["cloud_ids"], value)
    else:
        _add(ident["entitlements"], value)
    licenses, txs, mrows = [], [], []
    if "marketplace" in skip:
        covs.append(classify_result("marketplace", skipped="skipped by --skip"))
    else:
        snap = find_file(SNAPSHOT_REL, roots)
        if snap is None:
            covs.append(classify_result("marketplace", error=f"no marketplace.db in any checkout; run mp_report.py sync ({SNAPSHOT_REL})"))
        else:
            try:
                conn = sqlite3.connect(f"file:{snap}?mode=ro", uri=True)
                licenses = snapshot_lookup(conn, kind, value)
                ident = identity_from_licenses(licenses, ident)
                txs = snapshot_transactions(conn, ident["cloud_ids"])
                synced = (conn.execute("SELECT synced_at FROM sync_meta").fetchone() or ["unknown"])[0]
                mrows = marketplace_rows(licenses, txs)
                covs.append(classify_result("marketplace", n=len(mrows),
                                            note=f"{len(licenses)} license(s), {len(txs)} transaction(s); snapshot synced {synced}"))
                conn.close()
            except (sqlite3.Error, ValueError, OSError) as exc:
                covs.append(classify_result("marketplace", error=f"{type(exc).__name__}: {str(exc)[:160]}"))
    lists.append(mrows)

    d1 = D1Client(roots)
    d1_skip = "d1" in skip or args.plan
    # 2. window: first evidence (Marketplace dates) to now unless the caller bounds it
    first = min((r["ts"] for r in mrows), default=None)
    now = datetime.now(UTC)
    start = window_in[0] or first or (now - timedelta(days=DEFAULT_LOOKBACK_DAYS))
    end = window_in[1] or now
    if not window_in[0] and first is None:
        notes.append(f"no license or transaction evidence found; defaulted to the last {DEFAULT_LOOKBACK_DAYS} days")
    # 3. identity fallback through D1 (a site with no license, e.g. an internal one)
    if (not ident["cloud_ids"] or not ident["subdomains"]) and not d1_skip and d1.ready():
        try:
            conds = []
            if ident["cloud_ids"]:
                conds.append(f"cloudId IN ({sql_in(ident['cloud_ids'])})")
            if ident["subdomains"]:
                conds.append(f"clientDomain IN ({sql_in(ident['subdomains'] + [s + '.atlassian.net' for s in ident['subdomains']])})")
            if conds:
                for r in d1.query("SELECT DISTINCT cloudId, clientDomain FROM ForgeInstallation WHERE " + " OR ".join(conds)):
                    _add(ident["cloud_ids"], (r.get("cloudId") or "").lower() or None)
                    dom = (r.get("clientDomain") or "").lower()
                    _add(ident["subdomains"], dom[: -len(".atlassian.net")] if dom.endswith(".atlassian.net") else dom or None)
                    ident["origin"].append("d1:ForgeInstallation")
        except (D1Error, ValueError) as exc:
            notes.append(f"identity fallback through D1 failed: {exc}")
    # a site with no license and no install row: take its cloudId from recent analytics facts (clientDomain is indexed)
    if not ident["cloud_ids"] and ident["subdomains"] and not d1_skip and d1.ready():
        try:
            lo = max(start, now - timedelta(days=DEFAULT_LOOKBACK_DAYS))
            doms = sql_in(ident["subdomains"] + [s + ".atlassian.net" for s in ident["subdomains"]])
            for r in d1.query(f"SELECT DISTINCT cloudId FROM AnalyticsEventFact WHERE clientDomain IN ({doms}) "
                              f"AND eventDate >= '{lo:%Y-%m-%d}' AND cloudId IS NOT NULL LIMIT 5"):
                _add(ident["cloud_ids"], (r.get("cloudId") or "").lower() or None)
                ident["origin"].append("d1:AnalyticsEventFact")
        except (D1Error, ValueError) as exc:
            notes.append(f"cloudId lookup through AnalyticsEventFact failed: {exc}")
    if not ident["subdomains"] and not ident["cloud_ids"]:
        sys.exit("error: identifier matched nothing in the Marketplace snapshot or D1; pass a subdomain you know exists")
    ident["hostnames"] = sorted({s + ".atlassian.net" for s in ident["subdomains"]} | set(ident["hostnames"]))
    window = (start, end)

    ids = {"cloud": check_safe(ident["cloud_ids"]), "domain": check_safe(sorted(set(ident["subdomains"]) | set(ident["hostnames"])))}
    if args.plan:
        print(json.dumps({"identity": ident, "window": [iso_z(start), iso_z(end)], "d1_ready": d1.ready(), "tables": [s["table"] for s in TABLE_SPECS]}, indent=2))
        return 0

    # 4. D1
    d1_content = None
    if d1_skip:
        covs += [classify_result(f"d1:{s['table']}", skipped="skipped by --skip") for s in TABLE_SPECS]
    elif not d1.ready():
        covs += [classify_result(f"d1:{s['table']}", error="no checkout with wrangler.toml found (set CONF_APP_ROOT)") for s in TABLE_SPECS]
    else:
        rows, c, d1_content = collect_d1(d1, ids, window, allow_scan=args.allow_scan)
        lists.append(rows)
        covs += c

    # 5. Mixpanel
    if "mixpanel" in skip:
        covs.append(classify_result("mixpanel", skipped="skipped by --skip"))
    else:
        rows, c = collect_mixpanel(sorted(ident["subdomains"]), window, lambda script: run_mp_chunk(script, roots))
        lists.append(rows)
        covs.append(c)

    # 6. caller-supplied rows
    for path in args.extra:
        src = f"extra:{Path(path).stem}"
        try:
            rows, dropped = load_extra(path)
            lists.append(rows)
            covs.append(classify_result(src, n=len(rows), note=f"{dropped} row(s) dropped (no usable time or event)" if dropped else ""))
        except (OSError, ValueError) as exc:
            covs.append(classify_result(src, error=f"{type(exc).__name__}: {str(exc)[:160]}"))

    rows = merge_rows(lists, start, end)

    # 7. gaps
    sampling_path = Path(args.sampling_file) if args.sampling_file else find_file(SAMPLING_REL, roots)
    sampling_src = read_text(sampling_path)
    model = parse_sampling(sampling_src, read_text(find_file(BUDGET_REL, roots))) if sampling_src else None
    gaps = compute_gaps(rows, covs, model, d1_content, window, read_text(find_file(CATALOG_REL, roots)), now)

    label = (ident["subdomains"] or ["tenant"])[0]
    meta = {"label": label, "generated": iso_z(now), "from": iso_z(start), "to": iso_z(end), "identity": ident,
            "notes": notes, "sampling_source": str(sampling_path) if sampling_path else None,
            "rows_by_source": rows_by_source(rows)}
    out_dir = Path(args.out).expanduser() if args.out else Path(tempfile.gettempdir()) / "customer-timeline"
    if not out_dir_allowed(out_dir, roots):
        sys.exit(f"error: --out {out_dir} is inside the repo; customer data must stay outside it (or under private/)")
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{label}-{now:%Y%m%dT%H%M%S}"
    (out_dir / f"{stem}.json").write_text(to_json(meta, rows, covs, gaps, zones))
    md = render_markdown(meta, rows, covs, gaps, zones)
    (out_dir / f"{stem}.md").write_text(md)
    print(f"wrote {out_dir / (stem + '.md')} and .json", file=sys.stderr)
    for c in covs:
        print(f"  {c['source']}: {coverage_label(c)}", file=sys.stderr)
    if args.print_mode == "md":
        print(md)
    elif args.print_mode == "json":
        print(to_json(meta, rows, covs, gaps, zones))
    return 0


if __name__ == "__main__":
    sys.exit(main())
