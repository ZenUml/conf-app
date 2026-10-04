"""Anonymous regression fixtures; no production calls or customer data."""
import contextlib, datetime as dt, importlib.util, io, json, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
SKILLS = pathlib.Path(__file__).resolve().parents[2]
for folder in ('marketplace', 'client-health', 'extend-space-license'):
    sys.path.insert(0, str(SKILLS / folder / 'scripts'))
import mp_report, mp_pricing, health_score, grant_extension


def module(name, relative):
    spec = importlib.util.spec_from_file_location(name, SKILLS / relative)
    obj = importlib.util.module_from_spec(spec); spec.loader.exec_module(obj); return obj


installs = module('install_check', 'forge-installs/scripts/check.py')
new_customers = module('new_candidates', 'new-customers/scripts/new_customers.py')
macro_count = module('macro_inventory', 'macro-count/scripts/macro_count.py')


class LicenseEvidence(unittest.TestCase):
    def test_nonzero_empty_cli_is_unknown(self):
        failed = subprocess.CompletedProcess([], 1, '', 'authentication failed')
        with patch.object(mp_report.subprocess, 'run', return_value=failed):
            self.assertIsNone(mp_report._kv_space_licenses('example-cloud'))

    def test_success_empty_list_is_absence(self):
        with patch.object(mp_report, '_kv_run', return_value='[]'):
            self.assertEqual(mp_report._kv_space_licenses('example-cloud'), [])

    def test_malformed_list_is_unknown(self):
        for raw in ('', '{}', '[{}]', '[{"name":"license:another-cloud:ENG"}]'):
            with patch.object(mp_report, '_kv_run', return_value=raw):
                self.assertIsNone(mp_report._kv_space_licenses('example-cloud'))

    def test_user_scope_preserves_colons(self):
        keys = '[{"name":"license:example-cloud:ENG:712020:example-user"}]'
        with patch.object(mp_report, '_kv_run', side_effect=[keys, '{"status":"active","expiresAt":"2027-01-01"}']):
            row = mp_report._kv_space_licenses('example-cloud')[0]
        self.assertEqual((row['space'], row['userAccountId'], row['scope'], row['kind']),
                         ('ENG', '712020:example-user', 'user', 'COMPED'))

    def test_failed_value_is_not_a_comp(self):
        with patch.object(mp_report, '_kv_run', side_effect=['[{"name":"license:example-cloud:ENG"}]', RuntimeError()]):
            self.assertEqual(mp_report._kv_space_licenses('example-cloud')[0]['kind'], 'UNKNOWN')

    def test_valid_payment_reference_preserved(self):
        with patch.object(mp_report, '_kv_run', side_effect=['[{"name":"license:example-cloud:ENG"}]', '{"status":"active","paymentReference":"example-payment"}']):
            self.assertEqual(mp_report._kv_space_licenses('example-cloud')[0]['kind'], 'PAID')


class D1Evidence(unittest.TestCase):
    def test_unsuccessful_response_is_not_zero_inventory(self):
        for body in ('[]', '[{}]', '[{"success":false,"results":[]}]'):
            response = subprocess.CompletedProcess([], 0, body, '')
            with patch.object(macro_count.subprocess, 'run', return_value=response):
                with self.assertRaises(RuntimeError): macro_count.run_d1('SELECT 1')
        with patch.object(macro_count.subprocess, 'run', return_value=subprocess.CompletedProcess([],0,'[{"success":true,"results":[]}]','')):
            self.assertEqual(macro_count.run_d1('SELECT 1'), [])


