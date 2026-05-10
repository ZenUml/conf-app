# Handoff: Paywall Advocacy CTA Redesign

> **Audience:** developer using Claude Code to implement against the `conf-app/` Vue 3 codebase (Atlassian Forge + Connect hybrid).
> **Source ticket:** internal handoff doc dated 2026-05-08 (eagle.xiao@gmail.com).

---

## Overview

The Lite paywall in `conf-app` (`src/components/UpgradePrompt/UpgradePrompt.vue`) currently shows two CTAs — **Buy on Marketplace** and **Contact Sales for Enterprise**. Click rate has been **0%** for multiple consecutive days because the users who hit this paywall are engineers, not buyers.

This redesign:

1. **Removes** the two purchase CTAs from the pricing cards. Cards become read-only reference content (kept so the engineer sees what they're advocating for — but no longer clickable).
2. **Adds** a single primary "Copy upgrade request" button that puts a templated message on the user's clipboard. They paste it into Slack / email / wherever and forward it to the person who actually owns the tooling budget.
3. **Adds** an always-visible draft preview card showing exactly what gets copied, with `{{SPACE_KEY}}`, `{{MACRO_COUNT}}`, etc. tokens highlighted.
4. **Tracks** intent via a new `advocacy_message_copied` Mixpanel event.

The paywall block (the forcing function — saves blocked at ≥100 macros) is **unchanged**. We are not softening the wall, only changing the offered exit.

---

## About the design files

The HTML in this bundle is a **design reference**, not production code to lift. Recreate it inside the existing Vue 3 + Tailwind codebase using the project's established patterns — `<script setup>`, the existing icon imports from `@heroicons/vue/24/outline`, `useUpgradeTracking`, etc. Do **not** add React, Babel, or the design-canvas wrapper to the real app.

The two HTML files:

- **`Variant D Refined.html`** — **THIS IS THE SHIP DESIGN.** Three copy directions (D1, D2, D3) and five hero-illustration options laid out side-by-side in a design canvas. The recommended combination is **D2 copy + illustration option 4 (animated paper plane)**.
- **`All Variants Canvas.html`** — earlier exploration with five layout variants (A–E) plus button states and Confluence-context chrome. Useful as background; not the ship target.

Open either file in a browser. The design canvas is pan/zoom (drag to pan, scroll to zoom, click an artboard to focus fullscreen).

---

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, and micro-interactions are locked. Implement pixel-perfectly using Tailwind classes that map to the values listed under **Design Tokens** below — every utility class in the design uses values that already exist in `tailwind.config.js`.

---

## What changed at the modal level

Current `UpgradePrompt.vue` layout (kept for reference):

```
┌─ Header ──────────────────────────────────────┐
│ "This space has reached the ZenUML Lite…"     │
├───────────────────────────────────────────────┤
│ "Pick the upgrade that fits your team"        │
├──────────────────────┬────────────────────────┤
│ MarketplacePricing   │ EnterpriseBundle       │
│  [Buy on Marketplace]│  [Contact Sales]       │   ← REMOVE both buttons
├──────────────────────┴────────────────────────┤
│ [Continue editing]   [Why upgrade? →]         │
└───────────────────────────────────────────────┘
```

New layout (Variant D refined — what to build):

```
┌─ Header (unchanged) ──────────────────────────┐
│ "This space has reached the ZenUML Lite…"     │
├───────────────────────────────────────────────┤
│ ┌─ illustration ─┐  Hero title (sentence case)│
│ │ animated plane │  Hero body — 1–2 sentences │
│ └────────────────┘                            │
├───────────────────────────────────────────────┤
│  ▼ DRAFT CARD (always visible)                │
│  ┌──────────────────────────────────────────┐ │
│  │ Your draft · paste this anywhere         │ │
│  │ ──────────────────────────────────────── │ │
│  │ Hey,                                     │ │
│  │ I've been using ZenUML to draft…         │ │
│  │ "{{SPACE_KEY}}" Confluence space…        │ │
│  │ ({{MACRO_COUNT}} of {{MACROS_LIMIT}})…   │ │
│  │ • Marketplace plan — {{UPGRADE_URL}}     │ │
│  │ • Enterprise bundle — {{ENTERPRISE_URL}} │ │
│  └──────────────────────────────────────────┘ │
├───────────────────────────────────────────────┤
│ [ 📋 Copy upgrade request ]  ← primary button │
├───────────────────────────────────────────────┤
│ [Continue editing]   [Why upgrade? →]         │  (footer unchanged)
└───────────────────────────────────────────────┘
```

The original two pricing cards (`MarketplacePricingCard.vue` / `EnterpriseBundleCard.vue`) are **dropped from this layout**. Both options are described inside the draft body — repeating them as cards above the draft is redundant and was tested in earlier iterations.

If product wants the cards retained as reference, see `All Variants Canvas.html` Variant A — it's an alternative that keeps demoted, no-CTA cards above the advocacy button. Not the recommended ship.

---

## Final copy (D2)

| Slot | Final copy |
|------|------------|
| **Header** (unchanged) | `This space has reached the ZenUML Lite limit (100 macros).` |
| **Header sub** (unchanged) | `Existing diagrams still render. To create or edit, upgrade the space.` |
| **Hero title** | `Send this to whoever runs your tooling budget.` |
| **Hero body** | `Usually a manager, team lead, or IT. We've drafted the request — explains the limit, the two upgrade paths, and what each costs. Just paste and send.` |
| **Draft label** | `Your draft · paste this anywhere` |
| **Button (default)** | `📋  Copy upgrade request` (icon = Heroicons `DocumentDuplicateIcon` outline, 16×16) |
| **Button (copied)** | `✓  Copied — paste into Slack or email` |
| **Button (failed)** | `Couldn't copy. Select the draft above and copy manually (⌘/Ctrl+C).` (in red-700, with the draft body becoming `<textarea>`-selectable) |
| **Footer left** (unchanged) | `Continue editing without upgrading` |
| **Footer right** (unchanged) | `Why do I need to upgrade? →` |

### Copy alternatives in the canvas

- **D1 (recipient-agnostic):** `We've drafted a short upgrade request.` / `It covers the limit you've hit, both pricing options, and links to start the upgrade. Paste it wherever the budget conversation happens — Slack, email, your tooling channel.` — safer; doesn't name a role.
- **D3 (no illustration, action-first):** `Here's a request you can forward.` / `The draft below explains the limit and walks through both upgrade options. Paste it to your manager, team lead, or whoever signs off on tools.` — strips ornament; pure utility.

If A/B testing is on the table, ship D2 as primary and D1 as the variant.

---

## The clipboard message (final template)

Drop this in `useUpgradeTracking.ts` or a new `buildAdvocacyMessage.ts`. Tokens are interpolated from `getUpgradeContext()` — see "State / data" below.

```
Hey,

I've been using ZenUML to draft sequence diagrams in our "${SPACE_KEY}" Confluence space, and we've just hit the Lite limit (${MACRO_COUNT} of ${MACROS_LIMIT} macros). New edits are blocked until someone with billing access upgrades the space.

Two options when you have a moment:

  • ZenUML Marketplace plan — per-user monthly billing through Atlassian.
    ${UPGRADE_URL}
  • Enterprise bundle — ${ENTERPRISE_BUNDLE_PRICE}, annual flat fee, includes the AI diagramming tools too.
    ${ENTERPRISE_BUNDLE_URL}

Could you take a quick look? Happy to send more details — I'm running into the limit on existing work and would love to keep moving.

Thanks!
```

**No name field.** We considered prefilling the user's display name (would require an extra `/wiki/rest/api/user?accountId=…` call from Forge context) but decided against it — the user types their own name when pasting, which removes both the API call and a form field from the modal.

---

## Hero illustration

Use the **animated paper plane** (option 4 in `hero-illustrations.jsx` → `HeroPlaneAnimated`). 132×110 viewBox SVG. Two animations on a 3.4s loop:

- The plane group floats: `translate(0,0) → translate(-3px,-4px) rotate(-3deg) → translate(0,0)`, ease-in-out.
- The dotted trail "flows" via `stroke-dashoffset: 60 → 0`, linear, same period.

The trail path `M10 94 Q 36 82 60 68 T 90 44` ends at the plane's tail crease (90, 44 in viewBox coords) so the trail visually flows into the back of the plane.

Honor `prefers-reduced-motion` — fall back to the static plane (option 1, `HeroPlaneV2`).

```css
@media (prefers-reduced-motion: reduce) {
  .illus-plane-anim .illus-plane,
  .illus-plane-anim .illus-trail { animation: none; }
}
```

The full SVG + keyframes are in `hero-illustrations.jsx` (option 4) and the inline `<style>` block at the top of `Variant D Refined.html`. Lift them verbatim into a Vue SFC.

---

## Components & behavior

### `UpgradePrompt.vue` — replace its body

Keep the modal shell (`fixed inset-0 z-50` backdrop, `680px` wide white card with `rounded-lg shadow-xl`). Replace everything between header and footer with:

```
<PaywallHero/>          <!-- new component -->
<DraftCard/>            <!-- new component -->
<AdvocacyButton @copied="onCopied" @failed="onFailed"/>  <!-- new component -->
```

Delete imports of `MarketplacePricingCard.vue` and `EnterpriseBundleCard.vue` from this file. The card components themselves can remain in the codebase if other surfaces use them; otherwise delete.

### `PaywallHero.vue` (new)

- Grid: `grid grid-cols-[132px_1fr] gap-4 items-center px-4 pt-[18px] pb-1.5`
- Slot 1: `<HeroPlaneAnimated/>` SVG component (132×110)
- Slot 2: `<h3>` (16px / 600 / `text-gray-900` / `leading-[1.3]`) and `<p>` (12px / `text-gray-600` / `leading-[1.45]`)

### `DraftCard.vue` (new)

- Wrapper: `mx-4 mb-3 bg-white border border-gray-200 rounded-lg shadow-[0_1px_0_rgba(0,0,0,.02)] overflow-hidden`
- Header strip: `flex items-center gap-1.5 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-[.08em] text-gray-500` — content: `<MailIcon class="w-3 h-3"/> Your draft · paste this anywhere`
- Body: `px-3.5 py-3 text-[12.5px] leading-[1.55] text-gray-800 whitespace-pre-wrap font-sans max-h-[240px] overflow-y-auto`
- Tokens (`{{SPACE_KEY}}`, `{{MACRO_COUNT}}`, `{{MACROS_LIMIT}}`, `{{UPGRADE_URL}}`, `{{ENTERPRISE_BUNDLE_PRICE}}`, `{{ENTERPRISE_BUNDLE_URL}}`) get the `pw-draft-token` style: `text-blue-700 font-semibold bg-blue-50 px-[3px] rounded-sm font-mono text-[11.5px]`

The body should render the *interpolated* template (real values) for sighted users, but the `MailIcon` label states "Your draft" so users understand it's the literal text being sent.

### `AdvocacyButton.vue` (new)

States — drive via a single `state` ref: `'default' | 'copied' | 'failed'`.

- **Default:** `w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm rounded-md px-4 py-3 flex items-center justify-center gap-2 transition-colors`
- **Hover/focus:** built into the above; add `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`
- **Copied:** swap `bg-blue-600` → `bg-green-600 hover:bg-green-700`. Label changes to `✓ Copied — paste into Slack or email`. Auto-revert to default after **2000ms**.
- **Failed:** `bg-red-50 border border-red-100 text-red-700` block in place of the button — short error message + a `<textarea readonly>` showing the message text, focused-and-selected on render so the user can ⌘/Ctrl+C.

Click handler — mirror the iframe-safe pattern in `src/components/Viewer/GenericViewer.vue:359–389`:

```ts
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Forge iframe contexts often deny clipboard-write — fall back.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}
```

On success → `state.value = 'copied'`, fire tracking, `setTimeout(() => state.value = 'default', 2000)`.
On failure → `state.value = 'failed'` (no auto-revert; user must manually copy and dismiss).

### `PageEditorPaywallGate.vue`

Thin pass-through wrapper. No changes needed — designing the modal once covers both contexts.

---

## State / data

### `useCustomerSuccessService.ts:211-217` — `getUpgradeContext()`

Currently exposes:
- `macro_count`
- `macro_limit`
- `macro_usage_pct`

**Add** `space_key` — fetched via `globals.apWrapper.getCurrentSpace()` (async). The build of the message blocks until this resolves; show a brief skeleton state on the draft card until it does (or block the click — the latter is simpler and the fetch is fast).

### Build template in a single helper

```ts
// src/components/UpgradePrompt/buildAdvocacyMessage.ts
export function buildAdvocacyMessage(ctx: {
  spaceKey: string;
  macroCount: number;
  macrosLimit: number;
  upgradeUrl: string;
  enterpriseBundleUrl: string;
}): string {
  return `Hey,\n\nI've been using ZenUML to draft sequence diagrams in our "${ctx.spaceKey}" …`;
}
```

Keep one source of truth for the template — both the displayed draft card and the clipboard write should call this helper.

---

## Tracking

### Add a new event

- `src/utils/upgradeTracking.ts` — extend `UpgradeEventName` enum: `ADVOCACY_MESSAGE_COPIED = 'advocacy_message_copied'`
- `src/utils/analytics/catalog.ts` — register the new event name
- `src/components/UpgradePrompt/useUpgradeTracking.ts` — add `trackAdvocacyCopy(ctx)` that fires `ADVOCACY_MESSAGE_COPIED` with properties:
  - `space_key: string`
  - `macro_count: number`
  - `macros_limit: number`

Fire from `AdvocacyButton.vue`'s success branch, **before** the 2s revert.

### Deprecate

- `trackMarketplaceClick` and `trackEnterpriseBundleClick` — delete the call sites (the buttons are gone). Keep the functions in `useUpgradeTracking.ts` for one release cycle in case telemetry is in flight, then remove. The `upgrade_cta_clicked` event name itself stays in `catalog.ts` for backward compatibility with historical Mixpanel queries.

---

## Design tokens

All values map to `tailwind.config.js` defaults — no custom tokens required.

### Color

| Use | Token | Hex |
|-----|-------|-----|
| Primary CTA | `blue-600` | `#2563EB` |
| CTA hover | `blue-700` | `#1D4ED8` |
| CTA active | `blue-800` | `#1E40AF` |
| CTA focus ring | `blue-500` | `#3B82F6` |
| Copied success | `green-600` | `#16A34A` |
| Copied success hover | `green-700` | `#15803D` |
| Token highlight bg | `blue-50` | `#EFF6FF` |
| Token highlight text | `blue-700` | `#1D4ED8` |
| Body text | `gray-800` | `#1F2937` |
| Headings | `gray-900` | `#111827` |
| Subtext | `gray-600` | `#4B5563` |
| Micro labels | `gray-500` | `#6B7280` |
| Borders | `gray-200` | `#E5E7EB` |
| Card striping bg | `gray-50` | `#F9FAFB` |
| Lite product accent bar | `orange-500` | `#F97316` |
| Failure block bg | `red-50` | `#FEF2F2` |
| Failure block text | `red-700` | `#B91C1C` |

