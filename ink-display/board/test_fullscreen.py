import io
import json
from datetime import datetime,timedelta
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
import layout
from sources import fullscreen
from store import Store
NOW=datetime.fromisoformat('2026-11-13T08:00:00+11:00')
UUID='00000000-0000-4000-8000-000000000001'
def raw(i=1,state='delivered',expiry='2026-11-18T00:00:00Z'):
    return dict(id=f'{i:08x}-0000',spaceKey='DEMO',createdAt='2026-11-11T00:00:00Z',activatedAt='2026-11-11T00:00:00Z',expiresAt=expiry,mailState=state,replySentAt='2026-11-12T20:39:00Z',mailEventAt='2026-11-12T20:42:00Z',supportOutcome=None)
class FullscreenTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.config=Path(self.tmp.name)/'config.json'
        self.config.write_text(json.dumps({'site':'DEMO','cloud_id':UUID}))
    def fetch(self,rows,now=NOW):
        queries=[]
        result=fullscreen.fetch(lambda sql:queries.append(sql) or rows,self.config,now)
        self.assertEqual(len(queries),1);self.assertIn(f"WHERE r.cloudId='{UUID}'",queries[0])
        self.assertNotIn('encrypted',queries[0].lower());return result
    def test_mail_states_do_not_infer_read_or_customer_reply(self):
        data=self.fetch([raw(i,s) for i,s in enumerate(('delivered','accepted','bounced','failed',None,'draft','delivery_unknown'))])
        self.assertEqual([r['mail'] for r in data['rows']],['Reply delivered','Reply sent (unconfirmed)','REPLY BOUNCED','REPLY FAILED','Reply not recorded','Reply draft (not sent)','Reply state: delivery_unknown'])
        self.assertEqual(data['outcomes_recorded'],0);self.assertEqual(data['checked_at'],NOW.isoformat())
        self.assertEqual(data['rows'][0]['mail_at'],'13 Nov 07:42')
    def test_expiry_boundary_pending_unknown_and_empty(self):
        item=raw(expiry=NOW.isoformat())
        self.assertEqual(self.fetch([item])['expired'],1)
        self.assertEqual(self.fetch([item],NOW-timedelta(seconds=1))['active'],1)
        item['activatedAt']=None
        self.assertEqual(self.fetch([item],NOW-timedelta(seconds=1))['rows'][0]['grant'],'PENDING')
        item['activatedAt'],item['expiresAt']=NOW.isoformat(),None
        self.assertEqual(self.fetch([item])['rows'][0]['grant'],'UNKNOWN')
        self.assertEqual(self.fetch([])['rows'],[])
    def test_invalid_config_missing_file_and_d1_error_keep_last_cache(self):
        prior=self.fetch([raw()]);store=Store(Path(self.tmp.name)/'cache');naive=NOW.replace(tzinfo=None)
        store.save('fullscreen',prior,naive)
        self.config.write_text(json.dumps({'site':'DEMO','cloud_id':"bad'; DROP TABLE x"}))
        store.refresh_due({'fullscreen':lambda:fullscreen.fetch(lambda sql:self.fail('invalid SQL'),self.config)},naive+timedelta(seconds=1000))
        self.assertEqual(store.load('fullscreen'),prior);self.assertTrue(store.stale('fullscreen',naive+timedelta(seconds=1000)))
        self.config.write_text(json.dumps({'site':'DEMO','cloud_id':UUID}))
        with self.assertRaises(RuntimeError):
            fullscreen.fetch(lambda sql:(_ for _ in ()).throw(RuntimeError('D1 down')),self.config,NOW)
        self.config.unlink()
        with self.assertRaises(OSError):fullscreen.fetch(config_file=self.config)
    def test_four_rows_bounded_and_other_regions_unchanged(self):
        data=self.fetch([raw(1,expiry='2026-11-06T00:00:00Z'),raw(2),raw(3),raw(4,'bounced')])
        credit={'status':'PENDING','requested_amount':'$10,000','checked_at':NOW.isoformat()}
        c=layout.Canvas();layout.draw_credits(c,credit,210);aws=c.image.copy();layout.draw_fullscreen(c,data,210)
        self.assertEqual(aws.crop((728,232,1348,365)).tobytes(),c.image.crop((728,232,1348,365)).tobytes())
        ink=Image.eval(c.image,lambda p:255-p).getbbox()
        self.assertGreaterEqual(ink[0],728);self.assertGreaterEqual(ink[1],232);self.assertLessEqual(ink[2],1348);self.assertLessEqual(ink[3],664)
        texts=[]
        with patch.object(layout.Canvas,'text',lambda s,x,y,v,*a,**k:texts.append(str(v))):layout.draw_fullscreen(c,data,210)
        self.assertEqual(sum(t.startswith('11 Nov DEMO ') for t in texts),4)
        self.assertIn('REPLY BOUNCED · 13 Nov 07:42',texts)
        a=Image.open(io.BytesIO(layout.render_page({'credits':credit},None,NOW,set())))
        b=Image.open(io.BytesIO(layout.render_page({'credits':credit,'fullscreen':data},None,NOW,set())))
        for box in ((0,0,728,1872),(728,686,1404,1872),(728,0,1404,232)):
            self.assertEqual(a.crop(box).tobytes(),b.crop(box).tobytes())
