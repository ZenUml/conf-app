"""Anonymous fixtures; no production calls or customer data."""
import datetime as dt
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import behaviour_targets as bt

TODAY = dt.date(2026, 11, 13)
LITE, FULL = bt.LITE_KEY, 'com.example.full'


def lic(cloud, addon, kind, status='active', host=None, end=None, partner=False, tier='500 Users'):
    r = {'cloudId': cloud, 'addonKey': addon, 'licenseType': kind, 'status': status, 'tier': tier,
         'cloudSiteHostname': host or f'{cloud}.atlassian.net', 'maintenanceEndDate': end,
         'contactDetails': {'company': f'{cloud} Ltd', 'country': 'Nowhere',
                            'technicalContact': {'name': 'T Contact', 'email': f't@{cloud}.example'}}}
    if partner:
        r['partnerDetails'] = {'partnerName': 'Reseller'}
    return r


def tx(cloud, addon, amount, end, sale='New'):
    return {'cloudId': cloud, 'addonKey': addon,
            'purchaseDetails': {'vendorAmount': amount, 'saleType': sale, 'maintenanceEndDate': end}}


def health(domain, score):
    return {'domain': domain, 'opportunity_score': score, 'seat_tier': 500, 'usage_volume': 1000,
            'growth_trend%': 5.0, 'paywall_friction': 3, 'adoption_breadth%': 2.0, 'risk_score': 10.0}


class OtherProductState(unittest.TestCase):
    def state(self, licences, transactions=()):
        return bt.other_product_state('c1', licences, list(transactions), TODAY)['state']

    def test_examples(self):
        cases = [
            ('lite only', [lic('c1', LITE, 'FREE')], [], 'none'),
            ('pays for full', [lic('c1', FULL, 'COMMERCIAL')], [tx('c1', FULL, 900.0, '2027-01-01')], 'paying'),
            ('coverage ended', [lic('c1', FULL, 'COMMERCIAL', 'inactive')], [tx('c1', FULL, 900.0, '2026-06-01')], 'lapsed'),
            ('refunded in full', [lic('c1', FULL, 'COMMERCIAL')],
             [tx('c1', FULL, 900.0, '2027-01-01'), tx('c1', FULL, -900.0, '2027-01-01', 'Refund')], 'commercial_unpaid'),
            ('commercial, no order', [lic('c1', FULL, 'COMMERCIAL')], [], 'commercial_unpaid'),
            ('active trial', [lic('c1', FULL, 'EVALUATION', end='2026-12-05')], [], 'trial'),
            ('ended trial only', [lic('c1', FULL, 'EVALUATION', 'inactive', end='2026-03-01')], [], 'none'),
            ('legacy free', [lic('c1', FULL, 'LEGACY_FREE')], [], 'legacy_free'),
            ('another site pays', [lic('c2', FULL, 'COMMERCIAL')], [tx('c2', FULL, 900.0, '2027-01-01')], 'none'),
        ]
        for name, licences, transactions, want in cases:
            self.assertEqual(self.state(licences, transactions), want, name)


class Targets(unittest.TestCase):
    def setUp(self):
        self.licences = [
            lic('a', LITE, 'FREE'), lic('a', FULL, 'COMMERCIAL'),          # already pays
            lic('b', LITE, 'FREE', partner=True),                            # free, via a reseller
            lic('c', LITE, 'FREE'), lic('c', FULL, 'EVALUATION', end='2026-12-05'),
            lic('d', LITE, 'FREE'),
        ]
        self.transactions = [tx('a', FULL, 900.0, '2027-01-01')]
        self.rows = [health('a', 95), health('b', 90), health('c', 85), health('d', 80), health('ghost', 70)]

    def build(self, **kw):
        return bt.build_targets(self.rows, self.licences, self.transactions, today=TODAY, **kw)

    def test_paying_site_is_skipped_and_others_keep_rank_order(self):
        out = self.build()
        self.assertEqual([(r['domain'], r['verdict']) for r in out],
                         [('a', 'skip'), ('b', 'candidate'), ('c', 'candidate'), ('d', 'candidate'), ('ghost', 'unknown')])
        self.assertIn('pays', out[0]['reason'])
        self.assertIn('no Lite licence', out[4]['reason'])

    def test_candidate_carries_contact_partner_and_other_product(self):
        b, c = self.build()[1:3]
        self.assertEqual(b['contact_email'], 't@b.example')
        self.assertTrue(b['via_partner'])
        self.assertFalse(c['via_partner'])
        self.assertEqual(c['other_product'], 'trial')
        self.assertIn('2026-12-05', c['other_product_detail'])

    def test_candidate_carries_partner_name_and_email_domain(self):
        b, c = self.build()[1:3]
        self.assertEqual((b['partner_name'], b['contact_email_domain']), ('Reseller', 'b.example'))
        self.assertEqual((c['partner_name'], c['contact_email_domain']), (None, 'c.example'))

    def test_missing_email_gives_no_domain(self):
        self.licences[-1]['contactDetails']['technicalContact'] = {}
        d = [r for r in self.build() if r['domain'] == 'd'][0]
        self.assertIsNone(d['contact_email_domain'])

    def test_table_shows_partner_name(self):
        import contextlib, io, json, os, sqlite3, tempfile
        with tempfile.TemporaryDirectory() as tmp:
            db, hp = os.path.join(tmp, 'm.db'), os.path.join(tmp, 'h.json')
            con = sqlite3.connect(db)
            con.execute('create table licenses (raw text)'); con.execute('create table transactions (raw text)')
            con.execute('create table sync_meta (synced_at text)'); con.execute("insert into sync_meta values ('2026-11-13')")
            con.executemany('insert into licenses values (?)', [(json.dumps(r),) for r in self.licences])
            con.commit(); con.close()
            with open(hp, 'w') as f:
                json.dump(self.rows, f)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                bt.main(['--health', hp, '--db', db])
        line = [l for l in out.getvalue().splitlines() if '| b |' in l][0]
        self.assertIn('Reseller', line)

    def test_tracker_exclusion_wins_and_keeps_its_reason(self):
        out = self.build(excluded={'d': 'paused until Q1'})
        d = [r for r in out if r['domain'] == 'd'][0]
        self.assertEqual((d['verdict'], d['reason']), ('skip', 'tracker: paused until Q1'))

    def test_top_counts_candidates_not_rows(self):
        out = self.build(top=2)
        self.assertEqual([r['domain'] for r in out if r['verdict'] == 'candidate'], ['b', 'c'])
        self.assertEqual(out[0]['domain'], 'a')  # the skipped row above them stays visible


if __name__ == '__main__':
    unittest.main()
