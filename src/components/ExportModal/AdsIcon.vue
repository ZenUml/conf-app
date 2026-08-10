<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    role="presentation"
    focusable="false"
    v-html="inner"
  ></svg>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { ADS_ICONS, type AdsIconName } from './adsIcons';

export default defineComponent({
  name: 'AdsIcon',

  props: {
    glyph: { type: String as PropType<AdsIconName>, required: true },
    size: { type: Number, default: 16 },
  },

  computed: {
    inner(): string {
      return ADS_ICONS[this.glyph];
    },
  },
});
</script>
