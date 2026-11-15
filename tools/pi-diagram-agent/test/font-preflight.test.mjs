import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPortableFontMetrics} from '../cli.mjs';

test('doctor refuses incompatible measured fallback fonts with an actionable dependency error',async()=>{
  const page={evaluate:async()=>[{text:'WWWWWW',size:28,width:999}]};
  await assert.rejects(assertPortableFontMetrics(page),/Arial-compatible font.*Liberation Sans.*Playwright/s);
});
test('font preflight accepts bounds already verified by the browser',async()=>{
  await assertPortableFontMetrics({evaluate:async()=>[{text:'AAAAAA',size:12,width:40}]});
});