### Type

System sans stack (already global in `addon.css`):
```
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

| Use | Size | Weight | Line height |
|-----|------|--------|-------------|
| Header h2 | 14px | 600 | 1.4 |
| Header sub | 12px | 400 | 1.4 |
| Hero title | 16px | 600 | 1.3 |
| Hero body | 12px | 400 | 1.45 |
| Draft label | 10px | 600, `tracking-[.08em] uppercase` | 1 |
| Draft body | 12.5px | 400 | 1.55 |
| Token in draft | 11.5px mono | 600 | inherit |
| Button | 14px | 600 | 1 |
| Footer links | 12px | 400 | 1 |

### Spacing & radius

- Modal padding: `px-4` everywhere except header (`px-4 py-3`) and hero (`px-4 pt-[18px] pb-1.5`).
- Vertical rhythm between sections: `mb-3` (12px).
- Button radius: `rounded-md` (6px).
- Card radius: `rounded-lg` (8px).
- Token highlight radius: `rounded-sm` (2px).

### Shadow

- Modal card: `shadow-xl` (existing pattern).
- Draft card: `shadow-[0_1px_0_rgba(0,0,0,.02)]` — barely visible, just to lift it off the modal background.

---

## Assets

- **Heroicons v2 outline** — already a project dep (`@heroicons/vue`). Use:
  - `DocumentDuplicateIcon` for the Copy button
  - `CheckIcon` for the Copied state
  - `EnvelopeIcon` for the draft card label (or inline the small mail SVG from `hero-illustrations.jsx`)
- **Hero plane SVG** — bespoke, in `hero-illustrations.jsx` → `HeroPlaneAnimated`. Lift verbatim into a `HeroPlaneAnimated.vue` component, replace `className` → `class`.
- **No new images, no fonts.** System sans stack is intentional (matches Confluence chrome).

---

## Verification (from the original ticket)

1. Open a Confluence space with ≥100 ZenUML macros (or `localStorage.mockMacroCount = '105'` for local sim).
2. Click edit on an existing macro — paywall fires.
3. Click the new advocacy button.
4. Verify clipboard contains the templated message with real space key, macro count, and pricing URLs filled in.
5. Verify "Copied!" state shows for 2s, then reverts.
6. Mixpanel: confirm `advocacy_message_copied` fires with `space_key`, `macro_count`, `macros_limit`.
7. Confirm the two old CTA events (`upgrade_cta_clicked` with `product_option=marketplace` / `enterprise_bundle`) no longer fire.
8. Update `tests/unit/UpgradePrompt.spec.ts` — remove the two CTA tests, add an advocacy-copy test that:
   - Stubs `navigator.clipboard.writeText`
   - Clicks the button
   - Asserts the stub was called with the expected templated string
   - Asserts the button enters the `copied` state and reverts after 2000ms

---

## Files in this bundle

| File | Purpose |
|------|---------|
| `Variant D Refined.html` | The ship design — open in a browser to see all three copy directions and five hero illustrations side-by-side |
| `All Variants Canvas.html` | Earlier exploration (variants A–E, button states, in-context backdrop) |
| `modal-atoms.jsx` | Shared React components: `PaywallHeader`, `PaywallFooter`, `Icon` set, `buildMessage` helper. Use as a reference for exact icon paths and copy strings; don't lift directly. |
| `hero-illustrations.jsx` | Five hero illustrations including `HeroPlaneAnimated` (the ship pick) |
| `design-canvas.jsx` | Pan/zoom canvas wrapper used by the HTML files. Not needed in the real app. |
| `styles.css` | All design tokens and component CSS as plain CSS variables + class names. The `:root { --blue-600: #2563EB; … }` block is your source of truth for token values. |

---

## Open questions for product before merge

1. **A/B test D2 vs D1?** Cheap to flag-gate the hero copy.
2. **Display-name prefill?** We left it out for simplicity; if telemetry shows users abandoning at the paste step, the Forge `accountId → /wiki/rest/api/user?accountId=…` round trip is one extra request.
3. **Failure-state copy.** Currently silent on *why* the clipboard was blocked. If the Forge iframe denies it consistently for a customer, we may want a dedicated message ("Your Confluence admin has restricted clipboard access — paste manually below").

---

*Bundle generated 2026-05-08. Questions: ping the design author in the original handoff thread.*
