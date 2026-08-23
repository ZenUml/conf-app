<template>
  <div class="feed" data-testid="homepage-feed-card">
    <!-- Loading: ghost rows sized like real ones, so the panel resizes once
         (skeleton -> content) rather than twice. -->
    <div v-if="loading" class="rows" data-testid="homepage-feed-loading" aria-hidden="true">
      <div v-for="g in GHOSTS" :key="g.title" class="row row--ghost">
        <span class="ghost" :style="{ height: '11px', width: g.title }"></span>
        <span class="ghost" :style="{ height: '9px', width: g.meta, marginTop: '5px' }"></span>
      </div>
    </div>

    <template v-else>
      <!-- The viewer's own diagrams: the shortest path back to work already
           in progress. Each row navigates to the page carrying that diagram. -->
      <div v-if="diagrams.length" class="rows" data-testid="homepage-feed-recent">
        <button
          v-for="d in diagrams"
          :key="d.contentId"
          type="button"
          class="row row--link"
          :style="{ '--spine': spineColor(d.diagramType) }"
          :data-testid="`homepage-feed-diagram-${d.contentId}`"
          @click="openDiagram(d)"
        >
          <span class="row__body">
            <span class="row__title">{{ d.title || 'Untitled diagram' }}</span>
            <span class="row__meta">
              {{ typeLabel(d.diagramType) }}<template v-if="d.spaceKey"> · {{ d.spaceKey }}</template>
            </span>
          </span>
        </button>
      </div>

      <!-- Example rows for the types the viewer has no diagram of. They fill
           the list to four, so someone with a full shelf still sees one type
           they have not tried — the measured problem this card exists for is
           creators who make exactly one diagram and never a second. -->
      <div v-if="examples.length" data-testid="homepage-feed-examples">
        <div class="eyebrow">Examples</div>
        <div class="rows">
          <div v-for="e in examples" :key="e.key" class="row-group" :class="{ 'row-group--open': openExample === e.key }">
            <button
              type="button"
              class="row row--disclose"
              :style="{ '--spine': e.spine }"
              :aria-expanded="openExample === e.key ? 'true' : 'false'"
              :data-testid="`homepage-feed-example-${e.key}`"
              @click="toggleExample(e)"
            >
              <span class="row__body">
                <span class="row__title">{{ e.title }}</span>
                <span class="row__meta">{{ e.meta }}</span>
              </span>
              <svg class="chev" :class="{ 'chev--up': openExample === e.key }" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div v-if="openExample === e.key" class="disclosure">
              <!-- src is bound only once the row has been opened: four PNGs
                   eagerly on every Home-page mount is waste. Paths stay
                   relative — Vite builds with base './' and an absolute
                   /image/ URL breaks against the Forge CDN's hashed paths. -->
              <img v-if="loadedImages[e.key]" :src="e.image" :alt="`${e.title} example`" />
              <p>Add one from the <b>+</b> menu on any page.</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Outside the loading branch on purpose: the one control that is always
         available must not appear late and push the list under the pointer. -->
    <button
      type="button"
      class="action"
      data-testid="homepage-feed-action"
      @click="openQuickStart"
    >
      View the quick-start guide
    </button>
  </div>
</template>

<script setup>
// confluence:homepageFeed card (see manifest.yml). Confluence renders this in
// the right panel of the Home page — a surface with no page/content context,
// so "insert a macro here" is not an actionable link the way it is from
// GetStarted.vue (which sits inside a specific page's editor context).
//
// One list in every state, and two kinds of row serving two different jobs:
//
//  - A DIAGRAM row serves "get me back to what I was working on". It navigates
//    to the page carrying that diagram. `searchDiagramsForge` runs a CQL search
//    ordered by lastmodified and needs no page context (DocumentList.vue calls
//    its sibling the same way); every scope it needs — search:confluence,
//    read:custom-content:confluence, read:content:confluence — is already
//    granted, so this reads live data without a manifest permission change.
//    Each hit carries spaceKey + pageId, which is exactly what router.navigate
//    needs.
//
//  - An EXAMPLE row serves recognition, not education: show me what this is,
//    so I reach for it the day I need it. Nobody's job on the Home page is
//    "look at an example", and nothing here can create a diagram, so the row
//    opens the picture in place rather than navigating anywhere. The chevron
//    marks which kind of row it is before the click.
//
// The opened example shows a PICTURE and not a code snippet because Graph has
// no text form at all (DiagramTypeConfig.ts: DrawIO editor, empty
// storeUpdateAction). A snippet-and-picture pairing would be missing on one of
// the four types; a picture is the one shape all four can keep.
//
// There is deliberately no "create a diagram" button. Creating requires a host
// page to attach the custom content to; GetStarted.vue proves the point by
// toasting "go insert a macro" rather than navigating anywhere. A button that
// cannot do what it says is worse than no button.
//
// Copy stays brand-neutral: this module ships on lite/full/diagramly (asyncapi
// strips it), so the product name never appears in the body — only the
// manifest title carries ${LITE_TITLE_SUFFIX}.
import { onMounted, ref, computed } from "vue";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { navigateToPage, openUrl } from "@/model/globals/forgeGlobal";
import globals from "@/model/globals";
import { typeLabel, toMacroType } from "@/utils/byline/pageDiagrams";
import { DiagramType } from "@/model/Diagram/Diagram";

