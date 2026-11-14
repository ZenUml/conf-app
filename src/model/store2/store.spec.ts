import store from './index';
import ExtendedStore from './ExtendedStore';
import globals from '@/model/globals';

describe('Store', function () {
  it('should have default values', function () {
    expect(store.state.diagram.mermaidCode).toBe('');
  });

  it('can update mermaid code', () => {
    store.commit('updateMermaidCode', 'graph TD; A1-->B1;');
    expect(store.state.diagram.mermaidCode).toBe('graph TD; A1-->B1;');
  });

  it('does not define pass-through actions on ExtendedStore', () => {
    expect(ExtendedStore.actions).toBeUndefined();
  });

  it('exposes globals.apWrapper on window.globals without dead isEmbedded field', () => {
    expect(globals.apWrapper).toBeDefined();
    expect((window as any).globals).toBe(globals);
    expect('isEmbedded' in globals).toBe(false);
  });
});
