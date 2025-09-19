    <!-- MapView.vue -->
    <template>
        <div class="cesium" id="cesiumContainer" style="width: 100%; height: 100vh;"></div>

        <!-- 菜单单独放置 -->
        <div class="menu-wrapper">
            <el-tree class="menu-tree" :data="menuTreeData" show-checkbox node-key="id" default-expand-all
                :default-checked-keys="defaultCheckedKeys" :check-strictly="true" @check="handleCheck" />
        </div>

        <!-- 功能控件容器 - 与菜单分离 -->
        <div class="controls-wrapper">
            <AirspaceDrawer v-if="viewer && isDrawingAirspace" :viewer="viewer" ref="airspaceDrawer" />

            <DronePathDrawer v-if="viewer && isDrawingFlightPath" :viewer="viewer" ref="dronePathDrawer" />

            <!-- 飞行控制器 - 根据菜单控制显示 -->
            <DroneFlyController v-if="viewer && showFlyController" :viewer="viewer" :pathPoints="dronePathPoints"
                :droneEntity="droneEntity" :noFlyZones="noFlyZones" />

            <!-- 回放控制器 - 根据菜单控制显示 -->
            <DroneReplayController v-if="viewer && showReplayController" :viewer="viewer" :pathPoints="dronePathPoints"
                :droneEntity="droneEntity" :noFlyZones="noFlyZones" />

            <!-- 雨效果 - 根据菜单控制显示 -->
            <RainEffect v-if="viewer && showRainEffect" :viewer="viewer" />

            <!-- 雪效果 - 根据菜单控制显示 -->
            <SnowEffect v-if="viewer && showSnowEffect" :viewer="viewer" />

            <!-- 👇 引入独立组件 -->
            <!-- <LandingFieldManager :viewer="viewer" /> -->

            <LandingFieldManager v-if="viewer && showFlyAreaController" :viewer="viewer" />
        </div>

        <!-- 热力图视图 - 在右上角控件区域 -->
        <div class="heatmap-wrapper">
            <HeatmapView ref="heatmapViewRef" v-show="showHeatmap" />
        </div>
    </template>

<style>
/* 菜单容器 - 固定位置 */
.menu-wrapper {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 1100;
    /* 最高层级 */
}

/* 功能控件容器 - 右上角显示 */
.controls-wrapper {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: flex-end;
    /* 右对齐 */
}

/* 热力图容器 - 也在右上角，但在控件下方 */
.heatmap-wrapper {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 999;
    /* 比控件稍低 */
    margin-top: 300px;
    /* 给控件留出空间 */
}

.menu-tree {
    background: rgba(42, 42, 42, 0.95);
    color: white;
    padding: 12px;
    border-radius: 8px;
    min-width: 200px;
    max-width: 220px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(10px);
    /* 毛玻璃效果 */
}

.menu-tree :deep(.el-tree-node__content) {
    color: white;
    background-color: transparent;
    height: 32px;
    line-height: 32px;
}

.menu-tree :deep(.el-tree-node__content:hover) {
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
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
    font-weight: 500;
}

.menu-tree :deep(.el-tree-node.is-disabled > .el-tree-node__content .el-checkbox) {
    display: none !important;
}

.menu-tree :deep(.el-tree-node.is-disabled > .el-tree-node__content .el-tree-node__label) {
    color: #b0b0b0 !important;
    font-weight: bold;
    font-size: 15px;
}

/* 为控件添加统一的样式 */
.controls-wrapper>* {
    background: rgba(42, 42, 42, 0.9);
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(5px);
    min-width: 280px;
    max-width: 350px;
}

/* 响应式设计 */
@media (max-width: 768px) {
    .menu-wrapper {
        top: 10px;
        left: 10px;
    }

    .controls-wrapper {
        top: 10px;
        right: 10px;
        max-width: 280px;
    }

    .heatmap-wrapper {
        top: 10px;
        right: 10px;
        margin-top: 250px;
    }

    .menu-tree {
        min-width: 180px;
        max-width: 200px;
    }

    .controls-wrapper>* {
        min-width: 250px;
        max-width: 280px;
    }
}

