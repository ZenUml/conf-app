/** Browser-safe factory, also embedded verbatim in standalone exports.
 * Local fragment URLs, hrefs, ARIA IDREFs and unescaped CSS ID selectors are
 * supported. This is instance isolation, not an SVG sanitizer. */
export function createSvgInstanceRuntime() {
  const ns = 'http://www.w3.org/2000/svg';
  const slot = Symbol.for('pi.svg-instance'), counter = Symbol.for('pi.svg-instance-counter');
  const aria = new Set(['aria-labelledby','aria-describedby','aria-controls','aria-owns',
    'aria-flowto','aria-activedescendant','aria-details','aria-errormessage']);
  const elements = svg => [svg, ...svg.querySelectorAll('*')];
  function ids(svg) {
    const found = new Map();
    for (const el of elements(svg)) if (el.hasAttribute('id')) {
      if (!el.id || found.has(el.id)) throw Error(`SVG_DUPLICATE_ID:${el.id}`);
      found.set(el.id, el);
    }
    return found;
  }
  function fragment(value) {
    if (value.startsWith('#')) return value.slice(1);
    // Computed overlay styles can serialize same-document fragments absolutely.
    try {
      const target = new URL(value, document.URL), current = new URL(document.URL);
      if (target.hash && target.href.split('#')[0] === current.href.split('#')[0]) return target.hash.slice(1);
    } catch {}
    throw Error('SVG_EXTERNAL_REFERENCE_UNSUPPORTED');
  }
  function urls(text, change) {
    return text.replace(/url\s*\(\s*(["']?)([^)]*?)\1\s*\)/gi, (_, quote, value) => {
      const id = fragment(value.trim());
      if (!id || /[\s"'()\\]/.test(id)) throw Error('SVG_LOCAL_REFERENCE_UNSUPPORTED');
      return `url(${quote}#${change(id)}${quote})`;
    });
  }
  function animations(text, names) {
    return text.replace(/(^|[;{])(\s*animation(?:-name)?\s*:\s*)([^;}]*)/gi, (_, before, property, value) =>
      before + property + value.replace(/[A-Za-z_][\w-]*/g, token => names.get(token) || token));
  }
  function css(text, idMap, rootId, animationNames) {
    // Bounded grammar: flat style rules plus simple keyframe blocks. Escapes,
    // other at-rules and selectors requiring a full CSS parser fail explicitly.
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\\/.test(text)) throw Error('SVG_CSS_SYNTAX_UNSUPPORTED');
    const keyframes = [];
    text = text.replace(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, name, body) => {
      const mapped = animationNames.get(name);
      keyframes.push(`@keyframes ${mapped}{${urls(body, id => {
        if (!idMap.has(id)) throw Error(`SVG_DANGLING_REFERENCE:${id}`);
        return idMap.get(id);
      })}}`);
      return '';
    });
    if (/@|[{}]/.test(text.replace(/[^{}]*\{[^{}]*\}/g, ''))) throw Error('SVG_CSS_SYNTAX_UNSUPPORTED');
    if (/@/.test(text)) throw Error('SVG_CSS_SYNTAX_UNSUPPORTED');
    const rules = text.replace(/([^{}]+)\{([^{}]*)\}/g, (_, selector, body) => {
      if (/[()]|::|:(?:before|after|first-line|first-letter)\b/.test(selector) || [...selector.matchAll(/(["'])(.*?)\1/g)].some(hit => hit[2].includes(',')) ||
          [...selector.matchAll(/\[\s*([\w:-]+)\s*[*^$|~]?=/g)].some(hit => ['id','href','xlink:href'].includes(hit[1].toLowerCase()) || aria.has(hit[1].toLowerCase())))
        throw Error('SVG_CSS_SELECTOR_UNSUPPORTED');
      const rewritten = selector.replace(/("[^"]*"|'[^']*')|#([-\w\u0080-\uffff]+)/g,
        (token, quoted, id) => {
          if (quoted) return token;
          if (!/^(?:-?[A-Za-z_]|--)[\w-]*$/.test(id)) throw Error('SVG_CSS_SELECTOR_UNSUPPORTED');
          return idMap.has(id) ? `#${idMap.get(id)}` : token;
        });
      const scoped = rewritten.split(',').map(s => {
        s = s.trim();
        if (!s) throw Error('SVG_CSS_SYNTAX_UNSUPPORTED');
        return `${s}:where(#${rootId},#${rootId} *)`;
      }).join(',');
      body = urls(body, id => {
        if (!idMap.has(id)) throw Error(`SVG_DANGLING_REFERENCE:${id}`);
        return idMap.get(id);
      });
      body = animations(body, animationNames);
      return `${scoped}{${body}}`;
    });
    return rules + keyframes.join('');
  }
  function references(svg, visit) {
    for (const el of elements(svg)) {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) continue;
        if (attr.localName === 'href') visit(fragment(attr.value));
        else if (aria.has(attr.name)) for (const id of attr.value.trim().split(/\s+/).filter(Boolean)) visit(id);
        else if (/url\s*\(/i.test(attr.value)) urls(attr.value, id => { visit(id); return id; });
      }
      if (el.localName === 'style') urls(el.textContent, id => { visit(id); return id; });
    }
  }
  function validateSvgReferences(svg, {mounted = svg.isConnected} = {}) {
    if (svg.localName !== 'svg' || svg.namespaceURI !== ns) throw Error('SVG_ROOT_REQUIRED');
    const found = ids(svg);
    if (mounted) {
      const documentIds = new Map();
      for (const el of svg.ownerDocument.querySelectorAll('[id]')) {
        const list = documentIds.get(el.id) || []; list.push(el); documentIds.set(el.id, list);
      }
      for (const [id, el] of found) {
        const matches = documentIds.get(id) || [];
        if (matches.length !== 1 || matches[0] !== el) throw Error(`SVG_DOCUMENT_ID_COLLISION:${id}`);
      }
    }
    let referenceCount = 0;
    const visit = id => {
      const target = found.get(id);
      if (!target) {
        if (mounted && svg.ownerDocument.getElementById(id)) throw Error(`SVG_REFERENCE_WRONG_OWNER:${id}`);
        throw Error(`SVG_DANGLING_REFERENCE:${id}`);
      }
      if ((target === svg ? svg : target.ownerSVGElement) !== svg) throw Error(`SVG_REFERENCE_WRONG_OWNER:${id}`);
      if (mounted && svg.ownerDocument.getElementById(id) !== target) throw Error(`SVG_REFERENCE_WRONG_OWNER:${id}`);
      referenceCount++;
    };
    references(svg, visit);
    if (mounted) for (const el of elements(svg)) {
      const paint = svg.ownerDocument.defaultView.getComputedStyle(el);
      for (const name of ['marker-start','marker-mid','marker-end','fill','stroke','clip-path','mask-image','filter']) {
        const value = paint.getPropertyValue(name);
        if (/url\s*\(/i.test(value)) urls(value, id => {visit(id);return id});
      }
    }
    return {idCount:found.size, referenceCount};
  }
  function namespaceSvg(svg) {
    if (svg[slot]) { validateSvgReferences(svg); return svg[slot]; }
    validateSvgReferences(svg, {mounted:false});
    const found = ids(svg), sourceRootId = svg.id, doc = svg.ownerDocument;
    let prefix, idMap;
    do {
      doc[counter] = (doc[counter] || 0) + 1;
      prefix = `pi-svg-${doc[counter]}-`;
      idMap = new Map([...found.keys()].map((id, i) => [id, `${prefix}${i}`]));
    } while ([...idMap.values(), `${prefix}root`].some(id => doc.getElementById(id)));
    const rootId = idMap.get(sourceRootId) || `${prefix}root`;
    const animationNames = new Map();
    for (const style of svg.querySelectorAll('style')) for (const hit of style.textContent.matchAll(/@keyframes\s+([\w-]+)/g)) {
      if (/^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|infinite|normal|reverse|alternate|alternate-reverse|none|running|paused|forwards|backwards|both|initial|inherit|unset|revert|revert-layer|default|auto)$/i.test(hit[1]))
        throw Error('SVG_CSS_ANIMATION_NAME_UNSUPPORTED');
      animationNames.set(hit[1], `${rootId}-kf-${hit[1]}`);
    }
    const resolve = id => {
      if (!idMap.has(id)) throw Error(`SVG_DANGLING_REFERENCE:${id}`);
      return idMap.get(id);
    };
    // Prepare every rewrite before mutating this instance.
    const attrs = [], styles = [];
    for (const el of elements(svg)) {
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-')) continue;
        if (attr.name === 'id') attrs.push([el, attr, resolve(attr.value)]);
        else if (attr.localName === 'href') attrs.push([el, attr, `#${resolve(fragment(attr.value))}`]);
        else if (aria.has(attr.name)) attrs.push([el, attr, attr.value.trim().split(/\s+/).filter(Boolean).map(resolve).join(' ')]);
        else if (attr.name === 'style') attrs.push([el, attr, animations(urls(attr.value, resolve), animationNames)]);
        else if (/url\s*\(/i.test(attr.value)) attrs.push([el, attr, urls(attr.value, resolve)]);
        if (attr.name === 'style' && /\\/.test(attr.value)) throw Error('SVG_CSS_SYNTAX_UNSUPPORTED');
      }
      if (el.localName === 'style') styles.push([el, css(el.textContent, idMap, rootId, animationNames)]);
    }
    for (const [el, attr, value] of attrs) el.setAttributeNS(attr.namespaceURI, attr.name, value);
    for (const [el, text] of styles) el.textContent = text;
    svg.id = rootId;
    const instance = {svg, idMap, sourceRootId};
    validateSvgReferences(svg);
    svg[slot] = instance;
    return instance;
  }
  function mountSvg(host, source, {afterMount} = {}) {
    if (!host?.ownerDocument || typeof source !== 'string') throw Error('SVG_MOUNT_ARGUMENT_INVALID');
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw Error('SVG_XML_INVALID');
    const svg = host.ownerDocument.importNode(parsed.documentElement, true);
    const instance = namespaceSvg(svg);
    host.append(svg);
    try {
      afterMount?.(svg, instance);
      validateSvgReferences(svg, {mounted:true});
      return instance;
    } catch (error) { svg.remove(); throw error; }
  }
  return {mountSvg, namespaceSvg, validateSvgReferences};
}

/** Early static-export check. XML syntax/security are checked by its caller;
 * DOM ownership and final paint references are checked again during mounting. */
export function validateSvgReferenceText(svg) {
  const decode = s => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) => v[0] === '#'
    ? String.fromCodePoint(parseInt(v.slice(v[1].toLowerCase() === 'x' ? 2 : 1), v[1].toLowerCase() === 'x' ? 16 : 10))
    : ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v.toLowerCase()]));
  const clean = svg.replace(/<!--[\s\S]*?-->/g, ''), ids = new Set(), refs = [];
  for (const tag of clean.match(/<[\w:-]+\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g) || []) {
    for (const attr of tag.matchAll(/\s([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
      if (attr[1].startsWith('data-')) continue;
      const value = decode(attr[3]);
      if (attr[1] === 'id') { if (!value || ids.has(value)) throw Error(`SVG_DUPLICATE_ID:${value}`); ids.add(value); }
      else if (/^aria-(?:labelledby|describedby|controls|owns|flowto|activedescendant|details|errormessage)$/.test(attr[1])) refs.push(...value.trim().split(/\s+/).filter(Boolean));
      for (const hit of value.matchAll(/url\s*\(\s*["']?#([^\s"')]+)["']?\s*\)/gi)) refs.push(hit[1]);
    }
  }
  for (const style of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g))
    for (const hit of decode(style[1]).matchAll(/url\s*\(\s*["']?#([^\s"')]+)["']?\s*\)/gi)) refs.push(hit[1]);
  for (const id of refs) if (!ids.has(id)) throw Error(`SVG_DANGLING_REFERENCE:${id}`);
}
