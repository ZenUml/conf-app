import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadMermaidMock = vi.hoisted(() => vi.fn());
vi.mock('./loadMermaid', () => ({ loadMermaid: loadMermaidMock }));

import { __resetMermaidRenderQueueForTests, renderMermaid } from './renderMermaid';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('renderMermaid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMermaidRenderQueueForTests();
  });

  it('serializes complete render operations and cleans up only their own temporary node', async () => {
    const first = deferred<{ svg: string }>();
    const second = deferred<{ svg: string }>();
    const render = vi.fn((id: string) => {
      const temp = document.createElement('div');
      temp.id = `d${id}`;
      document.body.append(temp);
      return id === 'first' ? first.promise : second.promise;
    });
    loadMermaidMock.mockResolvedValue({ render });

    const firstResult = renderMermaid('first', 'flowchart LR\nA-->B');
    const secondResult = renderMermaid('second', 'flowchart LR\nA-->C');

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(document.getElementById('dfirst')).not.toBeNull();
    expect(document.getElementById('dsecond')).toBeNull();

    first.resolve({ svg: '<svg>first</svg>' });
    await expect(firstResult).resolves.toEqual({ svg: '<svg>first</svg>' });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(document.getElementById('dfirst')).toBeNull();
    expect(document.getElementById('dsecond')).not.toBeNull();

    second.resolve({ svg: '<svg>second</svg>' });
    await expect(secondResult).resolves.toEqual({ svg: '<svg>second</svg>' });
    expect(document.getElementById('dsecond')).toBeNull();
  });

  it('continues the queue after a render rejects', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('broken diagram'))
      .mockResolvedValueOnce({ svg: '<svg>next</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    await expect(renderMermaid('broken', 'broken')).rejects.toThrow('broken diagram');
    await expect(renderMermaid('next', 'flowchart LR\nA-->B')).resolves.toEqual({ svg: '<svg>next</svg>' });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('snapshots flowchart identity inside the queue before a later render mutates it', async () => {
    const first = deferred<{ svg: string }>();
    const vertex = { id: 'A', domId: 'flowchart-A-0' };
    const edge = { id: 'ab', start: 'A', end: 'B', stroke: 'normal' };
    const parse = vi.fn(async () => ({ type: 'flowchart-v2', db: { getVertices: () => new Map([['A', vertex]]), getEdges: () => [edge] } }));
    const render = vi.fn((id: string) => {
      if (id === 'first') return first.promise;
      vertex.id = 'changed'; edge.start = 'changed';
      return Promise.resolve({ svg: '<svg>second</svg>' });
    });
    loadMermaidMock.mockResolvedValue({ render, mermaidAPI: { getDiagramFromText: parse } });
    const pending = renderMermaid('first', 'first source', { captureFlowchartModel: true });
    const next = renderMermaid('second', 'second source');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(parse).toHaveBeenCalledWith('first source');
    first.resolve({ svg: '<svg>first</svg>' });
    const result = await pending;
    await next;
    expect(result.flowchartModel?.nodes[0]).toEqual({ id: 'A', domId: 'flowchart-A-0' });
    expect(result.flowchartModel?.edges[0]).toEqual({ id: 'ab', source: 'A', target: 'B' });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('preserves rendering when optional model capture is unsupported or fails', async () => {
    const parse = vi.fn().mockResolvedValueOnce({ type: 'sequence' }).mockRejectedValueOnce(new Error('snapshot failed'));
    const render = vi.fn().mockResolvedValue({ svg: '<svg>real diagram</svg>' });
    loadMermaidMock.mockResolvedValue({ render, mermaidAPI: { getDiagramFromText: parse } });
    for (const id of ['sequence', 'failed-snapshot']) {
      await expect(renderMermaid(id, 'source', { captureFlowchartModel: true })).resolves.toEqual({ svg: '<svg>real diagram</svg>', flowchartModel: undefined });
    }
    expect(render).toHaveBeenCalledTimes(2);
  });

});
