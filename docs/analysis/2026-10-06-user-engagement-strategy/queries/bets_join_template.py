# Offline join for bets_*.js outputs (raw outputs live in the session scratchpad, never in the repo; they hold account ids).
import json,collections
SP="/private/tmp/claude-501/-Users-pengxiao-workspaces-zenuml-conf-app--claude-worktrees-user-engagement-strategy-214961/dd63448d-e89b-460c-85c4-7aae38091ad7/scratchpad"
d=json.load(open(SP+"/out/bets_template_journey.json"))
J=collections.defaultdict(collections.Counter); orphan=collections.Counter(); T=collections.Counter(); Ts=collections.Counter()
for r in d:
    pt,w,text,gal,app,tid,out=r['key']; n=r['value']
    if out=='orphan_success': orphan[(pt,w)]+=n; continue
    k=(pt,w); s=n*(out=='success')
    J[k]['journeys']+=n; J[k]['succ']+=s
    if text=='text':
        J[k]['text_j']+=n; J[k]['text_succ']+=s
        sub='T' if str(app)=='1' else 'N'
        J[k][sub+'_j']+=n; J[k][sub+'_s']+=s
        J[k]['g_'+gal+'_j']+=n; J[k]['g_'+gal+'_s']+=s
        J[k]['g_'+gal+'_'+sub+'_j']+=n; J[k]['g_'+gal+'_'+sub+'_s']+=s
    if str(app)=='1': T[(pt,w,tid)]+=n; Ts[(pt,w,tid)]+=s
for k in sorted(J):
    if k[1]=='pre' or k[0] in ('asyncapi','diagramly'): continue
    v=J[k]; print(k,'journeys',v['journeys'],'succ',v['succ'],'text',v['text_j'],v['text_succ'],'orphan_succ',orphan[k], 'share_succ_with_template', f"{v['T_s']}/{v['succ']+orphan[k]}={v['T_s']/(v['succ']+orphan[k]):.1%}")
    for key in sorted(x[:-2] for x in v if x.endswith('_j') and (x.startswith('g_') or x in('T_j','N_j'))):
        j=v[key+'_j']; s=v[key+'_s']; print('   ',key,j,s,f"{s/j:.1%}")
print()
agg=collections.Counter(); aggs=collections.Counter()
for k in T:
    if k[1]=='cur': agg[(k[0],k[2])]+=T[k]; aggs[(k[0],k[2])]+=Ts[k]
for k,v in sorted(agg.items(), key=lambda x:-x[1]): print(k,v,aggs[k])
