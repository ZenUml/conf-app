import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock
from PIL import Image
import layout
from server import BoardState
from sources import credits
from store import Store

SNAPSHOT = {'status': 'PENDING', 'checked_at': '2026-11-13T07:30:00+11:00'}


class CreditsPanelTest(unittest.TestCase):
    def test_right_panel_is_bounded_and_customers_are_replaced(self):
        calls = []
        rows = [{'name': f'Customer {i}'} for i in range(10)]
        with mock.patch.object(layout.Canvas, 'text', lambda s, x, y, value, *a, **k: calls.append((x, y, str(value), a, k))):
            layout.render_page({'customers': {'rows': rows}, 'credits': SNAPSHOT}, None, datetime.now(), set())
        text = [v for _, _, v, _, _ in calls]
        for i in range(10):
            self.assertNotIn(f'Customer {i}', text)
        self.assertIn('PENDING', text)
        self.assertIn('7–10 business days · No action required', text)
        c = layout.Canvas()
        layout.draw_credits(c, SNAPSHOT, 210)
        ink = Image.eval(c.image, lambda p: 255-p).getbbox()
        self.assertGreaterEqual(ink[0], 728)
        self.assertGreaterEqual(ink[1], 232)
        self.assertLessEqual(ink[2], 1348)
        self.assertLessEqual(ink[3], 664)

    def test_missing_snapshot_shows_unavailable_even_without_customers(self):
        values = []
        with mock.patch.object(layout.Canvas, 'text', lambda s, x, y, v, *a, **k: values.append(str(v))):
            layout.render_page({}, None, datetime.now(), set())
        self.assertIn('UNAVAILABLE', values)
        self.assertNotIn('PENDING', values)

    def test_poll_does_not_advance_checked_at_and_missing_file_clears_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'snapshot.json'
            path.write_text(json.dumps(SNAPSHOT))
            store = Store(Path(tmp) / 'cache')
            now = datetime(2026, 11, 13, 9)
            state = BoardState(store, {'credits': lambda: credits.fetch(path)}, clock=lambda: now)
            state.refresh()
            first = state.png
            now += timedelta(seconds=300)
            state.refresh()
            self.assertEqual(store.load('credits'), SNAPSHOT)
            self.assertEqual(state.png, first)
            path.unlink()
            now += timedelta(seconds=300)
            state.refresh()
            self.assertEqual(store.load('credits')['status'], 'UNAVAILABLE')
            self.assertNotEqual(state.png, first)
