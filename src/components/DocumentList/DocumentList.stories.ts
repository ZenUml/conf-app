import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { DiagramType } from '@/model/Diagram/Diagram'

/**
 * DocumentList is a full-page embed-editor component that loads its own data
 * via Forge globals (`globals.apWrapper`, `forgeGlobal`). Rather than mock the
 * entire runtime, these stories render a structural facsimile of the component's
 * template — the left-panel list + right-panel preview placeholder — driven by
 * static prop data so every state is reproducible without a Forge connection.
 */

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

type CustomContentItem = {
  id: string
  title: string
  container: { id: string; title: string }
  value: { diagramType: string; code?: string }
}

const SAMPLE_ITEMS: CustomContentItem[] = [
  {
    id: 'cc-001',
    title: 'User Authentication Flow',
    container: { id: 'page-1', title: 'Backend Architecture' },
    value: { diagramType: DiagramType.Sequence, code: 'A -> B: login()\nB -> A: token' },
  },
  {
    id: 'cc-002',
    title: 'CI/CD Pipeline',
    container: { id: 'page-1', title: 'Backend Architecture' },
    value: { diagramType: DiagramType.Mermaid, code: 'graph LR\n  A[Commit] --> B[Build]\n  B --> C[Deploy]' },
  },
  {
    id: 'cc-003',
    title: 'System Context Diagram',
    container: { id: 'page-2', title: 'Cloud Infrastructure' },
    value: { diagramType: DiagramType.Graph },
  },
  {
    id: 'cc-004',
    title: 'Payment API Spec',
    container: { id: 'page-2', title: 'Cloud Infrastructure' },
    value: { diagramType: DiagramType.OpenApi },
  },
  {
    id: 'cc-005',
    title: 'Order State Machine',
    container: { id: 'page-3', title: 'Order Service' },
    value: { diagramType: DiagramType.Mermaid, code: 'stateDiagram-v2\n  [*] --> Placed\n  Placed --> Shipped' },
  },
]

// ---------------------------------------------------------------------------
// Shared shell component definition (plain object — no Vue named imports)
// ---------------------------------------------------------------------------

/**
 * Inline facsimile of DocumentList.vue's template. Accepts `items`, `pickedId`,
 * and `isLoading` as props so each story can drive a distinct visual state
 * without wiring up Forge globals or Vuex.
 */
