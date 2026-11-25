import io
import json
import unittest
from unittest import mock
from datetime import datetime
from pathlib import Path

from PIL import Image

from layout import WIDTH, HEIGHT, Canvas, _chart, render_page, updated_label

SAMPLE = json.loads((Path(__file__).parent / "fixtures" / "sample.json").read_text())
NOW = datetime(2026, 11, 6, 17, 30)


def open_png(data):
    return Image.open(io.BytesIO(data))


def long(n):
    return "Extraordinarily-long-" * n


def long_fixture():
    d = json.loads(json.dumps(SAMPLE))
    for r in d["customers"]["rows"]:
        r.update(name=long(4), status=long(2), note=long(8), seats="1,234,567")
    for r in d["sites"]["rows"]:
        r["name"] = long(4)
    for r in d["revenue"]["rows"]:
        r.update(name=long(4), seats=long(2), type=long(2))
    for s in d["gcp"]["servers"]:
        s.update(name=long(3), machine=long(2), status=long(2), up=True)
    for c in d["tokens"]["cells"]:
        c.update(name=long(2), countdown=long(2), reset=long(2))
    return d


class UpdatedLabelTest(unittest.TestCase):
    def test_recent_sample_shows_plain_time(self):
        ts = NOW.timestamp() - 5 * 60
        self.assertEqual(updated_label(ts, NOW), ("17:25", False))

    def test_sample_over_30_minutes_old_is_stale(self):
        ts = NOW.timestamp() - 31 * 60
        self.assertEqual(updated_label(ts, NOW), ("STALE 16:59", True))

    def test_missing_sample_has_no_label(self):
        self.assertEqual(updated_label(None, NOW), ("", False))


