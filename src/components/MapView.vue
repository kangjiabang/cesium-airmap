<!-- MapView.vue -->
<template>
    <div class="cesium" id="cesiumContainer" style="width: 100%; height: 100vh;"></div>
    <div class="unified-controls-wrapper">
        <AirspaceDrawer v-if="viewer" :viewer="viewer" ref="airspaceDrawer">
            <template #drone-path>
                <DronePathDrawer v-if="viewer" :viewer="viewer" ref="dronePathDrawer" />
                <DroneFlyController v-if="viewer" :viewer="viewer" :pathPoints="dronePathPoints"
                    :droneEntity="droneEntity" :noFlyZones="noFlyZones" />

                <DroneReplayController v-if="viewer" :viewer="viewer" :pathPoints="dronePathPoints"
                    :droneEntity="droneEntity" :noFlyZones="noFlyZones" />
                <!-- 热力图开关按钮分组，始终在“开始无人机飞行”按钮下方 -->
                <div class="heatmap-switch-group">
                    <div class="heatmap-switch">
                        <label>
                            <input type="checkbox" v-model="showHeatmap" /> 显示热力图
                        </label>
                    </div>
                </div>
            </template>
        </AirspaceDrawer>
    </div>

    <HeatmapView ref="heatmapViewRef" v-show="showHeatmap" />
</template>
<style>
.unified-controls-wrapper {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 1000;
}

.heatmap-switch-group {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
}

.heatmap-switch {
    background: rgba(42, 42, 42, 0.8);
    color: white;
    padding: 8px;
    border-radius: 6px;
    margin-top: 8px;
    position: static;
    z-index: 2000;
}
</style>

<script setup>
import { ref, onMounted, onUnmounted, computed, provide, watch } from 'vue'
import HeatmapView from './HeatmapView.vue'
const showHeatmap = ref(false)
const heatmapViewRef = ref(null)
// 切换显示热力图时，主动回调 HeatmapView 的 refreshHeatmap 方法
watch(showHeatmap, (val) => {
    if (val && heatmapViewRef.value && typeof heatmapViewRef.value.refreshHeatmap === 'function') {
        heatmapViewRef.value.refreshHeatmap()
    }
})
import AirspaceDrawer from '@/components/AirspaceDrawer.vue'
import * as Cesium from 'cesium'
import DronePathDrawer from './DronePathDrawer.vue'
import DroneFlyController from './DroneFlyController.vue'
import DroneReplayController from './DroneReplayController.vue'

const cesiumContainer = ref(null)
const viewer = ref(null)
// 顶层 provide Cesium viewer 响应式 ref，供子组件 inject
provide('cesiumViewer', viewer)
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