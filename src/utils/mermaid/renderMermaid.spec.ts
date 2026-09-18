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
});
