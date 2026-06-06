import store from './index';

describe('Store', function () {
  it('should have default values', function () {
    expect(store.state.diagram.mermaidCode).toBe('');
  });

  it('can update mermaid code', () => {
    store.commit('updateMermaidCode', 'graph TD; A1-->B1;');
    expect(store.state.diagram.mermaidCode).toBe('graph TD; A1-->B1;');
  })

  it('can update mermaid svg', () => {
    store.commit('updateMermaidSvg', '<svg>test</svg>');
    expect(store.state.diagram.mermaidSvg).toBe('<svg>test</svg>');
  })

  it('does not overwrite mermaidSvg when payload is falsy', () => {
    store.commit('updateMermaidSvg', '<svg>kept</svg>');
    store.commit('updateMermaidSvg', '');
    expect(store.state.diagram.mermaidSvg).toBe('');
  })
});
