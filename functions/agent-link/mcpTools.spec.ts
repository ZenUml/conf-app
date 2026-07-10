import { describe, it, expect, vi } from 'vitest';
import { dispatchTool, getToolSchemas, ToolError, TOOLS } from './mcpTools';
import type { DispatchContext } from './mcpTools';
import type { SessionRecord } from './sessionToken';

const SESSION: SessionRecord = {
  token: 'CL-TEST-0001',
  boundContext: { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' },
  scope: 'read-page+write-diagram',
  issuedAtMs: 1_000_000,
  state: 'active',
};

function makeCtx(forwardResult: unknown = { ok: true }): { ctx: DispatchContext; forwardToMacro: ReturnType<typeof vi.fn> } {
  const forwardToMacro = vi.fn().mockResolvedValue(forwardResult);
  return { ctx: { forwardToMacro, session: SESSION }, forwardToMacro };
}

function makeCtxWithSnapshot(
  snapshot: DispatchContext['diagramSnapshot'],
  forwardResult: unknown = { ok: true, version: 2, rendered: true },
): { ctx: DispatchContext; forwardToMacro: ReturnType<typeof vi.fn> } {
  const forwardToMacro = vi.fn().mockResolvedValue(forwardResult);
  return { ctx: { forwardToMacro, session: SESSION, diagramSnapshot: snapshot }, forwardToMacro };
}

describe('getToolSchemas', () => {
  it('lists exactly the 6 tools (design §6 + Track U discovery)', () => {
    const schemas = getToolSchemas();
    expect(schemas).toBe(TOOLS);
    expect(schemas.map((t) => t.name).sort()).toEqual(
      [
        'get_status',
        'list_diagrams',
        'read_diagram',
        'read_page',
        'search_diagrams',
        'update_diagram',
      ].sort(),
    );
  });

  it('marks "dsl" as required on update_diagram and leaves "summary" optional', () => {
    const updateDiagram = getToolSchemas().find((t) => t.name === 'update_diagram');
    expect(updateDiagram?.inputSchema.required).toEqual(['dsl']);
    expect(updateDiagram?.inputSchema.properties.summary).toBeDefined();
  });

  it('read_diagram exposes an optional (not required) contentId', () => {
    const readDiagram = getToolSchemas().find((t) => t.name === 'read_diagram');
    expect(readDiagram?.inputSchema.properties.contentId).toBeDefined();
    expect(readDiagram?.inputSchema.required).toBeUndefined();
  });

  it('search_diagrams requires query and offers types/spaceKey/limit', () => {
    const search = getToolSchemas().find((t) => t.name === 'search_diagrams');
    expect(search?.inputSchema.required).toEqual(['query']);
    expect(search?.inputSchema.properties.types.type).toBe('array');
    expect(search?.inputSchema.properties.types.items).toEqual({ type: 'string' });
    expect(search?.inputSchema.properties.spaceKey).toBeDefined();
    expect(search?.inputSchema.properties.limit).toBeDefined();
  });

  it('list_diagrams requires nothing and offers spaceKey/pageId/types/limit', () => {
    const list = getToolSchemas().find((t) => t.name === 'list_diagrams');
    expect(list?.inputSchema.required).toBeUndefined();
    expect(list?.inputSchema.properties.spaceKey).toBeDefined();
    expect(list?.inputSchema.properties.pageId).toBeDefined();
    expect(list?.inputSchema.properties.types.type).toBe('array');
  });
});

describe('dispatchTool', () => {
  it('read_page forwards op "read_page" and returns the forwarded result', async () => {
    const { ctx, forwardToMacro } = makeCtx({ pageId: 'page-1', title: 't', text: 'body' });
    const result = await dispatchTool('read_page', {}, ctx);

    expect(forwardToMacro).toHaveBeenCalledWith('read_page', {});
    expect(result).toEqual({ pageId: 'page-1', title: 't', text: 'body' });
  });

  it('read_diagram forwards op "read_diagram" with {} when no contentId (bound read, unchanged)', async () => {
    const { ctx, forwardToMacro } = makeCtx({ contentId: 'c', diagramType: 'Sequence', dsl: 'A->B' });
    const result = await dispatchTool('read_diagram', undefined, ctx);

    expect(forwardToMacro).toHaveBeenCalledWith('read_diagram', {});
    expect(result).toEqual({ contentId: 'c', diagramType: 'Sequence', dsl: 'A->B' });
  });

  it('read_diagram forwards the contentId when given (S5 discovery read)', async () => {
    const { ctx, forwardToMacro } = makeCtx({ contentId: 'other-1', diagramType: 'mermaid', dsl: 'graph TD' });
    await dispatchTool('read_diagram', { contentId: 'other-1' }, ctx);

    expect(forwardToMacro).toHaveBeenCalledWith('read_diagram', { contentId: 'other-1' });
  });

  it('read_diagram rejects a non-string contentId', async () => {
    const { ctx, forwardToMacro } = makeCtx();
    await expect(dispatchTool('read_diagram', { contentId: 123 }, ctx)).rejects.toMatchObject({
      code: 'bad_args',
    });
    expect(forwardToMacro).not.toHaveBeenCalled();
  });

  it('get_status forwards op "get_status"', async () => {
    const { ctx, forwardToMacro } = makeCtx({ connected: true });
    await dispatchTool('get_status', {}, ctx);

    expect(forwardToMacro).toHaveBeenCalledWith('get_status', {});
  });

  it('update_diagram forwards op "update_diagram" with dsl and summary', async () => {
    const { ctx, forwardToMacro } = makeCtx({ ok: true, version: 2, rendered: true });
    const result = await dispatchTool('update_diagram', { dsl: 'A->B: hi', summary: 'added greeting' }, ctx);

    expect(forwardToMacro).toHaveBeenCalledWith('update_diagram', { dsl: 'A->B: hi', summary: 'added greeting' });
    expect(result).toEqual({ ok: true, version: 2, rendered: true });
  });

  it('update_diagram omits summary when not provided', async () => {
    const { ctx, forwardToMacro } = makeCtx();
    await dispatchTool('update_diagram', { dsl: 'A->B: hi' }, ctx);

    expect(forwardToMacro).toHaveBeenCalledWith('update_diagram', { dsl: 'A->B: hi', summary: undefined });
  });

  it('throws ToolError("unknown_tool") for an unrecognized tool name', async () => {
    const { ctx } = makeCtx();

    await expect(dispatchTool('delete_everything', {}, ctx)).rejects.toMatchObject({
      name: 'ToolError',
      code: 'unknown_tool',
    });
  });

  it('throws ToolError("bad_args") when update_diagram is missing dsl', async () => {
    const { ctx } = makeCtx();

    await expect(dispatchTool('update_diagram', {}, ctx)).rejects.toBeInstanceOf(ToolError);
    await expect(dispatchTool('update_diagram', {}, ctx)).rejects.toMatchObject({ code: 'bad_args' });
  });

  it('throws ToolError("bad_args") when update_diagram.dsl is not a string', async () => {
    const { ctx } = makeCtx();

    await expect(dispatchTool('update_diagram', { dsl: 123 }, ctx)).rejects.toMatchObject({
      code: 'bad_args',
    });
  });

  it('throws ToolError("bad_args") when update_diagram.summary is not a string', async () => {
    const { ctx } = makeCtx();

    await expect(
      dispatchTool('update_diagram', { dsl: 'A->B', summary: 42 }, ctx),
    ).rejects.toMatchObject({ code: 'bad_args' });
  });

  it('throws ToolError("bad_args") when args is not an object (e.g. an array)', async () => {
    const { ctx } = makeCtx();

    await expect(dispatchTool('read_page', ['nope'], ctx)).rejects.toMatchObject({ code: 'bad_args' });
  });

  it('does not call forwardToMacro when validation fails', async () => {
    const { ctx, forwardToMacro } = makeCtx();

    await expect(dispatchTool('update_diagram', {}, ctx)).rejects.toBeInstanceOf(ToolError);
    expect(forwardToMacro).not.toHaveBeenCalled();
  });
});

describe('dispatchTool — discovery surface (Track U, S3/S4)', () => {
  const ROWS = [
    { contentId: 'a', title: 'Checkout flow', diagramType: 'sequence', spaceKey: 'ENG', pageId: 'p1', excerpt: 'x', lastModified: 'now' },
  ];

  describe('search_diagrams', () => {
    it('forwards the query alone when only query is given', async () => {
      const { ctx, forwardToMacro } = makeCtx(ROWS);
      const result = await dispatchTool('search_diagrams', { query: 'payment' }, ctx);
      expect(forwardToMacro).toHaveBeenCalledWith('search_diagrams', { query: 'payment' });
      expect(result).toEqual(ROWS);
    });

    it('forwards types/spaceKey/limit when provided', async () => {
      const { ctx, forwardToMacro } = makeCtx(ROWS);
      await dispatchTool(
        'search_diagrams',
        { query: 'payment', types: ['openapi', 'asyncapi'], spaceKey: 'ENG', limit: 5 },
        ctx,
      );
      expect(forwardToMacro).toHaveBeenCalledWith('search_diagrams', {
        query: 'payment',
        types: ['openapi', 'asyncapi'],
        spaceKey: 'ENG',
        limit: 5,
      });
    });

    it('rejects a missing/blank query', async () => {
      const { ctx, forwardToMacro } = makeCtx();
      await expect(dispatchTool('search_diagrams', {}, ctx)).rejects.toMatchObject({ code: 'bad_args' });
      await expect(dispatchTool('search_diagrams', { query: '   ' }, ctx)).rejects.toMatchObject({ code: 'bad_args' });
      expect(forwardToMacro).not.toHaveBeenCalled();
    });

    it('rejects a non-string-array types', async () => {
      const { ctx, forwardToMacro } = makeCtx();
      await expect(
        dispatchTool('search_diagrams', { query: 'p', types: [1, 2] }, ctx),
      ).rejects.toMatchObject({ code: 'bad_args' });
      await expect(
        dispatchTool('search_diagrams', { query: 'p', types: 'openapi' }, ctx),
      ).rejects.toMatchObject({ code: 'bad_args' });
      expect(forwardToMacro).not.toHaveBeenCalled();
    });

    it('rejects a non-number limit', async () => {
      const { ctx } = makeCtx();
      await expect(
        dispatchTool('search_diagrams', { query: 'p', limit: '5' }, ctx),
      ).rejects.toMatchObject({ code: 'bad_args' });
    });
  });

  describe('list_diagrams', () => {
    it('forwards an empty payload when no args (whole-site list)', async () => {
      const { ctx, forwardToMacro } = makeCtx(ROWS);
      await dispatchTool('list_diagrams', {}, ctx);
      expect(forwardToMacro).toHaveBeenCalledWith('list_diagrams', {});
    });

    it('forwards spaceKey/pageId/types/limit when provided', async () => {
      const { ctx, forwardToMacro } = makeCtx(ROWS);
      await dispatchTool('list_diagrams', { spaceKey: 'ENG', pageId: 'p1', types: ['graph'], limit: 3 }, ctx);
      expect(forwardToMacro).toHaveBeenCalledWith('list_diagrams', {
        spaceKey: 'ENG',
        pageId: 'p1',
        types: ['graph'],
        limit: 3,
      });
    });

    it('rejects a non-string spaceKey', async () => {
      const { ctx, forwardToMacro } = makeCtx();
      await expect(dispatchTool('list_diagrams', { spaceKey: 42 }, ctx)).rejects.toMatchObject({
        code: 'bad_args',
      });
      expect(forwardToMacro).not.toHaveBeenCalled();
    });
  });
});

describe('dispatchTool — update_diagram guardrail (charter §4-C)', () => {
  it('with no diagram snapshot, passes through and forwards verbatim (pre-existing behaviour)', async () => {
    const { ctx, forwardToMacro } = makeCtx({ ok: true, version: 3, rendered: true });
    const result = await dispatchTool('update_diagram', { dsl: 'literally anything' }, ctx);
    expect(forwardToMacro).toHaveBeenCalledWith('update_diagram', { dsl: 'literally anything', summary: undefined });
    expect(result).toEqual({ ok: true, version: 3, rendered: true });
  });

  it('rejects unparseable DSL with ToolError("guardrail") and never forwards', async () => {
    const { ctx, forwardToMacro } = makeCtxWithSnapshot({ diagramType: 'Sequence', dsl: 'A->B: hi' });
    await expect(dispatchTool('update_diagram', { dsl: 'A.method(' }, ctx)).rejects.toMatchObject({
      name: 'ToolError',
      code: 'guardrail',
    });
    expect(forwardToMacro).not.toHaveBeenCalled();
  });

  it('surfaces structured parse errors (reason + line/col) in the ToolError data', async () => {
    const { ctx } = makeCtxWithSnapshot({ diagramType: 'Sequence', dsl: 'A->B: hi' });
    try {
      await dispatchTool('update_diagram', { dsl: 'A.method(' }, ctx);
      throw new Error('expected a guardrail rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const data = (err as ToolError).data as { reason: string; errors: { line: number }[] };
      expect(data.reason).toBe('parse_error');
      expect(data.errors[0].line).toBe(1);
    }
  });

  it('rejects catastrophic truncation as reason "data_loss" and never forwards', async () => {
    const big = [
      'Alice->Bob: request authentication token',
      'Bob->AuthService: validate the supplied credentials',
      'AuthService->Bob: token issued successfully',
      'Bob->Alice: here is your fresh session token',
    ].join('\n');
    const { ctx, forwardToMacro } = makeCtxWithSnapshot({ diagramType: 'Sequence', dsl: big });
    try {
      await dispatchTool('update_diagram', { dsl: 'A->B: hi' }, ctx);
      throw new Error('expected a guardrail rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe('guardrail');
      expect(((err as ToolError).data as { reason: string }).reason).toBe('data_loss');
    }
    expect(forwardToMacro).not.toHaveBeenCalled();
  });

  it('forwards valid DSL and attaches the semantic before/after diff to the result', async () => {
    const { ctx, forwardToMacro } = makeCtxWithSnapshot(
      { diagramType: 'Sequence', dsl: 'A->B: x' },
      { ok: true, version: 2, rendered: true },
    );
    const result = await dispatchTool('update_diagram', { dsl: 'A->B: x\nB->C: y' }, ctx);
    expect(forwardToMacro).toHaveBeenCalledWith('update_diagram', { dsl: 'A->B: x\nB->C: y', summary: undefined });
    expect(result).toMatchObject({
      ok: true,
      version: 2,
      rendered: true,
      diff: { participants_before: 2, participants_after: 3, messages_before: 1, messages_after: 2 },
    });
  });
});
