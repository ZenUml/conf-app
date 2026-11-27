import unittest

import mixpanel_read as mr

PAGE = "\n".join(["Settings", "Org", "Diagramly.Ai", "Plan Details & Billing", "Session Replay", "Data Usage",
                  "Event Volume", "654,731 Events Tracked", "Session Replay", "52,259 Replays"])


class PayloadTest(unittest.TestCase):
    def test_keeps_only_billing_text_after_checked_org_and_tab(self):
        out = mr.payload(mr.URL, PAGE, "2026-11-19T09:36:35+11:00")
        self.assertEqual(out["text"], "Diagramly.Ai\nData Usage\nEvent Volume\n654,731 Events Tracked\n"
                                      "Session Replay\n52,259 Replays")
        self.assertEqual((out["source_url"], out["observed_at"]), (mr.URL, "2026-11-19T09:36:35+11:00"))

    def test_sign_in_page_is_refused(self):
        with self.assertRaises(mr.ReadError):
            mr.payload(mr.URL, "Log in to Mixpanel\nEmail", "2026-11-19T09:36:35+11:00")

    def test_other_page_and_missing_section_are_refused(self):
        with self.assertRaises(mr.ReadError):
            mr.payload("https://mixpanel.com/project/3373228/view", PAGE, "x")
        with self.assertRaises(mr.ReadError):
            mr.payload(mr.URL, PAGE.replace("Event Volume", "Loading"), "x")


if __name__ == "__main__":
    unittest.main()
