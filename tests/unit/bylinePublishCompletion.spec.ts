import fs from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideWriteback, deriveWritebackSignals } from '@/model/writebackGate';
import {
  captureCreationAttemptProperties,
  resetCreationAttemptTelemetry,
} from '@/utils/analytics/creationAttemptTelemetry';

// Execute the actual entry-point save handlers without their unrelated Forge
// bootstrap. The AST selects the handler; persistence and host APIs are the
// boundaries under test, including the deferred redirect after save mutates id.
function loadHandler(file: string, graph: boolean, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let handler: ts.Node | undefined;
  source.forEachChild(node => {
    if (graph && ts.isFunctionDeclaration(node) && node.name?.text === 'saveGraphAndExit') handler = node;
    if (!graph && ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText(source) === 'EventBus.$on'
        && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'save') handler = call.arguments[1];
    }
  });
  if (!handler) throw new Error(`Save handler not found in ${file}`);
  const code = graph ? `${handler.getText(source)}\nconst handler = saveGraphAndExit;` : `const handler = ${handler.getText(source)};`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn handler;`)(...Object.values(dependencies));
}

describe.each([
  ['graph', 'src/forge-graph-editor.ts'],
  ['sequence', 'src/forgeIndex.ts'],
] as const)('%s Byline publish completion', (macroType, file) => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCreationAttemptTelemetry();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(['create', 'edit'] as const)('keeps the pre-save %s mode when the saved id changes', async mode => {
    const graph = macroType === 'graph';
    const diagram = { id: mode === 'edit' ? '123' : undefined, title: 'Test diagram', diagramType: macroType };
    const savedId = '456';
    const captured: Record<string, unknown>[] = [];
    const start = captureCreationAttemptProperties(
      mode === 'create' ? 'macro_create_started' : 'macro_edit_started', { macro_type: macroType },
    );
    const close = vi.fn(async () => undefined);
    const submit = vi.fn(async () => undefined);
    const isInserting = vi.fn(async () => false);
    const isConfiguring = vi.fn(async () => false);
    const saveToPlatform = vi.fn(async (input: typeof diagram) => {
      input.id = savedId;
      diagram.id = savedId;
      captureCreationAttemptProperties(mode === 'create' ? 'macro_create_succeeded' : 'macro_save_succeeded', {
        macro_type: macroType, operation_mode: mode,
      });
      return savedId;
    });
    const handler = loadHandler(file, graph, {
      window: { diagram }, store: { state: { diagram } },
      saveToPlatform, markPublishClicked: vi.fn(), notifyAiTitleSaved: vi.fn(),
      trackPublishCompleted: (props: any) => captured.push({ ...props, ...captureCreationAttemptProperties('macro_publish_completed', props) }),
      getEditJourneyId: () => undefined,
      isInserting, isConfiguring, decideWriteback, deriveWritebackSignals,
      getView: async () => ({ close, submit }),
      forgeGlobal: { forgeContext: { moduleKey: 'zenuml-byline-diagrams' } },
      originalCustomContentId: undefined, originalConfigUuid: undefined,
      EventBus: { $emit: vi.fn() },
      getGraphEditorMode: () => 'diagram', DiagramType: { Graph: 'graph' }, DataSource: { CustomContent: 'custom-content' },
      sessionStorage: { getItem: () => null }, location: { hostname: 'example.atlassian.net' },
      createAttachmentIfContentChangedPromise: Promise.resolve(async () => undefined),
      getDiagramData: () => ({}),
    });

    await handler({ graphXml: '<mxfile />' });
    await vi.advanceTimersByTimeAsync(500);

    expect(saveToPlatform).toHaveBeenCalledTimes(1);
    expect(diagram.id).toBe(savedId);
    expect(isInserting).toHaveBeenCalledTimes(1);
    expect(isConfiguring).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ macro_type: macroType, operation_mode: mode, custom_content_id: savedId });
    if (mode === 'create') {
      expect(captured[0]).toMatchObject({ creation_attempt_id: start.creation_attempt_id, creation_event_index: 2 });
    } else {
      expect(captured[0]).not.toHaveProperty('creation_attempt_id');
    }
    expect(close).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });
});
