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

// 回放控制状态
const isPlaying = ref(false)
const currentTime = ref(0)
const maxTime = ref(100)
const playbackSpeed = ref(0.25) // 默认慢速回放
const positionProperty = ref(null)
const startTime = ref(null)
const endTime = ref(null)

// 计算属性
const canReplay = computed(() => {
    return Array.isArray(props.pathPoints) && props.pathPoints.length > 1 && props.droneEntity
})

// 监听路径点变化，更新时间范围
watch(() => props.pathPoints, (newPoints) => {
    if (newPoints.length > 1) {
        // 为回放创建位置属性
        const property = new Cesium.SampledPositionProperty()
        const start = Cesium.JulianDate.now()
        const step = 5 // 每个点间隔5秒

        // 添加插值点
        newPoints.forEach((pos, i) => {
            const carto = Cesium.Cartographic.fromCartesian(pos)
            const height = Math.max(carto.height, 0) + 2
            const newPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height)
            const time = Cesium.JulianDate.addSeconds(start, i * step, new Cesium.JulianDate())
            property.addSample(time, newPos)
        })

        positionProperty.value = property
        startTime.value = start
        endTime.value = Cesium.JulianDate.addSeconds(start, (newPoints.length - 1) * step, new Cesium.JulianDate())
        maxTime.value = (newPoints.length - 1) * step

        // 关键修复：只有在播放未进行时才设置无人机的位置属性
        // 如果正在播放，让Cesium时钟控制位置更新
        if (props.droneEntity && !isPlaying.value) {
            props.droneEntity.position = property
            props.droneEntity.orientation = new Cesium.VelocityOrientationProperty(property)
        }
    }
}, { deep: true, immediate: true })

// 时间变化处理
const onTimeChange = () => {
    if (!props.droneEntity || !startTime.value || !endTime.value) return

    // 修复：正确计算当前时间
    const ratio = currentTime.value / maxTime.value
    const totalSeconds = Cesium.JulianDate.secondsDifference(endTime.value, startTime.value)
    const currentSeconds = ratio * totalSeconds
    const currentTimeObj = Cesium.JulianDate.addSeconds(startTime.value, currentSeconds, new Cesium.JulianDate())

    // 更新视图时间
    props.viewer.clock.currentTime = currentTimeObj

    // 关键修复：在手动控制时更新无人机位置
    if (positionProperty.value && props.droneEntity && !isPlaying.value) {
        const position = positionProperty.value.getValue(currentTimeObj)
        if (position) {
            props.droneEntity.position = position
        }
    }
}

// 格式化时间显示
const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// 切换播放状态
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
    if (!props.viewer || !positionProperty.value) return

    // 设置时钟参数
    props.viewer.clock.startTime = startTime.value
    props.viewer.clock.stopTime = endTime.value
    props.viewer.clock.currentTime = startTime.value // 确保从起点开始
    props.viewer.clock.multiplier = parseFloat(playbackSpeed.value)
    props.viewer.clock.shouldAnimate = true
    props.viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP // 播放结束后停止

    // 关键修复：设置无人机的位置属性为SampledPositionProperty
    if (props.droneEntity) {
        props.droneEntity.position = positionProperty.value
        props.droneEntity.orientation = new Cesium.VelocityOrientationProperty(positionProperty.value)
    }

    // 监听时钟变化以更新滑块
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

    if (props.viewer && startTime.value) {
        props.viewer.clock.currentTime = startTime.value
        props.viewer.clock.shouldAnimate = false

        // 立即更新无人机位置到起点
        const startPosition = positionProperty.value?.getValue(startTime.value)
        if (startPosition && props.droneEntity) {
            props.droneEntity.position = startPosition
        }
    }
}

// 根据时钟更新滑块位置
const updateSliderFromClock = () => {
    if (!props.viewer || !startTime.value || !endTime.value) return

    const clock = props.viewer.clock
    if (clock.shouldAnimate) {
        const current = Cesium.JulianDate.secondsDifference(clock.currentTime, startTime.value)
        const total = Cesium.JulianDate.secondsDifference(endTime.value, startTime.value)
        currentTime.value = Math.max(0, Math.min(maxTime.value, current))

        // 继续更新直到暂停
        requestAnimationFrame(updateSliderFromClock)
    }
}

// 清理
onUnmounted(() => {
    pausePlayback()
})
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
</style>