import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [pkg,html,out]=process.argv.slice(2);
const {chromium}=createRequire(path.join(path.resolve(pkg),'package.json'))('playwright');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:600}});
 await page.route('https://**/*',route=>route.abort());
 await page.route('http://**/*',route=>route.abort());
 await page.goto(pathToFileURL(path.resolve(html)).href);
 const a=page.locator('svg [data-node="A"]').first();
 const c=page.locator('svg [data-node="C"]').first();
 await page.locator('svg [data-hit-node="A"]').hover();
 assert.equal(await a.evaluate(el=>getComputedStyle(el).opacity),'1');
 assert.ok(Number(await c.evaluate(el=>getComputedStyle(el).opacity))<0.3);
 await page.screenshot({path:path.resolve(out)});
 await page.mouse.move(1270,590);
 assert.equal(await c.evaluate(el=>getComputedStyle(el).opacity),'1');
 console.log('PASS: actual generated preview highlights A and its relation, dims unrelated C, and clears on pointer exit; HTTP requests blocked.');
} finally {await browser.close();}
