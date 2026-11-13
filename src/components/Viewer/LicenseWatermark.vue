<template>
  <!-- Sibling of .screen-capture-content, never inside it: exports (PNG, PDF,
       Word) and the stored PNG are cut from the capture node and must not
       carry the notice. Design: Figma 383:377 (1374x430 area, 96px / 30px). -->
  <svg
    class="license-watermark"
    data-testid="license-watermark"
    viewBox="0 0 1374 430"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
    focusable="false"
  >
    <g transform="rotate(-17.4 687 215)" fill="rgba(222, 53, 11, 0.16)" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
      <text x="687" y="205" font-size="96" font-weight="700" letter-spacing="2">NO ACTIVE LICENSE</text>
      <text x="687" y="262" font-size="30" font-weight="500">Payment required · Ask your Confluence admin to subscribe to Full</text>
    </g>
  </svg>
</template>

<style scoped>
/* Above the diagram, below the viewer controls (zoom card z-index 2, floating
   pills z-index 5): see .viewer-canvas--license-notice in GenericViewer.vue,
   which makes the layering true. */
.license-watermark {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
  user-select: none;
}
</style>
