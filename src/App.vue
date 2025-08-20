<script setup>
import MapView from './components/MapView.vue'
</script>

<template>
  <div class="fullscreen">
    <MapView />
  </div>
</template>

<style>
.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  z-index: 1;
}

body,
html {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
