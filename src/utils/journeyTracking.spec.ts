import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.resetModules());

describe('editor journey ownership across iframe instances', () => {
  it('parent cleanup cannot clear or cancel the independently running child journey', async () => {
    const parent = await import('./journeyTracking');
    const id = parent.startEditJourney('macro-test', 'dialog');
    const time = parent.getEditJourneyStartTime()!;
    vi.resetModules(); // distinct module instance, as in another iframe
    const child = await import('./journeyTracking');
    child.continueEditJourney(id, 'macro-test', time);
    parent.clearEditJourney();
    expect(parent.getEditJourneyId()).toBeNull();
    expect(child.getEditJourneyId()).toBe(id);
    expect(child.getEditJourneyStartTime()).toBe(time);
    child.endEditJourney('saved');
    parent.clearEditJourney();
    expect(child.getEditJourneyId()).toBeNull();
    expect(child.startEditJourney('macro-test', 'dialog')).not.toBe(id);
  });
});
