<template>
  <div class="get-started-page">
    <div class="hero-section">
      <div class="hero-content">
        <h1>Welcome to ZenUML Diagrams! <span class="forge-badge">FORGE</span></h1>
        <p class="hero-description">
          Your team is now ready to create and edit standard-compliant UML Diagrams with the power of ZenUML Diagrams.
        </p>
        <div class="hero-actions">
          <p class="hero-instruction">Navigate to any Confluence page and use the "+" button to insert a ZenUML macro!</p>
        </div>
      </div>
    </div>

    <div class="features-section">
      <h2>What You Can Do</h2>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">
            <img src="/image/diagram_macro_icon.png" alt="Sequence diagram icon" />
          </div>
          <h3>Sequence Diagrams</h3>
          <p>Create ZenUML sequence diagrams with powerful syntax and real-time preview.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAOVBMVEVHcEz/NnD/NnD/NnD/NnD/NnD/NnD/JGj/GWT/LGv/rL//2uL/yNT/mLD/SHr/////WYT/d5j/8/YtuSebAAAAB3RSTlMACY3w/94uwI4IpwAAANJJREFUeAGdk1EOhCAMRBHBtgCC3v+w2yg6bkJws88vnNcGCDXGTHZ2XbydjLK4AYvWuyHG2LFgzTwWvHFj5lMgJvkOhFggUIgpr4yU15xiEAipKLHSmVONRQkEIZSDfDTha4UOspWToAantqgQHJdGpqtb2dlBuP+Wtd6uQFCjNFJ6NoAgrRBUgYB9gk0chHb4HfHe6iEoIrex4+IhPPexag4BcGwnYdcXCHfcFyT/KGz/d9jiQacD3pl+hBzC4NH6seDfB+d19F6HV7F+7uKthh+IeBoSSzpYDQAAAABJRU5ErkJggg==" alt="Mermaid diagram icon" />
          </div>
          <h3>Mermaid Diagrams</h3>
          <p>Write diagrams using Mermaid syntax and render them instantly in Confluence pages.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADJ0lEQVR4Ae2VA4xcURSG63Vt22ZUxUkbp7Zt27Ztu1Ft2+bYNt/fc982k4z27azKk3yPF991LtOS/NsJHWHKYbTEGiZgJvCLUDIBR0yZFucl8kQhb6wC+pgFLBsrw7qzSUToXzYKUOtsxzrAr3sPzqEndCHo4aN/lkMdYVyUN3t6wP1yL4TC9mAf1DPjs0FgaRw8b48KCzw5DvGYFCbx6wREo1MgHp3MJH6dgGhUMvVEMjSz4n+ZgIBEzJMwH9xPN0MoLDe3UsVJAYFUiSRoZsdlfhladzWFT/4QLHwWNdzSFwx61oCF69sDKJa0gmhkIqs4TEJLEpnqAdPyFHg+ngHncUG7tx8kk8rwaPcPBOd1w/b4GMRjC4f1QJDEnLgMCizKA/vZ7oCPKnpyAuJxxfiWMsTji8P+7DSJOaDe3hmiEQkRBRiSsbxEjALU/eb15eFTPOa7XrGiTXAl9Kxc1R4+qxauL3chmVqRxJLSlpgbF4tAPjhvzATAwXRhWdSCTZdWAZwfhlNTguZBVInZccEC4Sce3Rfl4g8av0UKt+wVpLNqRi6cvslm14ZH8RZe7TfIFzTG9+FxgWGKMjEjCCyNh2VzNVi21/9JA3heHwQL0/mlkEwsHbl76RubkKaLK8DCenc35AubBpDNqQPRmELBeUYnhwoUgOPSWPhNInA2NaECZ9cAfg/AcfDb9HC8vwLZ3PrBLWKtn9cAzvdX4bcbAHDgfG62PAk1f/fqxdCfmEjpU6II0Dib15SET/UMQqE7MhLfR8QHCqJn+jYKQuGWPIdkSnnWW1EE1pWFX/sOQqE/OSlUgL5NhlB4lO8hnVb5txEg/gsErQISWF08cNhEDc4P7YHB4ZPw4BB+paQVru+PIJlcNppAqoTtVDc+oUfxjngbhvX+PkinVw3eC+hZOqMa/dsfMQ/Bl6nZ3Tt0/zAECxDGxfmhnleSuqoSJFNDqQjx2CJRNyL6x6cJz0dMKsNOSQGBgEQ+KKfGp2YYGUxYxeEi0aH/QgJBPaGcxp942UaYwC+Q4AUsBH6RhJoJ7Psp4YgGSTgUkxMdlCE9ONOJhdjyA6smHTdQzJIpAAAAAElFTkSuQmCC" alt="Graph diagram icon" />
          </div>
          <h3>Graph Diagrams</h3>
          <p>Design complex flowcharts and diagrams using the DrawIO-powered graph editor.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAsVBMVEVHcExHTjpCQUNCQUNCQUNCQUNERz1CQUNFSzZ6tEFrpUNrpUNIVTBTaDN4skFrpUNtqkRKVjBMWzFCQUOTyT5IUjBJVTB9ozxCRTyUyD2VyT1ppENMWzFCQUNFST1acjOXzT6UyD2Wyz1rpUNLWDBtp0OXyz1nokNMWjFMWjGDszyXzT1rpkNRaTRFSjpLWTBMWjFIVTCYzT2Z0D5sp0NvrkWIyUOUyD1rpUOXyj1afTnZtqL5AAAAO3RSTlMADjPk/84ht3xAfJ+KVBv/rMX/mS+95RQq7dGPr6VhZeL/Zu3/ZZfEgDFTrPZoa9L/9HaG/ycFW8nJSgtmUf8AAAFuSURBVHgBfNFVggJBDEXR4G7BaVfcnf0vbKoryeCcH+RdaIMfUin4JZ3JZnN5+Cqf1b7/SYGCIjwolSvlYrVGP8pQUABRrzSUZgsRW7X7P7SBdRpas4uJXl+CAc394ch4DEywaLf5jB3X8wMJeM/1bTsFpBfWXC+SgHe4MxFVEY8pkH2SAjZF1MWMrkJ29Ya1kIq5sTBKdlV2RP6LFDKnA4rsyoSCJbIV5AuZXIF3ZS2nSNaQziq0EwrWSGy5/XnYsDydY0/bDiBLVuAsCZ3lbk/q9yA4kCMkRh7ZyfNJnRqsDonYI2dI8fMpSwDaWc9x1DAAioX2AI6yXyg4qfk6GzcWNbq3nVWTgwjI3DsbjcbiFq7j0XzueU6VC2D9aKH3zdLT5t2JLsog6Pe49T0yC4uqCODuclA7Vl2PuMWNKupwd0r2cOaJXQ+rRxDyxLpz719tMwXBahvHu/Phg47c8+G+D5+dOmf/b+acaLIAMKA4jI70rE0AAAAASUVORK5CYII=" alt="OpenAPI icon" />
          </div>
          <h3>OpenAPI Specifications</h3>
          <p>Create and visualize OpenAPI/Swagger specifications with interactive documentation.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">
            <img src="/image/grid.png" alt="Embed content icon" />
          </div>
          <h3>Embed Existing Content</h3>
          <p>Embed and display existing diagrams, graphs, or API specifications in your pages.</p>
        </div>
      </div>
    </div>

    <div class="tutorial-section">
      <h2>Quick Start Tutorial</h2>
      <div class="tutorial-content">
        <div class="tutorial-video">
          <img
            src="/image/diagram-example.webp"
            alt="Example sequence diagram"
            width="100%"
            height="315"
            style="object-fit:cover;"
          />
        </div>
        <div class="tutorial-steps">
          <div class="step">
            <div class="step-number">1</div>
            <div class="step-content">
              <h4>Insert a Macro</h4>
              <p>Go to any Confluence page and click the "+" button to insert content. Search for "ZenUML" and choose your diagram type.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-number">2</div>
            <div class="step-content">
              <h4>Create Your Diagram</h4>
              <p>Use the intuitive editor to create your diagram. For sequence diagrams, you can use ZenUML or Mermaid syntax.</p>
            </div>
          </div>
          <div class="step">
            <div class="step-number">3</div>
            <div class="step-content">
              <h4>Save and Share</h4>
              <p>Save your diagram and it will be embedded in your Confluence page for your team to view and collaborate on.</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="resources-section">
      <h2>Resources & Support</h2>
      <div class="resources-grid">
        <div class="resource-card">
          <h4>📚 Documentation</h4>
          <p>Comprehensive guides and API reference</p>
          <a href="#" @click="viewDocumentation()" target="_blank" class="resource-link">
            View Documentation →
          </a>
        </div>
        <div class="resource-card">
          <h4>🎥 Video Tutorials</h4>
          <p>Step-by-step video guides</p>
          <a href="#" @click="openUrl('https://www.youtube.com/watch?v=cqQLyOwAZ0A')" target="_blank" class="resource-link">
            Watch Videos →
          </a>
        </div>
        <div class="resource-card">
          <h4>💬 Community</h4>
          <p>Get help from the community</p>
          <a href="#" @click="openUrl('https://community.atlassian.com')" target="_blank" class="resource-link">
            Join Community →
          </a>
        </div>
        <div class="resource-card">
          <h4>🐛 Report Issues</h4>
          <p>Found a bug? Let us know</p>
          <a href="#" @click="openUrl('https://zenuml.atlassian.net/servicedesk')" target="_blank" class="resource-link">
            Report Issue →
          </a>
        </div>
      </div>
    </div>

  </div>
