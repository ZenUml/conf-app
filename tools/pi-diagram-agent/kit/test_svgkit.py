"""Unit tests for svgkit. Synthetic fixtures only."""
import os
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import svgkit as k  # noqa: E402

NS = {"s": "http://www.w3.org/2000/svg"}


def parse(fragment):
    return ET.fromstring(f'<svg xmlns="http://www.w3.org/2000/svg">{fragment}</svg>')


def point_in_polygon(px, py, poly):
    inside = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > py) != (y2 > py) and px < (x2 - x1) * (py - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


class Fillet(unittest.TestCase):
    def test_single_bend_uses_r5_quadratic_with_control_at_the_corner(self):
        d = k.fillet_path([(0, 0), (0, 50), (50, 50)])
        self.assertEqual(d, "M 0,0 L 0,45 Q 0,50 5,50 L 50,50")

    def test_every_bend_gets_exactly_one_r5_fillet(self):
        pts = [(0, 0), (0, 40), (40, 40), (40, 90), (120, 90)]
        d = k.fillet_path(pts)
        self.assertEqual(d.count("Q"), 3)
        self.assertEqual(d.count("L"), 4)
        self.assertEqual(d, "M 0,0 L 0,35 Q 0,40 5,40 L 35,40 Q 40,40 40,45 L 40,85 Q 40,90 45,90 L 120,90")

    def test_straight_route_has_no_fillet(self):
        self.assertEqual(k.fillet_path([(0, 0), (100, 0)]), "M 0,0 L 100,0")

    def test_diagonal_leg_is_rejected(self):
        with self.assertRaises(ValueError):
            k.fillet_path([(0, 0), (10, 50), (50, 50)])

    def test_final_leg_must_carry_fillet_marker_and_8_unit_shaft(self):
        short = [(0, 0), (0, 50), (10, 50)]
        ok = [(0, 0), (0, 50), (25, 50)]
        self.assertTrue(k.check_route(short))
        self.assertEqual(k.check_route(ok), [])
        with self.assertRaises(ValueError):
            k.connector("A", "B", short, stroke="#000000")
        k.connector("A", "B", ok, stroke="#000000")

    def test_shared_leg_shorter_than_two_fillets_is_rejected(self):
        self.assertTrue(k.check_route([(0, 0), (0, 40), (8, 40), (8, 90), (60, 90)]))


class Review(unittest.TestCase):
    """Defects found in review: rule-violating input must raise, never be repaired or let through."""

    def test_reversal_is_rejected_not_drawn_as_a_bend(self):
        with self.assertRaises(ValueError):
            k.fillet_path([(0, 0), (0, 50), (0, 20)])
        self.assertTrue(k.check_route([(0, 0), (0, 50), (0, 20)]))
        with self.assertRaises(ValueError):
            k.connector("A", "B", [(0, 0), (0, 80), (0, 30)], stroke="#000000")

    def test_connector_has_no_non_strict_escape(self):
        with self.assertRaises(TypeError):
            k.connector("A", "B", [(0, 0), (0, 50), (10, 50)], stroke="#000000", strict=False)

    def test_no_context_stroke_and_one_marker_per_colour_with_identical_geometry(self):
        red = k.connector("A", "B", [(0, 0), (60, 0)], stroke="#C00000")
        red2 = k.connector("B", "C", [(0, 20), (60, 20)], stroke="#c00000")
        blue = k.connector("C", "D", [(0, 40), (60, 40)], stroke="#1f4e9a")
        line = k.legend_line(0, 60, 48, "Flow", stroke="#1f4e9a", text_color="#111111", canvas="#ffffff")
        tok = k.palette_token("t", subtle_bg="#ffffff", subtle_text="#111111", border="#333333", meaning="m")
        doc = k.svg_document(200, 100, [red, red2, blue, line], title="T", desc="D", tokens=[tok])
        self.assertNotIn("context-stroke", doc)
        root = ET.fromstring(doc)
        markers = root.findall(".//s:marker", NS)
        self.assertEqual(sorted(m.get("id") for m in markers), ["arrow-1f4e9a", "arrow-c00000"])
        geometry = set()
        for m in markers:
            path = m.find("s:path", NS)
            self.assertEqual(path.get("fill"), "#" + m.get("id")[len("arrow-"):])
            geometry.add((tuple(sorted((a, v) for a, v in m.attrib.items() if a != "id")), path.get("d")))
        self.assertEqual(len(geometry), 1)
        refs = [(el.get("marker-end"), el.get("stroke").lower()) for el in root.iter() if el.get("marker-end")]
        self.assertEqual(len(refs), 4)
        for ref, stroke in refs:
            self.assertEqual(ref, "url(#arrow-" + stroke.lstrip("#") + ")")

    def test_marker_def_has_no_default_colour(self):
        with self.assertRaises(TypeError):
            k.marker_def()

    def test_document_requires_a_palette_declaration_and_tokens_need_meaning(self):
        with self.assertRaises(ValueError):
            k.svg_document(100, 100, [], title="t", desc="d")
        with self.assertRaises((TypeError, ValueError)):
            k.palette_token("t", subtle_bg="#ffffff", subtle_text="#111111", border="#333333")
        with self.assertRaises(ValueError):
            k.palette_token("t", subtle_bg="#ffffff", subtle_text="#111111", border="#333333", meaning="  ")

    def test_text_contrast_is_enforced_by_every_text_primitive(self):
        with self.assertRaises(ValueError):
            k.node("A", "rect", 0, 0, "Start", fill="#ffffff", stroke="#333333", text_color="#bbbbbb")
        with self.assertRaises(ValueError):
            k.edge_label("A", "B", "Yes", 0, 0, text_color="#bbbbbb", canvas="#ffffff")
        with self.assertRaises(ValueError):
            k.container("G", 0, 0, 300, 200, "Heading", fill="#ffffff", stroke="#999999", text_color="#bbbbbb")
        with self.assertRaises(ValueError):
            k.legend_swatch(0, 0, "Key", fill="#ffffff", stroke="#333333", text_color="#bbbbbb", canvas="#ffffff")
        with self.assertRaises(ValueError):
            k.legend_line(0, 0, 40, "Key", stroke="#333333", text_color="#bbbbbb", canvas="#ffffff")

    def test_measure_text_is_an_upper_bound_of_measured_browser_glyphs(self):
        # Largest Chromium getBBox width per glyph (em) over font sizes 12-24, kit font stack, 2026-10-02.
        measured = {'0': 0.6302, '1': 0.4648, '2': 0.6042, '3': 0.6276, '4': 0.6445, '5': 0.6185, '6': 0.6367, '7': 0.5857, '8': 0.6393, '9': 0.6367, ' ': 0.2812, '!': 0.3112, '"': 0.4779, '#': 0.6302, '$': 0.6302, '%': 0.9258, '&': 0.7122, "'": 0.2969, '(': 0.3828, ')': 0.3828, '*': 0.4727, '+': 0.6302, ',': 0.2969, '-': 0.4727, '.': 0.2969, '/': 0.3047, ':': 0.2969, ';': 0.2969, '<': 0.6302, '=': 0.6302, '>': 0.6302, '?': 0.513, '@': 0.918, 'A': 0.6745, 'B': 0.6576, 'C': 0.7161, 'D': 0.7266, 'E': 0.5964, 'F': 0.5729, 'G': 0.7474, 'H': 0.7422, 'I': 0.2682, 'J': 0.5391, 'K': 0.6589, 'L': 0.569, 'M': 0.875, 'N': 0.7422, 'O': 0.7721, 'P': 0.6354, 'Q': 0.7721, 'R': 0.6536, 'S': 0.638, 'T': 0.6341, 'U': 0.7383, 'V': 0.6745, 'W': 0.9688, 'X': 0.6797, 'Y': 0.6562, 'Z': 0.6628, '[': 0.3828, '\\': 0.3047, ']': 0.3828, '^': 0.6302, '_': 0.5846, '`': 0.5033, 'a': 0.5521, 'b': 0.6146, 'c': 0.5599, 'd': 0.6146, 'e': 0.5716, 'f': 0.362, 'g': 0.6094, 'h': 0.5885, 'i': 0.2474, 'j': 0.2581, 'k': 0.543, 'l': 0.2539, 'm': 0.8711, 'n': 0.5846, 'o': 0.5911, 'p': 0.6107, 'q': 0.6094, 'r': 0.3891, 's': 0.5234, 't': 0.3633, 'u': 0.5846, 'v': 0.543, 'w': 0.7747, 'x': 0.5247, 'y': 0.543, 'z': 0.5391, '{': 0.3828, '|': 0.2591, '}': 0.3828, '~': 0.6302}
        under = {c: (k.measure_text(c, 1), w) for c, w in measured.items() if k.measure_text(c, 1) < w}
        self.assertEqual(under, {})


class Marker(unittest.TestCase):
    def test_single_marker_user_space_with_tip_ref(self):
        root = parse(k.marker_def("#123456"))
        markers = root.findall(".//s:marker", NS)
        self.assertEqual(len(markers), 1)
        m = markers[0]
        self.assertEqual(m.get("markerUnits"), "userSpaceOnUse")
        self.assertEqual(m.get("refX"), "10")
        self.assertEqual(m.get("id"), k.marker_id("#123456"))
        self.assertTrue(m.find("s:path", NS).get("d").startswith("M0,0 L10,5 L0,10"))

    def test_connector_attributes(self):
        el = parse(k.connector("A", "B", [(0, 0), (60, 0)], stroke="#123456", dashed=True))[0]
        self.assertEqual(el.get("data-source"), "A")
        self.assertEqual(el.get("data-target"), "B")
        self.assertEqual(el.get("stroke-width"), "1")
        self.assertEqual(el.get("marker-end"), f"url(#{k.marker_id('#123456')})")
        self.assertTrue(el.get("stroke-dasharray"))
        solid = parse(k.connector("A", "B", [(0, 0), (60, 0)], stroke="#123456"))[0]
        self.assertIsNone(solid.get("stroke-dasharray"))


class Labels(unittest.TestCase):
    def test_smallest_fitting_tier(self):
        self.assertEqual(k.fit_label("Start").tier, (96, 40))
        self.assertEqual(k.fit_label("Customer Deposit IDR via Nobu VA to Deposit Vault").tier, (200, 80))
        self.assertEqual(k.fit_label("word " * 60).tier, (480, 160))

    def test_tier_is_never_stretched_and_min_tier_is_respected(self):
        self.assertEqual(k.fit_label("Start", min_tier=(200, 80)).tier, (200, 80))

    def test_wrapped_lines_fit_the_tier(self):
        for text in ["Check withdrawal vault balance now", "Transfer excess from BPDM to withdrawal vault and notify PayOps"]:
            fit = k.fit_label(text)
            self.assertTrue(all(k.measure_text(line, fit.font_size) <= fit.tier[0] for line in fit.lines))
            self.assertLessEqual((len(fit.lines) - 1) * fit.line_height + 1.2 * fit.font_size, fit.tier[1])
            self.assertEqual(" ".join(fit.lines), text)

    def test_overflow_raises(self):
        with self.assertRaises(ValueError):
            k.fit_label("word " * 400)

    def test_measure_is_deterministic_and_monotone(self):
        self.assertEqual(k.measure_text("abc"), k.measure_text("abc"))
        self.assertLess(k.measure_text("ab"), k.measure_text("abc"))
        self.assertLess(k.measure_text("abc", 12), k.measure_text("abc", 18))

    def test_explicit_newlines_are_kept(self):
        self.assertEqual(k.wrap_text("one\ntwo", 400), ["one", "two"])


class Colour(unittest.TestCase):
    def test_contrast_ratio_reference_values(self):
        self.assertAlmostEqual(k.contrast_ratio("#000000", "#ffffff"), 21.0, places=2)
        self.assertAlmostEqual(k.contrast_ratio("#fff", "#fff"), 1.0, places=2)

    def test_check_contrast_boundary(self):
        k.check_contrast("#595959", "#ffffff")
        with self.assertRaises(ValueError):
            k.check_contrast("#777777", "#ffffff")

    def test_palette_token_rejects_a_failing_pair_and_comments_pass(self):
        with self.assertRaises(ValueError):
            k.palette_token("warn", subtle_bg="#fff3cd", subtle_text="#ffc107", border="#b8860b", meaning="Warning")
        t = k.palette_token("ok", subtle_bg="#e8f5e9", subtle_text="#1b5e20", border="#2e7d32", bold_bg="#1b5e20", inverse_text="#ffffff", meaning="Done")
        text = k.palette_comment([t])
        self.assertIn("ok", text)
        self.assertNotIn("--", text)


class Escaping(unittest.TestCase):
    def test_text_and_attributes_are_escaped_and_roundtrip(self):
        n = k.node("A&B", "rect", 0, 0, 'Fish & <Chips> "quoted"', fill="#fff", stroke="#000", text_color="#000")
        g = parse(n.svg)[0]
        self.assertEqual(g.get("data-node"), "A&B")
        self.assertEqual(" ".join(t.text for t in g.findall("s:text", NS)), 'Fish & <Chips> "quoted"')

    def test_comment_never_contains_double_dash(self):
        doc = k.svg_document(100, 100, [], title="t", desc="d", comment="a -- b")
        ET.fromstring(doc)
        self.assertNotIn("a -- b", doc)


class Nodes(unittest.TestCase):
    def style(self, **kw):
        return dict(fill="#ffffff", stroke="#333333", text_color="#111111", **kw)

    def test_rect_radius_4_and_label_box_inset_12(self):
        n = k.node("A", "rect", 10, 20, "Start", **self.style())
        self.assertEqual((n.w, n.h), (120, 64))
        el = parse(n.svg)[0]
        self.assertEqual(el.find("s:rect", NS).get("rx"), "4")
        self.assertEqual(el.get("data-label-box"), "22 32 96 40")

    def test_capsule_keeps_full_radius(self):
        n = k.node("A", "capsule", 0, 0, "Start", **self.style())
        self.assertEqual(parse(n.svg)[0].find("s:rect", NS).get("rx"), str(n.h / 2).rstrip("0").rstrip("."))

    def test_short_decision_is_a_diamond_long_is_a_hexagon_and_label_box_is_inside(self):
        short = k.node("D", "decision", 0, 0, "Ready", **self.style())
        long = k.node("E", "decision", 0, 0, "Does the withdrawal vault hold an adequate balance right now?", **self.style())
        self.assertEqual(short.variant, "diamond")
        self.assertEqual(long.variant, "hexagon")
        for n in (short, long):
            lx, ly, lw, lh = n.label_box
            self.assertTrue(all(point_in_polygon(px, py, n.polygon) for px, py in [(lx, ly), (lx + lw, ly), (lx, ly + lh), (lx + lw, ly + lh)]))
            self.assertIn("data-label-box", parse(n.svg)[0].attrib)
        top = long.polygon[0]
        self.assertEqual(top[0], long.x + long.w / 2)
        self.assertEqual(top[1], long.y)

    def test_decision_outline_has_10_unit_fillet(self):
        n = k.node("D", "decision", 0, 0, "Ready", **self.style())
        d = parse(n.svg)[0].find("s:path", NS).get("d")
        self.assertEqual(d.count("Q"), 4)

    def test_store_and_queue_emit_a_path_with_declared_label_box(self):
        for shape in ("store", "queue"):
            n = k.node("S", shape, 0, 0, "Ledger", **self.style())
            el = parse(n.svg)[0]
            self.assertEqual(el.find("s:path", NS) is not None, True)
            self.assertEqual(len(el.get("data-label-box").split()), 4)

    def test_text_is_one_element_per_line_and_group_is_recorded(self):
        n = k.node("A", "rect", 0, 0, "Customer deposit IDR via Nobu VA to Deposit Vault", group="G1", **self.style())
        el = parse(n.svg)[0]
        self.assertGreater(len(el.findall("s:text", NS)), 1)
        self.assertEqual(el.get("data-parent-group"), "G1")

    def test_edge_point_is_arithmetic_on_a_caller_supplied_face_and_fraction(self):
        n = k.node("A", "rect", 100, 100, "Start", **self.style())
        self.assertEqual(n.edge_point("right", 0.5), (220, 132))
        self.assertEqual(n.edge_point("top", 0.25), (130, 100))
        with self.assertRaises(ValueError):
            n.edge_point("right", 0.01)
        with self.assertRaises(TypeError):
            n.edge_point("right")

    def test_diamond_tip_port_is_pulled_in_by_the_fillet(self):
        n = k.node("D", "decision", 0, 0, "Ready", **self.style())
        px, py = n.edge_point("top", 0.5)
        self.assertEqual(px, n.x + n.w / 2)
        self.assertGreater(py, n.y)
        self.assertLess(py, n.y + 10)
        with self.assertRaises(ValueError):
            n.edge_point("top", 0.3)


class Pieces(unittest.TestCase):
    def test_edge_label_binding_and_canvas_background(self):
        lab = k.edge_label("A", "B", "Yes", 10, 10, text_color="#222222", canvas="#fafafa")
        g = parse(lab.svg)[0]
        self.assertEqual(g.get("data-edge-label-source"), "A")
        self.assertEqual(g.get("data-edge-label-target"), "B")
        self.assertEqual(g.find("s:rect", NS).get("fill"), "#fafafa")
        self.assertEqual(g.find("s:text", NS).text, "Yes")
        self.assertEqual(lab.box[:2], (10, 10))

    def test_container_heading_and_subtitle_are_direct_children(self):
        g = parse(k.container("G", 0, 0, 300, 200, "Heading", subtitle="Sub", fill="#fff", stroke="#999", text_color="#111"))[0]
        self.assertEqual(g.get("data-group"), "G")
        self.assertEqual([t.text for t in g.findall("s:text", NS)], ["Heading", "Sub"])
        self.assertIsNotNone(g.find("s:rect", NS))

    def test_legend_items_do_not_bind_edges(self):
        sw = parse(k.legend_swatch(0, 0, "Customer", fill="#eef", stroke="#00f", text_color="#111", canvas="#fff"))
        ln = parse(k.legend_line(0, 0, 60, "Dashed", stroke="#444", text_color="#111", canvas="#fff", dashed=True))
        for root in (sw, ln):
            self.assertEqual(root.findall(".//*[@data-source]"), [])

    def test_document_has_one_marker_and_is_well_formed(self):
        line = k.connector("A", "B", [(0, 0), (60, 0)], stroke="#123456")
        doc = k.svg_document(200, 100, ["<g/>", line], title="T", desc="D", canvas="#ffffff", comment="palette")
        root = ET.fromstring(doc)
        self.assertEqual(len(root.findall(".//s:marker", NS)), 1)
        self.assertEqual(root.get("viewBox"), "0 0 200 100")


if __name__ == "__main__":
    unittest.main()
