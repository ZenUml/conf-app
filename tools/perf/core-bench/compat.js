import cases from './cases.json';
const v = new URLSearchParams(location.search).get('v') || 'new';
const mod = v === 'v4' ? await import('core-v4') : v === 'new' ? await import('core-new') : await import('core-old');
const ZenUml = mod.default ?? mod;
const root = document.getElementById('root');
const out = {};
for (const [name, code] of Object.entries(cases)) {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px;height:400px';
  root.appendChild(el);
  try {
    const z = new ZenUml(el);
    await z.render(code, { theme: 'theme-default', stickyOffset: false });
    const html = el.innerHTML;
    // a real render produces participant/message nodes; an error state doesn't
    out[name] = { ok: true, chars: html.length, hasSvgOrDom: /svg|participant|message/i.test(html) };
  } catch (e) {
    out[name] = { ok: false, error: String(e).slice(0, 120) };
  }
}
window.__compat = out;
document.title = 'COMPAT_DONE';
