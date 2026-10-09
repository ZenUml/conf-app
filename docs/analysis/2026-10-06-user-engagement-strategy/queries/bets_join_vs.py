# Offline join for bets_*.js outputs (raw outputs live in the session scratchpad, never in the repo; they hold account ids).
import json,collections
SP="/private/tmp/claude-501/-Users-pengxiao-workspaces-zenuml-conf-app--claude-worktrees-user-engagement-strategy-214961/dd63448d-e89b-460c-85c4-7aae38091ad7/scratchpad"
auth={r['key'][0]:r['value'] for r in json.load(open(SP+"/out/bets_authors_first_success.json"))}
rows=json.load(open(SP+"/out/bets_view_source_14d.json"))
D14=14*86400*1000
C=collections.defaultdict(collections.Counter)
for uid,pt,v,nv,o,no,c in rows:
    pt=pt or 'none(opener_only)'
    grp='opener' if o is not None else 'non_opener'
    anchor=o if o is not None else v
    a=auth.get(uid,{}); fc=a.get('fc'); fa=a.get('fa')
    prior = fa is not None and fa < anchor
    seg='prior_author' if prior else 'never_author'
    k=(pt,grp,seg)
    C[k]['users']+=1; C[k]['views']+=nv; C[k]['opens']+=no; C[k]['copiers']+= (c>0)
    if fc is not None and anchor <= fc <= anchor+D14: C[k]['first_create_14d']+=1
    if fa is not None and anchor <= fa <= anchor+D14: C[k]['first_authoring_14d']+=1
for k in sorted(C):
    v=C[k]; u=v['users']
    print(k, dict(v), f"fc14={v['first_create_14d']/u:.2%}" )
