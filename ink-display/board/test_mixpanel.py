import io
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from PIL import Image
import layout
from sources import mixpanel
from store import Store

NOW=datetime.fromisoformat('2026-11-13T08:00:00+11:00')
SNAPSHOT={'organization':'Example','checked_at':NOW.isoformat(),'period_start':'2026-11-01','period_end':'2026-12-01',
          'events':{'used':458293,'limit':1000000},'session_replay':{'used':15293,'limit':20000}}

class MixpanelTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'usage.json';self.history=Path(self.tmp.name)/'history.json'
        self.snapshot=json.loads(json.dumps(SNAPSHOT))
    def fetch(self):
        self.path.write_text(json.dumps(self.snapshot))
        return mixpanel.fetch(self.path,self.history)
    def test_counts_remaining_and_one_real_point_deduplicated(self):
        data=self.fetch()
        self.assertAlmostEqual(data['events']['remaining'],54.1707)
        self.assertAlmostEqual(data['session_replay']['remaining'],23.535)
        self.assertEqual(len(data['history']),1)
        self.assertEqual(data['history'][0]['checked_at'],NOW.isoformat())
        self.assertEqual(self.fetch(),data)
        self.assertEqual(self.history.stat().st_mode&0o777,0o600)
        self.snapshot['events']['used']=1200000
        data=self.fetch();self.assertEqual(data['events']['used'],1200000);self.assertEqual(data['events']['remaining'],0)
    def test_true_history_sorted_and_new_cycle_resets(self):
        self.fetch();self.snapshot['checked_at']='2026-11-12T08:00:00+11:00';data=self.fetch()
        self.assertEqual(len(data['history']),2)
        self.assertLess(data['history'][0]['checked_at'],data['history'][1]['checked_at'])
        self.snapshot.update(period_start='2026-12-01',period_end='2027-01-01',checked_at='2026-12-03T08:00:00+11:00')
        self.assertEqual(len(self.fetch()['history']),1)
    def test_invalid_and_missing_snapshots_raise_without_touching_history(self):
        self.fetch();before=self.history.read_bytes()
        for value in (-1,True,float('nan')):
            self.snapshot['events']['used']=value
            with self.assertRaises(ValueError):self.fetch()
        self.snapshot=json.loads(json.dumps(SNAPSHOT));self.snapshot['events']['limit']=0
        with self.assertRaises(ValueError):self.fetch()
        self.snapshot=json.loads(json.dumps(SNAPSHOT));self.snapshot['checked_at']='2026-11-13T08:00:00'
        with self.assertRaises(ValueError):self.fetch()
        self.assertEqual(self.history.read_bytes(),before)
        self.path.unlink()
        with self.assertRaises(OSError):mixpanel.fetch(self.path,self.history)
    def test_stale_expired_and_cache_failure(self):
        data=self.fetch();values=[]
        with patch.object(layout.Canvas,'text',lambda s,x,y,v,*a,**k:values.append(str(v))):
            layout.draw_mixpanel(layout.Canvas(),data,210,datetime.fromisoformat('2026-11-15T08:00:00+11:00'))
        self.assertTrue(any(v.startswith('STALE ') for v in values))
        values=[]
        with patch.object(layout.Canvas,'text',lambda s,x,y,v,*a,**k:values.append(str(v))):
            layout.draw_mixpanel(layout.Canvas(),data,210,datetime.fromisoformat('2026-12-01T00:00:00+11:00'))
        self.assertEqual(values.count('N/A'),2);self.assertEqual(values.count('PERIOD EXPIRED'),2)
        self.assertFalse(any('used' in v for v in values))
        store=Store(Path(self.tmp.name)/'cache');store.save('mixpanel',data,NOW.replace(tzinfo=None));self.path.unlink()
        store.refresh_due({'mixpanel':lambda:mixpanel.fetch(self.path,self.history)},datetime(2026,11,13,9))
        self.assertEqual(store.load('mixpanel'),data);self.assertIn('mixpanel',store.errors)
    def test_snapshot_staleness_boundary_is_three_hourly_checks(self):
        data=self.fetch()
        for seconds,expected in ((3*3600,False),(3*3600+1,True)):
            values=[]
            with patch.object(layout.Canvas,'text',lambda s,x,y,v,*a,**k:values.append(str(v))):
                layout.draw_mixpanel(layout.Canvas(),data,210,NOW+timedelta(seconds=seconds))
            self.assertEqual(any(v.startswith('STALE ') for v in values),expected)
    def test_customers_rail_staleness_follows_mixpanel_only(self):
        fresh=Image.open(io.BytesIO(layout.render_page({},None,NOW,set())))
        old_customers=Image.open(io.BytesIO(layout.render_page({},None,NOW,{'customers'})))
        old_mixpanel=Image.open(io.BytesIO(layout.render_page({},None,NOW,{'mixpanel'})))
        box=(0,210,40,686)
        self.assertEqual(fresh.crop(box).tobytes(),old_customers.crop(box).tobytes())
        self.assertNotEqual(fresh.crop(box).tobytes(),old_mixpanel.crop(box).tobytes())
    def test_bounds_diagonal_initial_point_and_right_unchanged(self):
        data=self.fetch();c=layout.Canvas();layout.draw_mixpanel(c,data,210,NOW)
        ink=Image.eval(c.image,lambda p:255-p).getbbox()
        self.assertGreaterEqual(ink[0],54);self.assertGreaterEqual(ink[1],232);self.assertLessEqual(ink[2],705);self.assertLessEqual(ink[3],664)
        y=232; x0=331;x1=680
        self.assertEqual(c.image.getpixel((x0,y+48)),0)
        self.assertEqual(c.image.getpixel((x0+8,y+48)),170)
        self.assertEqual(c.image.getpixel((x0+100,y+125)),0)
        point=data['history'][0];fraction=(NOW-datetime.fromisoformat('2026-11-01T00:00:00+11:00')).total_seconds()/(30*86400)
        x=round(x0+fraction*(x1-x0));py=round(y+122-point['events']*74/100)
        self.assertEqual(c.image.getpixel((x,py)),0)
        a=Image.open(io.BytesIO(layout.render_page({},None,NOW,set())))
        b=Image.open(io.BytesIO(layout.render_page({'mixpanel':data},None,NOW,set())))
        for box in ((705,0,1404,1872),(0,0,1404,210),(0,686,1404,1872)):
            self.assertEqual(a.crop(box).tobytes(),b.crop(box).tobytes())
