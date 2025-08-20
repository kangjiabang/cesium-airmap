<!-- DroneFlyController.vue -->
<template>
    <div class="drone-fly-controls">
        <button @click="startFly" :disabled="!canFly">开始无人机飞行</button>
        <span v-if="!canFly" style="color: #888; margin-left: 8px;">请先绘制航线</span>
    </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import * as Cesium from 'cesium'
import { generateInterpolatedPointsByCartesian3 } from '@/js/path_interpolator.js'
import { pointInNoFlyZone } from '@/js/fly_zone.js'
import { warning_effects, collision_effects } from '@/js/danamic_effects.js'

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
        default: () => [] // [{positions: [Cesium.Cartesian3, ...]}]
    }
})

const canFly = ref(false)
watch(
    [() => props.pathPoints, () => props.droneEntity],
    ([points, drone]) => {
        canFly.value = Array.isArray(points) && points.length > 1 && !!drone;
    },
    { immediate: true }
)

const startFly = () => {
    const { viewer, pathPoints, droneEntity } = props
    if (!viewer || !pathPoints || pathPoints.length < 2 || !droneEntity) return

    // 动画飞行
    const property = new Cesium.SampledPositionProperty()
    const startTime = Cesium.JulianDate.now()
    const step = 5 // 每个点间隔5秒，飞行速度更慢
    // pathPoints.forEach((pos, i) => {
    //     Cesium.JulianDate.addSeconds(startTime, i * step, property.addSample.bind(property, Cesium.JulianDate.addSeconds(startTime, i * step, new Cesium.JulianDate()), pos))
    // })

    console.log(`pathPoints:${pathPoints}`)
    //添加插值点
    const smoothPathPoints = generateInterpolatedPointsByCartesian3(pathPoints);


    smoothPathPoints.forEach((pos, i) => {
        // 获取地理坐标
        const carto = Cesium.Cartographic.fromCartesian(pos);
        // 保证高度始终高于地表
        const height = Math.max(carto.height, 0) + 2;
        const newPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height);
        property.addSample(
            Cesium.JulianDate.addSeconds(startTime, i * step, new Cesium.JulianDate()),
            newPos
        );
    });

    // 实时检测无人机位置
    let warned = false;
    const warnDistance = 100; // 米
    const collisionDistance = 20; // 米
    let lastColor = null;

    // 监听时钟实时检测
    function onTick() {
        if (!droneEntity.position) return;
        const currentTime = viewer.clock.currentTime;
        const position = droneEntity.position.getValue(currentTime);
        if (position && props.noFlyZones && props.noFlyZones.length > 0) {
            const dist = pointInNoFlyZone(position, props.noFlyZones);

            //console.warn(`距离：${dist.toFixed(1)}米`);
            if (dist < collisionDistance) {

                console.warn(`已经进度禁飞区，距离：${dist.toFixed(1)}米`);
                lastColor = droneEntity.model.color;
                collision_effects(droneEntity);
            } else if (dist < warnDistance) {
                console.warn(`进度禁飞区预警，距离：${dist.toFixed(1)}米`);
                lastColor = droneEntity.model.color;
                warning_effects(droneEntity);
            }
            else {
                droneEntity.model.color = lastColor || Cesium.Color.WHITE;
            }
        }
    }
    viewer.clock.onTick.addEventListener(onTick);
    // 飞行结束后移除监听
    viewer.clock.onStop = function () {
        viewer.clock.onTick.removeEventListener(onTick);
    };

    // 强制设置无人机模型参数，保证可见性
    // if (droneEntity.model) {
    //     droneEntity.model.minimumPixelSize = 128;
    //     droneEntity.model.maximumScale = 500;
    // }
    droneEntity.position = property;
    droneEntity.orientation = new Cesium.VelocityOrientationProperty(property);
    // 可选：设置模型 always on top（调试用）
    // droneEntity.model.color = Cesium.Color.YELLOW.withAlpha(0.8);
    viewer.clock.startTime = startTime.clone();
    viewer.clock.stopTime = Cesium.JulianDate.addSeconds(startTime, (smoothPathPoints.length - 1) * step, new Cesium.JulianDate());
    viewer.clock.currentTime = startTime.clone();
    viewer.clock.multiplier = 1 * 3; // 降低动画速度
    viewer.clock.shouldAnimate = true;

    // 4) 让相机跟随实体
    viewer.trackedEntity = droneEntity;
}
</script>

<style scoped>
.drone-fly-controls {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
}

.drone-fly-controls button {
    padding: 8px 16px;
    background: #43a047;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.drone-fly-controls button:disabled {
    background: #ccc;
    cursor: not-allowed;
}
</style>