const DocumentListShell = {
  name: 'DocumentListShell',
  props: {
    items: { type: Array as () => CustomContentItem[], default: () => [] },
    pickedId: { type: String as () => string | null, default: null },
    isLoading: { type: Boolean, default: false },
  },
  data(this: { items: CustomContentItem[]; pickedId: string | null }) {
    return {
      picked: this.items.find((i) => i.id === this.pickedId) ?? null as CustomContentItem | null,
      filterKeyword: '',
      docTypeFilter: '',
    }
  },
  computed: {
    filteredItems(this: { items: CustomContentItem[]; docTypeFilter: string; filterKeyword: string }): CustomContentItem[] {
      return this.items.filter((item) => {
        if (this.docTypeFilter && item.value.diagramType !== this.docTypeFilter) return false
        if (this.filterKeyword) {
          const kw = this.filterKeyword.toLowerCase()
          if (
            !item.title.toLowerCase().includes(kw) &&
            !item.container.title.toLowerCase().includes(kw)
          )
            return false
        }
        return true
      })
    },
    groupedPages(this: { filteredItems: CustomContentItem[] }): Array<{ id: string; title: string; customContents: CustomContentItem[] }> {
      const map: Record<string, CustomContentItem[]> = {}
      for (const item of this.filteredItems) {
        const key = item.container.id
        if (!map[key]) map[key] = []
        map[key].push(item)
      }
      return Object.entries(map).map(([, contents]) => ({
        ...contents[0].container,
        customContents: contents,
      }))
    },
  },
  methods: {
    setFilter(this: { docTypeFilter: string }, type: string) {
      this.docTypeFilter = type
    },
  },
  template: `
    <div class="content">
      <div class="workspace h-screen flex flex-col">
        <!-- Header -->
        <header class="flex flex-shrink-0">
          <div class="flex-1 flex items-center justify-between bg-white px-6 border-b">
            <nav class="flex text-sm font-medium leading-none text-slate-800">
              <a href="#" class="inline-block ml-2 px-3 py-2 rounded-lg"
                :class="docTypeFilter === '' ? 'bg-gray-200' : 'hover:bg-gray-200'"
                @click.prevent="setFilter('')">All</a>
              <a href="#" class="inline-block ml-2 px-3 py-2 rounded-lg"
                :class="docTypeFilter === 'sequence' ? 'bg-gray-200' : 'hover:bg-gray-200'"
                @click.prevent="setFilter('sequence')">Sequence</a>
              <a href="#" class="inline-block ml-2 px-3 py-2 rounded-lg"
                :class="docTypeFilter === 'mermaid' ? 'bg-gray-200' : 'hover:bg-gray-200'"
                @click.prevent="setFilter('mermaid')">Mermaid</a>
              <a href="#" class="inline-block ml-2 px-3 py-2 rounded-lg"
                :class="docTypeFilter === 'graph' ? 'bg-gray-200' : 'hover:bg-gray-200'"
                @click.prevent="setFilter('graph')">Graph</a>
              <a href="#" class="inline-block ml-2 px-3 py-2 rounded-lg"
                :class="docTypeFilter === 'OpenAPI' ? 'bg-gray-200' : 'hover:bg-gray-200'"
                @click.prevent="setFilter('OpenAPI')">Open API</a>
            </nav>
            <div class="px-4 py-3">
              <button disabled class="px-4 py-2 rounded text-sm bg-blue-600 text-white opacity-40 cursor-default">Publish</button>
            </div>
          </div>
        </header>

        <!-- Body -->
        <div class="flex-1 flex overflow-hidden">
          <main class="flex bg-gray-200 flex-1">

            <!-- Left panel -->
            <div class="flex flex-col w-full max-w-xs flex-grow border-l border-r bg-white">
              <div class="flex flex-shrink-0 items-center px-4 py-2 justify-between border-b">
                <span class="text-xs font-semibold text-gray-600">Recent diagrams and API specs</span>
              </div>
              <div class="flex flex-shrink-0 items-center px-4 py-2 border-b">
                <input v-model="filterKeyword"
                  placeholder="search in title and content"
                  class="block p-2 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500" />
              </div>

              <!-- Loading skeleton -->
              <div v-if="isLoading" class="flex-1 overflow-y-auto">
                <div v-for="n in 5" :key="n" class="px-6 py-4 border-t animate-pulse">
                  <div class="h-3 bg-gray-200 rounded w-2/3 mb-2"></div>
                  <div class="h-2 bg-gray-100 rounded w-1/2 mb-1"></div>
                  <div class="h-2 bg-gray-100 rounded w-3/4"></div>
                </div>
              </div>

              <!-- Empty state -->
              <div v-else-if="groupedPages.length === 0"
                class="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 py-12">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" stroke-width="1">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                       a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                </svg>
                <p class="text-sm">No diagrams found</p>
                <p class="text-xs text-gray-300">Try a different filter or search term</p>
              </div>

              <!-- Populated list -->
              <div v-else class="flex-1 overflow-y-auto">
                <div v-for="page in groupedPages" :key="page.id"
                  class="block px-6 py-3 bg-white border-t hover:bg-gray-50">
                  <div class="mt-2 text-sm text-gray-600">
                    <span class="font-medium">Page: {{ page.title }}</span>
                  </div>
                  <a v-for="item in page.customContents" :key="item.id"
                    href="#"
                    @click.prevent="picked = item"
                    :class="picked && picked.id === item.id ? 'bg-gray-100' : 'bg-white'"
                    class="block px-6 py-3 border-t hover:bg-gray-50">
                    <span class="text-sm font-semibold text-gray-900">{{ item.title }}</span>
                    <div class="flex justify-between mt-1">
                      <span class="text-xs font-semibold text-gray-500">{{ item.value.diagramType }}</span>
                    </div>
                  </a>
                </div>
              </div>
            </div>

            <!-- Right panel -->
            <div class="flex-grow h-full bg-white border-t flex items-center justify-center">
              <div v-if="picked" class="text-center text-gray-600 p-8 max-w-md w-full">
                <p class="text-lg font-semibold mb-1">{{ picked.title }}</p>
                <p class="text-sm text-gray-400 mb-4">{{ picked.value.diagramType }} · preview not available in Storybook</p>
                <pre v-if="picked.value.code" class="text-left text-xs bg-gray-50 p-4 rounded border overflow-auto">{{ picked.value.code }}</pre>
              </div>
              <div v-else class="text-sm text-gray-500">Select a document to preview</div>
            </div>

          </main>
        </div>
      </div>
    </div>
  `,
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<Args> = {
  title: 'DocumentList/DocumentList',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Full-page embed-editor that lets users browse all diagrams stored as ' +
          'Confluence custom content, filter by diagram type, search by keyword, ' +
          'and pick a document to insert into the current page. The left panel lists ' +
          'pages and their child diagrams; the right panel shows a live preview of ' +
          'the selected diagram. These stories use a structural shell component that ' +
          'mirrors the real template without Forge/Vuex dependencies.',
      },
    },
  },
}

export default meta

type Story = StoryObj<Args>

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/**
 * Populated list — five diagrams across three pages.
 * The "CI/CD Pipeline" (Mermaid) item is pre-selected so the right panel is
 * active on load.
 */
export const Populated: Story = {
  name: 'Populated list',
  render: () => ({
    components: { DocumentListShell },
    setup() {
      return { items: SAMPLE_ITEMS, pickedId: 'cc-002' }
    },
    template: '<DocumentListShell :items="items" :picked-id="pickedId" />',
  }),
}

/**
 * Empty list — no diagrams exist in the space (e.g. fresh install).
 * The left panel shows the "No diagrams found" empty state; the right panel
 * shows the "Select a document to preview" placeholder.
 */
export const Empty: Story = {
  name: 'Empty list',
  render: () => ({
    components: { DocumentListShell },
    template: '<DocumentListShell :items="[]" />',
  }),
}

/**
 * Loading — skeleton rows shown while the apWrapper fetch is in flight.
 * In production this is the state between component mount and when
 * `searchCustomContentForge` resolves.
 */
export const Loading: Story = {
  name: 'Loading',
  render: () => ({
    components: { DocumentListShell },
    template: '<DocumentListShell :items="[]" :is-loading="true" />',
  }),
}
