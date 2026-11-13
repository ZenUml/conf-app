# OAuth PR #994 selective API acceptance

Current head f69efde4dcffe735baece27d436546a7ba658e51; actual target 46480f305e88f84755c79c9f28edc283c570481d; merge candidate 03874f365a11a200dbc9d9ab1c04633811ac125d.

[Immutable collaborator decision](https://github.com/ZenUml/conf-app/pull/994#issuecomment-6848245070) selects exactly agent-authorization × oauth-protocol and agent-authorization × external-agent. Registered OAuth API lane is expected; required smoke remains. PR stays Draft and this exercise does not authorize merging it.

Local 14 HTTP tests and 384 OAuth unit tests passed; 3 credential-dependent live unit tests were skipped. The final main merge changes only controller metadata paths: OAuth implementation, integration inputs, package/lock and standalone workflow are identical to validated 96810b30. Trusted manifest verification and 70 controller/API checks passed after merge. Current GitHub execution is pending; historical results are not presented as fresh candidate execution.

The suite uses actual local HTTP/Pages middleware/router and token/MCP handlers, workerd, local D1/KV and production refresh migration. It covers exchange, binding failures, consumed code, rotation/retry, replay/cross-client revocation, legacy migration and storage faults/recovery. No token handler or bearer-authentication mocks. No browser consent, real SSO, remote storage or edge deployment coverage is claimed. Outbound networking is denied; only local fake identities/configuration are used.
