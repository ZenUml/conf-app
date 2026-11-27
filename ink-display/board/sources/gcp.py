"""Google Cloud section: servers, spend and credit for staging-zenuml-27954.

Servers: `gcloud compute instances list`; name without the `diagramly-` prefix; status `up 3h` or
`off 11m` (`, spot` for SPOT); up first, then most recently stopped; max 5.
Spend: BigQuery billing export, cost before credits, all projects on the account, days in Australia/Sydney.
Credit: ~/.local/share/kindle-quota/gcp_cost.json (credit_left, credit_total), written by the Kindle job.
Raises on failure of gcloud or bq. A missing credit file shows "--".
"""
from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

PROJECT = "staging-zenuml-27954"
TABLE = f"{PROJECT}.billing_export.gcp_billing_export_v1_013CED_7C01D9_E7C0B6"
COST_FILE = Path.home() / ".local/share/kindle-quota/gcp_cost.json"
SYDNEY = ZoneInfo("Australia/Sydney")
UNKNOWN = "--"
MAX_SERVERS = 5
DAYS = 14

# On-demand USD per hour, us-central1, VM only (no disk). Read 2026-11-06 from the Cloud Billing Catalog
# API (Compute Engine SKUs): c4n-standard-48 = 48 vCPU x 0.05544 + 180 GB x 0.006301 = 3.795;
# c4d-highcpu-8 = 8 vCPU x 0.0327035 + 15 GB x 0.003495578 = 0.314.
RATES = {"c4n-standard-48": 3.80, "c4d-highcpu-8": 0.31}


def _tool(name: str) -> str:
    return shutil.which(name) or f"/opt/homebrew/bin/{name}"


def run_gcloud() -> str:
    return subprocess.run([_tool("gcloud"), "compute", "instances", "list", "--project", PROJECT,
                           "--format=json"], capture_output=True, text=True, timeout=60, check=True).stdout


def run_bq(sql: str) -> str:
    return subprocess.run([_tool("bq"), "query", f"--project_id={PROJECT}", "--use_legacy_sql=false",
                           "--format=json", sql], capture_output=True, text=True, timeout=120, check=True).stdout


def money(value) -> str:
    if value is None:
        return UNKNOWN
    return f"${value:,.0f}" if value >= 1 else f"${value:.2f}"


def money_total(value) -> str:
    if not value:
        return UNKNOWN
    return f"${value / 1000:g}K" if value >= 1000 else f"${value:,.0f}"


def duration(since: datetime, now: datetime) -> str:
    minutes = max(0, int((now - since).total_seconds() // 60))
    if minutes < 60:
        return f"{minutes}m"
    if minutes < 48 * 60:
        return f"{minutes // 60}h"
    return f"{minutes // 1440}d"


def servers(raw: str, now: datetime) -> list:
    rows = []
    for item in json.loads(raw):
        up = item.get("status") == "RUNNING"
        stamp = item.get("lastStartTimestamp" if up else "lastStopTimestamp")
        when = datetime.fromisoformat(stamp) if stamp else None
        word = "up" if up else "off"
        status = f"{word} {duration(when, now)}" if when else word
        if (item.get("scheduling") or {}).get("provisioningModel") == "SPOT":
            status += ", spot"
        machine = item["machineType"].rsplit("/", 1)[-1]
        rate = RATES.get(machine)
        rows.append((up, when, {
            "name": item["name"].removeprefix("diagramly-"),
            "machine": machine,
            "disk": f"{sum(int(d.get('diskSizeGb', 0)) for d in item.get('disks', []))} GB",
            "status": status,
            "rate": f"{rate:.2f}" if rate else UNKNOWN,
            "up": up,
        }))
    epoch = datetime.fromtimestamp(0, SYDNEY)
    rows.sort(key=lambda r: (not r[0], -(r[1] or epoch).timestamp()))
    return [r[2] for r in rows[:MAX_SERVERS]]


def spend_sql(today) -> str:
    first = today - timedelta(days=DAYS - 1)
    return (f"SELECT FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time, 'Australia/Sydney')) AS day, "
            f"invoice.month AS invoice_month, SUM(cost) AS cost FROM `{TABLE}` "
            f"WHERE DATE(usage_start_time, 'Australia/Sydney') >= DATE '{first.replace(day=1).isoformat()}' "
            f"GROUP BY day, invoice_month")


def read_credit(path: Path) -> tuple:
    try:
        data = json.loads(path.read_text())
        return data.get("credit_left"), data.get("credit_total")
    except (OSError, ValueError, TypeError):
        return None, None


def fetch(gcloud=run_gcloud, bq=run_bq, cost_file: Path = COST_FILE, now: datetime | None = None) -> dict:
    now = (now or datetime.now(SYDNEY)).astimezone(SYDNEY)
    today = now.date()
    by_day, by_invoice = {}, {}
    for row in json.loads(bq(spend_sql(today))):
        cost = float(row["cost"] or 0)
        by_day[row["day"]] = by_day.get(row["day"], 0.0) + cost
        by_invoice[row["invoice_month"]] = by_invoice.get(row["invoice_month"], 0.0) + cost
    days = [today - timedelta(days=DAYS - 1 - i) for i in range(DAYS)]
    credit_left, credit_total = read_credit(cost_file)
    return {
        "today": money(by_day.get(today.isoformat(), 0.0)),
        "yesterday": money(by_day.get((today - timedelta(days=1)).isoformat(), 0.0)),
        "month_label": now.strftime("%b").upper(),
        "month": money(by_invoice.get(now.strftime("%Y%m"), 0.0)),
        "credit": money(credit_left),
        "credit_total": money_total(credit_total),
        "daily": [{"day": f"{d.day}", "cost": round(by_day.get(d.isoformat(), 0.0), 2)} for d in days],
        "servers": servers(gcloud(), now),
    }
