<template>
    <div class="heatmap-wrapper">
        <!-- 不再创建 Cesium 容器，只保留热力图容器 -->
        <div id="heatmapContainer" class="heatmap-container"></div>
        <div id="toolbar" class="heatmap-toolbar">

            <div>
                半径:
                <input type="range" v-model="radius" min="10" max="100" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted, watch, inject, onUnmounted, defineExpose } from 'vue'
import CesiumHeatmap from '@/js/CesiumHeatmap.js'

const radius = ref(50)
console.log('HeatmapView mounted, radius:', radius.value)
let heatmapInstance = null

// 通过 inject 获取 MapView.vue 提供的 Cesium viewer 响应式 ref，防止 inject 返回 undefined
const viewerRef = inject('cesiumViewer', ref(null))

const refreshHeatmap = async () => {
    console.log('刷新热力图')
    // 2秒后执行一次热力图刷新
    setTimeout(() => {
        initHeatmap()
    }, 2000)
}

defineExpose({ refreshHeatmap })

const initHeatmap = async () => {


    // 只有父容器显示时才初始化
    const container = document.getElementById('heatmapContainer');
    if (!container) throw new Error('热力图容器未找到');

    console.log('initHeatmap called, viewerRef.value:', viewerRef.value)

    if (!viewerRef || typeof viewerRef.value === 'undefined' || !viewerRef.value) {
        console.warn('viewerRef.value 未初始化，跳过 heatmap 初始化')
        return
    }
    if (heatmapInstance) {
        console.log('heatmapInstance 已存在，跳过初始化')
        return
    }

    heatmapInstance = new CesiumHeatmap({
        viewer: viewerRef.value,
        heatmapContainerId: 'heatmapContainer',
        dataFile: '/files/buildings_output.txt',
        radius: radius.value
    })
    await heatmapInstance.init()
    console.log('heatmapInstance 初始化完成', heatmapInstance)
}

onMounted(() => {

    // setTimeout(() => {
    //     const el = document.getElementById('heatmapContainer');
    //     if (el) {
    //         console.log('heatmapContainer style:', el.style.width, el.style.height, el.getBoundingClientRect());
    //     } else {
    //         console.warn('heatmapContainer not found');
    //     }
    // }, 1000);

    console.log('onMounted viewerRef.value:', viewerRef.value)
    // 只在父容器显示时初始化

})

watch(() => viewerRef.value, (val) => {
    const container = document.getElementById('heatmapContainer');
    // if (viewerRef && typeof val !== 'undefined' && val && container) {
    //     if (container.offsetWidth > 0 && container.offsetHeight > 0) {
    //         initHeatmap();
    //     }
    // }
})

onUnmounted(() => {
    console.log('onUnmounted called, heatmapInstance:', heatmapInstance)
    if (heatmapInstance && typeof heatmapInstance.destroy === 'function') {
        heatmapInstance.destroy()
    }
    heatmapInstance = null
})

// 监听半径变化
watch(radius, (val) => {
    if (heatmapInstance) {
        heatmapInstance.setRadius(val)
    }
})
</script>

<style scoped>
.heatmap-wrapper {
    position: relative;
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
}

.heatmap-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none !important;
    z-index: 99999 !important;
}

.cesium-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}


.heatmap-container canvas {
    background: transparent !important;
}

/* 菜单放在热力图容器下方，底部居中 */
.heatmap-toolbar {
    position: fixed;
    left: 50%;
    bottom: 40px;
    transform: translateX(-50%);
    z-index: 100000;
    background: rgba(42, 42, 42, 0.85);
    padding: 12px 24px;
    border-radius: 12px;
    color: white;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    gap: 18px;
}

.heatmap-toolbar button {
    padding: 5px 10px;
    margin: 2px;
}
</style>
