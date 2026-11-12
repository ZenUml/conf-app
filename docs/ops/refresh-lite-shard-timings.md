# Refresh Lite E2E shard timings

The Lite planner uses advisory per-project, per-file median test durations from
`scripts/test-selection/lite-shard-durations.mjs`. Refresh them when the Lite
suite or its timing distribution changes. Unknown tests use the 40-second
fallback. The estimates change scheduling only, not test selection or serial
file groups.

Choose at least two recent successful **full Lite PR E2E validation** runs.
Check each run's conclusion and compare their concrete plans before using
them. Keep another full run out of the input as a holdout for evaluating the
result. Artifacts can expire; use runs whose plan and every shard report remain
available.

For each chosen run, download its `test-plan-lite-stg` artifact and all
`blob-report-lite-stg-shard-*` artifacts. Each blob artifact contains a zip
with `report.jsonl`. Extract that file from each zip. For example, for run
`123`:

```sh
mkdir -p /tmp/lite-timings/123/blobs
gh run download 123 --repo ZenUml/conf-app --name test-plan-lite-stg --dir /tmp/lite-timings/123
gh run download 123 --repo ZenUml/conf-app --pattern 'blob-report-lite-stg-shard-*' --dir /tmp/lite-timings/123/blobs
for zip in /tmp/lite-timings/123/blobs/*/*.zip; do
  unzip -p "$zip" report.jsonl > "${zip%.zip}.jsonl"
done
```

Create a JSON manifest listing **every** extracted report for each run. Paths
are relative to the manifest. This abbreviated example shows the shape; a
full 10-shard run requires all ten reports:

```json
{
  "runs": [
    {
      "run_id": 123,
      "plan": "123/test-plan.json",
      "reports": ["123/blobs/blob-report-lite-stg-shard-4/report-fullscreen-insert-b2f9c16.jsonl"]
    }
  ],
  "default_ms": 40000
}
```

The actual extracted JSONL filename matches the zip filename with `.jsonl`
in place of `.zip`; use those actual paths in the manifest. Generate to a
temporary file first so an error cannot truncate the checked-in estimates:

```sh
node scripts/test-selection/refresh-shard-durations.mjs /tmp/lite-timings/manifest.json > /tmp/lite-shard-durations.mjs
# Inspect the estimates and evaluate against the holdout before replacing them.
cp /tmp/lite-shard-durations.mjs scripts/test-selection/lite-shard-durations.mjs
```

The tool requires a full Lite plan and a final result for every planned test;
it rejects failed tests, missing results, duplicate runs and tests appearing in
multiple reports. It ignores setup tests and skipped tests, uses the final
attempt of a retried test, and takes the median of passing durations for each
project and file. It does not query GitHub or verify the run's conclusion;
check that before assembling the manifest. Test the changed planner and compare
a real full PR run's longest shard before claiming a speedup.
