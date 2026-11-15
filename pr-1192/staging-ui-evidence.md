# CI-deployed Lite staging UI evidence

16 Nov2026 client date. Candidate a87551e99388d2a548ba837609b1d6c7a0037555 merged by CI into base597cc56331ff0698f7a7c344d4dc2561eefb1742 as5ce29033232453020361d642d9c940fea9fbaa33.

Authority: https://github.com/ZenUml/conf-app/actions/runs/43771716054/job/132988938186 (Deploy:Lite/deploy success, completed22:56:32Z). The pipeline, not a local shell, deployed staging.

Deployment log proves checkout5ce2903 and build version ci-5ce29033232453020361d642d9c940fea9fbaa33-lite; published Cloudflare revision https://ffc29b01.conf-stg-lite.pages.dev. Forge package includes assets/index-DqX4gIDF.js (job log line6131). The observed globalPage iframe loaded exactly ./assets/index-DqX4gIDF.js from the Atlassian CDN staging resource, not localhost. Screenshot and read-only DOM/source observation were emitted in the Codex chat.

Live staging identity was the already signed-in support admin (different from the Forge tunnel owner). No identity, license data or counts were injected or edited.

Observed page:

```text
Plan and usage
lite-stg
48,493 Diagrams on this site
2 Spaces over the Lite limit of100
Spaces over the limit
Space |Diagrams /limit |Unlock one space
SD |48,203 /100 |$299/yr/space |Unlock this space
ATSEED01 |100 /100 |$299/yr/space |Unlock this space
Upgrade to Full
Request Full |View on Marketplace
```

Both rows were rendered from the page's normal usage and authenticated licensing request. The client requests two keys in one batch; both showing actions proves confirmed-unpaid batch results reached the UI (the former endpoint lacks the statuses map and would fail closed).

Clicking ATSEED01 produced Confluence's external-link confirmation target:
https://buy.stripe.com/cNifZifkN7hzavK12H7IY05?client_reference_id=lite-stg__ATSEED01

Clicked Cancel, then clicked SD; its confirmation target was:
https://buy.stripe.com/cNifZifkN7hzavK12H7IY05?client_reference_id=lite-stg__SD

Clicked Cancel again. The confirmation dialog closed. No payment or Stripe-page form interaction was performed. The destination URL was verified in Confluence's own handoff dialog; the Stripe page itself was not loaded.

## Results and limits

PASS: CI deployed candidate provenance, CDN source, multi-row known-unpaid eligibility, exactly100 boundary, row-specific checkout target, unchanged Full block.
Paid/user-license/unknown/pending/personal rows were observed with Storybook fixtures and covered by unit tests; no such live staging state was manufactured. Staging Fullscreen-source state was not separately exercised (covered in Storybook and unit tests).
Automated E2E remains blocked by test:triage, so this is manual UI evidence, not a claim that all CI checks are green.
