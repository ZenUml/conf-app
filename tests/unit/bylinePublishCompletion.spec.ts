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
function loadHandler(file: string, name: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let handler: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) handler = node;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) handler = node.initializer;
    if (name === 'event:save' && ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (call.expression.getText(source) === 'EventBus.$on'
        && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'save') handler = call.arguments[1];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!handler) throw new Error(`Save handler not found in ${file}`);
  const code = ts.isFunctionDeclaration(handler)
    ? `${handler.getText(source)}\nconst handler = ${name};`
    : `const handler = ${handler.getText(source)};`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn handler;`)(...Object.values(dependencies));
}

describe.each([
  ['graph', 'src/forge-graph-editor.ts', 'saveGraphAndExit'],
  ['sequence', 'src/forgeIndex.ts', 'event:save'],
  ['openapi', 'src/forge-swagger-editor.ts', 'saveOpenApiAndExit'],
  ['asyncapi', 'src/forge-asyncapi-editor.ts', 'handleSave'],
] as const)('%s modal publish completion', (macroType, file, handlerName) => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCreationAttemptTelemetry();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(['create', 'edit'] as const)('keeps the pre-save %s mode when the saved id changes', async mode => {
    const diagram = { id: mode === 'edit' ? '123' : undefined, title: 'Test diagram', diagramType: macroType };
    const savedId = '456';
    const captured: Record<string, unknown>[] = [];
    const start = captureCreationAttemptProperties(
      mode === 'create' ? 'macro_create_started' : 'macro_edit_started',
      { feature_area: 'macro', surface: 'editor', macro_type: macroType },
    );
    const close = vi.fn(async () => undefined);
    const submit = vi.fn(async () => undefined);
    const isInserting = vi.fn(async () => false);
    const isConfiguring = vi.fn(async () => false);
    const saveToPlatform = vi.fn(async (input: typeof diagram) => {
      input.id = savedId;
      diagram.id = savedId;
      captureCreationAttemptProperties(mode === 'create' ? 'macro_create_succeeded' : 'macro_save_succeeded', {
        feature_area: 'macro', surface: 'editor', macro_type: macroType, operation_mode: mode,
      });
      return savedId;
    });
    const handler = loadHandler(file, handlerName, {
      window: { diagram, specContent: 'info: {title: Test diagram}' }, store: { state: { diagram } },
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
      trackPublishRequested: vi.fn(), isDashboardEdit: false, dashboardEditDocLoaded: false, capturedOrigin: {},
      existing: diagram, customContentId: diagram.id,
      buildOpenApiSaveDiagram: ({ existing }: { existing: typeof diagram }) => existing,
      buildAsyncApiSaveDiagram: ({ existing }: { existing: typeof diagram }) => existing,
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
    // AsyncAPI already submits on idChanged; the other modal save handlers
    // use writebackGate. This telemetry fix must preserve those host actions.
    const submits = macroType === 'asyncapi' && mode === 'edit';
    expect(close).toHaveBeenCalledTimes(submits ? 0 : 1);
    expect(submit).toHaveBeenCalledTimes(submits ? 1 : 0);
  });
});
