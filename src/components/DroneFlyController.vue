<!-- DroneFlyController.vue -->
<template>
    <div class="drone-fly-controls">
        <button @click="startFly" :disabled="!canFly || isFlying">开始无人机飞行</button>
        <button @click="stopFly" :disabled="!isFlying" class="stop-button">停止无人机飞行</button>
        <span v-if="!canFly" style="color: #888; margin-left: 8px;">请先绘制航线</span>
        <span v-if="isFlying" style="color: #43a047; margin-left: 8px;">飞行中...</span>
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
        default: () => {
            console.log('[Props] noFlyZones 默认值被调用')
            return []
        }
    }
})

const canFly = ref(false)
const isFlying = ref(false)
let onTickListener = null
let highlightedBuildingEntity = null

watch(
    [() => props.pathPoints, () => props.droneEntity],
    ([points, drone]) => {
        canFly.value = Array.isArray(points) && points.length > 1 && !!drone;
    },
    { immediate: true }
)

const startFly = () => {
    const { viewer, pathPoints, droneEntity } = props
    if (!viewer || !pathPoints || pathPoints.length < 2 || !droneEntity || isFlying.value) return

    isFlying.value = true

    // 动画飞行
    const property = new Cesium.SampledPositionProperty()
    const startTime = Cesium.JulianDate.now()
    const step = 5

    console.log(`pathPoints:${pathPoints}`)
    const smoothPathPoints = generateInterpolatedPointsByCartesian3(pathPoints);

    smoothPathPoints.forEach((pos, i) => {
        const carto = Cesium.Cartographic.fromCartesian(pos);
        const height = Math.max(carto.height, 0) + 2;
        const newPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height);
        property.addSample(
            Cesium.JulianDate.addSeconds(startTime, i * step, new Cesium.JulianDate()),
            newPos
        );
    });

    // 实时检测无人机位置和最近建筑物
    let warned = false;
    const warnDistance = 100;
    const collisionDistance = 20;
    let lastColor = null;
    const detectionRadius = 100;

    // 存储上一时刻的位置和时间，用于计算速度
    let lastPosition = null;
    let lastTime = null;

    // 限制建筑物检测频率
    let lastCheckTime = 0;

    function onTick() {
        if (!droneEntity.position) return;

        const currentTime = viewer.clock.currentTime;
        const currentTimeSeconds = Cesium.JulianDate.toDate(currentTime).getTime() / 1000;

        // 避免过于频繁检测（每秒一次）
        if (currentTimeSeconds - lastCheckTime < 1) return;
        lastCheckTime = currentTimeSeconds;

        const position = droneEntity.position.getValue(currentTime);
        console.log(`无人机当前位置: ${position}`);

        // 更新无人机标签信息
        if (position) {
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            const height = cartographic?.height?.toFixed(1) || '0.0';

            // 计算速度（m/s）
            let speed = 0;
            if (lastPosition && lastTime) {
                const distance = Cesium.Cartesian3.distance(position, lastPosition);
                const timeDiff = Cesium.JulianDate.secondsDifference(currentTime, lastTime);
                if (timeDiff > 0) {
                    speed = (distance / timeDiff).toFixed(1);
                }
            }

            // ✅ 修复：正确的标签配置
            if (!droneEntity.label) {
                droneEntity.label = new Cesium.LabelGraphics();
            }

            // 设置标签文本
            droneEntity.label.text = `无人机信息\n高度: ${height}m\n速度: ${speed} m/s\n电量: 100%`;

            // ✅ 修复：合理的字体大小和距离缩放
            droneEntity.label.font = '16px sans-serif'; // 固定字体大小，通过scaleByDistance控制显示大小

            droneEntity.label.fillColor = Cesium.Color.RED;
            droneEntity.label.outlineColor = Cesium.Color.WHITE;
            droneEntity.label.outlineWidth = 2;
            droneEntity.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
            droneEntity.label.pixelOffset = new Cesium.Cartesian2(0, -50);
            droneEntity.label.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
            droneEntity.label.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;

            // ✅ 修复：合理的距离缩放配置
            // 参数说明：近距(100m)时完全显示(scale=1.0)，远距(5000m)时缩小到0.3倍
            droneEntity.label.scaleByDistance = new Cesium.NearFarScalar(100.0, 1.0, 200.0, 0.3);

            // 透明度距离控制：近距时完全不透明，远距时半透明
            droneEntity.label.translucencyByDistance = new Cesium.NearFarScalar(100.0, 1.0, 800.0, 0.5);

            // 可见性距离：超过一定距离完全不可见
            droneEntity.label.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0.0, 600.0);

            // 保存当前位置和时间用于下次速度计算
            lastPosition = Cesium.Cartesian3.clone(position);
            lastTime = Cesium.JulianDate.clone(currentTime);
        }

        // 禁飞区检测
        if (position && props.noFlyZones && props.noFlyZones.length > 0) {
            const dist = pointInNoFlyZone(position, props.noFlyZones);
            if (dist < collisionDistance) {
                console.warn(`已经进入禁飞区，距离：${dist.toFixed(1)}米`);
                collision_effects(droneEntity);
            } else if (dist < warnDistance) {
                console.warn(`进入禁飞区预警，距离：${dist.toFixed(1)}米`);
                warning_effects(droneEntity);
            } else {
                console.warn(`远离禁飞区，距离：${dist.toFixed(1)}米`);
                droneEntity.model.color = Cesium.Color.WHITE;
            }
        }

        // 最近建筑物检测与高亮
        if (position) {
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            const dronePoint = turf.point([lon, lat]);

            getNearstBuildingsWithinDistance(dronePoint, detectionRadius, cartographic.height)
                .then(nearest => {
                    if (nearest) {
                        console.warn(
                            `⚠️ 最近建筑: ID=${nearest.polygon.properties.id}, ` +
                            `水平距离=${nearest.distanceInMeters.toFixed(2)}米, 高度=${nearest.polygon.properties.height}米, ` +
                            `无人机高度=${cartographic.height.toFixed(2)}米, 实际距离=${nearest.actualDistance.toFixed(2)}米`
                        );

                        const coordinates = parseWKTCoordinates(nearest.polygon.properties.wkt);
                        if (!coordinates) return;

                        if (highlightedBuildingEntity) {
                            viewer.entities.remove(highlightedBuildingEntity);
                        }

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
                                scale: 0.8,
                                // ✅ 为建筑物标签也添加距离缩放
                                scaleByDistance: new Cesium.NearFarScalar(100.0, 1.0, 3000.0, 0.3),
                                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 5000.0)
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

        // 检查飞行是否结束
        if (Cesium.JulianDate.greaterThan(viewer.clock.currentTime, viewer.clock.stopTime) ||
            !viewer.clock.shouldAnimate) {
            stopFly();
        }
    }

    onTickListener = onTick;
    viewer.clock.onTick.addEventListener(onTickListener);

    droneEntity.position = property;
    droneEntity.orientation = new Cesium.VelocityOrientationProperty(property);

    viewer.clock.startTime = startTime.clone();
    viewer.clock.stopTime = Cesium.JulianDate.addSeconds(startTime, (smoothPathPoints.length - 1) * step, new Cesium.JulianDate());
    viewer.clock.currentTime = startTime.clone();
    viewer.clock.multiplier = 1;
    viewer.clock.shouldAnimate = true;

    // 让相机跟随实体
    viewer.trackedEntity = droneEntity;
};

const stopFly = () => {
    const { viewer, droneEntity } = props;

    if (!isFlying.value) return;

    // 停止时钟动画
    viewer.clock.shouldAnimate = false;

    // 移除tick监听器
    if (onTickListener) {
        viewer.clock.onTick.removeEventListener(onTickListener);
        onTickListener = null;
    }

    // 清理高亮建筑物
    if (highlightedBuildingEntity) {
        viewer.entities.remove(highlightedBuildingEntity);
        highlightedBuildingEntity = null;
    }

    // 停止跟随
    viewer.trackedEntity = null;

    // 将无人机位置固定在当前位置
    if (droneEntity && droneEntity.position) {
        const currentPosition = droneEntity.position.getValue(viewer.clock.currentTime);
        if (currentPosition) {
            droneEntity.position = new Cesium.ConstantPositionProperty(currentPosition);
            droneEntity.orientation = undefined;
        }
    }

    isFlying.value = false;
    console.log('无人机飞行已停止');
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

.stop-button {
    background: #f44336 !important;
}

.stop-button:disabled {
    background: #ccc !important;
}
</style>