<template>
  <div class="analytics-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Cloudflare Analytics</p>
        <h1>Analytics dashboard</h1>
        <p class="subtitle">
          Board parity, saved views, and event drill-through from the Cloudflare-native analytics stack.
        </p>
      </div>
      <div class="header-actions">
        <button class="secondary-button" @click="exportRows(`${selectedReport}-report`, reportRows)">Export report CSV</button>
        <button class="secondary-button" @click="exportRows('analytics-explore', exploreRows)">Export explore CSV</button>
        <button class="primary-button" @click="refreshAll" :disabled="loading.report || loading.explore || loading.events">
          Refresh
        </button>
      </div>
    </header>

    <section class="panel">
      <div class="section-heading">
        <div>
          <h2>Saved views</h2>
          <p class="section-copy">Persist common board/explore combinations for quick access.</p>
        </div>
      </div>
      <div class="saved-layout">
        <div class="saved-controls">
          <label>
            Saved view
            <select v-model="selectedSavedSlug" @change="onSavedQueryChange">
              <option value="">Choose a saved view</option>
              <option v-for="query in savedQueries" :key="query.slug" :value="query.slug">
                {{ query.title }}
              </option>
            </select>
          </label>
          <button class="secondary-button" @click="deleteSelectedQuery" :disabled="!selectedSavedSlug">Delete</button>
        </div>
        <div class="saved-controls">
          <label>
            Title
            <input v-model="saveForm.title" type="text" placeholder="Weekly active clients" />
          </label>
          <label>
            Description
            <input v-model="saveForm.description" type="text" placeholder="Optional notes for this view" />
          </label>
          <button class="primary-button" @click="saveCurrentView" :disabled="!saveForm.title">Save current view</button>
        </div>
      </div>
    </section>

    <section class="grid">
      <article class="panel">
        <div class="section-heading">
          <div>
            <h2>Board report</h2>
            <p class="section-copy">Current Mixpanel-equivalent report backed by D1 views.</p>
          </div>
        </div>
        <div class="filters-grid">
          <label>
            Report
            <select v-model="selectedReport" @change="loadReport">
              <option v-for="report in reportOptions" :key="report.value" :value="report.value">
                {{ report.label }}
              </option>
            </select>
          </label>
          <label>
            Start date
            <input v-model="filters.startDate" type="date" @change="refreshAll" />
          </label>
          <label>
            End date
            <input v-model="filters.endDate" type="date" @change="refreshAll" />
          </label>
        </div>
        <p v-if="error.report" class="error-message">{{ error.report }}</p>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th v-for="column in reportColumns" :key="column">{{ humanizeColumn(column) }}</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading.report">
                <td :colspan="reportColumns.length + 1">Loading report…</td>
              </tr>
              <tr v-else-if="!reportRows.length">
                <td :colspan="reportColumns.length + 1">No report rows found for the current filter.</td>
              </tr>
              <tr v-for="(row, index) in reportRows" :key="index">
                <td v-for="column in reportColumns" :key="column">{{ row[column] }}</td>
                <td><button class="link-button" @click="inspectAggregateRow(row)">Inspect</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <div class="section-heading">
          <div>
            <h2>Explore</h2>
            <p class="section-copy">Run ad-hoc aggregation queries on the hot D1 fact table.</p>
          </div>
          <button class="primary-button" @click="runExplore">Run query</button>
        </div>
        <div class="filters-grid">
          <label>
            Metric
            <select v-model="explore.metric">
              <option value="count">Count</option>
              <option value="uniqueUsers">Unique users</option>
              <option value="uniqueClients">Unique clients</option>
              <option value="uniqueMacros">Unique macros</option>
            </select>
          </label>
          <label>
            Group by
            <select v-model="explore.groupBy">
              <option value="">None</option>
              <option value="eventDate">Event date</option>
              <option value="event">Event</option>
              <option value="clientDomain">Client domain</option>
              <option value="confluenceSpace">Confluence space</option>
              <option value="diagramType">Diagram type</option>
              <option value="eventCategory">Event category</option>
              <option value="isLite">Variant</option>
            </select>
          </label>
          <label>
            Event
            <input v-model="filters.event" type="text" placeholder="view_macro" />
          </label>
          <label>
            Client domain
            <input v-model="filters.clientDomain" type="text" placeholder="whimet4.atlassian.net" />
          </label>
          <label>
            Space
            <input v-model="filters.confluenceSpace" type="text" placeholder="ENG" />
          </label>
          <label>
            Diagram type
            <input v-model="filters.diagramType" type="text" placeholder="sequence" />
          </label>
          <label>
            Event category
            <input v-model="filters.eventCategory" type="text" placeholder="sequence" />
          </label>
          <label>
            Variant
            <select v-model="filters.isLite">
              <option value="">All</option>
              <option value="1">Lite</option>
              <option value="0">Full</option>
            </select>
          </label>
          <label>
            Limit
            <input v-model.number="filters.limit" type="number" min="1" max="500" />
          </label>
        </div>
        <p v-if="error.explore" class="error-message">{{ error.explore }}</p>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th v-for="column in exploreColumns" :key="column">{{ humanizeColumn(column) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading.explore">
                <td :colspan="Math.max(exploreColumns.length, 1)">Running query…</td>
              </tr>
              <tr v-else-if="!exploreRows.length">
                <td :colspan="Math.max(exploreColumns.length, 1)">No explore rows found.</td>
              </tr>
              <tr v-for="(row, index) in exploreRows" :key="index">
                <td v-for="column in exploreColumns" :key="column">{{ row[column] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <h2>Event drill-through</h2>
          <p class="section-copy">Inspect the underlying hot facts that match the current filters.</p>
        </div>
        <div class="header-actions">
          <button class="secondary-button" @click="exportRows('analytics-events', eventRows)">Export events CSV</button>
          <button class="primary-button" @click="loadEvents">Load events</button>
        </div>
      </div>
      <p v-if="error.events" class="error-message">{{ error.events }}</p>
      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th v-for="column in eventColumns" :key="column">{{ humanizeColumn(column) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading.events">
              <td :colspan="eventColumns.length">Loading events…</td>
            </tr>
            <tr v-else-if="!eventRows.length">
              <td :colspan="eventColumns.length">No matching events found.</td>
            </tr>
            <tr v-for="(row, index) in eventRows" :key="index">
              <td v-for="column in eventColumns" :key="column">{{ row[column] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="paging">
        <button class="secondary-button" @click="previousPage" :disabled="eventOffset === 0">Previous</button>
        <span>Offset {{ eventOffset }}</span>
        <button class="secondary-button" @click="nextPage" :disabled="!nextOffset">Next</button>
      </div>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import {
  deleteAnalyticsQuery,
  fetchAnalyticsEvents,
  fetchAnalyticsExplore,
  fetchAnalyticsReport,
  listSavedAnalyticsQueries,
  saveAnalyticsQuery,
  type SavedAnalyticsQuery,
} from '@/services/AnalyticsService';
import { trackEvent } from '@/utils/window';

type Row = Record<string, unknown>;

const REPORT_OPTIONS = [
  { value: 'installed-uninstalled', label: 'Installed / Uninstalled' },
  { value: 'csat-average', label: 'CSAT Average' },
  { value: 'active-clients-view-save-weekly', label: 'Active Clients per week View vs Save' },
  { value: 'active-clients-view-save-full-weekly', label: 'Active Clients View vs Save (FULL)' },
  { value: 'all-events-unique-users-daily', label: 'All Events Unique Users' },
  { value: 'view-macro-paynet-daily', label: 'PV (view_macro) pay-net' },
  { value: 'macros-per-day-ex-mermaid', label: 'How many macros per day (ex mermaid)' },
  { value: 'view-macro-unique-macro-daily', label: 'view_macro unique macro' },
];

function toCsv(rows: Row[]): string {
  if (!rows.length) {
    return '';
  }

  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));

  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\n');
}

export default defineComponent({
  name: 'AnalyticsDashboard',
  data() {
    return {
      reportOptions: REPORT_OPTIONS,
      selectedReport: REPORT_OPTIONS[0].value,
      selectedSavedSlug: '',
      savedQueries: [] as SavedAnalyticsQuery[],
      reportRows: [] as Row[],
      exploreRows: [] as Row[],
      eventRows: [] as Row[],
      filters: {
        startDate: '',
        endDate: '',
        event: '',
        clientDomain: '',
        confluenceSpace: '',
        diagramType: '',
        eventCategory: '',
        isLite: '',
        limit: 100,
      },
      explore: {
        metric: 'count',
        groupBy: 'eventDate',
      },
      saveForm: {
        title: '',
        description: '',
      },
      eventOffset: 0,
      nextOffset: null as number | null,
      loading: {
        report: false,
        explore: false,
        events: false,
      },
      error: {
        report: '',
        explore: '',
        events: '',
      },
    };
  },
  computed: {
    reportColumns(): string[] {
      return this.reportRows.length ? Object.keys(this.reportRows[0]) : ['eventDate', 'eventCount'];
    },
    exploreColumns(): string[] {
      return this.exploreRows.length ? Object.keys(this.exploreRows[0]) : ['dimension', 'value'];
    },
    eventColumns(): string[] {
      return this.eventRows.length
        ? Object.keys(this.eventRows[0])
        : ['eventTime', 'event', 'clientDomain', 'confluenceSpace', 'diagramType', 'r2Key'];
    },
  },
  async mounted() {
    trackEvent('', 'analytics_dashboard_page_view', 'forge_analytics_dashboard');
    await this.refreshAll();
  },
  methods: {
    humanizeColumn(value: string) {
      return value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
    },
    currentQueryConfig() {
      return {
        selectedReport: this.selectedReport,
        filters: { ...this.filters },
        explore: { ...this.explore },
      };
    },
    async refreshAll() {
      await Promise.all([
        this.loadSavedQueries(),
        this.loadReport(),
        this.runExplore(),
        this.loadEvents(),
      ]);
    },
    async loadSavedQueries() {
      const response = await listSavedAnalyticsQueries();
      this.savedQueries = response.rows || [];
    },
    async loadReport() {
      this.loading.report = true;
      this.error.report = '';
      try {
        const response = await fetchAnalyticsReport(this.selectedReport, this.filters);
        this.reportRows = response.rows || [];
      } catch (error) {
        this.error.report = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading.report = false;
      }
    },
    async runExplore() {
      this.loading.explore = true;
      this.error.explore = '';
      try {
        const response = await fetchAnalyticsExplore({
          ...this.filters,
          metric: this.explore.metric,
          groupBy: this.explore.groupBy || undefined,
        });
        this.exploreRows = response.rows || [];
      } catch (error) {
        this.error.explore = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading.explore = false;
      }
    },
    async loadEvents() {
      this.loading.events = true;
      this.error.events = '';
      try {
        const response = await fetchAnalyticsEvents({
          ...this.filters,
          offset: this.eventOffset,
        });
        this.eventRows = response.rows || [];
        this.nextOffset = response.paging?.nextOffset ?? null;
      } catch (error) {
        this.error.events = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading.events = false;
      }
    },
    inspectAggregateRow(row: Row) {
      this.filters.startDate = typeof row.eventDate === 'string' ? row.eventDate : this.filters.startDate;
      this.filters.endDate = typeof row.eventDate === 'string' ? row.eventDate : this.filters.endDate;
      this.filters.event = typeof row.event === 'string' ? row.event : this.filters.event;
      this.filters.clientDomain = typeof row.clientDomain === 'string' ? row.clientDomain : this.filters.clientDomain;
      if (typeof row.isLite === 'number') {
        this.filters.isLite = String(row.isLite);
      }
      this.eventOffset = 0;
      trackEvent('', 'analytics_dashboard_inspect_row', 'forge_analytics_dashboard', {
        report: this.selectedReport,
      });
      this.runExplore();
      this.loadEvents();
    },
    async saveCurrentView() {
      await saveAnalyticsQuery({
        slug: this.selectedSavedSlug || this.saveForm.title,
        title: this.saveForm.title,
        description: this.saveForm.description,
        config: this.currentQueryConfig(),
      });
      trackEvent('', 'analytics_dashboard_saved_view', 'forge_analytics_dashboard');
      await this.loadSavedQueries();
      this.selectedSavedSlug = this.saveForm.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    },
    async onSavedQueryChange() {
      if (!this.selectedSavedSlug) {
        return;
      }

      const response = await listSavedAnalyticsQueries(this.selectedSavedSlug);
      const query = response.rows?.[0];
      if (!query) {
        return;
      }

      this.applySavedQuery(query);
    },
    applySavedQuery(query: SavedAnalyticsQuery) {
      this.saveForm.title = query.title;
      this.saveForm.description = query.description || '';
      const config = query.config || {};
      this.selectedReport = String(config.selectedReport || this.selectedReport);
      Object.assign(this.filters, config.filters || {});
      Object.assign(this.explore, config.explore || {});
      this.eventOffset = 0;
      trackEvent('', 'analytics_dashboard_loaded_saved_view', 'forge_analytics_dashboard', {
        slug: query.slug,
      });
      this.loadReport();
      this.runExplore();
      this.loadEvents();
    },
    async deleteSelectedQuery() {
      if (!this.selectedSavedSlug) {
        return;
      }

      await deleteAnalyticsQuery(this.selectedSavedSlug);
      trackEvent('', 'analytics_dashboard_deleted_saved_view', 'forge_analytics_dashboard', {
        slug: this.selectedSavedSlug,
      });
      this.selectedSavedSlug = '';
      await this.loadSavedQueries();
    },
    exportRows(fileName: string, rows: Row[]) {
      const csv = toCsv(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      trackEvent('', 'analytics_dashboard_export', 'forge_analytics_dashboard', {
        file_name: fileName,
        row_count: rows.length,
      });
    },
    async previousPage() {
      this.eventOffset = Math.max(this.eventOffset - Number(this.filters.limit || 100), 0);
      await this.loadEvents();
    },
    async nextPage() {
      if (this.nextOffset == null) {
        return;
      }
      this.eventOffset = this.nextOffset;
      await this.loadEvents();
    },
  },
});
</script>

<style scoped>
.analytics-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px;
  color: #172b4d;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header,
.section-heading,
.saved-layout,
.saved-controls,
.grid,
.filters-grid,
.header-actions,
.paging {
  display: flex;
  gap: 12px;
}

.page-header,
.section-heading,
.paging {
  justify-content: space-between;
  align-items: center;
}

.saved-layout,
.grid {
  align-items: flex-start;
}

.saved-layout,
.filters-grid {
  flex-wrap: wrap;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.panel {
  background: #fff;
  border: 1px solid #dfe1e6;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  color: #0052cc;
}

h1,
h2 {
  margin: 0;
}

.subtitle,
.section-copy {
  margin: 6px 0 0;
  color: #5e6c84;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
  font-size: 14px;
}

input,
select,
button {
  font: inherit;
}

input,
select {
  min-height: 36px;
  border: 1px solid #c1c7d0;
  border-radius: 8px;
  padding: 8px 10px;
  background: #fff;
}

button {
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  padding: 10px 14px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.primary-button {
  background: #0052cc;
  color: #fff;
}

.secondary-button {
  background: #f4f5f7;
  color: #172b4d;
}

.link-button {
  padding: 0;
  background: transparent;
  color: #0052cc;
}

.table-shell {
  overflow-x: auto;
  margin-top: 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  text-align: left;
  border-bottom: 1px solid #ebecf0;
  padding: 10px 8px;
  vertical-align: top;
  font-size: 14px;
}

th {
  background: #f7f8f9;
  position: sticky;
  top: 0;
}

.error-message {
  color: #ae2a19;
  margin: 12px 0 0;
}

@media (max-width: 1024px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
