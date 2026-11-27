"""Data sources for the board. Each module has fetch() returning one section's JSON (see ../DESIGN.md)."""
from . import mixpanel, fullscreen, credits, gcp, revenue, tokens

FETCHERS = {"mixpanel": mixpanel.fetch, "fullscreen": fullscreen.fetch, "credits": credits.fetch, "tokens": tokens.fetch, "revenue": revenue.fetch, "gcp": gcp.fetch}

# Other agents add these later; absent until their modules exist.
try:
    from . import customers
    FETCHERS["customers"] = customers.fetch
except ImportError:
    pass
try:
    from . import sites
    FETCHERS["sites"] = sites.fetch
except ImportError:
    pass
