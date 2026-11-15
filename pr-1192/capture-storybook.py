import subprocess,json,pathlib
out=pathlib.Path('/tmp/spot-check/conf-app/issue-19')
def ab(*args):
 r=subprocess.run(['/usr/local/bin/agent-browser','--session','issue19-ui',*args],text=True,capture_output=True)
 if r.returncode: raise RuntimeError(r.stdout+r.stderr)
 return r.stdout
checks={
'default':('button[aria-label="Unlock this space: ENG"]','document.querySelectorAll(".space-purchase button").length===1'),
'space-purchases':('button[aria-label="Unlock this space: ~abc123"]','document.querySelectorAll(".space-purchase button").length===3 && [...document.querySelectorAll(".license-state")].filter(x=>x.textContent.includes("Covered")).length===2 && document.querySelector(".space-table").innerText.includes("100 / 100")'),
'paid-status-unavailable':('.license-state','document.querySelector(".license-state").textContent.includes("unavailable") && document.querySelectorAll(".space-purchase button").length===0'),
'paid-status-pending':('.license-state','document.querySelector(".license-state").textContent.includes("Checking") && document.querySelectorAll(".space-purchase button").length===0'),
'no-spaces-over-limit':('.upgrade-block','!document.querySelector(".space-table") && document.querySelector(".plan-usage").innerText.includes("No spaces are currently")'),
'fullscreen-ordinary-space':('button[aria-label="Unlock this space: ENG"]','!!document.querySelector("[data-testid=plan-usage-fullscreen-context]") && document.querySelectorAll(".space-purchase button").length===1'),
}
results=[]
for story,(ready,assertion) in checks.items():
 ab('frame','main');ab('open','http://localhost:6009/?path=/story/plan-and-usage-planusage--'+story);ab('frame','#storybook-preview-iframe');ab('wait',ready)
 raw=ab('eval','(()=>{if(!('+assertion+'))throw new Error("visual DOM assertion failed");return {pass:true,story:'+json.dumps(story)+',rowHeights:[...document.querySelectorAll(".space-table tbody tr")].map(r=>r.getBoundingClientRect().height)}})()')
 results.append(json.loads(raw));(out/('final-'+story+'.txt')).write_text(ab('snapshot','-c','-d','7'));ab('screenshot',str(out/('final-'+story+'.png')))
print(json.dumps(results))
(out/'storybook-results.json').write_text(json.dumps({'candidate':'a87551e9','source':'http://localhost:6009 / isolated worktree','viewport':'1280x1000','results':results},indent=2))
