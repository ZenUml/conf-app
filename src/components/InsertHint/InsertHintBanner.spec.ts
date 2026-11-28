import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import InsertHintBanner from './InsertHintBanner.vue';

enableAutoUnmount(afterEach);

function selectedTitle(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[role="tab"][aria-selected="true"] .ih-tab-title').text();
}

function command(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid="insert-hint-command"]').text();
}

async function advance(ms: number) {
  // rAF runs every 16 ms under fake timers.
  await vi.advanceTimersByTimeAsync(ms);
}

describe('InsertHintBanner', () => {
  let visible = true;
  beforeEach(() => {
    visible = true;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {}
        observe() {
          if (visible) this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
      },
    );
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rotates once: Mermaid, draw.io, Swagger, back to Mermaid, then stops', async () => {
    const wrapper = mount(InsertHintBanner, { props: { reducedMotion: false }, attachTo: document.body });
    expect(selectedTitle(wrapper)).toBe('Mermaid');
    expect(command(wrapper)).toBe('/mermaid');

    await advance(3050);
    expect(selectedTitle(wrapper)).toBe('draw.io');
    expect(command(wrapper)).toBe('/drawio');

    await advance(3000);
    expect(selectedTitle(wrapper)).toBe('Swagger');
    expect(command(wrapper)).toBe('/swagger');

    await advance(3000);
    expect(selectedTitle(wrapper)).toBe('Mermaid');

    await advance(10000);
    expect(selectedTitle(wrapper)).toBe('Mermaid');

    const changes = wrapper.emitted('tab-change')!.map(([p]) => p);
    expect(changes).toEqual([
      { tab: 'drawio', source: 'auto' },
      { tab: 'swagger', source: 'auto' },
      { tab: 'mermaid', source: 'auto' },
    ]);
  });

  it('does not rotate while the banner is off screen', async () => {
    visible = false;
    const wrapper = mount(InsertHintBanner, { props: { reducedMotion: false }, attachTo: document.body });
    await advance(10000);
    expect(selectedTitle(wrapper)).toBe('Mermaid');
    expect(wrapper.emitted('tab-change')).toBeUndefined();
  });

  it('pauses while the pointer is over the tabs', async () => {
    const wrapper = mount(InsertHintBanner, { props: { reducedMotion: false }, attachTo: document.body });
    await wrapper.find('[role="tablist"]').trigger('mouseenter');
    await advance(6000);
    expect(selectedTitle(wrapper)).toBe('Mermaid');
    await wrapper.find('[role="tablist"]').trigger('mouseleave');
    await advance(3050);
    expect(selectedTitle(wrapper)).toBe('draw.io');
  });

  it('a click stops the pass and reports source "click"', async () => {
    const wrapper = mount(InsertHintBanner, { props: { reducedMotion: false }, attachTo: document.body });
    await wrapper.findAll('[role="tab"]')[2].trigger('click');
    expect(selectedTitle(wrapper)).toBe('Swagger');
    await advance(10000);
    expect(selectedTitle(wrapper)).toBe('Swagger');
    expect(wrapper.emitted('tab-change')).toEqual([[{ tab: 'swagger', source: 'click' }]]);
  });

  it('Arrow Down moves the selection and reports source "keyboard"', async () => {
    const wrapper = mount(InsertHintBanner, { props: { autoRotate: false }, attachTo: document.body });
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedTitle(wrapper)).toBe('draw.io');
    expect(wrapper.emitted('tab-change')).toEqual([[{ tab: 'drawio', source: 'keyboard' }]]);
  });

  it('with reduced motion it does not rotate and shows a full bar', async () => {
    const wrapper = mount(InsertHintBanner, { props: { reducedMotion: true }, attachTo: document.body });
    await advance(10000);
    expect(selectedTitle(wrapper)).toBe('Mermaid');
    expect(wrapper.find('[data-testid="insert-hint-progress"]').attributes('style')).toContain('width: 100%');
    expect(wrapper.emitted('tab-change')).toBeUndefined();
  });

  it('Replay reports the current tab and dismiss reports dismiss', async () => {
    const wrapper = mount(InsertHintBanner, { props: { autoRotate: false, initialTab: 'drawio' }, attachTo: document.body });
    await wrapper.find('.ih-replay').trigger('click');
    expect(wrapper.emitted('replay')).toEqual([[{ tab: 'drawio' }]]);
    await wrapper.find('.ih-close').trigger('click');
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
    expect(wrapper.emitted('shown')).toHaveLength(1);
  });
});