class IdentityAndCandidates(unittest.TestCase):
    def test_placeholder_accounts_are_not_people(self):
        rows = [{'key':['example', uid]} for uid in (None, '', 'unknown_user_account_id', 'anonymous', 'null', 'real-id', 'real-id')]
        self.assertEqual(health_score.parse_creators_rows(rows), {'example': 1})

    def test_no_history_remains_candidate(self):
        lic = {'cloudSiteHostname':'example-customer.atlassian.net', 'maintenanceStartDate':'2026-09-01'}
        result = new_customers.classify(lic, 'my-api', {}, 30)
        self.assertEqual(result[0], 'CANDIDATE')
        self.assertIn('unknown', result[3])

    def test_known_old_history_is_preexisting(self):
        lic = {'cloudSiteHostname':'example-customer.atlassian.net', 'maintenanceStartDate':'2026-09-01'}
        self.assertEqual(new_customers.classify(lic, 'my-api', {('example-customer','my-api'):'2025-01-01'}, 30)[0], 'PRE-EXISTING')


class SharedPricing(unittest.TestCase):
    def setUp(self):
        self.payload = {'perUnitItems':[{'licenseType':'COMMERCIAL','unitCount':n,'amount':a} for n,a in [(-1,99),(100,.44),(250,.33),(1000,.11)]],
                        'items':[{'licenseType':'COMMERCIAL','unitCount':n,'amount':a,'monthsValid':12} for n,a in [(10,40),(100,440),(1000,1760)]]}

    def test_annual_uses_containing_tier_not_monthly_multiple(self):
        with patch.object(mp_pricing, '_pricing_payload', return_value=self.payload):
            q = mp_pricing.live_full_quote(902)
            g = grant_extension.full_plan_pricing(902)
        self.assertEqual(q, g)
        self.assertEqual(q['annual'], 1760)
        self.assertAlmostEqual(q['monthly'], 165.22)
        self.assertNotEqual(q['annual'], q['monthly'] * 10)

    def test_unavailable_or_uncovered_does_not_fallback(self):
        with patch.object(mp_pricing, '_pricing_payload', side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError): grant_extension.full_plan_pricing(902)
        with patch.object(mp_pricing, '_pricing_payload', return_value=self.payload):
            with self.assertRaises(RuntimeError): mp_pricing.live_full_quote(1001)
            with self.assertRaises(ValueError): mp_pricing.live_full_quote(0)

    def test_tiers_are_live(self):
        output = io.StringIO()
        with patch.object(mp_pricing, '_pricing_payload', return_value=self.payload), contextlib.redirect_stdout(output):
            mp_pricing.cmd_tiers(None)
        self.assertIn('1760', output.getvalue())
        self.assertNotIn('annual list price = 10', output.getvalue())


class InstallSnapshots(unittest.TestCase):
    def record(self, site='example.atlassian.net', ident='example-id'):
        return {'id':ident,'environment':'production','site':site}

    def test_bad_responses_are_not_empty(self):
        for raw in ('', '{}', '[{}]', json.dumps([self.record(),self.record()])):
            with self.assertRaises(ValueError): installs.parse_installations(raw)
        self.assertEqual(installs.parse_installations('[]'), [])

    def test_reinstall_is_not_customer_acquisition(self):
        delta = installs.compare([self.record(ident='new-id')], [self.record(ident='old-id')])
        self.assertEqual(delta, {'added':[], 'removed':[]})

    def test_no_baseline_and_bounded_removal(self):
        product = {'key':'full', 'forge_app_id':'example-app'}
        now = dt.datetime(2026,9,12,tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            first = installs.snapshot_report(product, [self.record()], pathlib.Path(tmp), now-dt.timedelta(days=8))
            self.assertEqual(first['deltas']['1']['read_status'], 'unavailable')
            second = installs.snapshot_report(product, [], pathlib.Path(tmp), now)
            self.assertEqual(second['read_status'], 'empty')
            self.assertEqual(len(second['deltas']['7']['removed']), 1)
            self.assertEqual(len(second['deltas']['7']['observed_interval']), 2)

    def test_failed_command_does_not_write_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(sys, 'argv', ['check.py','full','--snapshot-dir',tmp]), patch.object(installs.subprocess, 'run', return_value=subprocess.CompletedProcess([],1,'','')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(installs.main(),1)
            self.assertEqual(list(pathlib.Path(tmp).iterdir()),[])


if __name__ == '__main__': unittest.main()
