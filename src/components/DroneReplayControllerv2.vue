<template>
    <div class="drone-replay-controls">
        <div class="replay-controls-group">
            <button @click="togglePlayback" :disabled="!canReplay">
                {{ isPlaying ? '暂停' : '播放' }}
            </button>
            <button @click="resetPlayback" :disabled="!canReplay">重置</button>
        </div>

        <div class="replay-slider-group">
            <label>时间控制:</label>
            <input type="range" min="0" :max="maxTime" v-model="currentTime" @input="onTimeChange"
                :disabled="!canReplay" class="time-slider" />
            <span class="time-display">{{ formatTime(currentTime) }} / {{ formatTime(maxTime) }}</span>

        </div>

        <div class="replay-speed-group">
            <label>播放速度:</label>
            <select v-model="playbackSpeed" :disabled="!canReplay">
                <option value="0.1">0.1x</option>
                <option value="0.25">0.25x</option>
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="5">5x</option>
                <option value="5">10x</option>
            </select>
        </div>

        <div v-if="!canReplay" class="replay-warning">
            请先绘制航线并开始飞行
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import * as Cesium from 'cesium'

const props = defineProps({
    viewer: {
        type: Object,
        required: true
    },
    pathPoints: {
        type: Array,
        required: true
    },
    droneEntity: {
        type: Object,
        required: false
    },
    noFlyZones: {
        type: Array,
        required: false,
        default: () => []
    }
})

const droneEntity = ref(null)
// 改造：每个点包含 position + time
const pathPointsWithTime = ref([])

// 回放控制状态
const isPlaying = ref(false)
const currentTime = ref(0) // 从起点开始的偏移秒数（内部逻辑）
const maxTime = ref(100) // 总持续时间（秒）
const playbackSpeed = ref(0.25)
const positionProperty = ref(null)
const replayStartTime = ref(null) // JavaScript Date
const replayEndTime = ref(null)
const polylineEntity = ref(null) // 👈 新增：用于保存航线实体

// 计算属性
const canReplay = computed(() => {
    const canFly = pathPointsWithTime.value.length > 1
    console.log('[canReplay] canFly:', canFly)
    return canFly
})

// 监听 viewer 初始化
watch(() => props.viewer, (newViewer) => {
    if (!newViewer || pathPointsWithTime.value.length > 0) return
    generatePathPointsWithTime()

    // 确保无人机存在，不存在则创建
    if (!droneEntity.value) {
        addDroneEntity()
    }
}, { immediate: true })

// 生成带时间戳的路径点（模拟非均匀间隔）
function generatePathPointsWithTime() {
    if (!props.viewer) return

    const startLon = 119.99873676955849
    const startLat = 30.28631073587987
    const startHeight = 50

    // 自定义起始时间（例如 10:00:00）
    const baseTime = new Date()
    baseTime.setHours(10, 0, 0, 0) // 10:00:00
    replayStartTime.value = baseTime

    const points = []
    let accumulatedSeconds = 0

    // 模拟非均匀时间间隔
    const timeIntervals = [0, 5, 15, 8, 25, 12, 7, 30, 5, 10, 20, 15, 5, 8, 12, 18, 7, 9, 22, 6, 14, 16, 3, 11, 19, 8, 4, 13, 17, 21, 10, 6, 9, 15, 25, 7, 8, 12, 18, 5, 10, 20, 15, 8, 12, 9, 14, 6, 11, 13]

    for (let i = 0; i < 50; i++) {
        const lon = startLon + i * 0.0001
        const lat = startLat + Math.sin(i * 0.1) * 0.00005
        const height = startHeight + Math.sin(i * 0.2) * 20

        const cartesian = Cesium.Cartesian3.fromDegrees(lon, lat, height)
        const pointTime = new Date(baseTime)
        pointTime.setSeconds(pointTime.getSeconds() + accumulatedSeconds)

        points.push({
            position: cartesian,
            time: pointTime
        })

        if (i < timeIntervals.length) {
            accumulatedSeconds += timeIntervals[i]
        } else {
            accumulatedSeconds += 5 // fallback
        }
    }

    replayEndTime.value = new Date(points.at(-1).time)
    maxTime.value = (replayEndTime.value - replayStartTime.value) / 1000

    pathPointsWithTime.value = points

    // 绘制路径线
    if (props.viewer) {
        // 移除旧的 polyline（如果存在）
        if (polylineEntity.value) {
            props.viewer.entities.remove(polylineEntity.value)
        }

        // 创建并保存新的 polyline 实体
        polylineEntity.value = props.viewer.entities.add({
            name: "航线",
            polyline: {
                positions: points.map(p => p.position),
                width: 5,
                material: Cesium.Color.YELLOW.withAlpha(0.8),
            }
        })

        console.log('[generatePathPointsWithTime] 航线已绘制')
    }
}

