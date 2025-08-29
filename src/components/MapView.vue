<!-- MapView.vue -->
<template>
    <div class="cesium" id="cesiumContainer" style="width: 100%; height: 100vh;"></div>
    <div class="unified-controls-wrapper">
        <AirspaceDrawer v-if="viewer" :viewer="viewer" ref="airspaceDrawer">
            <template #drone-path>
                <DronePathDrawer v-if="viewer" :viewer="viewer" ref="dronePathDrawer" />

                <!-- 飞行控制器 - 根据菜单控制显示 -->
                <DroneFlyController v-if="viewer && showFlyController" :viewer="viewer" :pathPoints="dronePathPoints"
                    :droneEntity="droneEntity" :noFlyZones="noFlyZones" />

                <!-- 回放控制器 - 根据菜单控制显示 -->
                <DroneReplayController v-if="viewer && showReplayController" :viewer="viewer"
                    :pathPoints="dronePathPoints" :droneEntity="droneEntity" :noFlyZones="noFlyZones" />

                <!-- 雨效果 - 根据菜单控制显示 -->
                <RainEffect v-if="viewer && showRainEffect" :viewer="viewer" />

                <!-- 雪效果 - 根据菜单控制显示 -->
                <SnowEffect v-if="viewer && showSnowEffect" :viewer="viewer" />

                <!-- 树状菜单 -->
                <el-tree class="menu-tree" :data="menuTreeData" show-checkbox node-key="id" default-expand-all
                    :default-checked-keys="defaultCheckedKeys" @check="handleCheck" />
            </template>
        </AirspaceDrawer>
    </div>

    <!-- 热力图视图 -->
    <HeatmapView ref="heatmapViewRef" v-show="showHeatmap" />
</template>

<style>
.unified-controls-wrapper {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 1000;
}

.menu-tree {
    background: rgba(42, 42, 42, 0.9);
    color: white;
    padding: 12px;
    border-radius: 8px;
    margin-top: 16px;
    min-width: 200px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.menu-tree :deep(.el-tree-node__content) {
    color: white;
    background-color: transparent;
}

.menu-tree :deep(.el-tree-node__content:hover) {
    background-color: rgba(255, 255, 255, 0.1);
}

.menu-tree :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: #409eff;
    border-color: #409eff;
}

.menu-tree :deep(.el-checkbox__input.is-checked + .el-checkbox__label) {
    color: #409eff;
}

.menu-tree :deep(.el-tree-node__label) {
    font-size: 14px;
}
</style>

<script setup>
import { ref, onMounted, onUnmounted, computed, provide, watch } from "vue"
import * as Cesium from "cesium"
import AirspaceDrawer from "@/components/AirspaceDrawer.vue"
import DronePathDrawer from "./DronePathDrawer.vue"
import DroneFlyController from "./DroneFlyController.vue"
import DroneReplayController from "./DroneReplayController.vue"
import RainEffect from "./RainEffect.vue"
import SnowEffect from "./SnowEffect.vue"
import HeatmapView from "./HeatmapView.vue"

// Element Plus
import "element-plus/dist/index.css"
import { ElTree } from "element-plus"

// 各种功能状态
const showHeatmap = ref(false)
const showRainEffect = ref(false)
const showSnowEffect = ref(false)
const showFlyController = ref(false)
const showReplayController = ref(false)

const heatmapViewRef = ref(null)

// 默认勾选的节点（可根据需要调整）
const defaultCheckedKeys = ref([])

// 监听热力图状态变化
watch(showHeatmap, (val) => {
    if (val && heatmapViewRef.value && typeof heatmapViewRef.value.refreshHeatmap === "function") {
        // 延迟执行，确保DOM更新完成
        setTimeout(() => {
            heatmapViewRef.value.refreshHeatmap()
        }, 100)
    }
})

const cesiumContainer = ref(null)
const viewer = ref(null)
provide("cesiumViewer", viewer)

const dronePathDrawer = ref(null)
const dronePathPoints = computed(() => {
    return dronePathDrawer.value?.pathPoints ?? []
})
const droneEntity = computed(() => {
    return dronePathDrawer.value?.droneEntity ?? null
})

// 动态获取禁飞区
const airspaceDrawer = ref(null)
const noFlyZones = computed(() => {
    return airspaceDrawer.value?.airspacePolygons ?? []
})

/**
 * 菜单树数据
 */
const menuTreeData = ref([
    {
        id: 1,
        label: "视觉效果",
        children: [
            { id: 11, label: "显示热力图", type: "heatmap" },
            { id: 12, label: "下雨特效", type: "rain" },
            { id: 13, label: "下雪特效", type: "snow" }
        ]
    },
    {
        id: 2,
        label: "无人机控制",
        children: [
            { id: 21, label: "飞行控制器", type: "fly" },
            { id: 22, label: "回放控制器", type: "replay" }
        ]
    }
])

