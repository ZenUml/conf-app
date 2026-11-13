// Trusted controller registry. Candidate manifests can confirm this mapping,
// but cannot add lanes, commands, or scenarios to it.
export const API_LANES = [{
  id: 'oauth-token',
  manifest: 'tests/integration/oauth-token/scenarios.json',
  scenarios: [
    { feature: 'agent-authorization', interface: 'oauth-protocol' },
    { feature: 'agent-authorization', interface: 'external-agent' },
  ],
}];
