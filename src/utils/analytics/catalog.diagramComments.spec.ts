import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';
import { sampleRateFor } from './eventSampling';

const NAMES = [
  'diagram_comment_entry_clicked',
  'diagram_comment_panel_opened',
  'diagram_comment_load_completed',
  'diagram_comment_submit_requested',
  'diagram_comment_submit_succeeded',
  'diagram_comment_submit_failed',
  'diagram_comment_dismissed',
  'diagram_comment_link_revealed',
];

describe('diagram_comments analytics', () => {
  it('keeps every comment event at full rate: they are user actions, not renders', () => {
    for (const name of NAMES) {
      expect(sampleRateFor(name), name).toBe(1);
      // Inside the October budget window too: new events are not on any reduce list.
      expect(sampleRateFor(name, Date.UTC(2026, 9, 15)), `${name} in budget window`).toBe(1);
    }
  });

  it('accepts the planned vocabulary and rejects invalid event, area, reason and property types', () => {
    // Compile only this virtual consumer and its imports. Vitest transpiles
    // TypeScript without typechecking, so runtime literal checks prove nothing.
    const fileName = path.resolve(process.cwd(), 'src/utils/analytics/__diagram_comments_contract__.ts');
    const source = `
      import type { AnalyticsEventName, DiagramCommentFailureReason, FeatureArea } from './catalog';
      import type { AnalyticsProperties } from './types';
      const names: AnalyticsEventName[] = ${JSON.stringify(NAMES)};
      const area: FeatureArea = 'diagram_comments';
      const reason: DiagramCommentFailureReason = 'rate_limited';
      const props: AnalyticsProperties = {
        feature_area: area, surface: 'fullscreen', macro_type: 'mermaid',
        comment_thread_action: 'reply', comment_mention_count: 1,
        comment_planned_recipient_count: 2, comment_count: 3,
        comment_load_outcome: 'failed', comment_failure_reason: reason,
        comment_had_draft: true,
      };
      // @ts-expect-error unknown analytics event
      const badEvent: AnalyticsEventName = 'diagram_comment_typo';
      // @ts-expect-error unknown failure reason: free text must never be sent
      const badReason: DiagramCommentFailureReason = 'the server said hello';
      // @ts-expect-error unknown thread action
      const badProps: AnalyticsProperties = { comment_thread_action: 'edit' };
      // @ts-expect-error counts must be numeric
      const badCount: AnalyticsProperties = { comment_mention_count: 'two' };
      void [names, props, badEvent, badReason, badProps, badCount];
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
        // Existing unrelated duplicate declaration in types.ts.
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