// 监听路径点变化，创建 SampledPositionProperty
watch(pathPointsWithTime, (newPoints) => {
    if (newPoints.length < 2) return

    const property = new Cesium.SampledPositionProperty()

    newPoints.forEach(point => {
        const julianTime = Cesium.JulianDate.fromDate(point.time)
        const carto = Cesium.Cartographic.fromCartesian(point.position)
        const height = Math.max(carto.height, 0) + 2
        const adjustedPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height)
        property.addSample(julianTime, adjustedPos)
    })

    positionProperty.value = property

    // 只在未播放时设置位置（避免冲突）
    if (droneEntity.value && !isPlaying.value) {
        droneEntity.value.position = property
        droneEntity.value.orientation = new Cesium.VelocityOrientationProperty(property)
    }
}, { deep: true, immediate: true })

// 监听播放速度
watch(playbackSpeed, (newSpeed) => {
    if (isPlaying.value && props.viewer) {
        props.viewer.clock.multiplier = parseFloat(newSpeed) * 10
    }
})

// 时间变化处理（滑块拖动）
const onTimeChange = () => {
    if (!droneEntity.value || !replayStartTime.value || pathPointsWithTime.value.length < 2) return

    const currentRealTime = new Date(replayStartTime.value)
    currentRealTime.setSeconds(currentRealTime.getSeconds() + currentTime.value)

    const points = pathPointsWithTime.value
    let startIndex = 0

    // 找到当前时间落在哪两个点之间
    for (let i = 0; i < points.length - 1; i++) {
        if (currentRealTime >= points[i].time && currentRealTime <= points[i + 1].time) {
            startIndex = i
            break
        }
        if (i === points.length - 2 && currentRealTime > points[i + 1].time) {
            startIndex = i
        }
    }

    const startPt = points[startIndex]
    const endPt = points[Math.min(startIndex + 1, points.length - 1)]

    // 计算插值比例
    const intervalMs = endPt.time - startPt.time
    const elapsedMs = currentRealTime - startPt.time
    const ratio = intervalMs > 0 ? Math.min(1, Math.max(0, elapsedMs / intervalMs)) : 0

    // 线性插值位置
    const interpolatedPos = Cesium.Cartesian3.lerp(
        startPt.position,
        endPt.position,
        ratio,
        new Cesium.Cartesian3()
    )

    // 更新无人机位置（仅手动控制时）
    if (!isPlaying.value && droneEntity.value) {
        droneEntity.value.position = interpolatedPos
    }

    // 同步 viewer 时钟（用于 orientation 等）
    const julianCurrent = Cesium.JulianDate.fromDate(currentRealTime)
    props.viewer.clock.currentTime = julianCurrent
}

// 格式化真实时间显示
const formatTime = (seconds) => {
    if (!replayStartTime.value) return '--:--'
    const dt = new Date(replayStartTime.value)
    dt.setSeconds(dt.getSeconds() + seconds)
    return dt.toTimeString().substring(0, 8) // HH:mm:ss
}

// 切换播放
const togglePlayback = () => {
    isPlaying.value = !isPlaying.value
    if (isPlaying.value) {
        startPlayback()
    } else {
        pausePlayback()
    }
}

// 开始播放
const startPlayback = () => {
    if (!props.viewer || !positionProperty.value || !replayStartTime.value) return

    // 确保无人机存在，不存在则创建
    if (!droneEntity.value) {
        addDroneEntity()
        // // 等待实体创建后再设置位置（异步安全）
        // setTimeout(() => {
        //     if (droneEntity.value && positionProperty.value) {
        //         droneEntity.value.position = positionProperty.value
        //         droneEntity.value.orientation = new Cesium.VelocityOrientationProperty(positionProperty.value)
        //     }
        // }, 0)
    } else {
        // 已存在，直接设置属性
        droneEntity.value.position = positionProperty.value
        droneEntity.value.orientation = new Cesium.VelocityOrientationProperty(positionProperty.value)
    }

    const startJulian = Cesium.JulianDate.fromDate(replayStartTime.value)
    const endJulian = Cesium.JulianDate.fromDate(replayEndTime.value)

    props.viewer.clock.startTime = startJulian
    props.viewer.clock.stopTime = endJulian
    props.viewer.clock.currentTime = startJulian
    props.viewer.clock.multiplier = parseFloat(playbackSpeed.value) * 10
    props.viewer.clock.shouldAnimate = true
    props.viewer.clock.clockRange = Cesium.ClockRange.CLAMPED

    if (droneEntity.value) {
        droneEntity.value.position = positionProperty.value
        droneEntity.value.orientation = new Cesium.VelocityOrientationProperty(positionProperty.value)
    }

    updateSliderFromClock()
}

// 暂停播放
const pausePlayback = () => {
    if (props.viewer) {
        props.viewer.clock.shouldAnimate = false
    }
}

