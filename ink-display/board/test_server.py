import http.client
import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from server import BoardState, make_server, parse_battery
from store import Store

SAMPLE = json.loads((Path(__file__).parent / "fixtures" / "sample.json").read_text())
TOKEN = "t0ken"
T0 = datetime(2026, 11, 6, 12, 0)


def get(server, path):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
    conn.request("GET", path)
    response = conn.getresponse()
    return response.status, dict(response.getheaders()), response.read()


class ServerTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.now = T0
        self.store = Store(Path(tmp.name))
        self.data = {"revenue": SAMPLE["revenue"]}
        self.state = BoardState(self.store, {"revenue": lambda: self.data["revenue"]}, clock=lambda: self.now)
        self.server = make_server("127.0.0.1", 0, TOKEN, self.state)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_serves_png_on_the_token_path(self):
        self.state.refresh()
        status, headers, body = get(self.server, f"/r/{TOKEN}.png")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(body[:8], b"\x89PNG\r\n\x1a\n")

    def test_wrong_token_and_other_paths_are_404(self):
        self.assertEqual(get(self.server, "/r/other.png")[0], 404)
        self.assertEqual(get(self.server, "/q/t0ken.png")[0], 404)
        self.assertEqual(get(self.server, "/")[0], 404)

    def test_board_id_answers_without_the_token(self):
        status, headers, body = get(self.server, "/board-id")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"remarkable-board")

    def test_forced_refresh_is_answered_once(self):
        path = f"/r/{TOKEN}.full"
        self.assertEqual(get(self.server, path)[2], b"0")
        (self.store.dir / "force-full").touch()
        self.assertEqual(get(self.server, path)[2], b"1")
        self.assertEqual(get(self.server, path)[2], b"0")

    def test_forced_refresh_needs_the_token_and_stays_out_of_the_log(self):
        import contextlib
        import io
        self.assertEqual(get(self.server, "/r/other.full")[0], 404)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            get(self.server, f"/r/{TOKEN}.full")
        self.assertNotIn(TOKEN, out.getvalue())

    def test_battery_change_redraws_and_same_level_does_not(self):
        self.state.refresh()
        first = get(self.server, f"/r/{TOKEN}.png?b=10")[2]
        again = get(self.server, f"/r/{TOKEN}.png?b=10")[2]
        other = get(self.server, f"/r/{TOKEN}.png?b=90")[2]
        self.assertEqual(first, again)
        self.assertNotEqual(first, other)

    def test_refresh_rerenders_only_when_a_section_changed(self):
        self.state.refresh()
        png = self.state.png
        self.now = T0 + timedelta(seconds=30)
        self.state.refresh()
        self.assertIs(self.state.png, png)
        self.data["revenue"] = {"counts": [], "rows": []}
        self.now = T0 + timedelta(seconds=400)
        self.state.refresh()
        self.assertIsNot(self.state.png, png)

    def test_failing_fetcher_keeps_last_image(self):
        self.state.refresh()
        png = self.state.png

        def boom():
            raise RuntimeError("down")
        self.state.fetchers["revenue"] = boom
        self.now = T0 + timedelta(seconds=4000)
        self.state.refresh()
        self.assertIsNotNone(self.state.png)
        self.assertEqual(self.store.load("revenue"), SAMPLE["revenue"])
        self.assertIn("down", self.store.errors["revenue"])
        self.assertEqual(get(self.server, f"/r/{TOKEN}.png")[0], 200)

    def test_log_line_leaves_the_token_out(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            get(self.server, f"/r/{TOKEN}.png")
        self.assertNotIn(TOKEN, out.getvalue())

    def test_parse_battery(self):
        self.assertEqual(parse_battery("b=55"), 55)
        self.assertIsNone(parse_battery("b=101"))
        self.assertIsNone(parse_battery("b=x"))
        self.assertIsNone(parse_battery(""))


if __name__ == "__main__":
    unittest.main()
