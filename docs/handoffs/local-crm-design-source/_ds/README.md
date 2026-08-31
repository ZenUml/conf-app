# ZenUML for Confluence — Design System

## What this is

A design system extracted from the **ZenUML for Confluence** codebase — an Atlassian Marketplace app (hybrid Forge / Connect) that lets Confluence users author and embed:

- **Sequence diagrams** (ZenUML DSL) — *cerulean* accent (`#0094D9`, ZenUML brand)
- **Mermaid** diagrams — *radical red* accent (`#FF3670`, Mermaid brand)
- **PlantUML** diagrams — *rust* accent (`#B84800`, darkened from PlantUML brand `#D75500`)
- **DrawIO Graph** diagrams — *orange* accent (`#F08705`, draw.io brand)
- **OpenAPI / Swagger** specs — *green* accent (`#6BA539`, OpenAPI Initiative)
- Embedded references to all of the above

The app ships in three product variants:

| Variant     | Color bar  | Notes                                    |
|-------------|------------|------------------------------------------|
| **Full**    | blue-500   | All diagram types, paid                  |
| **Lite**    | orange-500 | Free with macro limit + upgrade paywall  |
| **Diagramly** | purple-500 | Sister AI-diagramming product          |

Tech stack: **Vue 3** + **Vite** + **TailwindCSS** for the frontend, **Cloudflare Pages/Workers** for hosting, **D1** for storage. Some React 17 islands (Swagger UI, Forge bridge surfaces).

## Sources

- **Codebase** — `conf-app/` (Atlassian Forge + Connect hybrid app)
- Style sources: `conf-app/tailwind.config.js`, `conf-app/src/assets/tailwind.css`, `conf-app/public/css/addon.css`, `conf-app/src/components/AUI/Button.vue`, inline Tailwind in every `*.vue` template.
- Asset sources: `conf-app/public/image/*`, `conf-app/src/assets/*`, `conf-app/src/components/icons/*`.

No Figma was provided.

## Index

| File                       | Purpose                                                   |
|----------------------------|-----------------------------------------------------------|
| `colors_and_type.css`      | All color, type, spacing, radii, shadow tokens            |
| `assets/`                  | Logos, product icons, illustrations                       |
| `assets/icons/`            | Vue icon components (copied — see ICONOGRAPHY)            |
| `preview/`                 | Design-system preview cards (Type / Color / Components)   |
| `ui_kits/diagram-editor/`  | UI kit for the in-page diagram editor                     |
| `ui_kits/diagram-viewer/`  | UI kit for the read-only viewer + paywall                 |
| `components/`              | Built React components (see Components below)              |
| `SKILL.md`                 | Skill manifest (cross-compatible with Claude Code)        |

## Components

- **Button** — `components/Button/` — primary, secondary, outline, ghost, danger, disabled.
- **TabSwitcher** — `components/TabSwitcher/` — diagram-type tabs with accent-tinted active state.
- **TitleInput** — `components/TitleInput/` — inline-editable title with uppercase micro-label.

---

## Content fundamentals

### Voice

- **Plain, helpful, mildly playful.** The product talks like a senior engineer who's relieved you're using a real diagram instead of a screenshot. No corporate fluff, no marketing-speak.
- **Second person.** Talks *to* the user (“Name your diagram…”, “Your team is now ready to…”). Never first-person plural.
- **Action verbs first.** Buttons are short imperatives: `Publish`, `Edit`, `Fullscreen`, `Copy Code`, `Export`, `Upgrade →`.
- **Short sentences.** Most UI strings are <12 words. The longest run-on copy is in marketing CTAs.
- **A little emoji, sparingly.** Used as ornaments in upgrade flow only — `🚀` (paywall achievement), `💡` (best-for tip), `✓` (feature checkmarks), `📚 🎥 💬 🐛` (resource cards in GetStarted). Never in core editor chrome.
- **Arrows for forward motion.** `Upgrade →`, `View Documentation →`, `Why do I need to upgrade? →`. Convention is plain ASCII arrow + space.

### Casing

- **Sentence case** for all headings, buttons, menu items: *“Quick start tutorial”*, *“Pick the upgrade that fits your team”*, *“Continue editing without upgrading”*.
- **Uppercase micro-labels** with letter-spacing for tiny in-control labels: `TITLE` (left of the diagram-title input).
- **Title-cased proper nouns only.** *Confluence*, *Forge*, *Mermaid*, *ZenUML*, *Atlassian*, *DrawIO*, *OpenAPI*.

### Specific examples (lifted verbatim)

