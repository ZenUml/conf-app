import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from sources import gcp

NOW = datetime.fromisoformat("2026-11-06T21:40:00+11:00")


def instance(name, status, machine, start, stop, model="STANDARD", disks=(100,)):
    return {"name": name, "status": status, "machineType": f"https://x/zones/us-central1-a/machineTypes/{machine}",
            "lastStartTimestamp": start, "lastStopTimestamp": stop, "scheduling": {"provisioningModel": model},
            "disks": [{"diskSizeGb": str(d)} for d in disks]}


INSTANCES = [
    instance("diagramly-e2e-dev", "TERMINATED", "c4d-highcpu-8", "2026-11-05T17:54:27-08:00", "2026-11-05T18:43:37-08:00"),
    instance("diagramly-ci-c4n48-central", "TERMINATED", "c4n-standard-48", "2026-11-06T00:11:00-08:00",
             "2026-11-06T02:29:00-08:00", "SPOT", (300, 200)),
    instance("diagramly-up-box", "RUNNING", "c4d-highcpu-8", "2026-11-05T14:00:00-08:00", None),
    instance("other", "TERMINATED", "n2-standard-2", None, None),
]


def bq_rows(**days):
    return json.dumps([{"day": d, "invoice_month": d[:4] + d[5:7], "cost": str(c)} for d, c in days.items()])


class GcpTest(unittest.TestCase):
    def cost_file(self, content):
        path = Path(tempfile.mkdtemp()) / "gcp_cost.json"
        if content is not None:
            path.write_text(json.dumps(content))
        return path

    def fetch(self, rows=None, credit=None):
        rows = rows or json.dumps([])
        credit = {"credit_left": 1768.06, "credit_total": 2000} if credit is None else credit
        return gcp.fetch(gcloud=lambda: json.dumps(INSTANCES), bq=lambda sql: rows,
                         cost_file=self.cost_file(credit), now=NOW)

    def test_servers_up_first_then_latest_stop(self):
        servers = self.fetch()["servers"]
        self.assertEqual([s["name"] for s in servers], ["up-box", "ci-c4n48-central", "e2e-dev", "other"])
        self.assertEqual(servers[0], {"name": "up-box", "machine": "c4d-highcpu-8", "disk": "100 GB",
                                      "status": "up 12h", "rate": "0.31", "up": True})
        self.assertEqual(servers[1]["status"], "off 11m, spot")
        self.assertEqual(servers[1]["disk"], "500 GB")
        self.assertEqual(servers[1]["rate"], "3.80")
        self.assertEqual(servers[3]["rate"], "--")
        self.assertEqual(servers[3]["status"], "off")

    def test_servers_capped_at_five(self):
        many = [instance(f"diagramly-s{i}", "TERMINATED", "c4d-highcpu-8", None, f"2026-11-0{i + 1}T00:00:00Z") for i in range(8)]
        self.assertEqual(len(gcp.servers(json.dumps(many), NOW)), 5)

    def test_spend_and_daily(self):
        rows = bq_rows(**{"2026-11-06": 21.4, "2026-11-05": 44.2, "2026-11-01": 114.7, "2026-10-30": 0.01})
        data = self.fetch(rows)
        self.assertEqual((data["today"], data["yesterday"], data["month_label"]), ("$21", "$44", "NOV"))
        self.assertEqual(data["month"], "$180")
        self.assertEqual(len(data["daily"]), 14)
        self.assertEqual(data["daily"][-1], {"day": "6", "cost": 21.4})
        self.assertEqual(data["daily"][0]["day"], "24")
        self.assertEqual(data["daily"][2], {"day": "26", "cost": 0.0})

    def test_credit_formats(self):
        data = self.fetch(credit={"credit_left": 1772.4, "credit_total": 2000})
        self.assertEqual((data["credit"], data["credit_total"]), ("$1,772", "$2K"))
        missing = gcp.fetch(gcloud=lambda: "[]", bq=lambda s: "[]", cost_file=Path("/nonexistent/x.json"), now=NOW)
        self.assertEqual((missing["credit"], missing["credit_total"]), ("--", "--"))

    def test_money(self):
        self.assertEqual([gcp.money(v) for v in (0.01, 21.4, 1772.4)], ["$0.01", "$21", "$1,772"])

    def test_failures_propagate(self):
        def boom(*a):
            raise RuntimeError("bq failed")
        with self.assertRaises(RuntimeError):
            gcp.fetch(gcloud=lambda: "[]", bq=boom, cost_file=Path("/x"), now=NOW)


if __name__ == "__main__":
    unittest.main()