@media (max-width: 480px) {
    .menu-wrapper {
        top: 10px;
        left: 10px;
        right: 10px;
    }

    .controls-wrapper {
        top: 10px;
        right: 10px;
        left: 10px;
        margin-top: 200px;
        /* 在菜单下方显示 */
        align-items: stretch;
    }

    .heatmap-wrapper {
        top: 10px;
        right: 10px;
        left: 10px;
        margin-top: 450px;
    }

    .menu-tree {
        width: 100%;
        max-width: none;
    }

    .controls-wrapper>* {
        min-width: auto;
        max-width: none;
        width: 100%;
    }
}

/* 折叠菜单功能 */
.menu-tree {
    transition: all 0.3s ease-in-out;
}

.menu-tree.collapsed {
    transform: translateX(-180px);
}

.menu-tree::before {
    content: "";
    position: absolute;
    top: 50%;
    right: -20px;
    transform: translateY(-50%);
    width: 20px;
    height: 40px;
    background: rgba(42, 42, 42, 0.8);
    border-radius: 0 8px 8px 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1101;
}

.menu-tree::after {
    content: "◀";
    position: absolute;
    top: 50%;
    right: -15px;
    transform: translateY(-50%);
    color: white;
    font-size: 12px;
    cursor: pointer;
    z-index: 1102;
    transition: transform 0.3s ease;
}

.menu-tree.collapsed::after {
    content: "▶";
    transform: translateY(-50%) rotate(0deg);
}


.toolbar {
    position: absolute;
    top: 30px;
    right: 10px;
    z-index: 10;
    background: rgba(255, 255, 255, 0.8);
    padding: 5px;
    border-radius: 4px;
}
</style>

<script setup>
import { ref, onMounted, onUnmounted, computed, provide, watch, watchEffect } from "vue"
import * as Cesium from "cesium"
import AirspaceDrawer from "@/components/AirspaceDrawer.vue"
import DronePathDrawer from "./DronePathDrawer.vue"
import DroneFlyController from "./DroneFlyController.vue"
import DroneReplayController from "./DroneReplayControllerv2.vue"
import RainEffect from "./RainEffect.vue"
import SnowEffect from "./SnowEffect.vue"
import HeatmapView from "./HeatmapView.vue"
import LandingFieldManager from "@/components/LandingFieldManager.vue" // 👈 引入新组件

// Element Plus
import "element-plus/dist/index.css"
import { ElTree } from "element-plus"

// 各种功能状态
const showHeatmap = ref(false)
const showRainEffect = ref(false)
const showSnowEffect = ref(false)
const showFlyController = ref(false)
const showReplayController = ref(false)
const showFlyAreaController = ref(false)
const isDrawingAirspace = ref(false)
const isDrawingFlightPath = ref(false)

const heatmapViewRef = ref(null)

// 默认勾选的节点（可根据需要调整）
const defaultCheckedKeys = ref([])


let draggingEntity = null;
let handler = null;
const landingFields = ref([]); // 存储所有起降场实体
const landingFieldManager = ref(null)

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

const dronePathPoints = ref([])

watchEffect(() => {
    const points = dronePathDrawer.value?.pathPoints;
    dronePathPoints.value = Array.isArray(points) ? [...points] : [];
    console.log('📌 pathPoints 数组更新:', dronePathPoints.value);
})

const droneEntity = computed(() => {
    return dronePathDrawer.value?.droneEntity?.value || null
})

// 动态获取禁飞区
const airspaceDrawer = ref(null)
const cachedNoFlyZones = ref([])  // 持久化缓存
const noFlyZones = computed(() => {
    // 优先使用当前组件的数据，如果没有则使用缓存
    const currentPolygons = airspaceDrawer.value?.airspacePolygons
    if (currentPolygons && currentPolygons.length > 0) {
        return currentPolygons  // 直接返回，不在这里更新缓存
    }
    console.log('[Computed] 使用缓存的禁飞区数据:', cachedNoFlyZones.value)
    return cachedNoFlyZones.value
})

