# ZenUML for Confluence — Design System Reference

> Single-source-of-truth for visual design, tokens, and UI conventions. Generated from the `conf-app` codebase and design system preview cards.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Color Tokens](#2-color-tokens)
3. [Typography](#3-typography)
4. [Spacing & Layout](#4-spacing--layout)
5. [Borders, Radii & Elevation](#5-borders-radii--elevation)
6. [Motion & Transitions](#6-motion--transitions)
7. [Iconography](#7-iconography)
8. [Components](#8-components)
9. [Voice & Copy](#9-voice--copy)
10. [Product Variants](#10-product-variants)
11. [Assets](#11-assets)
12. [Do / Don't](#12-do--dont)

---

## 1. Product Overview

ZenUML for Confluence is an Atlassian Marketplace app (hybrid Forge / Connect) that lets Confluence users author and embed diagrams directly on pages. It ships in three variants:

| Variant       | Color bar          | Purpose                                              |
|---------------|--------------------|------------------------------------------------------|
| **Full**      | `blue-500 #3B82F6` | All diagram types, paid                              |
| **Lite**      | `orange-500 #F97316` | Free tier with macro limit + upgrade paywall       |
| **Diagramly** | `purple-500 #A855F7` | Sister AI-diagramming product                      |

**Diagram types supported:**

| Type       | Accent family | Notes                                  |
|------------|---------------|----------------------------------------|
| Sequence   | Blue/indigo   | ZenUML DSL; core product identity      |
| Mermaid    | Pink          | Dracula-pink `#FF79C6`                 |
| PlantUML   | Red           | `#D33833`                              |
| DrawIO     | —             | Graph canvas, no dedicated accent      |
| OpenAPI    | —             | Swagger UI embedded, no accent         |

**Tech stack:** Vue 3 + Vite + TailwindCSS frontend; Cloudflare Pages/Workers; D3/SQLite for storage. Some React 17 islands (Swagger UI, Forge bridge surfaces).

---

## 2. Color Tokens

All tokens are defined in `colors_and_type.css` as CSS custom properties.

### 2.1 Brand / Primary

| Token                    | Value     | Usage                                   |
|--------------------------|-----------|-----------------------------------------|
| `--color-primary`        | `#0052CC` | Atlassian Blue — links, focus rings     |
| `--color-primary-hover`  | `#0747A6` | Hover state                             |
| `--color-primary-press`  | `#064395` | Active/pressed state                    |
| `--color-blue-600`       | `#2563EB` | Publish CTA button (primary action)     |
| `--color-blue-700`       | `#1D4ED8` | CTA hover                               |
| `--color-blue-800`       | `#1E40AF` | CTA active/press                        |

> **Note:** Both `#0052CC` (AUI) and `#2563EB` (Tailwind blue-600) coexist. Prefer `blue-600` for new interactive CTAs; use `#0052CC` when matching legacy AUI surfaces.

### 2.2 Diagram-Type Accents

#### Sequence (ZenUML)

| Token                     | Value     |
|---------------------------|-----------|
| `--accent-sequence-50`    | `#EFF4FF` |
| `--accent-sequence-100`   | `#DBE5FF` |
| `--accent-sequence-300`   | `#7FA1FF` |
| `--accent-sequence-500`   | `#004EEB` |
| `--accent-sequence-800`   | `#0B2A8A` |

#### Mermaid

| Token                    | Value     |
|--------------------------|-----------|
| `--accent-mermaid-50`    | `#FFF0F8` |
| `--accent-mermaid-100`   | `#FCDDED` |
| `--accent-mermaid-300`   | `#FBA8D7` |
| `--accent-mermaid-500`   | `#FF79C6` |
| `--accent-mermaid-800`   | `#9D174D` |

#### PlantUML

| Token                     | Value     |
|---------------------------|-----------|
| `--accent-plantuml-50`    | `#FEF2F2` |
| `--accent-plantuml-100`   | `#FCDADA` |
| `--accent-plantuml-300`   | `#F08784` |
| `--accent-plantuml-500`   | `#D33833` |
| `--accent-plantuml-800`   | `#7F1D1D` |

### 2.3 Atlassian Neutrals (AUI surfaces)

| Token                   | Value       | Usage                           |
|-------------------------|-------------|---------------------------------|
| `--neutral-text`        | `#172B4D`   | Primary text                    |
| `--neutral-subtle`      | `#6B778C`   | Subtitle, muted text            |
| `--neutral-border`      | `#DFE1E6`   | Borders on AUI surfaces         |
| `--neutral-bg-subtle`   | `#F4F5F7`   | Subtle background               |

### 2.4 Tailwind Gray Ramp (app chrome)

| Token        | Value     |
|--------------|-----------|
| `--gray-50`  | `#F9FAFB` |
| `--gray-100` | `#F3F4F6` |
| `--gray-200` | `#E5E7EB` |
| `--gray-300` | `#D1D5DB` |
| `--gray-400` | `#9CA3AF` |
| `--gray-500` | `#6B7280` |
| `--gray-600` | `#4B5563` |
| `--gray-700` | `#374151` |
| `--gray-800` | `#1F2937` |
| `--gray-900` | `#111827` |

### 2.5 Semantic Colors

| Token                  | Value     | Usage                            |
|------------------------|-----------|----------------------------------|
| `--color-success`      | `#36B37E` | Success states, confirmations    |
| `--color-warning`      | `#E2B203` | Warnings (AUI)                   |
| `--color-danger`       | `#CA3521` | Errors, destructive actions      |
| `--color-attention`    | `#FF5630` | "Forge" badge, high urgency      |

### 2.6 Special Surfaces

| Token           | Value     | Usage                                            |
|-----------------|-----------|--------------------------------------------------|
| `--canvas-bg`   | `#F8F7F4` | Editor workspace background (warm cream)         |
| `--canvas-dot`  | `#D0CEC7` | Dot-grid pattern color (radial-gradient, 20×20)  |

> The warm-cream canvas with subtle dot grid (`#F8F7F4` + `#D0CEC7`) is a **defining visual moment** — preserve it exactly.

### 2.7 Semantic Role Aliases

| Token               | Resolves to             | Use for              |
|---------------------|-------------------------|----------------------|
| `--fg1`             | `--neutral-text`        | Primary text         |
| `--fg2`             | `--neutral-subtle`      | Secondary text       |
| `--fg3`             | `--gray-400`            | Placeholder / muted  |
| `--fg-on-primary`   | `#FFFFFF`               | Text on filled CTAs  |
| `--bg1`             | `#FFFFFF`               | Page/card background |
| `--bg2`             | `--gray-50`             | Subtle row fill      |
| `--bg3`             | `--gray-100`            | Tab rail / chip bg   |
| `--border`          | `--gray-200`            | Default border       |
| `--border-strong`   | `--gray-300`            | Hover/focus borders  |

---

## 3. Typography

No webfont is loaded — system stack is intentional to match Confluence chrome.

### 3.1 Font Stacks

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;

--font-mono: Menlo, "Fira Code", Monaco, "source-code-pro",
             "Ubuntu Mono", "DejaVu Sans Mono", Consolas, monospace;
```

### 3.2 Type Scale

| Token           | Size  | Weight            | Line height | Usage                       |
|-----------------|-------|-------------------|-------------|-----------------------------|
| `--fs-display`  | 48px  | 700 bold          | 60px        | Intro hero h1               |
| `--fs-h1`       | 36px  | 700 bold          | 1.2         | Hero headings               |
| `--fs-h2`       | 28px  | 600 semibold      | 1.25        | Section headings            |
| `--fs-h3`       | 20px  | 600 semibold      | 1.3         | Card titles                 |
| `--fs-h4`       | 18px  | 600 semibold      | 1.3         | Small headings              |
| `--fs-body-lg`  | 16px  | 400/500           | 1.5         | Intro copy                  |
| `--fs-body`     | 14px  | 400/500           | 1.5         | **Default UI text**         |
| `--fs-body-sm`  | 13px  | 400               | 1.5         | Secondary labels            |
| `--fs-caption`  | 12px  | 400               | —           | Captions, tooltips          |
| `--fs-micro`    | 11px  | 400/500           | —           | Badges, tab counts          |

### 3.3 Weights

| Token            | Value | Usage                                |
|------------------|-------|--------------------------------------|
| `--fw-regular`   | 400   | Body copy, secondary labels          |
| `--fw-medium`    | 500   | UI chrome, buttons, nav items        |
| `--fw-semibold`  | 600   | Headings, active states, emphasis    |
| `--fw-bold`      | 700   | Hero h1, big numerals (pricing)      |

### 3.4 Special Treatments

- **Uppercase micro-labels** (e.g. the `TITLE` label left of the diagram-title input): `font-size: 11px; font-weight: 500; letter-spacing: 0.025em; text-transform: uppercase;`
- **Mono code editor**: `font-family: var(--font-mono); font-size: 15px;` (CodeMirror DSL editor)
- **Tabular-nums pricing**: `font-variant-numeric: tabular-nums;` on price displays

---

## 4. Spacing & Layout

4-pt grid throughout (Tailwind defaults).

### 4.1 Space Scale

| Token        | Value |
|--------------|-------|
| `--space-1`  | 4px   |
| `--space-2`  | 8px   |
| `--space-3`  | 12px  |
| `--space-4`  | 16px  |
| `--space-5`  | 20px  |
| `--space-6`  | 24px  |
| `--space-8`  | 32px  |
| `--space-10` | 40px  |
| `--space-12` | 48px  |

### 4.2 Layout Structure

| Region               | Spec                                                              |
|----------------------|-------------------------------------------------------------------|
| **Toolbar / header** | `height: 56px` (`h-14`); `padding: 12px 24px`; `gap: 12px`       |
| **Workspace split**  | Horizontal `Split.js` — 35% editor / 65% diagram; resizable      |
| **Gutter**           | 6px wide; 3×32px pill handle in `gray-300`, darkens on hover     |
| **Editor bg**        | `#F8F7F4` canvas with `#D0CEC7` dot-grid at 20×20                |
| **Modals**           | `fixed inset-0 z-50`; centered dialog max `680×660px`            |
| **Error bar**        | `position: sticky; bottom: 0; z-index: 1000`                     |

### 4.3 Flex / Grid Conventions

- Use `display: flex` + `gap:` for all sibling groups (buttons, chips, nav items, toolbars). Do **not** use inline flow with whitespace for UI element spacing.
- Almost no margin-based spacing — `gap-2`/`gap-3` is the universal pattern.

---

## 5. Borders, Radii & Elevation

### 5.1 Radii

| Token           | Value    | Usage                              |
|-----------------|----------|------------------------------------|
| `--radius-xs`   | 3px      | Legacy AUI buttons                 |
| `--radius-sm`   | 4px      | Small chips, tags                  |
| `--radius-md`   | 6px      | Most buttons                       |
| `--radius-lg`   | 8px      | Cards, modals, popovers            |
| `--radius-xl`   | 12px     | Large surfaces (rare)              |
| `--radius-full` | 9999px   | Pill badges, avatar rings          |

### 5.2 Borders

- **Default:** `1px solid var(--gray-200)` — workhorse for cards and chrome.
- **Title input:** `2px solid` — changes to `border-blue-500` on focus, `border-red-400` + `bg-red-50` on error. The **2px** is intentional and unusual — preserve it.
- **No inner shadows. No glass blur.** Modal backdrops are plain `rgba(0,0,0,0.5)`.

### 5.3 Shadows

| Token             | Value                                                        | Usage                      |
|-------------------|--------------------------------------------------------------|----------------------------|
| `--shadow-sm`     | `0 1px 2px rgba(0,0,0,0.05)`                                 | Subtle lift                |
| `--shadow-card`   | `0 1px 3px rgba(0,0,0,0.06)`                                 | Viewer toolbar             |
| `--shadow-md`     | `0 4px 12px rgba(0,0,0,0.10)`                                | Card hover state           |
| `--shadow-lg`     | `0 8px 24px rgba(0,0,0,0.12)`                                | Popovers                   |
| `--shadow-xl`     | `0 20px 25px -5px rgba(0,0,0,0.10), 0 8px 10px -6px …`      | Upgrade modal              |
| `--shadow-toast`  | `0 2px 8px rgba(0,0,0,0.20)`                                 | Toast notifications        |

---

## 6. Motion & Transitions

| Token       | Value  | Usage                          |
|-------------|--------|--------------------------------|
| `--t-fast`  | 150ms  | Tooltip fades                  |
| `--t-base`  | 200ms  | Color transitions (universal)  |

**Rules:**
- `transition-colors duration-200` is the universal default — color-only, no geometry.
- **No bounces, no springs, no entry animations, no parallax.**
- The **only** transform in the system is `hover:scale-105` on the `Upgrade` gold CTA — do not replicate this pattern elsewhere.
- Async spinners: `ArrowPathIcon` (Heroicons) with `animate-spin`. Used for AI title generation and code generation. No skeletons.
- Card hover: `translateY(-2px)` + `--shadow-md` — **only** on GetStarted feature/resource cards, not on app chrome cards.

---

## 7. Iconography

Three icon sources, in priority order:

### 7.1 Heroicons v2 (primary)

- **Set:** Outline only. **Stroke-width: 1.5.** 16px (`w-4 h-4`) inside buttons, 20px in headers.
- **Import:** `@heroicons/vue/24/outline/<Name>Icon` in Vue; CDN for HTML prototypes.
- **Key icons used:** `LightBulbIcon`, `QuestionMarkCircleIcon`, `SparklesIcon`, `ArrowPathIcon`, plus inline SVG literals for camera, clock, edit-pencil, copy, fullscreen.

### 7.2 Hand-rolled `Icon*.vue` components

Small set of single-purpose icons in `src/components/icons/` (copied to `assets/icons/`):
`IconChevron`, `IconEdit`, `IconLike`, `IconLikeFilled`, `IconSpark`, `IconServer`, `IconGitBranch`. Same outline-stroke style as Heroicons.

### 7.3 Macro Icons (PNG)

Pre-rendered 32×32 PNGs per diagram type — **use as-is, never redraw:**

| File                        | Diagram type       |
|-----------------------------|--------------------|
| `assets/diagram_macro_icon.png`  | Sequence / ZenUML  |
| `assets/graph_macro_icon.png`    | DrawIO / Graph     |
| `assets/openapi_macro_icon.png`  | OpenAPI / Swagger  |
| `assets/embed_macro_icon.png`    | Embed references   |

### 7.4 Rules

- Icons inherit `currentColor`. No coloured SVG icons.
- No icon font. No SVG sprite. No Font Awesome.
- Emoji used **only** in upgrade flow and GetStarted: `🚀 💡 ✓ 📚 🎥 💬 🐛`. Never in core editor chrome. Do not add new ones.
- Unicode `→` for forward-motion button affixes: `Upgrade →`, `View Documentation →`.

---

## 8. Components

### 8.1 Buttons

| Variant         | Base style                                         | Hover                  |
|-----------------|----------------------------------------------------|------------------------|
| **Primary**     | `bg-blue-600 text-white rounded-md px-4 py-2`      | `bg-blue-700`          |
| **Primary (active)** | —                                             | `bg-blue-800`          |
| **Neutral**     | `bg-transparent text-gray-500 rounded-md`          | `bg-gray-100 text-gray-700` |
| **AUI**         | `bg-[#091E4224] rounded-[3px] text-[#172B4D]`     | Atlassian AUI hover    |
| **Upgrade CTA** | Gold gradient; `hover:scale-105` (only transform)  | Gradient shift + scale |
| **Disabled**    | `bg-[#091E4208] text-[#091E424F]` — no interaction |                        |

Radius: `--radius-md` (6px) for most; `--radius-xs` (3px) for legacy AUI.

### 8.2 Toolbar / Header

- `height: 56px`, `padding: 12px 24px`, `gap: 12px`
- **Left:** Diagram-type tabs (with accent-colored dot + `-100` bg pill for active)
- **Center:** Title input (stretch, 2px border)
- **Right:** Helper icons → `Publish` CTA → `Close` (×)
- `box-shadow: var(--shadow-card)` (1px 3px, very subtle)
- Sticky at top; `z-index` above workspace.

### 8.3 Tab Switcher

- Tab rail: `bg-gray-100/50` pill container, `border-radius: 8px`
- **Active tab:** `bg-{accent}-100 text-{accent}-800` + colored dot `bg-{accent}-500`
- **Inactive tab:** `bg-white/60` on hover; `text-gray-500`
- Tabs share the same accent system as diagram types.

### 8.4 Title Input

```
border: 2px solid var(--gray-200)
border-radius: var(--radius-md)   /* 6px */
padding: 6px 12px
```
On focus → `border-color: var(--color-blue-500)`
On error → `border-color: #F87171; background: #FEF2F2`

Placeholder: `"Name your diagram…"` (lowercase, one trailing ellipsis — verbatim).

### 8.5 Cards

```
background: #FFFFFF
border: 1px solid var(--neutral-border)   /* #DFE1E6 */
border-radius: var(--radius-lg)           /* 8px */
padding: var(--space-6)                   /* 24px */
```

Hover (GetStarted cards only): `transform: translateY(-2px); box-shadow: var(--shadow-md)`

### 8.6 Modals

```
position: fixed; inset: 0; z-index: 50
backdrop: rgba(0,0,0,0.5)    /* no blur */
dialog max-width: 680px; max-height: 660px
border-radius: var(--radius-lg)
box-shadow: var(--shadow-xl)
```

### 8.7 Toast Notifications

```
border-radius: var(--radius-lg)   /* 8px */
box-shadow: var(--shadow-toast)   /* 0 2px 8px rgba(0,0,0,0.20) */
padding: 12px 16px
```
- Appear in a fixed corner (bottom-right or top-center).
- Example copy: `"Code copied to clipboard"` (sentence case, no period).

### 8.8 Paywall / Upgrade Modal

> This section is stale beyond the header text below — `UpgradePrompt.vue`'s actual current
> header is factual (see §9.1), and a repo search found no gold-gradient CTA, `✓` checkmark
> list, or "Best for" callout anywhere in that component. Needs a real re-audit against the
> live component; not attempted here, out of scope for the tone-rule fix this section came from.

- **Header text (factual, not a hero):** `"This space has reached the ZenUML Lite limit ({{n}} macros)."` / `"Existing diagrams still render. To create or edit, upgrade the space."`

### 8.9 Error / CantDisplay State

- Replaces the diagram canvas when content cannot load.
- Tone: helpful, not alarming. Offers a recovery action.

### 8.10 Debug Bar

- Compact status line or devtools panel; three variants: refined light, dark devtools, terminal status-line.

---

## 9. Voice & Copy

### 9.1 Tone

Confident, slightly nerdy, never patronising. Assumes the user knows what a sequence diagram is.
In paywall/upgrade copy, state usage as fact and keep the ask separate — never congratulate the
user on their usage immediately before asking them to pay. That sequence produced a real
negative-impression incident (a user read "you created lots of diagrams!" followed immediately by
a payment ask as a bait-and-switch). The shipped paywall modal already reflects this: its header is
literally commented `<!-- Header - Factual -->` in `UpgradePrompt.vue`, not congratulatory.

### 9.2 Rules

| Rule                | Detail                                                                         |
|---------------------|--------------------------------------------------------------------------------|
| **Casing**          | Sentence case for all headings, buttons, menu items                            |
| **Micro-labels**    | Uppercase with letter-spacing: `TITLE`                                         |
| **Proper nouns**    | Title-case: *Confluence, Forge, Mermaid, ZenUML, Atlassian, DrawIO, OpenAPI*  |
| **POV**             | Second person ("Name your diagram…"). Never first-person plural.               |
| **Verbs first**     | Buttons are short imperatives: `Publish`, `Edit`, `Fullscreen`, `Upgrade →`    |
| **Sentence length** | Most UI strings < 12 words                                                     |
| **Arrows**          | Plain ASCII `→` for forward motion: `Upgrade →`, `View Documentation →`       |
| **Periods**         | No trailing period on toasts, labels, or buttons                               |
| **Emoji**           | Only in upgrade flow and GetStarted. Never in core chrome.                     |

### 9.3 Verbatim Copy Reference

| Context                  | String                                                                                      |
|--------------------------|---------------------------------------------------------------------------------------------|
| Title placeholder        | `Name your diagram…`                                                                        |
| Disabled publish tooltip | `Add a diagram title to publish`                                                            |
| Copy success toast       | `Code copied to clipboard`                                                                  |
| Paywall modal header     | `This space has reached the ZenUML Lite limit ({{n}} macros).` / `Existing diagrams still render. To create or edit, upgrade the space.` (factual, not congratulatory — see §9.1) |
| Best-for callout         | `Best for: Multiple spaces heavily use this app`                                            |
| GetStarted hero          | `Welcome to ZenUML Diagrams!`                                                               |
| GetStarted instruction   | `Navigate to any Confluence page and use the "+" button to insert a ZenUML macro`          |
| AI notice                | `This is an experimental feature, and your data will be sent to Cloudflare. Cloudflare will not use your data as training data.` |

---

## 10. Product Variants

### Variant Colour Bars

Each variant has a coloured left bar in the viewer header identifying the product:

| Variant       | Color              | Hex       |
|---------------|--------------------|-----------|
| Full          | `--product-full`   | `#3B82F6` |
| Lite          | `--product-lite`   | `#F97316` |
| Diagramly     | `--product-diagramly` | `#A855F7` |

### Lite Paywall Behaviour

- Default `15` continue attempts stored in `localStorage` keyed `paywallContinueAttempts:domain:space:user`.
- Each attempt decrements the counter and lets the user reach the editor and save normally.
- When counter hits `0`, Continue-editing button becomes non-clickable ("Request extension").
- Paywall copy uses the congratulatory-before-transactional pattern.

---

## 11. Assets

All assets live in `assets/` (copied from `conf-app/public/image/` and `conf-app/src/assets/`).

| File                          | Description                                              |
|-------------------------------|----------------------------------------------------------|
| `assets/zenuml_brand.png`     | **Primary logo.** White "H–H" glyph on Atlassian-blue square. Use this. |
| `assets/diagram_macro_icon.png` | Sequence / ZenUML macro icon (32×32 PNG)               |
| `assets/graph_macro_icon.png`   | DrawIO / Graph macro icon (32×32 PNG)                  |
| `assets/openapi_macro_icon.png` | OpenAPI / Swagger macro icon (32×32 PNG)               |
| `assets/embed_macro_icon.png`   | Embed reference macro icon (32×32 PNG)                 |
| `assets/diagram-example.webp`   | Example diagram screenshot                             |
| `assets/default_avatar.png`     | Default user avatar                                    |
| `assets/ai-aide-logo.png`       | AI assistant logo                                      |
| `assets/icons/`                 | Hand-rolled Vue icon components (outline stroke 1.5)   |

> `assets/zenuml_logo.png` is a generic placeholder shipped in the repo — **do not use it.** Use `zenuml_brand.png`.

---

## 12. Do / Don't

| ✅ Do                                                                                   | ❌ Don't                                                    |
|----------------------------------------------------------------------------------------|-------------------------------------------------------------|
| Use sentence case for all UI strings                                                   | Title-case headings or buttons                              |
| Use `gap:` with flex/grid for spacing sibling elements                                 | Use margin or whitespace between inline UI elements         |
| Use the warm-cream canvas bg (`#F8F7F4`) with dot-grid for the diagram workspace       | Use a plain white or gray editor background                 |
| Use 2px border on the title input (changes color on focus/error)                       | Use 1px on the title input                                  |
| Use `→` (ASCII arrow) for forward-motion CTAs                                          | Use `»`, `▶`, or emoji arrows in buttons                   |
| Use Heroicons v2 outline at stroke-width 1.5                                           | Use filled icons, Font Awesome, or SVG sprites              |
| Use `transition-colors duration-200` for hover states                                  | Add bounce, spring, or scale animations (except Upgrade CTA)|
| Use `hover:scale-105` only on the Upgrade gold CTA                                     | Scale other buttons or cards on hover                       |
| State usage neutrally, keep the upgrade ask in its own section                         | Congratulate the user right before asking them to pay       |
| Use system font stack (no webfont)                                                     | Load Google Fonts or custom webfonts                        |
| Use `rgba(0,0,0,0.5)` for modal backdrops                                              | Use backdrop-filter blur                                    |
| Use `translateY(-2px)` card hover only on GetStarted cards                             | Lift app-chrome cards on hover                              |
| Use macro icon PNGs from `assets/` as-is                                               | Redraw or restyle macro icons                               |

---

*Generated from the ZenUML for Confluence Design System project. For questions, see `README.md`.*
