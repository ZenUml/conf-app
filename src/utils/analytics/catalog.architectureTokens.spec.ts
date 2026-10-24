import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';

describe('architecture_tokens analytics type contract', () => {
  it('accepts the planned vocabulary and rejects invalid event, area, outcome, and property types', () => {
    // Compile only this virtual consumer and its imports. Vitest transpiles
    // TypeScript without typechecking, so runtime literal checks prove nothing.
    const fileName = path.resolve(process.cwd(), 'src/utils/analytics/__architecture_tokens_contract__.ts');
    const source = `
      import type { AnalyticsEventName, ArchitectureTokenLookupOutcome, FeatureArea } from './catalog';
      import type { AnalyticsProperties } from './types';
      const names: AnalyticsEventName[] = [
        'related_diagrams_lookup_succeeded',
        'related_diagrams_lookup_failed',
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
        error_kind: 'timeout',
      };
      // @ts-expect-error unknown analytics event
      const badEvent: AnalyticsEventName = 'related_diagrams_lookup_typo';
      // @ts-expect-error unknown feature area
      const badArea: FeatureArea = 'architecture_tokens_typo';
      // @ts-expect-error unknown lookup outcome
      const badOutcome: ArchitectureTokenLookupOutcome = 'unknown';
      // @ts-expect-error count must be numeric
      const badProps: AnalyticsProperties = { participant_count: 'seven' };
      void [names, props, badEvent, badArea, badOutcome, badProps];
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
