# Lite byline reconciliation

The Lite app's `byline-visibility-hourly` scheduled trigger retains its key but
runs daily. The key is historical; there is one trigger, not an hourly companion.
The independent Forge flag `byline-reconciliation-enabled` gates the complete
space scan. Set up this flag with the `installContext` identifier and enable it
for Lite before deploying a build that changes the interval. A missing,
disabled, or unavailable flag skips the run without reading or changing the
space property or Forge storage marker. Existing byline visibility stays as it
was, but new spaces will not be enrolled until a later enabled run. This is a
cost-control gate, not the byline's display condition.

As of 2026-10-02 the Lite app's Forge Console has 10 of 10 flag slots in use.
Provisioning this flag requires retiring an existing flag after verifying its
deployed consumers. The `ai-title-enabled` flag is a possible candidate based
on source history; its deployed use has not been verified. Do not retire it
based on source search alone.

Each scheduled invocation logs `run started runId=<uuid>` and a `run completed`
JSON object with the same `runId`, `outcome` (`skipped`, `unchanged`, `changed`,
`failed`), `durationMs`, `spaceCount`, `changedCount`, and `failureCount`.
`changedCount` includes created, updated, and deleted properties. A start with
no completion can indicate a hard timeout or runtime termination; a completed
duration cannot measure an invocation that was killed. Logs contain no space
IDs, diagram bodies, or titles. The Mixpanel event name and properties are
reserved in the analytics catalog but outbound emission is pending explicit
approval of that aggregate payload.
