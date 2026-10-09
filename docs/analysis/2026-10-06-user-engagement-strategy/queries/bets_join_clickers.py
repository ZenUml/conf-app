# Offline join for bets_*.js outputs (raw outputs live in the session scratchpad, never in the repo; they hold account ids).
import json,datetime,collections
SP="/private/tmp/claude-501/-Users-pengxiao-workspaces-zenuml-conf-app--claude-worktrees-user-engagement-strategy-214961/dd63448d-e89b-460c-85c4-7aae38091ad7/scratchpad"
ts=lambda s: int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
CUR=ts("2026-09-06"); PRI=ts("2026-08-07"); END=ts("2026-10-06"); ROLL=ts("2026-08-23T01:24:43")
win=lambda t: "cur" if t>=CUR else ("prior" if t>=PRI else "pre")
auth={r['key'][0]:r['value'] for r in json.load(open(SP+"/out/bets_authors_first_success.json"))}
rows=json.load(open(SP+"/out/bets_surface_clickers.json"))
M30=30*60*1000
def gate(click_name, label, extra_filter=None):
    res=collections.defaultdict(lambda: collections.Counter())
    for r in rows:
        uid=r['key'][0]; v=r['value']; t=v['t']; clicks=t.get(click_name,[])
        if not clicks: continue
        pts=",".join(sorted(v['pt']))
        creates=sorted(t.get('macro_create_succeeded',[]))
        fc=auth.get(uid,{}).get('fc'); fa=auth.get(uid,{}).get('fa')
        for W in ('cur','prior'):
            cw=[c for c in clicks if win(c)==W]
            if not cw: continue
            key=(W,pts); res[key]['clickers']+=1; res[key]['clicks']+=len(cw)
            if any(any(0<=cr-c<=M30 for cr in creates) for c in cw): res[key]['any_create_30m']+=1
            if fc is not None and any(0<=fc-c<=M30 for c in cw): res[key]['first_ever_create_30m']+=1
            if fa is not None and any(0<=fa-c<=M30 for c in cw): res[key]['first_ever_authoring_30m']+=1
            # clicker had no create/save before first click in window
            if fa is None or fa>min(cw): res[key]['never_authored_before_click']+=1
            if W=='prior':
                post=[c for c in cw if c>=ROLL]
                if post:
                    res[('prior_post_rollout',pts)]['clickers']+=1
                    if fc is not None and any(0<=fc-c<=M30 for c in post): res[('prior_post_rollout',pts)]['first_ever_create_30m']+=1
                    if any(any(0<=cr-c<=M30 for cr in creates) for c in post): res[('prior_post_rollout',pts)]['any_create_30m']+=1
    print("==",label)
    for k in sorted(res): print(k, dict(res[k]))
gate('byline_create_clicked','T1 byline create click -> create within 30m')
gate('homepage_feed_action_clicked','T2 homepage action click -> create within 30m')
gate('homepage_feed_diagram_opened','T2 homepage diagram opened -> create within 30m')
# homepage viewers: first create within 30 min after view
gate('homepage_feed_viewed','T2 homepage viewed -> create within 30m')
gate('byline_opened','T1 byline opened -> create within 30m')
# byline_diagram_created users
c=collections.Counter()
for r in rows:
    t=r['value']['t']
    for W in ('cur','prior'):
        if any(win(x)==W for x in t.get('byline_diagram_created',[])): c[W]+=1
print("byline_diagram_created users",c)
