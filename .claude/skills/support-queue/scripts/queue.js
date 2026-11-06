// ZEN service-desk queue reader.
//
// Paste into Playwright MCP `browser_evaluate` AFTER navigating to any
// zenuml.atlassian.net page in the support@zenuml.com browser session. Uses the
// page's own cookies — no API token. There is no headless path: the only agent
// credential for this desk (JSM_API_TOKEN) exists solely as a GitHub Actions
// secret, and the owner's personal Atlassian token gets 403 on ZEN requests
// (valid creds, per-desk permission gap — /rest/api/3/myself still returns 200).
//
// Returns: { generatedAt, counts, tickets: [...] }
// Each ticket: { key, created, updated, status, summary, plan, reporter,
//                kind: 'extension' | 'other',
//                ctx: { clientDomain, spaceKey, macroCount, macrosLimit,
//                       userAccountId, pageId, macroType, product, appVersion } | null,
//                lastComment: { author, at, jsdPublic } | null,
//                signalA, signalB }
//
// signalA = customer commented last -> we owe a reply.
// signalB = our own internal note (jsdPublic false) is last -> we recorded
//           something and never answered the customer.
// signalC (grant expiry) is NOT computed here — it needs Cloudflare KV, which the
// browser cannot read. The SKILL.md joins it from a wrangler call.
//
// Two API traps this file already works around:
//  1. /rest/api/2/search?jql= returns an empty issues[] SILENTLY on this site.
//     Only /rest/api/3/search/jql works.
//  2. The comment endpoint ignores orderBy=-created and always returns ascending
//     order, so a small maxResults yields the FIRST comments, not the last.
//     Fetch the whole list, then take the tail.

(async () => {
  const AGENTS = ['Peng Xiao']; // our side; anyone else commenting is the customer

  const api = async (path) => {
    const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } });
    return { http: r.status, body: await r.json() };
  };

  // statusCategory != Done, not `resolution = Unresolved`: two tickets carry
  // status "Resolved" with an empty resolution field and would otherwise be
  // reported as open (cause not established — treat as a data-hygiene note).
  const search = await api(
    '/rest/api/3/search/jql?' +
      new URLSearchParams({
        jql: 'project = ZEN AND statusCategory != Done ORDER BY created ASC',
        fields: 'summary,created,updated,status,reporter,customfield_10070,description',
        maxResults: '100',
      })
  );
  if (search.http !== 200) return { err: 'search failed', http: search.http, body: search.body };

  // ADF -> plain text. Paragraph boundaries must become newlines or the
  // "Client domain: x" lines run together and the parse below fails.
  const flatten = (n) =>
    !n ? '' : (n.text || '') + (n.content ? n.content.map(flatten).join(n.type === 'paragraph' ? '\n' : '') : '');

  const parseCtx = (text) => {
    const get = (label) => {
      const m = text.match(new RegExp('^' + label + ':\\s*(.+)$', 'm'));
      return m ? m[1].trim() : null;
    };
    const clientDomain = get('Client domain');
    const spaceKey = get('Space key');
    // Field presence is the classifier, NOT the summary wording: a paywall
    // lockout filed as a plain bug report ("we have not changed our
    // configuration") carries neither field and must fall through to 'other'
    // rather than be silently dropped.
    if (!clientDomain || !spaceKey) return null;
    return {
      clientDomain,
      spaceKey,
      macroCount: Number(get('Macro count')) || null,
      macrosLimit: Number(get('Limit')) || null,
      userAccountId: get('User account ID'),
      pageId: get('Page ID'),
      macroType: get('Macro type'),
      product: get('Product'),
      appVersion: get('App version'),
    };
  };

  const tickets = [];
  for (const i of search.body.issues || []) {
    const f = i.fields;
    const descText = flatten(f.description);
    const ctx = parseCtx(descText);

    const c = await api(`/rest/api/3/issue/${i.key}/comment?maxResults=100`);
    const list = (c.body && c.body.comments) || [];
    const last = list.length ? list[list.length - 1] : null;
    const lastComment = last
      ? { author: last.author.displayName, at: last.created.slice(0, 10), jsdPublic: last.jsdPublic === true }
      : null;

    const weAreLast = lastComment ? AGENTS.includes(lastComment.author) : false;

    tickets.push({
      key: i.key,
      created: f.created.slice(0, 10),
      updated: f.updated.slice(0, 10),
      status: f.status.name,
      summary: f.summary,
      plan: (f.customfield_10070 && f.customfield_10070.value) || null,
      reporter: (f.reporter && f.reporter.displayName) || null,
      kind: ctx ? 'extension' : 'other',
      ctx,
      lastComment,
      signalA: lastComment ? !weAreLast : false,
      signalB: Boolean(lastComment && weAreLast && !lastComment.jsdPublic),
    });
  }

  const counts = {
    open: tickets.length,
    extension: tickets.filter((t) => t.kind === 'extension').length,
    other: tickets.filter((t) => t.kind === 'other').length,
    signalA: tickets.filter((t) => t.signalA).length,
    signalB: tickets.filter((t) => t.signalB).length,
    noComments: tickets.filter((t) => !t.lastComment).length,
  };

  return { generatedAt: new Date().toISOString(), counts, tickets };
})();
