// Path → E2E tag impact map (ADR-0007 §5). Read by scripts/e2e-select.mjs to
// decide which specs a PR run executes; policed by tests/unit/e2eSelect.spec.ts
// (every tag must exist in tags.ts, every glob must match a tracked file).
//
// Evaluation order for one changed file, first match wins:
//   1. RUN_EVERYTHING — the run becomes unselective (`mode: all`).
//   2. NO_E2E_IMPACT  — contributes nothing (unit tests, stories, docs).
//   3. IMPACT         — the union of the tags of every glob the file matches.
//   4. no match       — unmapped, the run becomes unselective.
// `@smoke` is always selected. The map is deliberately conservative: when in
// doubt a path is left unmapped, which costs a full run, never a missed spec.
//
// Globs: `**` any depth (a leading `**/` also matches the root), `*` within a
// segment, `{a,b}` alternation. Paths are repo-relative, as `git diff
// --name-only` and the pulls/N/files API print them.

/** Anything here changes behaviour everywhere, or is the harness itself. */
export const RUN_EVERYTHING = [
  // the Forge entry that dispatches every macro, route, modal and gate
  'src/forgeIndex.ts', 'src/mount-root.ts', 'src/EventBus.ts',
  // the shared model (ApWrapper2, persistence, globals) — every surface imports it
  'src/model/**',
  'src/utils/window.ts', 'src/utils/toast.ts', 'src/utils/customContentId.ts',
  'src/utils/effectiveCustomContentId.ts', 'src/utils/requestUtil.ts',
  'src/utils/featureConstants.ts', 'src/utils/forgeFlagEnvironment.ts',
  'src/stubs/**', 'src/types/**', 'src/assets/**', 'src/*.d.ts', 'global.d.ts',
  // build graph, manifest, dependencies
  'manifest.yml', 'manifest.spec.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'vite.config.*', 'tsconfig*.json', 'tailwind.config.js', 'index.html',
  'editor-preview.html', 'viewer-preview.html', 'scripts/forge-wizard.mjs', 'scripts/build-studio.sh',
  // the CI harness and the selection itself
  '.github/**', 'scripts/e2e-select.mjs',
  // everything the E2E suite stands on — and the specs themselves: a changed
  // spec runs the whole suite (v1; selecting the changed spec is a later step)
  'tests/e2e-tests/config/**', 'tests/e2e-tests/utils/**', 'tests/e2e-tests/helpers/**',
  'tests/e2e-tests/fixtures/**', 'tests/e2e-tests/pages/**', 'tests/e2e-tests/tests/**',
  'tests/e2e-tests/playwright*.config.ts', 'tests/e2e-tests/package.json',
  // the backend request pipeline in front of every function
  'functions/_middleware.ts', 'functions/utils/**', 'functions/feature-flags.ts',
  'functions/forge-custom-content.ts', 'functions/forge-installed.ts', 'functions/uninstalled.ts',
  'functions/migrations/**', 'public/_routes.json', 'wrangler*.toml',
];

