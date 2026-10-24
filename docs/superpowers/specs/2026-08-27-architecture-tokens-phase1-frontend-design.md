# Architecture Tokens — Phase 1 front-end design

**Date:** 2026-08-27 · **Status:** Approved by the product owner after two review rounds (hover popover rejected; always-visible counts rejected).
**Canvas:** https://claude.ai/code/artifact/57b5165b-854a-4c29-92c8-57b0a6e734bd · **Sources:** `docs/design/architecture-tokens-phase1/` (`build-artboards.py` generates the five `.dc.html` artboards from a real mermaid 11.12.2 render; `preview/*.png` are rendered previews).
**Parent spec:** `2026-08-27-architecture-tokens-phase1-design.md` (data, backend, gate, events). **Plan:** `docs/superpowers/plans/2026-08-27-architecture-tokens-phase1.md` (Task 8–9 implement this document).

## 1. Principle — three levels of intent

| level | user action | what appears | what never appears |
|---|---|---|---|
| read | nothing | the diagram unchanged + one footer line | pills, popovers |
| hover | pointer over a lifeline's actor box (or keyboard focus on its pill) | that lifeline's **count pill** only | a popover |
| click | click on the pill | the **popover** for that lifeline | anything on other lifelines |

Reasons on record: a hover-opened popover covered the diagram while presenting; always-visible counts on every lifeline were judged too loud. A hover listener exists only to reveal one pill.

## 2. States (one artboard each)

| # | artboard | state | preview |
|---|---|---|---|
| 1 | `Default.dc.html` | flag off / lookup failed / no accessible related page → macro unchanged, only the existing "Created by …" line | `preview/Default.png` |
| 2 | `Main.dc.html` | footer line rendered; diagram untouched | `preview/Main.png` |
| 3 | `HoverPill.dc.html` | pointer over *Partner App* → its pill `3` at the box's top-right corner | `preview/HoverPill.png` |
| 4 | `PopoverOpen.dc.html` | pill clicked → popover; the actor keeps its pill and gets a `#0052CC` outline | `preview/PopoverOpen.png` |
| 5 | `Fullscreen.dc.html` | 1440×900 modal; same footer row pinned at the bottom; popover on *Payments API* | `preview/Fullscreen.png` |

## 3. Anatomy and exact values

All values are the shipped viewer's literals (no design tokens exist in the viewer; `--ds-*` variables are not used there).

### 3.1 Footer line (`RelatedDiagramsFooter.vue`, footer part)

- Placement: the same row as `DiagramAttributionFooter` (`GenericViewer.vue:262`), **left** side; the attribution stays right-aligned. Row = `display:flex; align-items:center; justify-content:space-between`.
- Style: `padding: 8px 12px; font-size: 12px; color: #6b7280;` (identical to `.diagram-attribution`). Leading icon: 14px stroke SVG (three nodes, `stroke: currentColor; stroke-width: 1.5`), `gap: 6px`.
- Copy, exactly: `<N> of <M> participants` in `#374151`, then ` also appear in other diagrams you can access`, then ` · as of <d Mon>` in `#9CA3AF`. `N` = participants with ≥1 accessible related page; `M` = participants of this diagram present in the rendered SVG. Date: `toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })`.
- Rendered only when `N ≥ 1`.

### 3.2 Count pill

- Element: `<button type="button" data-testid="related-diagrams-pill" data-actor="<actorId>">`, one per lifeline with `related.length > 0`, rendered inside an overlay `position:absolute; inset:0; pointer-events:none` teleported into the diagram host (`.screen-capture-content`, already `position: relative`).
- Size/style: `min-width: 18px; height: 18px; padding: 0 5px; font-size: 11px; font-weight: 600; color: #6B7280; background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 9999px; cursor: pointer; pointer-events: auto`. Hover on the pill: `background: #E5E7EB; color: #374151`. Open (`aria-expanded="true"`): `border-color: #0052CC; color: #0052CC`.
- Position: anchored on the lifeline's top actor box — mermaid renders it as `<rect class="actor actor-top" name="<actorId>">`. With `r = rect.getBoundingClientRect()` and `h = host.getBoundingClientRect()`: `left = r.right - h.left - 12`, `top = r.top - h.top - 9` (pill centred on the top-right corner). Recompute on `window.resize`.
- Visibility: `hidden` unless `hovered === actorId || focused === actorId || open === participant`. `hovered` is set by delegated `mouseover` on the host via `closest('[name]')` and cleared on `mouseout` unless the pointer moves onto the pill itself.
- Tooltip (native `title`): `<n> related diagrams you can access — click to see`.
- Keyboard: focusable button; focus reveals it; Enter/Space opens. Touch: first tap fires `mouseover` (reveal), second tap opens.

