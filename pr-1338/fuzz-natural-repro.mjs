import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('@playwright/test');
const MERMAID = process.cwd() + '/node_modules/mermaid/dist/mermaid.min.js';
const N = Number(process.argv[2] || 400);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ path: MERMAID });
const res = await page.evaluate(async (N) => {
  mermaid.initialize({ startOnLoad: false });
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const shapes = [['[',']'],['(',')'],['{','}'],['{{','}}'],['[/','/]'],['[\\','\\]'],['[/','\\]'],['>',']'],['((','))'],['([','])']];
  const words = ['Xử lý','Kiểm tra dữ liệu','Đăng nhập','OK','Người dùng xác thực mật khẩu','A','Lỗi?','Gửi yêu cầu tới máy chủ xác thực'];
  const arrows = ['-->','---','-.->','==>','<-->','--o','--x'];
  const orig = window.btoa; let hit = null;
  window.btoa = (s) => { if (!hit && /"(label|id|domId|shape)"/.test(s)) hit = s.slice(0, 220); return orig(s); };
  const found = [];
  for (let i = 0; i < N; i++) {
    const n = 3 + Math.floor(rnd() * 7);
    const lines = [`flowchart ${pick(['TD','LR','BT','RL'])}`];
    for (let k = 0; k < n; k++) { const [o,c] = pick(shapes); lines.push(`  N${k}${o}${pick(words)}${c}`); }
    const e = n + Math.floor(rnd() * n * 1.5);
    for (let k = 0; k < e; k++) { const a = Math.floor(rnd()*n), b = Math.floor(rnd()*n); lines.push(`  N${a} ${pick(arrows)}${rnd()<0.4 ? '|' + pick(words) + '|' : ''} N${b}`); }
    if (rnd() < 0.4) { lines.push('  subgraph G[Nhóm]'); lines.push(`    N0`); lines.push(`    N1`); lines.push('  end'); lines.push(`  G --> N${n-1}`); }
    const code = lines.join('\n');
    hit = null; let err = null;
    try { await mermaid.render('r' + i, code); } catch (x) { err = String(x.message || x).slice(0, 90); }
    if (hit || (err && /btoa|Latin1/.test(err))) found.push({ i, err, hit, code });
    if (found.length >= 3) break;
  }
  return found;
}, N);
console.log(`found=${res.length}`);
for (const f of res) console.log(JSON.stringify(f));
await browser.close();
