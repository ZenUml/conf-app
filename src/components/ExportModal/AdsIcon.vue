<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    :viewBox="glyphData.viewBox"
    fill="none"
    stroke="currentColor"
    :stroke-width="glyphData.strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    role="presentation"
    focusable="false"
  >
    <path :d="glyphData.d" />
  </svg>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { ADS_ICONS, type AdsIconGlyph, type AdsIconName } from './adsIcons';

export default defineComponent({
  name: 'AdsIcon',

  props: {
    glyph: { type: String as PropType<AdsIconName>, required: true },
    size: { type: Number, default: 16 },
  },

  computed: {
    // Each glyph carries the coordinate space it was authored in, so the
    // Figma-sourced paths render at their source proportions without being
    // re-fitted into a shared 24x24 box.
    glyphData(): AdsIconGlyph {
      return ADS_ICONS[this.glyph];
    },
  },
});
</script>
