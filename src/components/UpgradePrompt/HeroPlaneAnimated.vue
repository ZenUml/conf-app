<template>
  <svg
    viewBox="0 0 132 110"
    class="illus-plane-anim"
    aria-hidden="true"
  >
    <path
      class="illus-trail"
      d="M10 94 Q 36 82 60 68 T 90 44"
      fill="none"
      stroke="#93C5FD"
      stroke-width="2"
      stroke-dasharray="2 6"
      stroke-linecap="round"
    />
    <g class="illus-plane">
      <g transform="translate(70 18)">
        <path
          d="M2 22 L48 4 L26 38 L20 26 Z"
          fill="#EFF6FF"
          stroke="#2563EB"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <path
          d="M20 26 L48 4"
          stroke="#2563EB"
          stroke-width="1.5"
          stroke-linecap="round"
        />
        <path
          d="M20 26 L24 32"
          stroke="#2563EB"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
</script>

<style scoped>
.illus-plane-anim {
  width: 132px;
  height: 110px;
  display: block;
}

@keyframes plane-float {
  0%   { transform: translate(0, 0) rotate(0deg); }
  50%  { transform: translate(-3px, -4px) rotate(-3deg); }
  100% { transform: translate(0, 0) rotate(0deg); }
}

.illus-plane-anim .illus-plane {
  transform-origin: center;
  transform-box: fill-box;
  animation: plane-float 3.4s ease-in-out infinite;
}

@keyframes trail-flow {
  0%   { stroke-dashoffset: 60; opacity: .25; }
  50%  { opacity: .9; }
  100% { stroke-dashoffset: 0;  opacity: .25; }
}

.illus-plane-anim .illus-trail {
  stroke-dasharray: 2 6;
  animation: trail-flow 3.4s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .illus-plane-anim .illus-plane,
  .illus-plane-anim .illus-trail {
    animation: none;
  }
}
</style>
