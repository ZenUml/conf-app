import diagrams from './corpus.js';
const v = new URLSearchParams(location.search).get('v') || 'new';
const mod = v === 'v4' ? await import('core-v4') : v === 'new' ? await import('core-new') : await import('core-old');
const ZenUml = mod.default ?? mod;
const root = document.getElementById('root');

// capture ANTLR error-listener output per diagram
const errs = {};
let current = null;
const origErr = console.error;
console.error = (...a) => { if (current) (errs[current] ??= []).push(a.map(String).join(' ').slice(0,140)); origErr(...a); };

const out = {};
for (const [key, code] of Object.entries(diagrams)) {
  current = key;
  const el = document.createElement('div');
  el.style.cssText = 'width:800px;height:600px';
  root.appendChild(el);
  try {
    const z = new ZenUml(el);
    await z.render(code, { theme: 'theme-default', stickyOffset: false });
    out[key] = { html: el.innerHTML, threw: null };
  } catch (e) {
    out[key] = { html: '', threw: String(e).slice(0, 160) };
  }
  el.remove();   // keep DOM small across 100 renders
}
current = null;
window.__dump = { out, errs };
document.title = 'DUMP_DONE';
