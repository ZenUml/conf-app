import diagrams from './corpus.js';

const params = new URLSearchParams(location.search);
const version = params.get('v') || 'old';
const mode = params.get('mode') || 'serial';   // serial | concurrent
const n = Number(params.get('n') || 16);

const mod = version === 'v4' ? await import('core-v4')
  : version === 'new' ? await import('core-new')
  : await import('core-old');
const ZenUml = mod.default ?? mod.ZenUml ?? mod;

const codes = Object.values(diagrams).slice(0, n);
const root = document.getElementById('root');

function makeHost() {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px;height:600px;overflow:hidden';
  root.appendChild(el);
  return el;
}

async function renderOne(code) {
  const el = makeHost();
  const z = new ZenUml(el);
  const t0 = performance.now();
  await z.render(code, { theme: 'theme-default', stickyOffset: false });
  return performance.now() - t0;
}

const wall0 = performance.now();
let per = [];
if (mode === 'serial') {
  for (const c of codes) per.push(await renderOne(c));
} else {
  // all N at once — mirrors N Forge iframes mounting simultaneously
  per = await Promise.all(codes.map(renderOne));
}
const wall = performance.now() - wall0;

window.__bench = {
  version, mode, n,
  wall_ms: Math.round(wall),
  per_ms: per.map(x => Math.round(x)),
  median_ms: Math.round([...per].sort((a,b)=>a-b)[Math.floor(per.length/2)]),
  max_ms: Math.round(Math.max(...per)),
  coreVersion: ZenUml.version ?? mod.version ?? 'unknown',
};
document.title = 'BENCH_DONE';
