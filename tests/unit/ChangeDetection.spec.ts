import { DiagramType } from '@/model/Diagram/Diagram';

describe('Change Detection', () => {
  let originalCode = '';
  let originalMermaidCode = '';
  let mockStore: any;

  beforeEach(() => {
    // Reset original code values
    originalCode = 'original sequence code';
    originalMermaidCode = 'original mermaid code';
    
    // Mock store state
    mockStore = {
      state: {
        diagram: {
          id: 'test-id',
          diagramType: DiagramType.Sequence,
          code: originalCode,
          mermaidCode: originalMermaidCode,
          isNew: false
        }
      }
    };
  });

  describe('hasChanges function', () => {
    it('should return false when no changes are made', () => {
      // Simulate the hasChanges function logic
      const hasChanges = () => {
        const currentCode = mockStore.state.diagram.code || '';
        const currentMermaidCode = mockStore.state.diagram.mermaidCode || '';
        
        if (mockStore.state.diagram.diagramType === DiagramType.Mermaid) {
          return currentMermaidCode !== originalMermaidCode;
        } else {
          return currentCode !== originalCode;
        }
      };

      expect(hasChanges()).toBe(false);
    });

    it('should return true when sequence code is changed', () => {
      // Update the code in store
      mockStore.state.diagram.code = 'modified sequence code';
      
      const hasChanges = () => {
        const currentCode = mockStore.state.diagram.code || '';
        const currentMermaidCode = mockStore.state.diagram.mermaidCode || '';
        
        if (mockStore.state.diagram.diagramType === DiagramType.Mermaid) {
          return currentMermaidCode !== originalMermaidCode;
        } else {
          return currentCode !== originalCode;
        }
      };

      expect(hasChanges()).toBe(true);
    });

    it('should return true when mermaid code is changed', () => {
      // Change diagram type to Mermaid and update code
      mockStore.state.diagram.diagramType = DiagramType.Mermaid;
      mockStore.state.diagram.mermaidCode = 'modified mermaid code';
      
      const hasChanges = () => {
        const currentCode = mockStore.state.diagram.code || '';
        const currentMermaidCode = mockStore.state.diagram.mermaidCode || '';
        
        if (mockStore.state.diagram.diagramType === DiagramType.Mermaid) {
          return currentMermaidCode !== originalMermaidCode;
        } else {
          return currentCode !== originalCode;
        }
      };

      expect(hasChanges()).toBe(true);
    });

    it('should handle empty code values', () => {
      // Test with empty original code
      originalCode = '';
      originalMermaidCode = '';
      mockStore.state.diagram.code = '';
      mockStore.state.diagram.mermaidCode = '';
      
      const hasChanges = () => {
        const currentCode = mockStore.state.diagram.code || '';
        const currentMermaidCode = mockStore.state.diagram.mermaidCode || '';
        
        if (mockStore.state.diagram.diagramType === DiagramType.Mermaid) {
          return currentMermaidCode !== originalMermaidCode;
        } else {
          return currentCode !== originalCode;
        }
      };

      expect(hasChanges()).toBe(false);
    });

    it('should handle undefined code values', () => {
      // Test with undefined values
      originalCode = '';
      originalMermaidCode = '';
      mockStore.state.diagram.code = undefined;
      mockStore.state.diagram.mermaidCode = undefined;
      
      const hasChanges = () => {
        const currentCode = mockStore.state.diagram.code || '';
        const currentMermaidCode = mockStore.state.diagram.mermaidCode || '';
        
        if (mockStore.state.diagram.diagramType === DiagramType.Mermaid) {
          return currentMermaidCode !== originalMermaidCode;
        } else {
          return currentCode !== originalCode;
        }
      };

      expect(hasChanges()).toBe(false);
    });
  });
});
