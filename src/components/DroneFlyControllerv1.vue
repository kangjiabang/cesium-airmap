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
import { warning_effects, warning_effects_2, collision_effects } from '@/js/danamic_effects.js'
import * as turf from '@turf/turf'
import { getNearstBuildingsWithinDistance } from '@/js/poligon_infos_intersect_distance.js'
import { parseWKTCoordinates, bufferPolygon } from '@/js/parse_buildings.js'

// 创建 worker 实例
const buildingWorker = new Worker(new URL('@/js/buildingWorker.js', import.meta.url), { type: 'module' })

// 监听 worker 回调
buildingWorker.onmessage = (event) => {
    const { success, result, error } = event.data
    if (!success) {
        console.error("Worker 检测出错:", error)
        return
    }
    console.log("Worker 检测结果:", result)

    if (result) {
        updateHighlightedBuilding(result)
    } else {
        clearHighlightedBuilding()
    }
}

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
    },
    // ✅ 新增：下雨状态
    hasRain: {
        type: Boolean,
        default: false
    }
})

const canFly = ref(false)
const isFlying = ref(false)
let onTickListener = null
let highlightedBuildingEntity = null

const droneEntity = ref(null)

watch(
    () => props.pathPoints,
    (points) => {
        canFly.value = Array.isArray(points) && points.length > 1;
    },
    { immediate: true }
)

// 监听 viewer 初始化
watch(() => props.viewer, (newViewer) => {
    if (!newViewer || !props.pathPoints) return
    // 确保无人机存在，不存在则创建
    if (!droneEntity.value) {
        addDroneEntity()
    }
}, { immediate: true })