// 监听数组引用和长度变化
watch(
    () => [
        airspaceDrawer.value?.airspacePolygons,
        airspaceDrawer.value?.airspacePolygons?.length
    ],
    ([newPolygons, newLength]) => {
        if (newPolygons && newLength > 0) {
            cachedNoFlyZones.value = newPolygons
        }
    }
)
/**
 * 菜单树数据
 */
const menuTreeData = ref([
    {
        id: 1,
        label: "🚁 空域管理",
        disabled: true, // 父节点不可选择
        children: [
            { id: 11, label: "绘制空域", type: "drawAirspace" },
            { id: 12, label: "绘制航线", type: "drawFlightPath" }
        ]
    },
    {
        id: 2,
        label: "🎨 视觉效果",
        disabled: true, // 父节点不可选择
        children: [
            { id: 21, label: "显示热力图", type: "heatmap" },
            { id: 22, label: "下雨特效", type: "rain" },
            { id: 23, label: "下雪特效", type: "snow" }
        ]
    },
    {
        id: 3,
        label: "🎮 无人机控制",
        disabled: true, // 父节点不可选择
        children: [
            { id: 31, label: "飞行碰撞预警", type: "fly" },
            { id: 32, label: "飞行回放", type: "replay" }
        ]
    },
    {
        id: 4,
        label: "起降场管理",
        disabled: true, // 父节点不可选择
        children: [
            { id: 41, label: "起降场管理", type: "fly_area" },
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

    // 更新空域管理状态
    isDrawingAirspace.value = checkedKeys.includes(11)
    isDrawingFlightPath.value = checkedKeys.includes(12)

    // 更新视觉效果状态
    showHeatmap.value = checkedKeys.includes(21)
    showRainEffect.value = checkedKeys.includes(22)
    showSnowEffect.value = checkedKeys.includes(23)

    // 更新控制器状态
    showFlyController.value = checkedKeys.includes(31)
    showReplayController.value = checkedKeys.includes(32)

    showFlyAreaController.value = checkedKeys.includes(41)

    // 空域管理互斥逻辑：绘制空域和绘制航线不能同时进行
    if (isDrawingAirspace.value && isDrawingFlightPath.value) {
        const airspaceIndex = checkedKeys.indexOf(11)
        const flightPathIndex = checkedKeys.indexOf(12)

        if (airspaceIndex > flightPathIndex) {
            // 绘制空域是最新选中的，取消绘制航线
            isDrawingFlightPath.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(12, false)
            }, 0)
        } else {
            // 绘制航线是最新选中的，取消绘制空域
            isDrawingAirspace.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(11, false)
            }, 0)
        }
    }

    // 控制器互斥逻辑：飞行控制器和回放控制器不能同时开启
    if (showFlyController.value && showReplayController.value) {
        const flyIndex = checkedKeys.indexOf(31)
        const replayIndex = checkedKeys.indexOf(32)

        if (flyIndex > replayIndex) {
            // 飞行控制器是最新选中的，取消回放控制器
            showReplayController.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(32, false)
            }, 0)
        } else {
            // 回放控制器是最新选中的，取消飞行控制器
            showFlyController.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(31, false)
            }, 0)
        }
    }

    // 天气效果互斥：雨和雪不能同时存在
    if (showRainEffect.value && showSnowEffect.value) {
        const rainIndex = checkedKeys.indexOf(22)
        const snowIndex = checkedKeys.indexOf(23)

        if (rainIndex > snowIndex) {
            // 雨是最新选中的，取消雪
            showSnowEffect.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(23, false)
            }, 0)
        } else {
            // 雪是最新选中的，取消雨
            showRainEffect.value = false
            setTimeout(() => {
                document.querySelector('.menu-tree').__vue__?.setChecked(22, false)
            }, 0)
        }
    }

    // 处理空域管理功能
    handleAirspaceManagement()

    // 日志输出当前状态（可选，用于调试）
    console.log('Menu状态更新:', {
        绘制空域: isDrawingAirspace.value,
        绘制航线: isDrawingFlightPath.value,
        热力图: showHeatmap.value,
        雨效果: showRainEffect.value,
        雪效果: showSnowEffect.value,
        飞行控制器: showFlyController.value,
        回放控制器: showReplayController.value
    })
}

