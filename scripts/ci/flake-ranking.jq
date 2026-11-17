def severity: if .status == "unexpected" then 2 elif .status == "flaky" then 1 else 0 end;
def escape: tostring | gsub("\\|"; "\\|") | gsub("[\r\n]"; " ");
map(select(.status != "skipped"))
| group_by([.run, .suite, .project, .file, .title])
| map(max_by(severity))
| group_by([.suite, .project, .file, .title])
| map({suite: .[0].suite, project: .[0].project, name: (.[0].file + " › " + .[0].title),
       runs: length, flaky: (map(select(.status == "flaky")) | length),
       failed: (map(select(.status == "unexpected")) | length),
       last_flaky_run: (map(select(.status != "expected") | .run) | sort | last)})
| map(select(.flaky + .failed > 0))
| sort_by(-(.flaky + .failed))
| (["| suite | project | test | runs | passed on retry | failed | last non-green run |", "|---|---|---|---|---|---|---|"]
   + map("| \(.suite | escape) | \(.project | escape) | \(.name | escape) | \(.runs) | \(.flaky) | \(.failed) | \(.last_flaky_run | escape) |"))
| .[]
