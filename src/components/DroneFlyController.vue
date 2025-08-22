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
import * as turf from '@turf/turf'
import { getNearstBuildingsWithinDistance } from '@/js/poligon_infos_intersect_distance.js'
import { parseWKTCoordinates, bufferPolygon } from '@/js/parse_buildings.js'
// 解析WKT工具和缓冲区工具请确保已引入
// import { parseWKTCoordinates, bufferPolygon } from '@/js/your_utils.js'

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


    // 实时检测无人机位置和最近建筑物
    let warned = false;
    const warnDistance = 100; // 米
    const collisionDistance = 20; // 米
    let lastColor = null;
    let highlightedBuildingEntity = null;
    const detectionRadius = 100; // 建筑检测半径（米）

    // 限制建筑物检测频率
    let tickCount = 0;
    const DETECT_INTERVAL = 100; // 每100帧检测一次（可调整）
    let lastCheckTime = 0;
    function onTick() {
        if (!droneEntity.position) return;
        // 避免过于频繁检测（例如：每秒一次）
        const currentTime = viewer.clock.currentTime;
        const currentTimeSeconds = Cesium.JulianDate.toDate(currentTime).getTime() / 1000;

        // 避免过于频繁检测（例如：每秒一次）
        if (currentTimeSeconds - lastCheckTime < 1) return;
        lastCheckTime = currentTimeSeconds;

        const position = droneEntity.position.getValue(currentTime);
        console.log(`无人机当前位置: ${position}`);
        // 禁飞区检测
        if (position && props.noFlyZones && props.noFlyZones.length > 0) {
            const dist = pointInNoFlyZone(position, props.noFlyZones);
            if (dist < collisionDistance) {
                console.warn(`已经进度禁飞区，距离：${dist.toFixed(1)}米`);
                lastColor = droneEntity.model.color;
                collision_effects(droneEntity);
            } else if (dist < warnDistance) {
                console.warn(`进度禁飞区预警，距离：${dist.toFixed(1)}米`);
                lastColor = droneEntity.model.color;
                warning_effects(droneEntity);
            } else {
                droneEntity.model.color = lastColor || Cesium.Color.WHITE;
            }
        }

        // 最近建筑物检测与高亮（限制频率）

        if (position) {
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            const dronePoint = turf.point([lon, lat]);
            getNearstBuildingsWithinDistance(dronePoint, detectionRadius, cartographic.height)
                .then(nearest => {
                    if (nearest) {
                        // 找到最近的建筑
                        console.warn(
                            `⚠️ 最近建筑: ID=${nearest.polygon.properties.id}, ` +
                            `水平距离=${nearest.distanceInMeters.toFixed(2)}米, 高度=${nearest.polygon.properties.height}米, ` +
                            `无人机高度=${cartographic.height.toFixed(2)}米, 实际距离=${nearest.actualDistance.toFixed(2)}米`
                        );

                        // 解析WKT坐标（需自定义工具）
                        const coordinates = parseWKTCoordinates(nearest.polygon.properties.wkt);
                        if (!coordinates) return;

                        if (highlightedBuildingEntity) {
                            viewer.entities.remove(highlightedBuildingEntity);
                        }

                        // 缓冲区工具（需自定义工具）
                        const coords = bufferPolygon(coordinates, 2);
                        highlightedBuildingEntity = viewer.entities.add({
                            name: `高亮建筑 ID: ${nearest.polygon.properties.id}`,
                            polygon: {
                                hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
                                extrudedHeight: nearest.polygon.properties.height,
                                height: 10,
                                material: Cesium.Color.RED.withAlpha(0.5),
                                outline: true,
                                outlineColor: Cesium.Color.YELLOW,
                                outlineWidth: 5,
                                classificationType: Cesium.ClassificationType.BOTH
                            },
                            label: {
                                text: `⚠️ 障碍物\n实际距离: ${nearest.actualDistance.toFixed(1)}m\n高度: ${nearest.polygon.properties.height}m`,
                                font: '14px sans-serif',
                                fillColor: Cesium.Color.WHITE,
                                backgroundColor: Cesium.Color.RED,
                                backgroundOpacity: 0.7,
                                showBackground: true,
                                pixelOffset: new Cesium.Cartesian2(0, -50),
                                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                                scale: 0.8
                            }
                        });
                    } else {
                        if (highlightedBuildingEntity) {
                            viewer.entities.remove(highlightedBuildingEntity);
                            highlightedBuildingEntity = null;
                        }
                        console.log(`✅ 无人机安全飞行中，${detectionRadius} 米内无建筑物`);
                    }
                })
                .catch(err => {
                    console.error("检测建筑物时出错:", err);
                });
        }
    }
    viewer.clock.onTick.addEventListener(onTick);
    // 飞行结束后移除监听
    viewer.clock.onStop = function () {
        viewer.clock.onTick.removeEventListener(onTick);
        if (highlightedBuildingEntity) {
            viewer.entities.remove(highlightedBuildingEntity);
            highlightedBuildingEntity = null;
        }
    }


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
    viewer.clock.multiplier = 1; // 降低动画速度
    viewer.clock.shouldAnimate = true;

    // 4) 让相机跟随实体
    viewer.trackedEntity = droneEntity;
};
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
