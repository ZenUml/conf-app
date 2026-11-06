import { describe, expect, it } from 'vitest';
import { useAnnotations } from './useAnnotations';

describe('export annotations', () => {
  it('adds two text labels and edits/deletes only the selected label', () => {
    const state = useAnnotations();
    const first = state.add('note', { x: 0.2, y: 0.3 });
    const second = state.add('note', { x: 0.7, y: 0.4 });
    expect(first.id).not.toBe(second.id);
    state.select(first.id);
    state.update(first.id, { text: 'First label' });
    expect(state.items.value).toHaveLength(2);
    expect(state.selected.value?.text).toBe('First label');
    expect(state.items.value[1].text).toBe('');
    state.remove(first.id);
    expect(state.items.value.map(item => item.id)).toEqual([second.id]);
    expect(state.selected.value).toBeNull();
  });
});