// 添加无人机实体
function addDroneEntity() {
    if (props.pathPoints.length === 0) return

    const firstPoint = props.pathPoints[0]
    const carto = Cesium.Cartographic.fromCartesian(firstPoint)
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

const startFly = () => {
    const { viewer, pathPoints } = props
    if (!viewer || !pathPoints || pathPoints.length < 2 || !droneEntity.value || isFlying.value) return

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

        // ✅ 关键修复：在函数最开始检查飞行状态
        if (!isFlying.value) {
            return; // 如果飞行已停止，立即退出，避免访问可能已销毁的属性
        }

        // ✅ 检查无人机实体和位置是否存在
        if (!droneEntity.value || !droneEntity.value.position) {
            console.warn('无人机实体或位置属性不存在');
            return;
        }

        if (!droneEntity.value.position) return;

        const currentTime = viewer.clock.currentTime;
        const currentTimeSeconds = Cesium.JulianDate.toDate(currentTime).getTime() / 1000;

        // 避免过于频繁检测（每秒一次）
        if (currentTimeSeconds - lastCheckTime < 1) return;
        lastCheckTime = currentTimeSeconds;

        // 获取无人机在路径上的理论位置
        const position = droneEntity.value.position.getValue(currentTime);
        console.log(`无人机当前位置: ${position}`);

        // ✅ 关键修复：检查 position 是否为有效值
        if (!position) {
            console.warn('无人机位置无效，跳过本次 tick');
            return; // 直接退出 onTick，避免后续所有计算
        }

        // ✅ 新增：风扰动效果（仅在下雨时生效）
        let finalPosition = position; // 最终位置，默认为理论位置
        let finalOrientation = undefined; // 最终朝向，默认由VelocityOrientationProperty计算

        if (props.hasRain) {
            // 生成基于时间的“伪随机”扰动，使效果连续
            const timeBasedSeed = currentTimeSeconds * 0.5; // 控制扰动变化速度
            const windStrength = 2.0; // 风力强度，单位：米

            // 计算一个平滑变化的扰动向量
            const windOffsetX = Math.sin(timeBasedSeed) * windStrength;
            const windOffsetY = Math.cos(timeBasedSeed * 1.3) * windStrength;
            const windOffsetZ = Math.sin(timeBasedSeed * 0.7) * (windStrength * 0.5); // 高度方向扰动小一些

            // 创建扰动向量
            const windOffset = new Cesium.Cartesian3(windOffsetX, windOffsetY, windOffsetZ);

            // 将扰动向量加到当前位置，得到最终显示位置
            finalPosition = Cesium.Cartesian3.add(position, windOffset, new Cesium.Cartesian3());

            // ✅ 计算倾斜朝向
            // 方法：根据风的方向，计算一个“抬头”或“低头”的俯仰角 (pitch)
            // 这里我们简化处理，让无人机朝着风来的反方向轻微倾斜
            const pitchAngle = Cesium.Math.toRadians(-5 * Math.sin(timeBasedSeed)); // 最大倾斜5度
            const headingAngle = Cesium.Math.toRadians(0); // 保持原航向
            const rollAngle = Cesium.Math.toRadians(3 * Math.cos(timeBasedSeed)); // 侧滚角，最大3度

            // 创建一个旋转矩阵
            const hpr = new Cesium.HeadingPitchRoll(headingAngle, pitchAngle, rollAngle);
            finalOrientation = Cesium.Transforms.headingPitchRollQuaternion(finalPosition, hpr);
        }

        // ✅ 应用最终的位置和朝向
        if (finalOrientation) {
            // 如果计算了自定义朝向，直接设置
            droneEntity.value.orientation = finalOrientation;
        } else {
            // 否则，使用速度方向（这是原来的逻辑）
            droneEntity.value.orientation = new Cesium.VelocityOrientationProperty(droneEntity.value.position);
        }

        // 更新无人机标签信息
        if (finalPosition) {
            const cartographic = Cesium.Cartographic.fromCartesian(finalPosition);
            const height = cartographic?.height?.toFixed(1) || '0.0';

            // ✅ 添加闪烁特效：当高度 < 100 米时
            if (height < 100) {
                warning_effects_2(droneEntity.value, viewer);
            } else {
                // 高度 >= 100 米，恢复默认颜色
                droneEntity.value.model.color = Cesium.Color.WHITE;
            }

            // 计算速度（m/s）
            let speed = 0;
            if (lastPosition && lastTime) {
                const distance = Cesium.Cartesian3.distance(finalPosition, lastPosition);
                const timeDiff = Cesium.JulianDate.secondsDifference(currentTime, lastTime);
                if (timeDiff > 0) {
                    speed = (distance / timeDiff).toFixed(1);
                }
            }

            // ✅ 修复：正确的标签配置
            if (!droneEntity.value.label) {
                droneEntity.value.label = new Cesium.LabelGraphics();
            }

            let baseText = `无人机信息\n高度: ${height}m\n速度: ${speed} m/s\n电量: 100%`;
            let labelText = baseText;

            const heightNum = parseFloat(height);
            if (heightNum < 100) {
                labelText = `⚠️ 高度低于100米！\n请保持安全飞行高度\n\n` + baseText;
            }

            // ✅ 如果下雨，在标签顶部添加提示
            if (props.hasRain) {
                labelText = `🌧️ 下雨中，飞行受风影响\n\n` + labelText;
            }

            droneEntity.value.label.text = labelText;
            // ✅ 修复：合理的字体大小和距离缩放
            droneEntity.value.label.font = '16px sans-serif'; // 固定字体大小，通过scaleByDistance控制显示大小

            droneEntity.value.label.fillColor = Cesium.Color.RED;
            droneEntity.value.label.outlineColor = Cesium.Color.WHITE;
            droneEntity.value.label.outlineWidth = 2;
            droneEntity.value.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
            droneEntity.value.label.pixelOffset = new Cesium.Cartesian2(0, -50);
            droneEntity.value.label.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
            droneEntity.value.label.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;

            // ✅ 修复：合理的距离缩放配置
            // 参数说明：近距(100m)时完全显示(scale=1.0)，远距(5000m)时缩小到0.3倍
            droneEntity.value.label.scaleByDistance = new Cesium.NearFarScalar(100.0, 1.0, 200.0, 0.3);

            // 透明度距离控制：近距时完全不透明，远距时半透明
            droneEntity.value.label.translucencyByDistance = new Cesium.NearFarScalar(100.0, 1.0, 800.0, 0.5);

            // 可见性距离：超过一定距离完全不可见
            droneEntity.value.label.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0.0, 600.0);

            // 保存当前位置和时间用于下次速度计算
            lastPosition = Cesium.Cartesian3.clone(finalPosition);
            lastTime = Cesium.JulianDate.clone(currentTime);
        }

        // 禁飞区检测
        if (finalPosition && props.noFlyZones && props.noFlyZones.length > 0) {
            const dist = pointInNoFlyZone(finalPosition, props.noFlyZones);

            let zoneWarning = "";
            if (dist < collisionDistance) {
                console.warn(`已经进入禁飞区，距离：${dist.toFixed(1)}米`);
                collision_effects(droneEntity.value);
                zoneWarning = `🚫 已进入禁飞区！\n距离边界: ${dist.toFixed(1)}米\n\n`;
            } else if (dist < warnDistance) {
                console.warn(`进入禁飞区预警，距离：${dist.toFixed(1)}米`);
                warning_effects(droneEntity.value);
                zoneWarning = `⚠️ 靠近禁飞区！\n距离边界: ${dist.toFixed(1)}米\n\n`;
            } else {
                console.warn(`远离禁飞区，距离：${dist.toFixed(1)}米`);
                droneEntity.value.model.color = Cesium.Color.WHITE;
            }

            // 🔥 更新无人机标签：拼接禁飞区警告
            if (droneEntity.value.label) {
                let baseText = droneEntity.value.label.text?.getValue
                    ? droneEntity.value.label.text.getValue(props.viewer.clock.currentTime)
                    : droneEntity.value.label.text;

                // 移除旧的禁飞区提示，避免累积（按换行符清理）
                baseText = baseText.replace(/(🚫 已进入禁飞区！[\s\S]*?\n\n)|(⚠️ 靠近禁飞区！[\s\S]*?\n\n)/, "");
                // 移除旧的下雨提示
                baseText = baseText.replace(/🌧️ 下雨中，飞行受风影响\n\n/, "");

                // 拼接禁飞区警告和下雨提示
                let newText = baseText;
                if (props.hasRain) {
                    newText = `🌧️ 下雨中，飞行受风影响\n\n` + newText;
                }
                newText = zoneWarning + newText;

                droneEntity.value.label.text = newText;
            }
        }

        // 最近建筑物检测与高亮
        if (finalPosition) {
            const cartographic = Cesium.Cartographic.fromCartesian(finalPosition);
            const lon = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            const dronePoint = turf.point([lon, lat]);


            buildingWorker.postMessage({
                dronePoint,
                detectionRadius,
                height: cartographic.height
            })

        }

        // 检查飞行是否结束
        if (Cesium.JulianDate.greaterThan(viewer.clock.currentTime, viewer.clock.stopTime) ||
            !viewer.clock.shouldAnimate) {
            stopFly();
        }
    }

    onTickListener = onTick;
    viewer.clock.onTick.addEventListener(onTickListener);

    droneEntity.value.position = property;
    // ✅ 注释掉这行，因为朝向将在 onTick 中动态计算
    // droneEntity.value.orientation = new Cesium.VelocityOrientationProperty(property);

    viewer.clock.startTime = startTime.clone();
    viewer.clock.stopTime = Cesium.JulianDate.addSeconds(startTime, (smoothPathPoints.length - 1) * step, new Cesium.JulianDate());
    viewer.clock.currentTime = startTime.clone();
    viewer.clock.multiplier = 5;
    viewer.clock.shouldAnimate = true;

    // 让相机跟随实体
    viewer.trackedEntity = droneEntity.value;
};