### 3.3 Popover

- Recipe = `OverflowMenu.vue` popover: `background: #fff; border: 1px solid #E5E7EB; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 5; padding: 10px 10px 8px; width: 320px` (360px in fullscreen is fine; the mock uses 360). Arrow: 10×10 rotated square, `left: 18px; top: -6px`, borders left+top `#E5E7EB`.
- Anchor: `left = r.left - h.left`, `top = r.bottom - h.top + 8` (below the actor box, left-aligned with it). Also anchored under the pill's lifeline in fullscreen.
- Content, top to bottom:
  1. eyebrow `POSSIBLY RELATED BY NAME` — `font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #6B7280`
  2. the participant's `rawLabel` — `13px / 600 / #172B4D`
  3. one row per related page (`min-height: 28px; padding: 4px 6px; border-radius: 4px; gap: 6px; font-size: 13px`; row hover `background: #F3F4F6`): page title as link (`#0052CC`, hover `#0747A6` underline, ellipsis), space-key pill (`11px #6B7280` on `#F3F4F6` / `#E5E7EB`, radius 9999px, `padding: 0 6px; line-height: 16px`), and — only when `rawLabelThere !== rawLabel` — `as <code>rawLabelThere</code>` (`12px #6B7280`; code = mono, `11px`, `#F4F5F7` bg, radius 3px)
  4. foot row, `border-top: 1px solid #E5E7EB; font-size: 11px; color: #9CA3AF`, left `Same name, not proof of the same object`, right `as of <d Mon>`
- Close: Escape; `mousedown` outside (pills and popover stop propagation); second click on the same pill. Opening another pill switches.
- Link click: `openUrl('<forgeContext.siteUrl>/wiki/pages/viewpage.action?pageId=<pageId>')` — Forge iframes have no `allow-popups`, so never `window.open` / `target=_blank`.

### 3.4 Open-state highlight on the diagram

While a popover is open, the lifeline's actor box gets an outline: an SVG-coordinate overlay is not needed — draw a `div` in the host overlay at the box's bounding rect with `outline: 2.5px solid #0052CC; border-radius: 3px; pointer-events: none` (the mock draws it as an SVG rect; either is acceptable, the HTML div keeps the SVG untouched).

## 4. Copy (final strings)

| where | string |
|---|---|
| footer | `5 of 7 participants also appear in other diagrams you can access · as of 27 Aug` |
| pill tooltip | `3 related diagrams you can access — click to see` |
| popover eyebrow | `Possibly related by name` |
| popover row variant | `as PartnerApp` |
| popover foot | `Same name, not proof of the same object` · `as of 27 Aug` |

Never: "is the same as", "Confirmed", "linked", counts of pages the viewer cannot access, or any hint that an inaccessible page exists.

## 5. Behaviour rules the implementation must keep

1. Render first; the lookup starts after `viewerLoadState === 'ready'` and never delays or reflows the diagram (the footer row is below it; pills are absolutely positioned).
2. Every failure is silent to the user and recorded as `related_diagrams_lookup_failed` with `error_kind`.
3. Nothing on the diagram by default; hover reveals at most one pill; only a click opens a popover.
4. Participants whose `actorId` is absent from the rendered SVG are dropped from counts and pills.
5. No customer vocabulary in analytics; the five events and their properties are in the parent spec §8.
6. Inline and fullscreen (`surface: 'viewer' | 'fullscreen'`) behave identically; the fullscreen footer row sits at the bottom of the frame with `border-top: 1px solid #E5E7EB`.

## 6. Fixture used in the mock (invented, safe to reuse in Storybook/tests)

Seven participants: `WEB as Web App`, `PA as Partner App`, `PAY as Payments API`, `LEDGER as Ledger Service`, `NOTIF as Notification Service`, `DB as Orders DB`, `actor OPS as Ops`. Related pages: PA → Checkout — order flow (VPAY, `PartnerApp`), Refund handling (VPAY, `Partner App`), Partner onboarding (OP, `partner-app`); PAY → 4 pages incl. `PaymentsAPI`, `payments_api`; LEDGER → 2; NOTIF → 1; DB → 2; WEB and OPS → none. Footer reads "5 of 7".