</template>

<script>
import { trackEvent } from "@/utils/window";

export default {
  name: "GetStarted",
  data() {
    return {
      hasTrackedPageView: false
    };
  },
  mounted() {
    this.trackPageView();
  },
  methods: {
    trackPageView() {
      if (!this.hasTrackedPageView) {
        trackEvent('', 'get_started_page_view', 'forge_get_started', {
          page_type: 'global_settings_get_started',
          version: '2025.04'
        });
        this.hasTrackedPageView = true;
      }
    },

    createFirstDiagram() {
      trackEvent('', 'get_started_create_first_diagram', 'forge_get_started');
      // Navigate to create diagram (this would be handled by Forge navigation)
      this.showMessage('Navigate to any Confluence page and use the "+" button to insert a ZenUML macro!');
    },

    createSequenceDiagram() {
      trackEvent('', 'get_started_create_sequence', 'forge_get_started');
      this.showMessage('Navigate to any Confluence page and insert a ZenUML Sequence Diagram macro!');
    },

    createMermaidDiagram() {
      trackEvent('', 'get_started_create_mermaid', 'forge_get_started');
      this.showMessage('Navigate to any Confluence page and insert a Mermaid Diagram macro!');
    },

    createGraphDiagram() {
      trackEvent('', 'get_started_create_graph', 'forge_get_started');
      this.showMessage('Navigate to any Confluence page and insert a ZenUML Graph Diagram macro!');
    },

    createOpenAPIDiagram() {
      trackEvent('', 'get_started_create_openapi', 'forge_get_started');
      this.showMessage('Navigate to any Confluence page and insert a ZenUML OpenAPI Diagram macro!');
    },

    createEmbedDiagram() {
      trackEvent('', 'get_started_create_embed', 'forge_get_started');
      this.showMessage('Navigate to any Confluence page and insert a ZenUML Embed Diagram macro!');
    },

    async viewDocumentation() {
      trackEvent('', 'get_started_view_docs', 'forge_get_started');
      await this.openUrl('https://zenuml.atlassian.net/wiki/spaces/Doc/overview');
    },
    async openUrl(url) {
      const { router } = await import("@forge/bridge");
      router.open(url);
    },

    showMessage(message) {
      // Create a temporary notification
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #0052CC;
        color: white;
        padding: 12px 16px;
        border-radius: 4px;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `;
      notification.textContent = message;
      document.body.appendChild(notification);
      
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 5000);
    }
  }
};
</script>

<style scoped>
.get-started-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #172B4D;
}

.hero-section {
  text-align: center;
  padding: 48px 24px;
  background: linear-gradient(135deg, #0052CC 0%, #0747A6 100%);
  color: white;
  border-radius: 8px;
  margin-bottom: 48px;
}

.hero-content h1 {
  font-size: 36px;
  font-weight: 700;
  margin: 0 0 16px 0;
}

.forge-badge {
  background: #FF5630;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  margin-left: 12px;
}

.hero-description {
  font-size: 18px;
  margin: 0 0 32px 0;
  opacity: 0.9;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.hero-actions {
  display: flex;
  flex-direction: column; /* stack instruction and button vertically */
  gap: 12px;
  justify-content: center;
  align-items: center;
}

.hero-instruction {
  margin: 0;
  padding: 12px 24px;
  background: rgba(255,255,255,0.06);
  color: white;
  border-radius: 6px;
  font-weight: 600;
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  text-decoration: none;
  display: inline-block;
}

.btn-primary {
  background: #FF5630;
  color: white;
}

.btn-primary:hover {
  background: #E53E3E;
  transform: translateY(-1px);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.features-section {
  margin-bottom: 48px;
}

.features-section h2 {
  text-align: center;
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 32px 0;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
}

.feature-card {
  background: white;
  border: 1px solid #DFE1E6;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.feature-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.feature-icon {
  margin-bottom: 16px;
  display: flex;
  justify-content: center;
}
.feature-icon img {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.feature-card h3 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 12px 0;
}

.feature-card p {
  color: #6B778C;
  margin: 0 0 20px 0;
  line-height: 1.5;
}

.feature-btn {
  background: #0052CC;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.feature-btn:hover {
  background: #0747A6;
}

.tutorial-section {
  margin-bottom: 48px;
}

.tutorial-section h2 {
  text-align: center;
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 32px 0;
}

.tutorial-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  align-items: start;
}

.tutorial-video {
  background: #F4F5F7;
  border-radius: 8px;
  overflow: hidden;
}

.tutorial-steps {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.step-number {
  background: #0052CC;
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}

.step-content h4 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
}

.step-content p {
  margin: 0;
  color: #6B778C;
  line-height: 1.5;
}

.resources-section {
  margin-bottom: 48px;
}

.resources-section h2 {
  text-align: center;
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 32px 0;
}

.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 24px;
}

.resource-card {
  background: white;
  border: 1px solid #DFE1E6;
  border-radius: 8px;
  padding: 24px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.resource-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.resource-card h4 {
  margin: 0 0 12px 0;
  font-size: 18px;
  font-weight: 600;
}

.resource-card p {
  margin: 0 0 16px 0;
  color: #6B778C;
  line-height: 1.5;
}

.resource-link {
  color: #0052CC;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}

.resource-link:hover {
  color: #0747A6;
  text-decoration: underline;
}

.footer-section {
  text-align: center;
  padding: 32px;
  background: #F4F5F7;
  border-radius: 8px;
}

.footer-section p {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .hero-content h1 {
    font-size: 28px;
  }
  
  .hero-description {
    font-size: 16px;
  }
  
  .tutorial-content {
    grid-template-columns: 1fr;
  }
  
  .features-grid {
    grid-template-columns: 1fr;
  }
  
  .resources-grid {
    grid-template-columns: 1fr;
  }
  
  .hero-actions {
    flex-direction: column;
    align-items: center;
  }
}
</style>