const QUICK_START_URL = "https://zenuml.atlassian.net/wiki/spaces/Doc/overview";

// Up to three of the viewer's own diagrams, then example rows until the list
// holds four. Fetch a few more candidates than that: hits whose parent page
// cannot be resolved are dropped.
const ROWS_TOTAL = 4;
const OWN_SHOWN = 3;
const CANDIDATES_FETCHED = 8;

// Order is measured, not intuition: over the 90 days to 2026-08-07,
// macro_create_succeeded on product_type lite counted 15,577 flowchart creates
// (mermaid 13,698 + plantuml 1,879) against 2,852 graph, 1,885 sequence and
// 1,481 openapi. Row text is the same copy the byline type picker ships.
//
// Spine colours come from the design system's per-type accent tokens
// (colors_and_type.css in the ZenUML for Confluence Design System project),
// which are the diagram engines' own brand colours: mermaid Radical Red,
// draw.io Tahiti Gold, OpenAPI Initiative green, ZenUML cerulean.
const EXAMPLES = [
  {
    key: "flowchart",
    title: "Flowchart",
    meta: "Mermaid or PlantUML",
    spine: "#FF3670",
    macroType: "mermaid",
    image: "./image/byline-example-flowchart.png",
  },
  {
    key: "graph",
    title: "Graph",
    meta: "Free-form, DrawIO",
    spine: "#F08705",
    macroType: "graph",
    image: "./image/byline-example-graph.png",
  },
  {
    key: "sequence",
    title: "Sequence",
    meta: "Who calls what, in order",
    spine: "#0094D9",
    macroType: "sequence",
    image: "./image/byline-example-sequence.png",
  },
  {
    key: "openapi",
    title: "OpenAPI",
    meta: "Render a spec inline",
    spine: "#6BA539",
    macroType: "openapi",
    image: "./image/byline-example-openapi.png",
  },
];

// Which example row a stored diagramType already covers. Mermaid and PlantUML
// both collapse onto "flowchart", the same way typeLabel renders both as
// "Flowchart" — a viewer with a Mermaid diagram has tried flowcharts.
const EXAMPLE_KEY_BY_DIAGRAM_TYPE = {
  [DiagramType.Sequence]: "sequence",
  [DiagramType.Mermaid]: "flowchart",
  [DiagramType.PlantUml]: "flowchart",
  [DiagramType.Graph]: "graph",
  [DiagramType.OpenApi]: "openapi",
};

const SPINE_COLORS = {
  [DiagramType.Sequence]: "#0094D9",
  [DiagramType.Mermaid]: "#FF3670",
  [DiagramType.PlantUml]: "#FF3670",
  [DiagramType.Graph]: "#F08705",
  [DiagramType.OpenApi]: "#6BA539",
};
const SPINE_FALLBACK = "#9CA3AF";

// Both tables above are keyed on the DiagramType enum, whose OpenApi member is
// spelled 'OpenAPI' while real bodies store 'openapi' (verified on lite-dev
// 2026-08-21, custom content 67600411). Fold the key the same way typeLabel
// does, so an OpenAPI row gets its own colour and stops asking the viewer to
// try a type they already have.
function foldedLookup(table, diagramType) {
  const exact = table[diagramType];
  if (exact) return exact;
  const folded = String(diagramType ?? "").toLowerCase();
  const key = Object.keys(table).find((k) => k.toLowerCase() === folded);
  return key ? table[key] : undefined;
}

const GHOSTS = [
  { title: "72%", meta: "46%" },
  { title: "58%", meta: "40%" },
  { title: "66%", meta: "44%" },
];

const loading = ref(true);
const diagrams = ref([]);
const openExample = ref(null);
const loadedImages = ref({});

