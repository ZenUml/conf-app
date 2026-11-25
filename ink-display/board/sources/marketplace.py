"""Marketplace licence export, shared by the customers and sites sources.

Product letters (DESIGN.md): LITE `com.zenuml.confluence-addon-lite`, FULL `com.zenuml.confluence-addon`,
BOTH when a site has both, DIAGRAMLY `gptdock-confluence`, ASYNCAPI `my-api`.

Seats = the largest user tier on the site ("1918 Users" -> 1918). "Evaluation" and "Unlimited Users" carry no
number and are ignored. Only active licences count; a site with none active (an overdue renewal) falls back to
all its licences so the row keeps its product and seats.

The export is fetched through an injectable `fetch` callable (returns the list of licence dicts). The default
fetch loads `mp_report.py` from conf-app by absolute path: its own `find_env()` walks up from the current
directory, which breaks under launchd, so the env file is addressed absolutely. Results are cached for the run.
"""
import importlib.util
import os
import re
import time
from dataclasses import dataclass, field

CONF_APP = os.path.expanduser("~/workspaces/zenuml/conf-app")
MP_REPORT = os.path.join(CONF_APP, ".claude/skills/marketplace/scripts/mp_report.py")
ENV_FILE = os.path.join(CONF_APP, ".env.forge.local")

PRODUCT_BY_KEY = {
    "com.zenuml.confluence-addon-lite": "LITE",
    "com.zenuml.confluence-addon": "FULL",
    "gptdock-confluence": "DIAGRAMLY",
    "my-api": "ASYNCAPI",
}
_CACHE_SECONDS = 600
_cache = {"at": 0.0, "records": None}


def site_key(host):
    """`Acme.atlassian.net` -> `acme` (Mixpanel's client_domain form)."""
    host = (host or "").strip().lower()
    return host[: -len(".atlassian.net")] if host.endswith(".atlassian.net") else host


def fmt_seats(n):
    return f"{n:,}" if n else ""


def _export(kind):
    spec = importlib.util.spec_from_file_location("mp_report", MP_REPORT)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        email, token = mod.load_creds(ENV_FILE)
        records = mod.export(kind, mod._auth_header(email, token))
    except SystemExit as exc:  # mp_report reports failures with sys.exit(message)
        raise RuntimeError(f"Marketplace {kind} export failed: {str(exc)[:200]}") from None
    if not isinstance(records, list):
        raise RuntimeError(f"Marketplace {kind} export did not return a list")
    return records


def _default_fetch():
    return _export("licenses")


def export_transactions():
    return _export("sales/transactions")


def load_records(fetch=None):
    """The raw export. An injected `fetch` bypasses the cache; the default is cached for ten minutes."""
    if fetch is not None:
        return fetch()
    if _cache["records"] is None or time.monotonic() - _cache["at"] > _CACHE_SECONDS:
        _cache["records"], _cache["at"] = _default_fetch(), time.monotonic()
    return _cache["records"]


def cloud_hosts(records):
    """{cloudId: site_key} from the export, to name installs whose clientDomain is null."""
    return {r["cloudId"]: site_key(r["cloudSiteHostname"]) for r in records
            if r.get("cloudId") and r.get("cloudSiteHostname")}


@dataclass
class SiteLicenses:
    product: str = ""
    seats: int = 0
    place: str = ""  # "Americas / US" from the licence contact
    paid: bool = False  # an active COMMERCIAL licence on a ZenUML-family app
    licenses: list = field(default_factory=list)  # the considered records, for status calculation


def _tier_seats(tier):
    m = re.fullmatch(r"\s*(\d+)\s+users?\s*", str(tier or ""), re.I)
    return int(m.group(1)) if m else 0


def _known(value) -> str:
    text = str(value or "").strip()
    return "" if text.lower() in ("", "unknown") else text