- Empty title placeholder: `Name your diagram…` (one trailing ellipsis, lowercase).
- Disabled-publish tooltip: `Add a diagram title to publish`.
- Toast on successful copy: `Code copied to clipboard`.
- Paywall hero: `Awesome progress—{{n}} diagrams already! Unlock unlimited access to keep building.`
- Best-for callout: `Best for: Multiple spaces heavily use this app`.
- Get Started hero: `Welcome to ZenUML Diagrams!`
- Get Started instruction: `Navigate to any Confluence page and use the "+" button to insert a ZenUML macro`.
- AI feature notice: `This is an experimental feature, and your data will be sent to Cloudflare. Cloudflare will not use your data as training data.`

### Vibe

Confident, slightly nerdy, never patronising. The product assumes you know what a sequence diagram is. When it nudges (toasts, paywall) the tone is congratulatory before transactional — *"Awesome progress"* before *"Upgrade"*.

---

## Visual foundations

### Color

- **Primary** is Atlassian Blue `#0052CC` (Tailwind-extended `primary`) — used for links, focus rings, the `Publish` CTA. Hover steps to `#0747A6`. Most buttons in newer code use Tailwind `blue-600` (`#2563EB`) — both ramps coexist.
- **Diagram-type accents** drive identity inside the editor: amber=sequence, emerald=mermaid, violet=plantuml. The *active* tab pill uses the `-100` background + `-800` text + `-500` dot. Inactive tabs are gray.
- **Atlassian neutrals** (`#172B4D` text, `#6B778C` subtle, `#DFE1E6` border, `#F4F5F7` subtle bg) appear in the older AUI surfaces (Get Started, AUI Button, default avatar surfaces). Newer Tailwind chrome uses gray-50→gray-900 — both palettes are mixed in the codebase.
- **Status colors:** `#36B37E` success, `#E2B203` warning, `#CA3521` danger, `#FF5630` attention (the "Forge" badge).

### Type

- **System sans** stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica Neue, Arial, sans-serif`. No webfont — intentional, to match Confluence chrome.
- **Mono**: `Menlo, "Fira Code", Monaco, source-code-pro, "Ubuntu Mono", "DejaVu Sans Mono", Consolas, monospace` — used in the CodeMirror DSL editor at 15px.
- **Scale:** 48 / 36 / 28 / 20 / 18 / 16 / 14 / 13 / 12 / 11. Body is **14px**. Heroes climb to 36–48 with 60px line-height.
- **Weights** mostly `500` (medium) and `600` (semibold). Bold (`700`) reserved for hero h1 and big numerals.
- **Letter-spacing** used only on the uppercase `TITLE` micro-label and on `tabular-nums` price displays.

### Spacing & layout

- 4-pt grid throughout (Tailwind defaults). The chrome uses `gap-2`/`gap-3` everywhere with flex layouts — almost no margin-based spacing.
- **Toolbar header is 56px tall** (`h-14`), with `px-6 py-3` and `gap-3`.
- **Workspace** is a horizontal `Split.js` 35/65 split (editor / diagram). Resizable 6px gutter, with a 3×32px handle pill in `gray-300` that darkens on hover.
- **Editor canvas background:** `#F8F7F4` (warm cream) with a `#D0CEC7` 1px-radial-gradient dot pattern at 20×20 — the sole "texture" in the system. *This is a defining visual moment.*
- **No full-bleed imagery.** The Get Started hero is the only filled large surface, using a blue-to-indigo linear gradient (`#0052CC → #0747A6`).

### Borders, radii, elevation

- **Radii:** `3px` (legacy AUI button), `4px` (small chips), `6px` (most buttons), `8px` (cards/modals), `12px` and full pills exist but are rare.
- **Borders:** 1px in `gray-200` is the workhorse. The title input uses **2px** borders that change color on focus (`border-blue-500`) and error (`border-red-400` + `bg-red-50`) — the *2px* is unusual; preserve it.
- **Shadows** are subtle. The viewer toolbar uses `0 1px 3px rgba(0,0,0,0.06)`. Cards/upgrade modal use `shadow-xl`. Toasts use `0 2px 8px rgba(0,0,0,0.20)`.
- **No inner shadows.** No glass blur. Backdrops are plain `rgba(0,0,0,0.5)` for modals.

### Hover, focus, press

- Hover on neutral buttons: bg shifts to `gray-100`, text darkens to `gray-700` (`text-gray-500 → text-gray-700`).
- Hover on filled CTAs: blue-600 → blue-700 → blue-800 (active).
- The `Upgrade` gold CTA is the *only* place with a transform: `hover:scale-105` and gradient stop shift. Otherwise no scale/translate motion on hover.
- Focus uses `ring-2 ring-offset-2 ring-{accent}-400` per diagram type.
- Press: `active:bg-blue-800` for primary; AUI buttons just darken via the disabled state.