// 重置播放
const resetPlayback = () => {
    isPlaying.value = false
    currentTime.value = 0

    if (props.viewer && replayStartTime.value) {
        const startJulian = Cesium.JulianDate.fromDate(replayStartTime.value)
        props.viewer.clock.currentTime = startJulian
        props.viewer.clock.shouldAnimate = false

        const startPosition = positionProperty.value?.getValue(startJulian)
        if (startPosition && droneEntity.value) {
            droneEntity.value.position = startPosition
        }
    }
}

// 根据时钟更新滑块
const updateSliderFromClock = () => {
    if (!props.viewer || !replayStartTime.value || !replayEndTime.value) return

    const clock = props.viewer.clock
    if (clock.shouldAnimate) {
        const currentJulian = clock.currentTime
        const startJulian = Cesium.JulianDate.fromDate(replayStartTime.value)
        const currentSeconds = Cesium.JulianDate.secondsDifference(currentJulian, startJulian)
        currentTime.value = Math.max(0, Math.min(maxTime.value, currentSeconds))

        requestAnimationFrame(updateSliderFromClock)
    }
}

// 清理
onUnmounted(() => {
    pausePlayback()

    // 移除无人机实体
    if (droneEntity.value && props.viewer) {
        props.viewer.entities.remove(droneEntity.value)
        droneEntity.value = null
        console.log('[onUnmounted] 无人机实体已移除')
    }

    // 移除航线实体
    if (polylineEntity.value && props.viewer) {
        props.viewer.entities.remove(polylineEntity.value)
        polylineEntity.value = null
        console.log('[onUnmounted] 航线实体已移除')
    }
})

// 添加无人机实体
function addDroneEntity() {
    if (pathPointsWithTime.value.length === 0) return

    const firstPoint = pathPointsWithTime.value[0]
    const carto = Cesium.Cartographic.fromCartesian(firstPoint.position)
    const initialHeight = Math.max(carto.height, 0) + 2
    const initialPosition = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, initialHeight)

    droneEntity.value = props.viewer.entities.add({
        name: "无人机",
        position: initialPosition,
        model: {
            uri: "models/drone_costum.glb",
            minimumPixelSize: 128,
            maximumScale: 200,
        },
        label: new Cesium.LabelGraphics({
            text: new Cesium.CallbackProperty(() => {
                const position = droneEntity.value?.position?.getValue(props.viewer.clock.currentTime)
                if (!position) return "无人机信息\n准备起飞"

                const cartographic = Cesium.Cartographic.fromCartesian(position)
                const height = cartographic?.height?.toFixed(1) || '0.0'

                return `无人机信息\n高度: ${height}m\n速度: 0 m/s\n电量: 100%`
            }, false),
            font: new Cesium.CallbackProperty(() => {
                const model = droneEntity.value?.model
                if (model) {
                    const pixelSize = model.pixelSize?.getValue(props.viewer.clock.currentTime) || model.minimumPixelSize || 64
                    const fontSize = Math.max(12, Math.min(24, Math.floor(pixelSize / 8)))
                    return `${fontSize}px sans-serif`
                }
                return "14px sans-serif"
            }, false),
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -50),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.1),
            scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.1)
        })
    })
}

// 计算时间刻度位置（用于显示在滑块下方）
const getTickPosition = (time) => {
    if (!replayStartTime.value || !replayEndTime.value) return 0
    const totalMs = replayEndTime.value - replayStartTime.value
    const elapsedMs = time - replayStartTime.value
    return (elapsedMs / totalMs) * 100
}
</script>

<style scoped>
.drone-replay-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 8px;
    color: white;
    margin-top: 8px;
}

.replay-controls-group,
.replay-slider-group,
.replay-speed-group {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.replay-controls-group button {
    padding: 8px 16px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.replay-controls-group button:disabled {
    background: #666;
    cursor: not-allowed;
}

.replay-slider-group {
    flex-direction: column;
    align-items: stretch;
}

.time-slider {
    width: 100%;
    height: 20px;
}

.time-display {
    font-family: monospace;
    font-size: 14px;
    min-width: 100px;
    text-align: center;
}

.replay-speed-group select {
    padding: 6px;
    border-radius: 4px;
    background: white;
}

.replay-warning {
    color: #ffcc00;
    font-size: 14px;
    text-align: center;
    padding: 8px;
}

.time-ticks {
    position: relative;
    height: 20px;
    margin-top: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
}

.time-tick {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    width: 2px;
    height: 10px;
    background: #ffcc00;
    font-size: 10px;
    color: #ffcc00;
    text-align: center;
    margin-top: 10px;
}

.time-tick::after {
    content: attr(title);
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 10px;
    opacity: 0;
    transition: opacity 0.2s;
}

.time-tick:hover::after {
    opacity: 1;
}
</style>