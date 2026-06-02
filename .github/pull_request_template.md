## Summary

<!-- 1–3 bullets describing what changed and why. -->

## Test plan

<!-- Bulleted checklist of how this was tested. -->

## Demo-page validation (Diagramly only — required for demo-page PRs)

- [ ] Created a demo page on `dia-dev.atlassian.net` via the tunneled admin entry.
- [ ] Attached the resulting page URL to this PR description.
- [ ] Attached one screenshot per macro showing it rendered (not in an error state):
  - [ ] Sequence (ZenUML)
  - [ ] Flowchart (Mermaid)
  - [ ] Graph (DrawIO)
  - [ ] OpenAPI / Swagger
- [ ] Attached the `results[].name` list returned by `/wiki/rest/api/user/memberof` for a known-admin user on a diagramly dev site. Confirmed at least one group name matches the regex `^(site-admins|confluence-admins(-.+)?|confluence-administrators)$`. If not, the regex was broadened and this PR includes the update.
- [ ] Confirmed post-CI `manifest.yml` artifacts: diagramly build contains `diagramly-admin-create-demo-page` and `createDemoPage`; lite and full builds contain neither.
