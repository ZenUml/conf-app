import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';

describe('architecture_tokens analytics type contract', () => {
  it('accepts the planned vocabulary and rejects invalid event, area, outcome, and property types', () => {
    // Compile only this virtual consumer and its imports. Vitest transpiles
    // TypeScript without typechecking, so runtime literal checks prove nothing.
    const fileName = path.resolve(process.cwd(), 'src/utils/analytics/__architecture_tokens_contract__.ts');
    const source = `
      import type {
        AnalyticsEventName, ArchitectureTokenIndexSource, ArchitectureTokenLookupOutcome,
        ArchitectureTokenStaleReason, FeatureArea,
      } from './catalog';
      import type { AnalyticsProperties } from './types';
      const names: AnalyticsEventName[] = [
        'related_diagrams_lookup_succeeded',
        'related_diagrams_lookup_failed',
        'related_diagrams_lookup_skipped',
        'related_token_indicators_shown',
        'related_diagram_popover_opened',
        'related_diagram_link_clicked',
      ];
      const area: FeatureArea = 'architecture_tokens';
      const outcome: ArchitectureTokenLookupOutcome = 'index_miss';
      const props: AnalyticsProperties = {
        feature_area: area, surface: 'viewer', macro_type: 'mermaid',
        lookup_outcome: outcome, participant_count: 7,
        participants_with_related: 5, participants_anchored: 5,
        related_pages_total: 12, index_age_days: 3, related_count: 3,
        label_variant_count: 2, same_space: false, same_page: true,
        error_kind: 'http_error', http_status: 500, lookup_skip_reason: 'anonymous_viewer',
      };
      const staleReasons: ArchitectureTokenStaleReason[] = [
        'version_mismatch', 'not_in_live_read', 'no_page_container',
      ];
      const staleProps: AnalyticsProperties = {
        feature_area: area, surface: 'viewer',
        error_kind: 'stale_index', stale_reason: staleReasons[0], indexed_version: 3, live_version: 4,
      };
      const indexSources: ArchitectureTokenIndexSource[] = ['save', 'heal', 'backfill', 'unknown'];
      const sourceProps: AnalyticsProperties = {
        feature_area: area, surface: 'viewer', error_kind: 'stale_index', index_source: indexSources[0],
      };
      // @ts-expect-error a raw run id is not an index source
      const badIndexSource: AnalyticsProperties = { feature_area: area, surface: 'viewer', index_source: 'save:3' };
      // @ts-expect-error unknown stale reason
      const badStaleReason: AnalyticsProperties = { feature_area: area, surface: 'viewer', stale_reason: 'self_missing' };
      // @ts-expect-error version must be numeric
      const badLiveVersion: AnalyticsProperties = { feature_area: area, surface: 'viewer', live_version: '4' };
      // @ts-expect-error unknown analytics event
      const badEvent: AnalyticsEventName = 'related_diagrams_lookup_typo';
      // @ts-expect-error unknown feature area
      const badArea: FeatureArea = 'architecture_tokens_typo';
      // @ts-expect-error unknown lookup outcome
      const badOutcome: ArchitectureTokenLookupOutcome = 'unknown';
      // @ts-expect-error count must be numeric
      const badProps: AnalyticsProperties = { participant_count: 'seven' };
      void [
        names, props, staleProps, sourceProps, badStaleReason, badLiveVersion, badIndexSource, badEvent,
        badArea, badOutcome, badProps,
      ];
    `;
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
      name === fileName
        ? ts.createSourceFile(name, source, languageVersion, true)
        : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([fileName], options, host))
      .filter((diagnostic) => {
        // Existing unrelated duplicate declaration in types.ts. Keep every
        // other consumer/dependency diagnostic visible to this contract.
        const knownDuplicate = diagnostic.code === 2300
          && diagnostic.file?.fileName.endsWith('/analytics/types.ts')
          && ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') === "Duplicate identifier 'failure_reason'.";
        return !knownDuplicate;
      });
    expect(diagnostics.map((diagnostic) =>
      `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    )).toEqual([]);
  });
});
