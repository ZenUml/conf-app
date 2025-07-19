<template>
  <div
    ref="container"
    :style="{
      width: '100%',
      overflow: 'hidden',
      position: 'relative',
      margin: '0 auto',
      ...(scaledHeight > 0 ? { height: scaledHeight + 'px' } : {})
    }"
  >
    <slot :container="containerRef"></slot>
  </div>
</template>

<script>
export default {
  name: "ViewResizer",
  data() {
    return {
      resizeObserver: null,
      containerRef: null,
      scale: 1,
      scaledHeight: 0,
      originalWidth: 0,
      originalHeight: 0,
    };
  },
  mounted() {
    this.containerRef = this.$refs.container;
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.containerRef);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  },
  beforeDestroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    window.removeEventListener('resize', this.handleResize);
  },
  methods: {
    handleResize() {
      this.$nextTick(() => {
        const resizeTarget = this.containerRef.querySelector('.resize-target');
        if (resizeTarget && resizeTarget.firstChild) {
          const width = resizeTarget.scrollWidth;
          const height = resizeTarget.scrollHeight;
          if (width && height &&
              (width !== this.originalWidth || height !== this.originalHeight)) {
            this.originalWidth = width;
            this.originalHeight = height;
          }
        }
        if (!this.originalWidth || !this.originalHeight) return;
        const containerWidth = this.containerRef.clientWidth;
        const scale = Math.max(0.1, Math.min(2, containerWidth / this.originalWidth));
        const scaledHeight = this.originalHeight * scale;
        this.scale = scale;
        this.scaledHeight = scaledHeight;
        if (resizeTarget) {
          resizeTarget.style.transform = `scale(${scale})`;
          resizeTarget.style.transformOrigin = 'top left';
        }
        this.containerRef.style.height = `${scaledHeight}px`;
        window.AP?.size?.({ height: scaledHeight });
      });
    }
  }
};
</script>
<style>
.resize-target{
  position: relative;
  transform-origin: top left;
  will-change: transform;
}
</style>