/**
 * el-tree 勾选回调
 * @param {Object} checkedNodes - 当前被勾选的节点对象
 * @param {Object} checkedInfo - 勾选状态信息
 */
const handleCheck = (checkedNodes, checkedInfo) => {
    const { checkedKeys } = checkedInfo

    // 更新各功能状态
    showHeatmap.value = checkedKeys.includes(11)
    showRainEffect.value = checkedKeys.includes(12)
    showSnowEffect.value = checkedKeys.includes(13)
    showFlyController.value = checkedKeys.includes(21)
    showReplayController.value = checkedKeys.includes(22)

    // 互斥逻辑：飞行控制器和回放控制器不能同时开启
    if (showFlyController.value && showReplayController.value) {
        // 如果两个都被选中，保留最新选中的，取消另一个
        if (checkedKeys.includes(21) && checkedKeys.includes(22)) {
            // 找出哪个是最新选中的
            const flyIndex = checkedKeys.indexOf(21)
            const replayIndex = checkedKeys.indexOf(22)

            if (flyIndex > replayIndex) {
                // 飞行控制器是最新选中的，取消回放控制器
                showReplayController.value = false
                // 从树组件中取消勾选
                setTimeout(() => {
                    document.querySelector('.menu-tree').__vue__?.setChecked(22, false)
                }, 0)
            } else {
                // 回放控制器是最新选中的，取消飞行控制器
                showFlyController.value = false
                setTimeout(() => {
                    document.querySelector('.menu-tree').__vue__?.setChecked(21, false)
                }, 0)
            }
        }
    }

    // 天气效果互斥：雨和雪不能同时存在
    if (showRainEffect.value && showSnowEffect.value) {
        const rainIndex = checkedKeys.indexOf(12)
        const snowIndex = checkedKeys.indexOf(13)

        if (rainIndex > snowIndex) {
            // 雨是最新选中的，取消雪
            showSnowEffect.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(13, false)
            }, 0)
        } else {
            // 雪是最新选中的，取消雨
            showRainEffect.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(12, false)
            }, 0)
        }
    }

    // 日志输出当前状态（可选，用于调试）
    console.log('Menu状态更新:', {
        热力图: showHeatmap.value,
        雨效果: showRainEffect.value,
        雪效果: showSnowEffect.value,
        飞行控制器: showFlyController.value,
        回放控制器: showReplayController.value
    })
}

/**
 * 提供外部方法来控制菜单状态
 */
const toggleFeature = (featureType, state = null) => {
    const treeRef = document.querySelector('.menu-tree').__vue__
    if (!treeRef) return

    const featureMap = {
        heatmap: 11,
        rain: 12,
        snow: 13,
        fly: 21,
        replay: 22
    }

    const nodeId = featureMap[featureType]
    if (nodeId) {
        const newState = state !== null ? state : !treeRef.getCheckedKeys().includes(nodeId)
        treeRef.setChecked(nodeId, newState)
    }
}

// 暴露方法给父组件使用
defineExpose({
    toggleFeature,
    showHeatmap,
    showRainEffect,
    showSnowEffect,
    showFlyController,
    showReplayController
})

onMounted(() => {
    initMap()
})

const initMap = async () => {
    try {
        Cesium.Ion.defaultAccessToken =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1OGIzZmQyZC03YjNiLTQzMjQtOWQxYS0xOTYxZWUyMTYzMjQiLCJpZCI6MzEzMjQxLCJpYXQiOjE3NTAyMjc2NDd9.G9X0WofFDt3mbp2L_WDzU__rcAVg0v3rpAliG1sgB9k"

        const terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
            requestVertexNormals: true,
            requestWaterMask: true
        })

        viewer.value = new Cesium.Viewer("cesiumContainer", {
            terrainProvider: terrainProvider,
            // 可以添加更多配置
            animation: false,
            baseLayerPicker: true,
            fullscreenButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            navigationHelpButton: false
        })

        // 加载3D瓦片集
        try {
            const tileset = viewer.value.scene.primitives.add(
                await Cesium.Cesium3DTileset.fromUrl("http://192.168.4.78:8000/tileset.json", {
                    debugShowBoundingVolume: false // 生产环境建议设为false
                })
            )
            viewer.value.zoomTo(tileset)
        } catch (error) {
            console.warn('无法加载3D瓦片集:', error)
            // 如果3D瓦片集加载失败，可以设置默认视角
            viewer.value.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 1000)
            })
        }
    } catch (error) {
        console.error('地图初始化失败:', error)
    }
}

onUnmounted(() => {
    if (viewer.value) {
        viewer.value.destroy()
        viewer.value = null
    }
})
</script>