let lastBuildingId = null

function updateHighlightedBuilding(nearest) {

    const currentId = nearest.polygon.properties.id
    if (currentId === lastBuildingId) {
        return // ✅ 相同建筑，不更新，避免多余开销
    }
    lastBuildingId = currentId

    const coordinates = parseWKTCoordinates(nearest.polygon.properties.wkt)
    if (!coordinates) return

    const coords = bufferPolygon(coordinates, 2)

    if (!highlightedBuildingEntity) {
        // 第一次创建
        highlightedBuildingEntity = props.viewer.entities.add({
            name: `高亮建筑`,
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
                font: '14px sans-serif',
                fillColor: Cesium.Color.WHITE,
                backgroundColor: Cesium.Color.RED,
                backgroundOpacity: 0.7,
                showBackground: true,
                pixelOffset: new Cesium.Cartesian2(0, -50),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                scale: 0.8,
                scaleByDistance: new Cesium.NearFarScalar(100.0, 1.0, 3000.0, 0.3),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 5000.0)
            }
        })
    }

    // ✅ 复用已有实体，只更新属性
    highlightedBuildingEntity.name = `高亮建筑 ID: ${nearest.polygon.properties.id}`
    highlightedBuildingEntity.polygon.hierarchy = Cesium.Cartesian3.fromDegreesArray(coords)
    highlightedBuildingEntity.polygon.extrudedHeight = nearest.polygon.properties.height
    highlightedBuildingEntity.label.text =
        `⚠️ 障碍物\n实际距离: ${nearest.actualDistance.toFixed(1)}m\n高度: ${nearest.polygon.properties.height}m`
    highlightedBuildingEntity.show = true
}


function clearHighlightedBuilding() {
    if (highlightedBuildingEntity) {
        highlightedBuildingEntity.show = false
    }
}



const stopFly = () => {
    const { viewer } = props;

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
    if (droneEntity.value && droneEntity.value.position) {
        const currentPosition = droneEntity.value.position.getValue(viewer.clock.currentTime);
        if (currentPosition) {
            droneEntity.value.position = new Cesium.ConstantPositionProperty(currentPosition);
            droneEntity.value.orientation = undefined;
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