const examples = computed(() => {
  const covered = new Set(
    diagrams.value
      .map((d) => foldedLookup(EXAMPLE_KEY_BY_DIAGRAM_TYPE, d.diagramType))
      .filter(Boolean),
  );
  const slots = Math.max(0, ROWS_TOTAL - diagrams.value.length);
  return EXAMPLES.filter((e) => !covered.has(e.key)).slice(0, slots);
});

function baseProps() {
  return {
    feature_area: "homepage_feed",
    surface: "route",
    entry_point: "route",
  };
}

function spineColor(diagramType) {
  return foldedLookup(SPINE_COLORS, diagramType) || SPINE_FALLBACK;
}

async function loadRecent() {
  try {
    const hits = await globals.apWrapper.searchDiagramsForge({
      maxCandidates: CANDIDATES_FETCHED,
    });
    // A row that cannot navigate is not a row: without pageId there is nothing
    // for router.navigate to open, so drop the hit rather than render a control
    // that does nothing when clicked.
    diagrams.value = (hits || [])
      .filter((h) => h && h.pageId && h.spaceKey)
      .slice(0, OWN_SHOWN);
  } catch (e) {
    // searchDiagramsForge already logs and returns [] on failure; this catch
    // only covers the wrapper itself being unavailable. Either way the card
    // falls through to a full set of example rows, which is the correct thing
    // to show someone whose diagram list cannot be read.
    console.error("[homepageFeed] recent diagram lookup failed", e);
    diagrams.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  trackAnalyticsEvent("homepage_feed_viewed", baseProps());
  void loadRecent();
});

async function openDiagram(hit) {
  trackAnalyticsEvent("homepage_feed_diagram_opened", {
    ...baseProps(),
    macro_type: toMacroType(hit.diagramType),
  });
  await navigateToPage(hit.spaceKey, hit.pageId);
}

function toggleExample(example) {
  // Accordion: sequence's example is 700x560, which is ~187px tall at the
  // ~234px of drawable width this card gets. Two open at once would make a
  // 500px card in a right-panel slot.
  if (openExample.value === example.key) {
    openExample.value = null;
    return;
  }
  openExample.value = example.key;
  loadedImages.value = { ...loadedImages.value, [example.key]: true };
  trackAnalyticsEvent("homepage_feed_example_expanded", {
    ...baseProps(),
    macro_type: example.macroType,
  });
}

async function openQuickStart() {
  trackAnalyticsEvent("homepage_feed_action_clicked", baseProps());
  await openUrl(QUICK_START_URL);
}

defineExpose({
  openQuickStart,
  openDiagram,
  toggleExample,
  QUICK_START_URL,
  EXAMPLES,
  diagrams,
  examples,
  openExample,
  loading,
});
</script>

<style scoped>
.feed {
  --ink: #172b4d;
  --muted: #6b778c;
  --link: #0052cc;
  --rule: #dfe1e6;
  --wash: #f4f5f7;
  --ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 4px 12px;
  font-family: var(--ui);
  color: var(--ink);
}

.rows {
  border-top: 1px solid var(--rule);
}
.rows > * {
  border-bottom: 1px solid var(--rule);
}

.eyebrow {
  padding: 0 0 5px 12px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}

.row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 6px 8px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
}
.row--link,
.row--disclose {
  cursor: pointer;
}
.row--link::before,
.row--disclose::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 9px;
  bottom: 9px;
  width: 2px;
  border-radius: 1px;
  background: var(--spine, #9ca3af);
}
.row--link:hover,
.row--disclose:hover {
  background: var(--wash);
}
.row--link:focus-visible,
.row--disclose:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: -2px;
}

.row__body {
  flex-grow: 1;
  min-width: 0;
}
.row__title {
  display: block;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__meta {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chev {
  flex: none;
  margin-top: 3px;
  color: var(--muted);
}
@media (prefers-reduced-motion: no-preference) {
  .chev {
    transition: transform 150ms ease;
  }
}
.chev--up {
  transform: rotate(180deg);
}

.row-group--open {
  background: var(--wash);
}
.disclosure {
  padding: 0 10px 10px 12px;
}
.disclosure img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--rule);
  border-radius: 3px;
  background: #fff;
}
.disclosure p {
  margin: 7px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
}
.disclosure b {
  font-weight: 600;
  color: var(--ink);
}

.row--ghost {
  display: block;
  padding: 9px 6px 9px 12px;
}
.ghost {
  display: block;
  border-radius: 2px;
  background: var(--wash);
}

.action {
  align-self: flex-start;
  padding: 6px 12px;
  border: 1px solid var(--link);
  border-radius: 4px;
  background: #fff;
  color: var(--link);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.action:hover {
  background: #deebff;
}
.action:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: 2px;
}
</style>
