import unittest

from sources import tokens


def frame():
    pct = lambda p: [p, "1d 2h", "Fri 00:00", "09:00"]
    fields = pct("10%") + pct("86%") + pct("40%") + pct("5%")
    charts = ["." + "5" * 47, "." + "A" * 47, "0" * 48, "o" * 48]
    return "\n".join(["Q5", "60", "123", *fields, *charts, "END"])


class TokensTest(unittest.TestCase):
    def test_keeps_the_three_weekly_cells(self):
        data = tokens.fetch(run=frame)
        self.assertEqual([c["name"] for c in data["cells"]], ["CLAUDE", "CODEX", "CURSOR"])
        first = data["cells"][0]
        self.assertEqual((first["percent"], first["countdown"], first["reset"]), ("86%", "1d 2h", "Fri 00:00"))
        self.assertIsNone(first["chart"][0])
        self.assertEqual(len(first["chart"]), 48)
        self.assertEqual(data["cells"][2]["chart"][5], 50)
        self.assertEqual(first["max"], 50)

    def test_each_cell_carries_its_provider_sample_time(self):
        source = {"providers": {"claude": {"sampled_at": 100}, "codex": {"sampled_at": 200}}}
        data = tokens.fetch(run=frame, read_source=lambda: source)
        self.assertEqual([c["sampled_at"] for c in data["cells"]], [100, 200, None])

    def test_unreadable_source_leaves_sample_time_empty(self):
        def boom():
            raise OSError("missing")
        data = tokens.fetch(run=frame, read_source=boom)
        self.assertEqual([c["sampled_at"] for c in data["cells"]], [None, None, None])

    def test_bad_frame_raises(self):
        with self.assertRaises(ValueError):
            tokens.fetch(run=lambda: "garbage")

    def test_runner_failure_propagates(self):
        def boom():
            raise RuntimeError("frame source failed")
        with self.assertRaises(RuntimeError):
            tokens.fetch(run=boom)


if __name__ == "__main__":
    unittest.main()
