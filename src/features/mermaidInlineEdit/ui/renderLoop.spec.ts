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

describe('createRenderLoop: slow-render debounce', () => {
  function timed(delayMs: () => number) {
    let text = 'base';
    let clock = 0;
    const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
    const renders: string[] = [];
    const pending: Array<ReturnType<typeof deferred>> = [];
    const loop = createRenderLoop({
      initialCode: 'base',
      now: () => clock,
      delay: delayMs,
      setTimer: (run, ms) => { const t = { at: clock + ms, run, live: true }; timers.push(t); return t; },
      clearTimer: (t) => { (t as { live: boolean }).live = false; },
      next: () => ({ code: text }),
      render: (code) => { renders.push(code); const d = deferred(); pending.push(d); return d.promise; },
      onRendered: () => undefined,
    });
    const advance = (ms: number) => {
      clock += ms;
      for (const t of timers.filter((x) => x.live && x.at <= clock)) { t.live = false; t.run(); }
    };
    return {
      loop, renders, advance,
      type: (t: string) => { text = t; loop.request(); },
      finish: async () => { pending.shift()!.resolve(true); await new Promise((r) => setTimeout(r, 0)); },
    };
  }

  it('waits for a pause of `delay` ms after the last request, then renders the newest text once', () => {
    const h = timed(() => 250);
    h.type('a');
    h.advance(100);
    h.type('ab');
    h.advance(200);
    expect(h.renders).toEqual([]);
    h.advance(50);
    expect(h.renders).toEqual(['ab']);
  });

  it('a request during a render waits for the rest of the pause after the render lands', async () => {
    const h = timed(() => 250);
    h.type('a');
    h.advance(250);
    expect(h.renders).toEqual(['a']);
    h.advance(100);
    h.type('ab');
    await h.finish();
    expect(h.renders).toEqual(['a']);
    h.advance(249);
    expect(h.renders).toEqual(['a']);
    h.advance(1);
    expect(h.renders).toEqual(['a', 'ab']);
  });

  it('delay 0 is the plain loop: render at once', () => {
    const h = timed(() => 0);
    h.type('a');
    expect(h.renders).toEqual(['a']);
  });

  it('cancelPending and dispose drop a waiting render', async () => {
    const h = timed(() => 250);
    h.type('a');
    h.loop.cancelPending();
    h.advance(1000);
    expect(h.renders).toEqual([]);
    await h.loop.idle();
    h.type('b');
    h.loop.dispose();
    h.advance(1000);
    expect(h.renders).toEqual([]);
  });
});
