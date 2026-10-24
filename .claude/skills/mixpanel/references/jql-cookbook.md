# Mixpanel JQL cookbook (conf-app)

Read this when actually writing a JQL query. For the project ID, event names, the rename, and the exclude list, see the parent `SKILL.md` — this file assumes you already have them.

## Auth & runner

`scripts/mp_query.py` handles auth and retries. It reads `API_Secret` from `.env.mixpanel` in **cwd first**, then the conf-app root, then `~/workspaces/zenuml/conf-app/.env.mixpanel`. So:

- conf-app analytics → run from the conf-app root.
- Another app's project (e.g. AsyncAPI) → run from that project's dir (so its own `.env.mixpanel` is picked up), pointing at the script by absolute path `~/workspaces/zenuml/conf-app/.claude/skills/mixpanel/scripts/mp_query.py`.

```bash
# from the conf-app repo root (so .env.mixpanel resolves):
python3 .claude/skills/mixpanel/scripts/mp_query.py --file /tmp/query.js          # to stdout
python3 .claude/skills/mixpanel/scripts/mp_query.py --file /tmp/query.js -o out.json
```

Manual auth, if you ever hand-roll it: `Authorization: Basic base64("{API_Secret}:")`, POST `script=<urlencoded JQL>` to `https://mixpanel.com/api/2.0/jql`. Never print the secret.

## Rate limits

- Wait **10–15 s** between requests (`mp_query.py --pace`, default 10).
- On `429`, back off `90 * (attempt + 1)` s (the runner does this for you, 5 retries).
- **Chunk multi-month ranges into ≤3-month windows** to avoid timeouts.
- Don't fire more than ~10 queries in quick succession.

## Patterns (current event names + canonical exclude)

Internal/staging exclusion in JQL is a `contains` check. Before running the example, append the customer-specific entries from [`private/operations/internal-analytics-domain-exclusions.md`](../../../../private/operations/internal-analytics-domain-exclusions.md); tenant identifiers belong only in that private reference. The public baseline is:

```javascript
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) {
  if (!d) return true;                       // drop blank client_domain too
  for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true;
  return false;
}
```

### Creates + edits by month, domain, type
```javascript
function main() {
  return Events({
    from_date: '2026-05-01',
    to_date: '2026-06-17',
    // window ≤ April 2026 must ALSO include {event:'create_macro_end'},{event:'edit_macro_end'}
    event_selectors: [
      {event: 'macro_create_succeeded'},
      {event: 'macro_save_succeeded'}
    ]
  })
  .filter(function(e) { return !isInternal(e.properties.client_domain); })
  .groupBy([
    function(e) { return new Date(e.time).toISOString().substring(0, 7); },
    'name',
    'properties.client_domain',
    'properties.macro_type'
  ], mixpanel.reducer.count());
}
```

### Unique domains rendering macros (a week)
```javascript
function main() {
  return Events({
    from_date: '2026-06-08',
    to_date: '2026-06-14',
    event_selectors: [{event: 'macro_viewed'}]   // pre-May: use {event:'view_macro'}
  })
  .filter(function(e) { return !isInternal(e.properties.client_domain); })
  .groupBy(['properties.client_domain'], mixpanel.reducer.count());
}
```

### Crossing the April-2026 rename boundary
Include both old and new names; both only carry data in April 2026, so double-counting outside it is impossible:
```javascript
event_selectors: [
  {event: 'macro_viewed'}, {event: 'view_macro'},
  {event: 'macro_create_succeeded'}, {event: 'create_macro_end'},
  {event: 'macro_save_succeeded'}, {event: 'edit_macro_end'}
]
```

## Result shape

JQL returns an array; each `key` array matches the `groupBy` fields in order, `value` is the reducer output:
```json
[{"key": ["2026-06", "macro_create_succeeded", "example-tenant", "mermaid"], "value": 45}]
```

## Gotchas specific to JQL

- `is_internal_client_domain` (the computed property) is **not** available in raw JQL — it only exists in Run-Query/Insights. Use the `contains` list above in JQL.
- `isForge`/`isLite` are dead here too — don't `groupBy` or filter on them (you'll get one all-`false` bucket).
- `e.time` is epoch ms; `new Date(e.time)` works. `e.name` is the event name.