/** glob → tags. A file matching several globs gets the union. */
export const IMPACT = [
  // ── diagram types ──────────────────────────────────────────────────────
  { glob: 'src/components/Sequence.vue', tags: ['@sequence', '@viewer', '@editor', '@viewport'] },
  { glob: 'src/utils/sequence/**', tags: ['@sequence', '@viewer', '@editor'] },
  { glob: 'src/components/Mermaid.vue', tags: ['@mermaid', '@viewer', '@editor', '@viewport'] },
  { glob: 'src/utils/mermaid/**', tags: ['@mermaid', '@viewer', '@editor'] },
  { glob: 'src/components/PlantUml.vue', tags: ['@plantuml', '@viewer', '@editor', '@viewport'] },
  { glob: 'src/utils/plantuml/**', tags: ['@plantuml', '@viewer', '@editor'] },
  { glob: 'src/components/Markdown.vue', tags: ['@viewer'] },
  { glob: 'src/utils/markdown/**', tags: ['@viewer'] },
  { glob: 'src/components/DrawIoExtension/**', tags: ['@graph', '@viewer', '@editor'] },
  { glob: 'src/forge-graph-*.ts', tags: ['@graph', '@viewer', '@editor'] },
  { glob: 'src/components/Viewer/ForgeGraphViewer*.vue', tags: ['@graph', '@viewer', '@viewport'] },
  { glob: 'src/utils/graph/**', tags: ['@graph', '@viewer', '@editor'] },
  { glob: 'src/utils/drawio/**', tags: ['@graph', '@viewer', '@editor'] },
  { glob: 'public/drawio/**', tags: ['@graph', '@viewer', '@editor'] },
  { glob: 'src/forge-swagger-*.ts', tags: ['@openapi', '@viewer', '@editor'] },
  { glob: 'src/components/OpenApi/**', tags: ['@openapi', '@viewer', '@editor'] },
  { glob: 'src/components/Viewer/OpenApiViewer.vue', tags: ['@openapi', '@viewer'] },
  { glob: 'src/components/react/**', tags: ['@openapi', '@ai', '@editor'] },
  { glob: 'src/utils/openapi/**', tags: ['@openapi', '@viewer', '@editor'] },
  { glob: 'src/forge-asyncapi-*.ts', tags: ['@asyncapi', '@viewer', '@editor'] },
  { glob: 'src/asyncapi-export.js', tags: ['@asyncapi', '@export'] },
  { glob: 'src/components/Editor/AsyncApi*/**', tags: ['@asyncapi', '@editor'] },
  { glob: 'src/components/Viewer/AsyncApiViewer/**', tags: ['@asyncapi', '@viewer'] },
  // the submodule pointer: a diff shows it as this single path
  { glob: 'vendor/asyncapi-studio', tags: ['@asyncapi', '@editor'] },
  { glob: 'src/components/AsyncApiDashboard/**', tags: ['@dashboard', '@asyncapi'] },
  { glob: 'src/routes/asyncApiDashboard.ts', tags: ['@dashboard', '@asyncapi'] },
  { glob: 'src/forge-embed-*.ts', tags: ['@embed', '@viewer', '@editor', '@deeplink'] },
  { glob: 'src/components/Viewer/ForgeEmbedViewer.vue', tags: ['@embed', '@viewer'] },
  { glob: 'src/components/DocumentList/**', tags: ['@embed', '@editor'] },
  { glob: 'src/utils/embedDeeplink.ts', tags: ['@embed', '@deeplink'] },
  // ── surfaces ───────────────────────────────────────────────────────────
  // The pan/zoom viewport, shared by every diagram type. `src/utils/viewport/**`
  // was unmapped when it was added, which cost a full unselective run.
  { glob: 'src/components/Viewer/DiagramViewport*.vue', tags: ['@viewer', '@viewport'] },
  { glob: 'src/components/Viewer/DiagramTransformViewport.vue', tags: ['@viewer', '@viewport'] },
  { glob: 'src/components/Viewer/ViewportZoomHint.vue', tags: ['@viewer', '@viewport'] },
  { glob: 'src/utils/viewport/**', tags: ['@viewer', '@editor', '@viewport'] },
  { glob: 'src/components/Viewer/**', tags: ['@viewer'] },
  { glob: 'src/utils/{viewerBootstrap,viewerLoadOutcome,loadFailedRetry}.ts', tags: ['@viewer'] },
  { glob: 'src/utils/renderGate/**', tags: ['@viewer'] },
  { glob: 'src/utils/renderCache/**', tags: ['@viewer'] },
  { glob: 'src/utils/prefetch/**', tags: ['@viewer'] },
  { glob: 'src/viewerPreview.ts', tags: ['@viewer'] },
  { glob: 'src/components/Editor/**', tags: ['@editor'] },
  { glob: 'src/components/Header/**', tags: ['@editor'] },
  { glob: 'src/components/TabSwitcher/**', tags: ['@editor'] },
  { glob: 'src/components/TemplateGallery/**', tags: ['@editor'] },
  { glob: 'src/components/{SyntaxErrorBox,ForeignDialectHint,Workspace,PublishButton,DiagramPortal}.vue', tags: ['@editor'] },
  { glob: 'src/editorPreview.ts', tags: ['@editor'] },
  { glob: 'src/utils/{closeGuard,guardEditClick,draftStore,restoreDraftBanner}.ts', tags: ['@editor'] },
  { glob: 'src/utils/modalService.ts', tags: ['@fullscreen', '@modal'] },
  { glob: 'src/components/ExportModal/**', tags: ['@export', '@modal'] },
  { glob: 'src/export.js', tags: ['@export', '@modal'] },
  { glob: 'src/lib/**', tags: ['@export'] },
  { glob: 'src/utils/pngMetadata.ts', tags: ['@export'] },
  { glob: 'src/utils/shareCardImage.ts', tags: ['@export'] },
  { glob: 'src/services/debugBundle.ts', tags: ['@export'] },
  { glob: 'src/components/Byline/**', tags: ['@byline'] },
  { glob: 'src/components/Byline/UnplacedDiagramsBanner.vue', tags: ['@page-banner'] },
  { glob: 'src/routes/{byline,bylineActivation}.ts', tags: ['@byline'] },
  { glob: 'src/utils/byline/**', tags: ['@byline'] },
  { glob: 'src/byline-visibility.ts', tags: ['@byline'] },
  { glob: 'src/routes/pageBanner.ts', tags: ['@page-banner'] },
  { glob: 'src/utils/banners/**', tags: ['@page-banner'] },
  { glob: 'src/utils/firstSeen/**', tags: ['@page-banner', '@analytics'] },
  // ── concerns ───────────────────────────────────────────────────────────
  { glob: 'src/components/UpgradePrompt/**', tags: ['@paywall'] },
  { glob: 'src/utils/paywall/**', tags: ['@paywall'] },
  { glob: 'src/components/PlanUsage/**', tags: ['@paywall', '@route'] },
  { glob: 'src/routes/planUsage.ts', tags: ['@paywall', '@route'] },
  { glob: 'src/space-properties.ts', tags: ['@paywall'] },
  { glob: 'src/macro-count-snapshot.ts', tags: ['@paywall'] },
  { glob: 'functions/api/{space-license,space-status,plan-usage,stripe-webhook}.ts', tags: ['@paywall'] },
  { glob: 'functions/api/support/**', tags: ['@paywall'] },
  { glob: 'src/components/CSAT/**', tags: ['@csat'] },
  { glob: 'src/hooks/useCSATState.ts', tags: ['@csat'] },
  { glob: 'src/utils/csat.ts', tags: ['@csat'] },
  { glob: 'src/features/feedback/**', tags: ['@feedback'] },
  { glob: 'functions/api/feedback-report.ts', tags: ['@feedback'] },
  { glob: 'src/components/AgentLink/**', tags: ['@ai'] },
  { glob: 'src/composables/agentLink/**', tags: ['@ai'] },
  { glob: 'src/components/AIChat/**', tags: ['@ai'] },
  { glob: 'src/components/AIRepair.vue', tags: ['@ai', '@editor'] },
  { glob: 'src/components/aiRepairArming.ts', tags: ['@ai', '@editor'] },
  { glob: 'src/utils/copyForAi/**', tags: ['@ai', '@viewer'] },
  { glob: 'src/routes/aiAide.ts', tags: ['@ai', '@route'] },
  { glob: 'src/services/{AIChatSessionService,GenerateService}.ts', tags: ['@ai'] },
  { glob: 'src/apis/aiGenerateTitle.ts', tags: ['@ai', '@editor'] },
  { glob: 'src/composables/useAutoTitle.ts', tags: ['@ai', '@editor'] },
  { glob: 'functions/agent-link/**', tags: ['@ai'] },
  { glob: 'functions/diagramly/**', tags: ['@ai'] },
  { glob: 'functions/ai-generate-title.ts', tags: ['@ai'] },
  { glob: 'workers/agent-link/**', tags: ['@ai'] },
  { glob: 'src/lite-full-conversion.ts', tags: ['@conversion'] },
  { glob: 'src/full-presence.ts', tags: ['@conversion'] },
  { glob: 'functions/conversion/**', tags: ['@conversion'] },
  { glob: 'src/utils/newDiagramLink.ts', tags: ['@deeplink'] },
  { glob: 'src/utils/macroEntryRouting.ts', tags: ['@deeplink', '@editor'] },
  { glob: 'src/utils/documentOpening/**', tags: ['@deeplink', '@editor'] },
  { glob: 'functions/deeplink-ticket.ts', tags: ['@deeplink'] },
  { glob: 'functions/i/**', tags: ['@deeplink'] },
  { glob: 'functions/d/**', tags: ['@deeplink'] },
  { glob: 'workers/confluence-deeplink/**', tags: ['@deeplink'] },
  { glob: 'src/routes/{getStarted,homepageFeed,createDemoPage}.ts', tags: ['@route'] },
  { glob: 'src/components/{GetStarted,HomepageFeed,Admin}/**', tags: ['@route'] },
  { glob: 'src/{createDemoPage,demoPageContent}.js', tags: ['@route'] },
  // catalog.ts / types.ts change with nearly every feature (CLAUDE.md: every
  // feature registers its events there); 17 of 40 recent PRs touched them. A
  // new event name changes nothing another surface can observe, so they map
  // to @analytics rather than to everything.
  { glob: 'src/utils/analytics/**', tags: ['@analytics'] },
  { glob: 'src/utils/{journeyTracking,upgradeTracking,orphanTelemetry,legacyContentPropertyTelemetry}.ts', tags: ['@analytics'] },
  { glob: 'src/utils/cohorts/**', tags: ['@analytics'] },
  { glob: 'src/services/{AnalyticsService,MacroMetrics}.ts', tags: ['@analytics'] },
  { glob: 'src/components/Analytics/**', tags: ['@analytics', '@route'] },
  { glob: 'src/analytics-page.ts', tags: ['@analytics', '@route'] },
  { glob: 'analytics.html', tags: ['@analytics', '@route'] },
  { glob: 'public/admin/**', tags: ['@analytics'] },
  { glob: 'functions/track.ts', tags: ['@analytics'] },
  { glob: 'functions/api/analytics/**', tags: ['@analytics'] },
  { glob: 'functions/api/user-cohorts.ts', tags: ['@analytics'] },
  { glob: 'functions/metrics-cache/**', tags: ['@analytics'] },
  { glob: 'functions/admin/**', tags: ['@analytics'] },
  { glob: 'functions/forge-user-behavior.ts', tags: ['@analytics'] },
  { glob: 'src/page-capture.js', tags: ['@analytics'] },
  { glob: 'functions/forge-page-capture.ts', tags: ['@analytics'] },
];

/** No E2E can observe these. Checked before IMPACT so a unit spec beside a
 *  component (`Viewer/GenericViewer.spec.ts`) selects nothing; an E2E spec's
 *  own `.spec.ts` is under tests/e2e-tests, caught by RUN_EVERYTHING first. */
export const NO_E2E_IMPACT = [
  '**/*.spec.ts', '**/*.spec.js', '**/*.stories.ts', '**/*.fixtures.ts', '**/__tests__/**',
  'tests/unit/**', 'tests/export-modal/**', 'src/sandbox.ts', 'sandbox.html', 'src/test-viewer.ts',
  'test-viewer.html', 'src/components/Debug/**',
  'docs/**', '**/*.md', '.claude/**', '.cursor/**', 'private', 'private/**',
  'public/image/**', 'scripts/**', 'eslint.config.mjs', '.storybook/**',
  '.gitignore', '.gitmodules', '.nvmrc', '.npmrc', '.prettierrc*', '.editorconfig', 'LICENSE*',
];