### Animation

- **Transitions:** `transition-colors duration-200` is the universal default. `duration-150` for tooltip fades. **No bounces, no springs.** Linear/ease colour-only changes.
- **Spinners** for async work — a Heroicons `ArrowPathIcon` with `animate-spin`. Used during AI title generation and code generation. No skeletons — just inline spinners + “Generating diagram code…”.
- **No page transitions, no parallax, no entry animations.**

### Transparency & blur

- Translucency is rare: `bg-white/60` on hover surface for inactive tabs, `bg-gray-100/50` as the tab-switcher rail. Modal backdrops are `bg-black bg-opacity-50` (no blur).

### Cards

- White (`#FFF`) bg, 1px `#DFE1E6` (Atlassian gray) or `gray-200` border, 8px radius, 24px padding. Hover lifts `translateY(-2px)` + `0 4px 12px rgba(0,0,0,0.10)` shadow — *only* on the GetStarted feature/resource cards, not on app chrome cards.

### Iconography color treatment

- Icons inherit `currentColor`. Stroke icons at `1.5` stroke-width, 16–20px box. No coloured icons except product macro icons which are pre-rendered PNGs (see ICONOGRAPHY).

### Imagery

- One `.webp` example diagram, default avatars (PNG), and the warm-toned ZenUML logo (sequence-diagram glyph). No photography. No illustrations beyond stock icons. Imagery vibe: **flat, technical, no grain, no gradient overlays**.

### Layout rules / fixed elements

- The **Header** is sticky at top of the workspace. Tabs left, title input center-stretched, helpers + Publish + Close right.
- The syntax-error box is `position: sticky; bottom: 0` with `z-1000`.
- Modals are `fixed inset-0 z-50` with a centered dialog (max 680×660 for upgrade prompts).

---

## Iconography

The codebase uses **three** icon sources, in this priority order — match it.

1. **`@heroicons/vue` (Heroicons v2 outline)** — the primary system. Stroke `1.5`, mostly 16px (`w-4 h-4`) inside buttons, 20px in headers. Direct imports like `@heroicons/vue/24/outline/SparklesIcon`. Used for: `LightBulbIcon`, `QuestionMarkCircleIcon`, `SparklesIcon`, `ArrowPathIcon` and many inline `<svg>` Heroicons literals (camera, clock, edit pencil, copy, fullscreen). **For prototypes use the Heroicons CDN** (see `assets/icons-cdn.md`).

2. **Hand-rolled `Icon*.vue` components** in `src/components/icons/` — small set of single-purpose icons (`IconChevron`, `IconEdit`, `IconLike`, `IconLikeFilled`, `IconSpark`, `IconServer`, `IconGitBranch`, etc). Drawn in the same outline-stroke style. Copied verbatim to `assets/icons/` — read these for exact paths when you need them.

3. **Pre-rendered PNG macro icons** for the four diagram types: `assets/diagram_macro_icon.png`, `assets/graph_macro_icon.png`, `assets/openapi_macro_icon.png`, plus an embedded base64 mermaid icon used inline in `GetStarted.vue`. These are 32×32 PNGs with brand-typical color (orange + cream ZenUML mark). **Use these as-is whenever you need a "diagram" or "API spec" icon — never redraw.**

- **No icon font.** No SVG sprite. No Font Awesome.
- **Emoji** are used as decorative ornaments in upgrade & GetStarted flows only — `🚀 💡 ✓ 📚 🎥 💬 🐛`. Not in core chrome. Don't add new ones.
- **Unicode arrows** (`→`) are used as button text affixes for forward motion. Common pattern: `Upgrade →`.
- The ZenUML brand mark (`assets/zenuml_brand.png`) is the only logo — a white "H–H" sequence-diagram glyph on Atlassian-blue square. (`assets/zenuml_logo.png` is a generic placeholder shipped in the repo — don't use it.)

> **Substitution flag:** for new prototypes use Heroicons via the official CDN (`https://unpkg.com/heroicons/...` or inline copy paths from heroicons.com). The codebase uses *outline* set at stroke-width 1.5 — match that.

---

## Caveats

- No fonts to ship — the system stack is intentional. If you want a webfont, ask.
- No marketing site / landing-page surfaces in the codebase — only in-product UI.
- The `server-svgrepo-com.svg` failed to copy (encoding). It's an unused asset; safe to ignore.
- Heroicons v2 is referenced — for HTML prototypes, use the CDN.
