// Declared dimensions for this package's supported node vocabulary. These
// values are code-owned, never read from Mermaid or SVG data attributes.
export const BOX_RULES_PROFILE = Object.freeze({
  gridStep: 4,
  containerContentInsets: Object.freeze({left:40,right:40,top:64,bottom:44}),
  sizingContract: Object.freeze({
    maxUnbreakableChars: 54,
    charWidth: 8.2,
    horizontalPadding: 28,
    firstLineInkHeight: 16,
    lineHeight: 19,
    verticalPadding: 24,
    tiers: Object.freeze([[96, 40], [200, 80], [320, 120], [480, 160]].map(tier => Object.freeze(tier))),
    outlinePadding: 24,
    decisionOutlinePadding: 80,
  }),
});