class LayoutTest(unittest.TestCase):
    def test_full_fixture_is_8_bit_grayscale_page(self):
        image = open_png(render_page(SAMPLE, 80, NOW, set()))
        self.assertEqual((image.mode, image.size), ("L", (WIDTH, HEIGHT)))
        self.assertEqual((WIDTH, HEIGHT), (1404, 1872))

    def test_side_tabs_use_the_dark_rail_gray(self):
        page = open_png(render_page(SAMPLE, 80, NOW, set()))
        self.assertEqual(page.getpixel((2, 700)), 0x22)

    def test_even_use_diagonal_is_two_px_black(self):
        c = Canvas()
        _chart(c, {}, 0)
        column = [c.image.getpixel((173, y)) for y in range(36, 153)]
        self.assertGreaterEqual(column.count(0), 2)

    def test_revenue_replaces_prs_with_totals_and_ten_transactions(self):
        import layout
        drawn = []
        with mock.patch.object(layout.Canvas, "text", lambda s, x, y, v, *a, **k: drawn.append(str(v))):
            render_page(SAMPLE, 80, NOW, set())
        self.assertEqual(layout.SECTIONS["revenue"], ("REVENUE", 1022, 468))
        self.assertNotIn("prs", layout.SECTIONS)
        self.assertIn("$2,316", drawn)
        self.assertIn("$9,494", drawn)
        self.assertIn("$31,077", drawn)
        self.assertIn("YEAR TO DATE", drawn)
        self.assertEqual(drawn.count("$23.20"), 9)
        self.assertEqual(drawn.count("-$5.00"), 1)

    def test_revenue_header_totals_fit_in_three_columns(self):
        import layout
        spans = []
        orig = layout.Canvas.text

        def spy(self, x, y, value, size=24, bold=False, *a, **k):
            if 1022 < y < 1022 + 86:
                spans.append((x, x + layout.tlen(str(value), size, bold)))
            return orig(self, x, y, value, size, bold, *a, **k)
        d = json.loads(json.dumps(SAMPLE))
        d["revenue"].update({"d30": "-$12,345", "d90": "$123,456", "ytd": "$1,234,567"})
        with mock.patch.object(layout.Canvas, "text", spy):
            render_page(d, 80, NOW, set())
        spans.sort()
        self.assertEqual(len(spans), 6)
        self.assertLessEqual(spans[-1][1], layout.R)
        self.assertTrue(all(a[1] < b[0] for a, b in zip(spans, spans[1:])))

    def test_very_long_names_and_titles_render(self):
        image = open_png(render_page(long_fixture(), 5, NOW, {"revenue"}))
        self.assertEqual((image.mode, image.size), ("L", (WIDTH, HEIGHT)))

    def test_missing_sections_and_no_battery_render(self):
        image = open_png(render_page({}, None, NOW, set()))
        self.assertEqual(image.size, (WIDTH, HEIGHT))

    def test_stale_tab_label_changes_the_tab(self):
        fresh = open_png(render_page(SAMPLE, 80, NOW, set())).crop((0, 686, 40, 1022))
        stale = open_png(render_page(SAMPLE, 80, NOW, {"sites"})).crop((0, 686, 40, 1022))
        self.assertNotEqual(fresh.tobytes(), stale.tobytes())

    def test_stale_label_is_longer_text_on_the_tab(self):
        def white(img):
            return sum(1 for p in img.getdata() if p > 200)
        fresh = open_png(render_page(SAMPLE, 80, NOW, set())).crop((0, 1022, 40, 1490))
        stale = open_png(render_page(SAMPLE, 80, NOW, {"revenue"})).crop((0, 1022, 40, 1490))
        self.assertGreater(white(stale), white(fresh))

    def test_sample_time_is_drawn_on_the_reset_row_right_edge(self):
        def ink(sampled_at):
            d = json.loads(json.dumps(SAMPLE))
            for c in d["tokens"]["cells"]:
                c["sampled_at"] = sampled_at
            img = open_png(render_page(d, 50, NOW, set())).convert("L")
            box = img.crop((380, 157, 457, 184))  # Claude cell, right of the reset text
            return sum(1 for v in box.getdata() if v < 200)
        self.assertEqual(ink(None), 0)
        self.assertGreater(ink(NOW.timestamp() - 60), 20)

    def test_fresh_sample_time_is_black(self):
        d = json.loads(json.dumps(SAMPLE))
        for c in d["tokens"]["cells"]:
            c["sampled_at"] = NOW.timestamp() - 60
        img = open_png(render_page(d, 50, NOW, set())).convert("L")
        self.assertEqual(min(img.crop((380, 157, 457, 184)).getdata()), 0)

    def test_fresh_sample_time_is_24_bold_like_the_reset_text(self):
        import layout
        calls = []
        orig = layout.Canvas.text

        def spy(self, x, y, value, size=24, bold=False, fill=0, anchor="ls"):
            if anchor == "rs" and y == 177:
                calls.append((value, size, bold))
            return orig(self, x, y, value, size, bold, fill, anchor)
        d = json.loads(json.dumps(SAMPLE))
        for c in d["tokens"]["cells"]:
            c["sampled_at"] = NOW.timestamp() - 60
        layout.Canvas.text = spy
        try:
            render_page(d, 50, NOW, set())
        finally:
            layout.Canvas.text = orig
        self.assertEqual(len(calls), len(d["tokens"]["cells"]))
        self.assertTrue(all(size == 24 and bold for _, size, bold in calls), calls)

    def test_seat_counts_are_24_bold_black_in_customers_and_new_customers(self):
        import layout
        seats = {str(r["seats"]) for k in ("customers", "sites") for r in SAMPLE[k]["rows"] if r.get("seats")}
        calls = []
        orig = layout.Canvas.text

        def spy(self, x, y, value, size=24, bold=False, fill=0, anchor="ls"):
            if str(value) in seats and 210 <= y < 1022 and x > 100:
                calls.append((value, size, bold, fill))
            return orig(self, x, y, value, size, bold, fill, anchor)
        layout.Canvas.text = spy
        try:
            render_page(SAMPLE, 50, NOW, set())
        finally:
            layout.Canvas.text = orig
        self.assertTrue(calls)
        self.assertTrue(all(c[1:] == (24, True, 0) for c in calls), calls)

    def test_place_label_keeps_the_country_shortcode(self):
        import layout
        self.assertEqual(layout.place_label("Americas / US", 400), "Americas / US")
        self.assertEqual(layout.place_label("EMEA / UK", 400), "EMEA / UK")

    def test_place_is_drawn_after_the_name_and_before_the_seats(self):
        import layout
        wanted = {
            ("coho-winery", "EMEA / DE", "1,918"),
        }
        calls = []
        orig = layout.Canvas.text

        def spy(self, x, y, value, size=24, bold=False, fill=0, anchor="ls"):
            calls.append((str(value), x, y, size, bold))
            return orig(self, x, y, value, size, bold, fill, anchor)

        layout.Canvas.text = spy
        try:
            render_page(SAMPLE, 50, NOW, set())
        finally:
            layout.Canvas.text = orig
        for name, place, seats in wanted:
            lines = {}
            for value, x, y, size, bold in calls:
                lines.setdefault(y, []).append((value, x, size, bold))
            line = next(items for items in lines.values()
                        if any(v == seats for v, *_ in items)
                        and any(v.startswith(name[:6]) for v, *_ in items))
            ordered = sorted(line, key=lambda item: item[1])
            name_i = next(i for i, item in enumerate(ordered) if item[0].startswith(name[:6]))
            place_i = next(i for i, item in enumerate(ordered) if item[0].startswith(place.split(" / ")[0]))
            seat_i = next(i for i, item in enumerate(ordered) if item[0] == seats)
            self.assertLess(name_i, place_i)
            self.assertLess(place_i, seat_i)
            self.assertEqual((ordered[place_i][2], ordered[place_i][3]), (24, False))
            self.assertEqual((ordered[seat_i][2], ordered[seat_i][3]), (24, True))

    def test_sites_section_is_labelled_new_customers(self):
        import layout
        self.assertEqual(layout.SECTIONS["sites"][0], "NEW CUSTOMERS")

    def test_dashed_line_marks_where_the_last_7_days_end(self):
        def strip(split):
            d = json.loads(json.dumps(SAMPLE))
            for i, r in enumerate(d["sites"]["rows"]):
                r["recent"] = i < split
            img = open_png(render_page(d, 50, NOW, set())).convert("L")
            b = 686 + 46 + (split - 1) * 44  # baseline of the last recent row
            return [v for v in img.crop((728, b + 8, 1348, b + 14)).getdata()]
        all_recent = strip(7)
        self.assertEqual(min(all_recent), 255)  # nothing older shown: no line
        line = strip(3)
        dark = sum(1 for v in line if v < 200)
        self.assertGreater(dark, 300)
        self.assertGreater(sum(1 for v in line if v == 255), 300)  # dashed, not solid

    def test_new_customers_shows_seven_rows(self):
        import layout
        names = []
        orig = layout.Canvas.badge

        def spy(self, x, baseline, product):
            if x == layout.COL2 and 686 < baseline < 1022:
                names.append(baseline)
            return orig(self, x, baseline, product)
        layout.Canvas.badge = spy
        try:
            render_page(SAMPLE, 50, NOW, set())
        finally:
            layout.Canvas.badge = orig
        self.assertEqual(len(names), 7)

    def test_row_squares_follow_the_steps_not_a_count(self):
        d = json.loads(json.dumps(SAMPLE))
        d["sites"]["rows"][0]["steps"] = [True, False, False, True, False]
        img = open_png(render_page(d, 50, NOW, set())).convert("L")
        b = 686 + 46
        bx0 = 1348 - 5 * 24 - 4 * 8
        filled = [img.getpixel((bx0 + j * 32 + 12, b - 10)) < 128 for j in range(5)]
        self.assertEqual(filled, [True, False, False, True, False])

    def test_battery_level_changes_the_header(self):
        low = open_png(render_page(SAMPLE, 10, NOW, set())).crop((1290, 30, 1360, 60))
        high = open_png(render_page(SAMPLE, 100, NOW, set())).crop((1290, 30, 1360, 60))
        self.assertNotEqual(low.tobytes(), high.tobytes())


if __name__ == "__main__":
    unittest.main()
