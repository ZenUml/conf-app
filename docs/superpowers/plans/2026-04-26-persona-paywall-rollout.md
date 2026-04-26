# PERSONA_AWARE_PAYWALL — Rollout Plan

**Feature**: Replace the legacy upgrade prompt with persona-aware paywall (HeavyCreator / Bystander flows)
**Branch**: `feat/persona-paywall-frontend` → PR #1035
**Flag name**: `PERSONA_AWARE_PAYWALL`
**Flag backend**: Cloudflare KV `confluence_plugin_features` on `portal.zenuml.com` / `portal-stg.zenuml.com`

---

## How the flag works

`useCustomerSuccessService` calls `getFeatureFlagsForCurrentDomain(['PERSONA_AWARE_PAYWALL'])` → hits `${portal}/feature-flags?client=<domain>`.

`UpgradePromptRouter.vue:35`: if flag is off → render `LegacyPrompt`; if on → run persona logic.

Flag structure in KV (`confluence_plugin_features` → key `feature_flags`):
```json
"PERSONA_AWARE_PAYWALL": {
  "name": "PERSONA_AWARE_PAYWALL",
  "description": "Persona-aware paywall (HeavyCreator + Bystander) instead of legacy upgrade prompt",
  "enabled": true,
  "rules": {
    "domains": {
      "include": ["zenuml-stg"],
      "exclude": []
    },
    "default": false
  }
}
```

---

## Phase 0 — Deploy to staging

- [ ] PR #1035 approved and merged to `master`
- [ ] Deploy lite variant to **staging** (`pnpm forge:deploy:lite:staging`)
- [ ] Verify `UpgradePromptRouter`, `HeavyCreatorPrompt`, `BystanderPrompt` assets are in staging bundle

**Gate**: CI green, staging deployment succeeded.

---

## Phase 1 — Staging smoke test

- [ ] Add `PERSONA_AWARE_PAYWALL` to KV on `portal-stg.zenuml.com`
  - `include: ["zenuml-stg"]`, `default: false`
  - Wrangler command: `wrangler kv key put feature_flags '<json>' --namespace-id <stg-ns-id> --env staging`
- [ ] Open `zenuml-stg.atlassian.net`, hit a blocked space
- [ ] Confirm HeavyCreator modal appears (not legacy prompt)
- [ ] Test all three personas (Heavy creator — Bundle primary, Heavy creator — Marketplace primary, Bystander)
- [ ] Confirm secondary line wording is correct (see wording fix 2026-04-26)
- [ ] Confirm CTA links open correct URLs

**Gate**: All three persona flows render and link correctly on staging.

---

## Phase 2 — Deploy to production (flag still off)

- [ ] Deploy lite variant to **production** (`pnpm forge:deploy:lite:prod` or via release tag)
- [ ] Flag is `default: false` with no production domains in `include` — zero user impact

**Gate**: Production deployment succeeded, no Sentry errors.

---

## Phase 3 — Internal canary (production, known-safe tenant)

- [ ] Add `PERSONA_AWARE_PAYWALL` to KV on `portal.zenuml.com`
  - `include: ["zenuml"]` (zenuml.atlassian.net — internal), `default: false`
- [ ] Repeat smoke test on `zenuml.atlassian.net`
- [ ] Check Mixpanel: `upgrade_modal_shown`, `upgrade_cta_clicked` events firing with correct `primary_option` / `persona` properties

**Gate**: Events in Mixpanel, no Sentry errors, UI correct.

---

## Phase 4 — Broad rollout

- [ ] Update flag: set `default: true` (enables for all tenants regardless of domain)
  - Or expand `include` list incrementally if prefer gradual: add high-MAU domains first
- [ ] Monitor for 48 h:
  - Sentry: no new errors in `HeavyCreatorPrompt` / `BystanderPrompt`
  - Mixpanel: `upgrade_modal_shown` volume matches expected (≈ same as legacy `css_blocked` events)
  - Mixpanel: `upgrade_cta_clicked` rate ≥ baseline (legacy)

**Gate**: No error spike, funnel metrics stable or improved after 48 h.

---

## Phase 5 — Cleanup (after 2–4 weeks stable)

- [ ] Delete `LegacyPrompt` component and its import in `UpgradePromptRouter.vue`
- [ ] Remove `if (!svc.personaAwarePaywallEnabled.value) return LegacyPrompt` gate
- [ ] Remove `mockPersonaAwarePaywall` from `MOCK_KEYS` and `FlagsEditor`
- [ ] Remove `Lite blocked` preset from `presets.ts`
- [ ] Remove `personaAwarePaywallEnabled` from `useCustomerSuccessService` return value
- [ ] Remove flag from KV (or leave as permanently-on tombstone)

---

## Rollback

To revert instantly: update KV to set `PERSONA_AWARE_PAYWALL.enabled: false`. All users fall back to `LegacyPrompt` on next page load (flag is cached 5 min client-side).