/**
 * 处理空域管理功能
 */
const handleAirspaceManagement = () => {
    if (!viewer.value) return

    if (isDrawingAirspace.value) {
        // 开始绘制空域
        startDrawingAirspace()
    } else if (isDrawingFlightPath.value) {
        // 开始绘制航线
        startDrawingFlightPath()
    } else {
        // 停止绘制
        stopDrawing()
    }
}

/**
 * 开始绘制空域
 */
const startDrawingAirspace = () => {
    stopDrawing() // 先停止之前的绘制

    console.log('开始绘制空域模式')

    // 如果有 AirspaceDrawer 的绘制方法，调用它
    if (airspaceDrawer.value && typeof airspaceDrawer.value.startDrawing === 'function') {
        airspaceDrawer.value.startDrawing()
    } else {
        // 备用方案：直接使用 Cesium 绘制
        enableCesiumDrawing('airspace')
    }
}

/**
 * 开始绘制航线
 */
const startDrawingFlightPath = () => {
    stopDrawing() // 先停止之前的绘制

    console.log('开始绘制航线模式')

    // 如果有 DronePathDrawer 的绘制方法，调用它
    if (dronePathDrawer.value && typeof dronePathDrawer.value.startDrawing === 'function') {
        dronePathDrawer.value.startDrawing()
    } else {
        // 备用方案：直接使用 Cesium 绘制
        enableCesiumDrawing('flightPath')
    }
}

/**
 * 停止绘制
 */
const stopDrawing = () => {
    console.log('停止绘制模式')

    // 停止空域绘制
    if (airspaceDrawer.value && typeof airspaceDrawer.value.stopDrawing === 'function') {
        airspaceDrawer.value.stopDrawing()
    }

    // 停止航线绘制
    if (dronePathDrawer.value && typeof dronePathDrawer.value.stopDrawing === 'function') {
        dronePathDrawer.value.stopDrawing()
    }

    // 移除 Cesium 绘制事件
    disableCesiumDrawing()
}

/**
 * 启用 Cesium 绘制功能（备用方案）
 */
const enableCesiumDrawing = (drawType) => {
    if (!viewer.value) return

    // 设置鼠标样式
    viewer.value.canvas.style.cursor = 'crosshair'

    // 这里可以添加具体的绘制逻辑
    // 例如监听鼠标点击事件来创建点、线、面等
    console.log(`启用 ${drawType} 绘制模式`)
}

/**
 * 禁用 Cesium 绘制功能
 */
const disableCesiumDrawing = () => {
    if (!viewer.value) return

    // 恢复鼠标样式
    viewer.value.canvas.style.cursor = 'default'

    console.log('禁用绘制模式')
}

/**
 * 提供外部方法来控制菜单状态
 */
const toggleFeature = (featureType, state = null) => {
    const treeRef = document.querySelector('.menu-tree').__vue__
    if (!treeRef) return

    const featureMap = {
        drawAirspace: 11,
        drawFlightPath: 12,
        heatmap: 21,
        rain: 22,
        snow: 23,
        fly: 31,
        replay: 32
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
    showReplayController,
    isDrawingAirspace,
    isDrawingFlightPath,
    startDrawingAirspace,
    startDrawingFlightPath,
    stopDrawing
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
                await Cesium.Cesium3DTileset.fromUrl("https://gl.hangzhoudk.com/modelfile/tileset.json", {
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