# Review round verification — 2026-10-27

Candidate: `7dbf59bbae205cfc74168014ddd7303a0c6296ab` plus these evidence files. The application source did not change after that commit.

## Automated checks

- Shared: TypeScript check and 10 Vitest tests passed.
- Hub: TypeScript check, 71 Vitest tests, and production build passed.
- Extension: TypeScript check, 115 Vitest tests, and MV3 production build passed.
- Mermaid component and ER diagrams parsed, and the ZenUML sequence diagram parsed.

These checks cover protocol validation, group replacement, GitHub body preservation, navigation rules, and UI components. They do not replace browser observation.

## Browser evidence

An isolated local Hub used a fixture `gh` command and its own runtime directory. An isolated Chrome for Testing profile loaded the built extension. The fixture intercepted only the test PR pages; its GitHub-like bodies and remote results were simulated. No real PR body, merge, or close action was changed in this browser run.

| Evidence | Observation |
| --- | --- |
| [Real GitHub PR page](screenshots/review-round-real-github.png) | On the actual public PR #917 page, the extension rendered the two-item left column and a stale-material notice above the existing body. The fixture group referred to an older head, so the stale notice was expected. This page was read before the PR description below was updated. |
| [Fixture material](screenshots/review-round-fixture-materials.png) | A published two-item round showed the left list and marked decision material above the preserved PR body. |
| [Fixture native result](screenshots/review-round-fixture-native-result.png) | The simulated native merge was confirmed through the Hub's fixture gateway; the current tab showed **Next / Stay**. |
| [Fixture zero result](screenshots/review-round-fixture-zero.png) | Publishing zero items removed the left list. |

The same isolated runtime also exercised preparation failure (old group retained), changed-head stale detection, **Stay** cancelling the three-second advance, AI action confirmation with an open PR (no advance), AI confirmation after remote merge (owned tab advanced without focus change), and an externally observed merge (group updated without navigation). These observations use fixture GitHub state. Actual authenticated GitHub merge/close behavior has not been exercised.

This is a Chrome extension and local Hub change. It does not change the Confluence UI, so the Confluence Storybook → Forge Tunnel → staging path does not apply.
