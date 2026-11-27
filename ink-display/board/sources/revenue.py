"""Revenue section: Marketplace sales transactions (bulk export), all of the vendor's apps.

d30 / d90 = sum of vendorAmount (what the vendor receives, in USD, after Atlassian's share; refunds are negative)
over saleDate from today-(n-1) to today; ytd = the same sum from 1 January of today's year. today is the Australia/Sydney calendar day.
rows = the 10 newest transactions. name = the site key from the licence export's cloudId, else the customer's company.
Transactions on our own sites (site key matches sites.INTERNAL, e.g. whimet6, lite-stg) are dropped from rows and totals.
"""
from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

from . import marketplace, sites

SYDNEY = ZoneInfo("Australia/Sydney")
MAX_ROWS = 10


def _seats(tier) -> str:
    m = re.search(r"(\d+)\s+users?", str(tier or ""), re.I)
    if not m:
        return ""
    return f"{m.group(1)} user{'' if m.group(1) == '1' else 's'}"


def _money(value: float) -> str:
    return f"-${-value:,.2f}" if value < 0 else f"${value:,.2f}"


def _total(records: list[dict], today: dt.date, first: dt.date) -> str:
    first = str(first)
    value = sum(r["purchaseDetails"]["vendorAmount"] for r in records if first <= r["purchaseDetails"]["saleDate"] <= str(today))
    return f"-${-value:,.0f}" if value < 0 else f"${value:,.0f}"


def _row(record: dict, clouds: dict) -> dict:
    details = record["purchaseDetails"]
    day = dt.date.fromisoformat(details["saleDate"][:10])
    return {"product": marketplace.PRODUCT_BY_KEY.get(record.get("addonKey"), "MINISITE"),
            "name": clouds.get(record.get("cloudId")) or (record.get("customerDetails") or {}).get("company") or "",
            "amount": _money(details["vendorAmount"]), "date": f"{day.day} {day.strftime('%b')}",
            "type": details.get("saleType", ""), "seats": _seats(details.get("tier"))}


def build(records: list[dict], today: dt.date, clouds: dict) -> dict:
    records = [r for r in records if not sites._internal(clouds.get(r.get("cloudId")) or "")]
    newest = sorted(records, key=lambda r: (r["purchaseDetails"]["saleDate"], r.get("transactionId", "")), reverse=True)
    return {"d30": _total(records, today, today - dt.timedelta(days=29)),
            "d90": _total(records, today, today - dt.timedelta(days=89)),
            "ytd": _total(records, today, today.replace(month=1, day=1)),
            "rows": [_row(r, clouds) for r in newest[:MAX_ROWS]]}


def fetch(transactions=None, licenses=None, now: dt.datetime | None = None) -> dict:
    records = (transactions or marketplace.export_transactions)()
    today = (now or dt.datetime.now(SYDNEY)).astimezone(SYDNEY).date()
    return build(records, today, marketplace.cloud_hosts(marketplace.load_records(licenses)))
