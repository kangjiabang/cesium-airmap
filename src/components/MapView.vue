<!-- MapView.vue -->
<template>
    <div class="cesium" id="cesiumContainer" style="width: 100%; height: 100vh;"></div>
    <div class="unified-controls-wrapper">
        <AirspaceDrawer v-if="viewer" :viewer="viewer" ref="airspaceDrawer">
            <template #drone-path>
                <DronePathDrawer v-if="viewer" :viewer="viewer" ref="dronePathDrawer" />
                <DroneFlyController v-if="viewer" :viewer="viewer" :pathPoints="dronePathPoints"
                    :droneEntity="droneEntity" :noFlyZones="noFlyZones" />
            </template>
        </AirspaceDrawer>
    </div>
</template>
<style>
.unified-controls-wrapper {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 1000;
}
</style>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import AirspaceDrawer from '@/components/AirspaceDrawer.vue'
import * as Cesium from 'cesium'
import DronePathDrawer from './DronePathDrawer.vue'
import DroneFlyController from './DroneFlyController.vue'

const cesiumContainer = ref(null)
const viewer = ref(null)
const dronePathDrawer = ref(null)

const dronePathPoints = computed(() => {
    return dronePathDrawer.value?.pathPoints ?? []
})
const droneEntity = computed(() => {
    return dronePathDrawer.value?.droneEntity ?? null
})

// 动态获取禁飞区（空域）
const airspaceDrawer = ref(null)
const noFlyZones = computed(() => {
    // AirspaceDrawer 通过 defineExpose({ airspacePolygons }) 暴露多边形数组
    return airspaceDrawer.value?.airspacePolygons ?? [];
});

onMounted(() => {
    initMap();
})

const initMap = async () => {
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1OGIzZmQyZC03YjNiLTQzMjQtOWQxYS0xOTYxZWUyMTYzMjQiLCJpZCI6MzEzMjQxLCJpYXQiOjE3NTAyMjc2NDd9.G9X0WofFDt3mbp2L_WDzU__rcAVg0v3rpAliG1sgB9k';

    const terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
        requestVertexNormals: true,
        requestWaterMask: true
    });
    viewer.value = new Cesium.Viewer("cesiumContainer", {
        terrainProvider: terrainProvider
    });

    // 加载 3D Tileset
    const tileset = viewer.value.scene.primitives.add(
        await Cesium.Cesium3DTileset.fromUrl(
            "http://192.168.4.78:8000/tileset.json",
            { debugShowBoundingVolume: true }
        )
    );
    viewer.value.zoomTo(tileset);
}
onUnmounted(() => {
    viewer.value?.destroy()
})
// ...existing code...
</script>