# Atlassian licence country names → the two-letter shortcode drawn on the board.
# United Kingdom is UK, the shortcode already used on this board, not the ISO code GB.
COUNTRY_CODE = {
    "Argentina": "AR", "Armenia": "AM", "Australia": "AU", "Austria": "AT", "Azerbaijan": "AZ",
    "Bahrain": "BH", "Bangladesh": "BD", "Belgium": "BE", "Bolivia": "BO", "Brazil": "BR",
    "Brunei": "BN", "Bulgaria": "BG", "Canada": "CA", "Cayman Islands": "KY", "Chile": "CL",
    "China": "CN", "Colombia": "CO", "Costa Rica": "CR", "Cote d'Ivoire (Ivory Coast)": "CI",
    "Croatia (Hrvatska)": "HR", "Cyprus": "CY", "Czech Republic": "CZ", "Denmark": "DK",
    "Dominican Republic": "DO", "Ecuador": "EC", "Egypt": "EG", "Estonia": "EE", "Finland": "FI",
    "France": "FR", "Georgia": "GE", "Germany": "DE", "Greece": "GR", "Guatemala": "GT",
    "Hong Kong": "HK", "Hungary": "HU", "India": "IN", "Indonesia": "ID", "Ireland": "IE",
    "Israel": "IL", "Italy": "IT", "Japan": "JP", "Jordan": "JO", "Kazakhstan": "KZ", "Kenya": "KE",
    "Korea (North)": "KP", "Korea (South)": "KR", "Kyrgyzstan": "KG", "Latvia": "LV",
    "Lithuania": "LT", "Malaysia": "MY", "Malta": "MT", "Mexico": "MX", "Moldova": "MD",
    "Morocco": "MA", "Netherlands": "NL", "New Zealand": "NZ", "Norway": "NO", "Pakistan": "PK",
    "Palestinian Territories": "PS", "Peru": "PE", "Philippines": "PH", "Poland": "PL",
    "Portugal": "PT", "Reunion": "RE", "Romania": "RO", "Russian Federation": "RU",
    "Saudi Arabia": "SA", "Senegal": "SN", "Serbia": "RS", "Singapore": "SG",
    "Slovak Republic": "SK", "Slovenia": "SI", "South Africa": "ZA", "Spain": "ES", "Sweden": "SE",
    "Switzerland": "CH", "Taiwan": "TW", "Tajikistan": "TJ", "Thailand": "TH", "Tunisia": "TN",
    "Turkey": "TR", "Ukraine": "UA", "United Arab Emirates": "AE", "United Kingdom": "UK",
    "United States of America": "US", "Uruguay": "UY", "Uzbekistan": "UZ", "Vietnam": "VN",
}


def fmt_place(region, country) -> str:
    """Licence contact as `Americas / US`. An unmapped country keeps its full name."""
    region = _known(region)
    country = _known(country)
    label = COUNTRY_CODE.get(country, country)
    parts = [p for p in (region, label) if p]
    return " / ".join(parts)


def _place(rec) -> str:
    contact = rec.get("contactDetails") or {}
    return fmt_place(contact.get("region"), contact.get("country"))


def _product(keys):
    if {"com.zenuml.confluence-addon-lite", "com.zenuml.confluence-addon"} <= keys:
        return "BOTH"
    for key in ("com.zenuml.confluence-addon-lite", "com.zenuml.confluence-addon", "gptdock-confluence", "my-api"):
        if key in keys:
            return PRODUCT_BY_KEY[key]
    return ""


def index(records):
    """{site_key: SiteLicenses} from raw export records."""
    by_site = {}
    for rec in records:
        key = site_key(rec.get("cloudSiteHostname"))
        if key and rec.get("addonKey") in PRODUCT_BY_KEY:
            by_site.setdefault(key, []).append(rec)
    out = {}
    for key, recs in by_site.items():
        active = [r for r in recs if r.get("status") == "active"]
        considered = active or recs
        seated = max(considered, key=lambda r: _tier_seats(r.get("tier")))
        place = _place(seated) or next((p for p in (_place(r) for r in considered) if p), "")
        out[key] = SiteLicenses(
            product=_product({r["addonKey"] for r in considered}),
            seats=max((_tier_seats(r.get("tier")) for r in considered), default=0),
            place=place,
            paid=any(r.get("licenseType") == "COMMERCIAL" for r in active),
            licenses=considered,
        )
    return out


def license_index(fetch=None):
    return index(load_records(fetch))
