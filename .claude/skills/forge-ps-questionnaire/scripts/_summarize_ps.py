#!/usr/bin/env python3
"""Summarize a Marketplace P&S REST payload (stdin) and flag deviations from target.
Args: <appKey> <expected_sub_count>.  Used by verify-ps.sh; not meant to be called directly."""
import json, sys

key = sys.argv[1] if len(sys.argv) > 1 else "?"
exp_subs = int(sys.argv[2]) if len(sys.argv) > 2 else 0
d = json.load(sys.stdin)

das = d["dataAccessAndStorage"]; pr = d["privacy"]; sec = d["security"]
dr = d.get("dataRetention", {})
tp = (d.get("thirdPartyInformation") or {}).get("thirdPartyDetails") or []
sp = pr["ccpa"]["serviceProvider"]
bad = 0

def line(label, got, ok):
    global bad
    if not ok: bad += 1
    print(("  OK  " if ok else "  !!  ") + label.ljust(24) + str(got))

print("=== P&S: %s   formStatus=%s ===" % (key, d["properties"].get("formStatus")))
line("stores/process EUD",
     "%s/%s" % (das.get("appStoresEUDOutsideAtlassian"), das.get("appProcessEUDOutsideAtlassian")),
     das.get("appStoresEUDOutsideAtlassian") is True and das.get("appProcessEUDOutsideAtlassian") is True)
line("data residency", d["dataResidency"].get("isDataResidencySupported"),
     d["dataResidency"].get("isDataResidencySupported") == "APP_DOES_NOT_SUPPORT_DR")
line("retention max/custom",
     "%s / custom=%s" % (dr.get("retentionDurationInDays", {}).get("max"), dr.get("isCustomRetentionPeriodAllowed")),
     dr.get("retentionDurationInDays", {}).get("max") == 90 and dr.get("isCustomRetentionPeriodAllowed") is False)
line("sub-processors", "%d %s" % (len(tp), [e.get("name", "")[:16] for e in tp]),
     (len(tp) == exp_subs) if exp_subs else True)
line("gdpr controller", pr["gdpr"]["dataController"].get("isAppDataController"),
     str(pr["gdpr"]["dataController"].get("isAppDataController")).upper() == "FALSE")
line("gdpr processor", pr["gdpr"]["dataProcessor"].get("isAppDataProcessor"),
     str(pr["gdpr"]["dataProcessor"].get("isAppDataProcessor")).upper() == "TRUE")
line("ccpa business", pr["ccpa"]["business"].get("isAppBusiness"),
     pr["ccpa"]["business"].get("isAppBusiness") == "NOT_APPLICABLE")
line("ccpa serviceProvider", sp.get("isAppServiceProvider"),
     str(sp.get("isAppServiceProvider")).upper() == "TRUE")
line("  svcProvider EUD", sp.get("endUserDataTypes"), bool(sp.get("endUserDataTypes")))
line("disk encryption", sec.get("isDiskEncryptionSupported"), sec.get("isDiskEncryptionSupported") is True)
line("security policy URL", sec.get("publicSecurityPoliciesLink"), bool(sec.get("publicSecurityPoliciesLink")))
line("permJustif set", "Data not provided" not in json.dumps(sec.get("permissionsJustification", "")),
     "Data not provided" not in json.dumps(sec.get("permissionsJustification", "")))
dt = pr["gdpr"].get("dataTransfer", {})
line("EEA transfer/mech",
     "%s/%s" % (dt.get("isEndUserDataTransferredOutsideEEA"), dt.get("isTransferComplianceMechanismsAdhered")),
     dt.get("isEndUserDataTransferredOutsideEEA") is True and dt.get("isTransferComplianceMechanismsAdhered") is True)
print("  --> %d field(s) deviate from canonical target (%s)" %
      (bad, "clean" if bad == 0 else "confirm each !! is intentional"))
