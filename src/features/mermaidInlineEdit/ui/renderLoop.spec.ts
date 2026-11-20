import { describe, expect, it } from 'vitest';
import { createRenderLoop, type Candidate } from './renderLoop';

function deferred() {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => { resolve = r; });
  return { promise, resolve };
}

function harness(opts: { schedule?: (run: () => void) => void } = {}) {
  let text = 'base';
  const renders: string[] = [];
  const pending: Array<ReturnType<typeof deferred>> = [];
  const rendered: Array<[Candidate, boolean]> = [];
  const loop = createRenderLoop({
    initialCode: 'base',
    schedule: opts.schedule,
    next: () => (text === 'INVALID' ? null : { code: text, tag: text }),
    render: (code) => {
      renders.push(code);
      const d = deferred();
      pending.push(d);
      return d.promise;
    },
    onRendered: (c, ok) => rendered.push([c, ok]),
  });
  return {
    loop, renders, rendered,
    set: (t: string) => { text = t; loop.request(); },
    finish: async (ok = true) => { pending.shift()!.resolve(ok); await new Promise((r) => setTimeout(r, 0)); },
  };
}

describe('createRenderLoop', () => {
  it('renders at once when idle and coalesces requests made during a render to the newest', async () => {
    const h = harness();
    h.set('a');
    expect(h.renders).toEqual(['a']);
    h.set('ab');
    h.set('abc');
    expect(h.renders).toEqual(['a']);
    await h.finish();
    expect(h.renders).toEqual(['a', 'abc']);
    await h.finish();
    await h.loop.idle();
    expect(h.loop.stats()).toEqual({ requests: 3, renders: 2, skipped: 1 });
    expect(h.rendered.map(([c]) => c.code)).toEqual(['a', 'abc']);
  });

  it('skips a candidate equal to what is on screen, and an invalid (null) candidate', async () => {
    const h = harness();
    h.set('base');
    h.set('INVALID');
    expect(h.renders).toEqual([]);
    h.set('x');
    await h.finish();
    h.set('x');
    expect(h.renders).toEqual(['x']);
    await h.loop.idle();
  });

  it('a failed render does not count as shown', async () => {
    const h = harness();
    h.set('x');
    await h.finish(false);
    h.set('x');
    expect(h.renders).toEqual(['x', 'x']);
    expect(h.rendered[0][1]).toBe(false);
    await h.finish();
  });

  it('starts through the schedule, so requests queued before it runs share one render', async () => {
    const queued: Array<() => void> = [];
    const h = harness({ schedule: (run) => queued.push(run) });
    h.set('a');
    h.set('ab');
    expect(h.renders).toEqual([]);
    expect(queued).toHaveLength(1);
    let idle = false;
    void h.loop.idle().then(() => { idle = true; });
    queued.shift()!();
    expect(h.renders).toEqual(['ab']);
    await h.finish();
    expect(idle).toBe(true);
  });

  it('dispose drops pending work and resolves idle', async () => {
    const h = harness();
    h.set('a');
    h.set('ab');
    const idle = h.loop.idle();
    h.loop.dispose();
    await h.finish();
    await idle;
    expect(h.renders).toEqual(['a']);
    expect(h.rendered).toEqual([]);
  });
});
