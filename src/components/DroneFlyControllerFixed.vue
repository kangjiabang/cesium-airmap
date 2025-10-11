<!-- DroneFlyController.vue -->
<template>
    <div class="drone-fly-controls">
        <button @click="startFly" :disabled="!canFly || isFlying" class="action-button start-button">
            <span class="button-icon">✈️</span>
            <span class="button-text">开始无人机飞行</span>
        </button>
        <button @click="stopFly" :disabled="!isFlying" class="action-button stop-button">
            <span class="button-icon">⏹️</span>
            <span class="button-text">停止无人机飞行</span>
        </button>

        <!-- ✅ 美化后的速度和飞行时间设置区域 -->
        <div class="speed-control-panel" v-if="canFly && !isFlying">
            <div class="control-item">
                <label class="control-label">
                    <span class="label-icon">⚡</span>
                    <span class="label-text">飞行速度</span>
                </label>
                <div class="speed-input-wrapper">
                    <!-- 修改 template：去掉 min/max -->
                    <input id="drone-speed" type="number" v-model="droneSpeedInput" :disabled="isFlying"
                        class="speed-input" @blur="applySpeed" @keyup.enter="applySpeed" />
                    <span class="speed-unit">米/秒</span>
                </div>
            </div>

            <div class="control-item">
                <label class="control-label">
                    <span class="label-icon">⏱️</span>
                    <span class="label-text">预计飞行时间</span>
                </label>
                <div class="duration-display">
                    <span class="duration-value">{{ formattedDuration }}</span>
                    <span class="duration-icon" v-if="droneSpeed < 10">🐢</span>
                    <span class="duration-icon" v-else-if="droneSpeed >= 10 && droneSpeed < 25">🚗</span>
                    <span class="duration-icon" v-else>🚀</span>
                </div>
            </div>
        </div>

        <div class="status-info">
            <span v-if="!canFly" class="status-hint">请先绘制航线</span>
            <span v-if="isFlying" class="status-flying">✈️ 飞行中... <span class="flight-time">{{ currentFlightTime
            }}</span></span>
        </div>
    </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
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

// 替换原来的 pathPoints props，使用内部 ref
const pathPoints = ref([]);

const smoothPathPoints = ref([])
// 在 ref 定义区域添加
const droneSpeed = ref(10); // ✅ 默认速度：10 米/秒
// 2. 新增一个用于输入框的临时值（可以是字符串/空/非法）
const droneSpeedInput = ref('10');
const droneEntity = ref(null)

let flightPathEntity = null

// ✅ 新增：当前飞行时间显示
const startTime = ref(null)

const currentFlightTime = ref("00:00")
let flightTimer = null // 用于清理定时器

// 在 script setup 顶部定义（和其他 ref 同级）
let coneEntity = null;


// 3. 应用输入值（带验证）
function applySpeed() {
    let value = parseFloat(droneSpeedInput.value);

    // 如果输入为空或非法，回退到当前合法值
    if (isNaN(value) || value === '') {
        droneSpeedInput.value = droneSpeed.value.toString();
        return;
    }

    if (value < 1 || value > 50) {
        alert('速度必须在 1 到 50 米/秒之间');
    }

    // 限制范围
    if (value < 1) value = 1;
    if (value > 50) value = 50;

    // 更新合法值和输入框
    droneSpeed.value = value;
    droneSpeedInput.value = value.toString();
}

// 4. 监听 droneSpeed 变化，同步到输入框（比如外部修改）
watch(droneSpeed, (newVal) => {
    droneSpeedInput.value = newVal.toString();
});

watch(
    () => pathPoints.value,
    (points) => {
        canFly.value = Array.isArray(points) && points.length > 1;
    },
    { immediate: true }
)

// 在 viewer 就绪时生成固定路径
watch(
    () => props.viewer,
    (newViewer) => {
        if (!newViewer) return;
        if (pathPoints.value.length > 0) return;

        const startLon = 119.988060;
        const startLat = 30.282778;
        const startHeight = 150.0;

        // 三段路径参数：每段的长度（米）和方位角（从正东起算，0°=东，90°=北）
        const legs = [
            { length: 400, azimuthDeg: 0 },   // 向东
            { length: 400, azimuthDeg: 30 },   // 东偏北 30°（即航向 30°）
            { length: 400, azimuthDeg: 60 },   // 更偏北（航向 60°）
        ];

        const totalPoints = 12; // 总点数（可调整）

        // 起点
        const startCarto = Cesium.Cartographic.fromDegrees(startLon, startLat, startHeight);
        const origin = Cesium.Cartesian3.fromRadians(startCarto.longitude, startCarto.latitude, startCarto.height);

        const ellipsoid = Cesium.Ellipsoid.WGS84;
        const normal = ellipsoid.geodeticSurfaceNormal(origin, new Cesium.Cartesian3());
        const east = Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, normal, new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(east, east);
        const north = Cesium.Cartesian3.cross(normal, east, new Cesium.Cartesian3());
        Cesium.Cartesian3.normalize(north, north);

        const points = [];
        let currentPos = origin;

        // 按比例分配点数（尽量均匀）
        const totalLength = legs.reduce((sum, leg) => sum + leg.length, 0);
        let accumulatedPoints = 0;

        legs.forEach((leg, idx) => {
            const legPoints = Math.round((leg.length / totalLength) * totalPoints);
            // 至少保留 2 个点（起点+终点），但首段起点已存在
            const numSegPoints = idx === 0 ? Math.max(2, legPoints) : Math.max(1, legPoints - 1);

            // 方位角转弧度
            const azimuthRad = Cesium.Math.toRadians(leg.azimuthDeg);
            // 方向向量 = cos(az) * east + sin(az) * north
            const dir = new Cesium.Cartesian3();
            Cesium.Cartesian3.multiplyByScalar(east, Math.cos(azimuthRad), dir);
            const northComponent = Cesium.Cartesian3.multiplyByScalar(north, Math.sin(azimuthRad), new Cesium.Cartesian3());
            Cesium.Cartesian3.add(dir, northComponent, dir);
            Cesium.Cartesian3.normalize(dir, dir);

            // 生成该段点（包括起点，但首段起点已作为 currentPos）
            for (let i = idx === 0 ? 0 : 1; i < numSegPoints; i++) {
                const ratio = i / (numSegPoints - 1); // 0 到 1
                const offset = ratio * leg.length;
                const displacement = Cesium.Cartesian3.multiplyByScalar(dir, offset, new Cesium.Cartesian3());
                const pos = Cesium.Cartesian3.add(currentPos, displacement, new Cesium.Cartesian3());
                points.push(pos);
            }

            // 更新 currentPos 为本段终点
            const endDisplacement = Cesium.Cartesian3.multiplyByScalar(dir, leg.length, new Cesium.Cartesian3());
            currentPos = Cesium.Cartesian3.add(currentPos, endDisplacement, new Cesium.Cartesian3());

            // 如果是最后一段，确保最后一个点被加入（避免因四舍五入丢失）
            if (idx === legs.length - 1 && points.length < totalPoints) {
                points.push(currentPos);
            }
        });

        // 去重（防止因分段导致重复点）
        const uniquePoints = [];
        for (const p of points) {
            if (uniquePoints.length === 0 ||
                !Cesium.Cartesian3.equalsEpsilon(uniquePoints[uniquePoints.length - 1], p, Cesium.Math.EPSILON6)) {
                uniquePoints.push(p);
            }
        }

        pathPoints.value = uniquePoints;
        console.log('✅ 生成三条折线路径（转角 < 90°），共', uniquePoints.length, '个点');
        drawFlightPath(uniquePoints);
    },
    { immediate: true }
);

function drawFlightPath(cartesianPoints) {
    // 如果已有路径，先移除（避免重复绘制）
    if (flightPathEntity) {
        props.viewer.entities.remove(flightPathEntity);
    }

    if (!cartesianPoints || cartesianPoints.length < 2) return;

    flightPathEntity = props.viewer.entities.add({
        name: '飞行路径',
        polyline: {
            positions: cartesianPoints,
            width: 4,
            material: new Cesium.PolylineOutlineMaterialProperty({
                color: Cesium.Color.LIME.withAlpha(0.8),
                outlineWidth: 1,
                outlineColor: Cesium.Color.BLACK
            }),
            clampToGround: false, // 若希望贴地，可设为 true（但你的路径有高度，建议 false）
            arcType: Cesium.ArcType.NONE // 直线连接
        }
    });

    console.log('✅ 飞行路径已绘制');
}

// 监听 viewer 初始化
watch(() => props.viewer, (newViewer) => {
    if (!newViewer || !pathPoints.value) return
    // 确保无人机存在，不存在则创建
    if (!droneEntity.value) {
        addDroneEntity()
    }
}, { immediate: true })

// ✅ 计算飞行总时长（秒）
const flightDurationSeconds = computed(() => {
    if (!pathPoints.value || pathPoints.value.length < 2) return 0;

    // 临时生成插值点（用于预览，不影响实际飞行）
    const tempSmoothPoints = generateInterpolatedPointsByCartesian3(pathPoints.value);

    if (!tempSmoothPoints || tempSmoothPoints.length < 2) return 0;

    let totalDist = 0;
    for (let i = 1; i < tempSmoothPoints.length; i++) {
        totalDist += Cesium.Cartesian3.distance(tempSmoothPoints[i - 1], tempSmoothPoints[i]);
    }

    // 时间 = 距离 / 速度
    return totalDist / droneSpeed.value;
});

// ✅ 格式化为 "X分Y秒" 或 "X秒"
const formattedDuration = computed(() => {
    const sec = Math.ceil(flightDurationSeconds.value); // 向上取整更合理
    if (sec < 60) {
        return `${sec}秒`;
    } else {
        const min = Math.floor(sec / 60);
        const remainingSec = sec % 60;
        return `${min}分${remainingSec}秒`;
    }
});

// 添加无人机实体
function addDroneEntity() {
    if (pathPoints.value.length === 0) return

    const firstPoint = pathPoints.value[0]
    const carto = Cesium.Cartographic.fromCartesian(firstPoint)
    const initialHeight = Math.max(carto.height, 0) + 2
    const initialPosition = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, initialHeight)

    // 定义缩放策略：近距离大，远距离小
    const scaleByDistance = new Cesium.NearFarScalar(
        100.0,   // near: 相机距离 ≤100 米时，使用最大缩放
        1.0,     // nearValue: 最大缩放比例（1.0 = 原始大小）
        2000.0,  // far: 相机距离 ≥2000 米时，使用最小缩放
        0.2,      // farValue: 最小缩放比例（0.2 = 缩小到 20%）
        8000.0,  // far: 相机距离 ≥2000 米时，使用最小缩放
        0.1,     // farValue: 最小缩放比例（0.2 = 缩小到 20%）
        15000.0,  // far: 相机距离 ≥2000 米时，使用最小缩放
        0.05      // farValue: 最小缩放比例（0.2 = 缩小到 20%）
    );

    droneEntity.value = props.viewer.entities.add({
        name: "无人机",
        position: initialPosition,
        model: {
            uri: "models/four_drone.glb",
            //uri: "models/drone_costum.glb",
            minimumPixelSize: 128,
            maximumScale: 100,
            // ✅ 关键：添加 scaleByDistance 到模型
            scaleByDistance: scaleByDistance
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
    const { viewer } = props
    if (!viewer || !pathPoints.value || pathPoints.value.length < 2 || !droneEntity.value || isFlying.value) return

    isFlying.value = true
    startTime.value = Date.now() // ✅ 记录开始时间
    // ✅ 启动飞行计时器
    if (flightTimer) clearInterval(flightTimer)
    flightTimer = setInterval(() => {
        if (!isFlying.value || !startTime.value) {
            currentFlightTime.value = "00:00"
            return
        }
        const elapsedSeconds = Math.floor((Date.now() - startTime.value) / 1000)
        const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')
        const seconds = (elapsedSeconds % 60).toString().padStart(2, '0')
        currentFlightTime.value = `${minutes}:${seconds}`
    }, 1000) // 每秒更新

    // 动画飞行
    const property = new Cesium.SampledPositionProperty()
    const startJulianTime = Cesium.JulianDate.now()

    console.log(`pathPoints:${pathPoints.value}`)
    smoothPathPoints.value = generateInterpolatedPointsByCartesian3(pathPoints.value);

    // 计算总距离和平均 step
    let totalDistance = 0;
    for (let i = 1; i < smoothPathPoints.value.length; i++) {
        totalDistance += Cesium.Cartesian3.distance(smoothPathPoints.value[i - 1], smoothPathPoints.value[i]);
    }

    // 如果总距离为0，使用默认 step
    const step = totalDistance > 0 ? totalDistance / (smoothPathPoints.value.length - 1) / droneSpeed.value : 5;
    console.log(`总距离: ${totalDistance.toFixed(2)} 米, 计算步长: ${step.toFixed(2)} 秒`);

    smoothPathPoints.value.forEach((pos, i) => {
        const carto = Cesium.Cartographic.fromCartesian(pos);
        const height = Math.max(carto.height, 0) + 2;
        const newPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height);
        property.addSample(
            Cesium.JulianDate.addSeconds(startJulianTime, i * step, new Cesium.JulianDate()),
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

        // ✅ 关键修复：在采样前，先检查时间是否合法
        if (Cesium.JulianDate.greaterThan(currentTime, viewer.clock.stopTime) || !viewer.clock.shouldAnimate) {
            console.log('飞行时间已结束，提前停止采样');
            stopFly();
            return;
        }

        // 获取无人机在路径上的理论位置
        let position = null;
        try {
            position = droneEntity.value.position.getValue(currentTime);
        } catch (error) {
            console.warn('采样位置时发生异常:', error.message);
        }

        // ✅ 如果连补偿位置都没有，则强制停止飞行
        if (!position) {
            console.error('无法获取有效无人机位置，强制停止飞行');
            stopFly();
            return;
        }

        console.log(`无人机当前位置: ${position}`);

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



    // ======================
    // 🔺 锥视视野可视化（终极修复：锥体尖端在无人机位置，向前延伸）
    // ======================
    const coneLength = 100.0;
    const coneFov = Cesium.Math.toRadians(30);
    const coneRadius = coneLength * Math.tan(coneFov);

    // ✅ 注释掉这行，因为朝向将在 onTick 中动态计算
    if (!droneEntity.value.orientation) {
        droneEntity.value.orientation = new Cesium.VelocityOrientationProperty(property);
    }
    // ✅ 关键：让圆柱体沿 X 轴延伸（无人机前向），而不是默认的 Z 轴
    const rotationQuaternion = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, -Cesium.Math.PI_OVER_TWO);

    coneEntity = viewer.entities.add({
        name: "无人机视野锥",
        position: new Cesium.CallbackProperty(() => {

            // 防御检查
            if (!isFlying.value || !droneEntity.value || !droneEntity.value.position || !droneEntity.value.orientation) {
                return Cesium.Cartesian3.ZERO;
            }

            const dronePos = droneEntity.value.position.getValue(viewer.clock.currentTime);
            const droneOri = droneEntity.value.orientation.getValue(viewer.clock.currentTime);

            // 🔒 关键：检查 droneOri 是否有效
            if (!dronePos || !droneOri) {
                return Cesium.Cartesian3.ZERO;
            }

            // 计算无人机前向单位向量（X轴方向）
            const forwardVector = new Cesium.Cartesian3(1, 0, 0);
            const rotatedForward = Cesium.Matrix3.multiplyByVector(
                Cesium.Matrix3.fromQuaternion(droneOri),
                forwardVector,
                new Cesium.Cartesian3()
            );

            // 将锥体位置设在无人机前方一个长度处
            // 这样锥体从该位置向后延伸，尖端正好落在无人机位置
            const conePos = Cesium.Cartesian3.add(
                dronePos,
                Cesium.Cartesian3.multiplyByScalar(rotatedForward, coneLength / 2, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );

            return conePos;
        }, false),
        orientation: new Cesium.CallbackProperty(() => {

            // 🔒 同样做防御性检查
            if (!droneEntity.value || !droneEntity.value.orientation) {
                return Cesium.Quaternion.IDENTITY;
            }

            const ori = droneEntity.value.orientation.getValue(viewer.clock.currentTime);

            // 🔥🔥 关键修复：检查 getValue() 的返回值是否为有效对象
            if (!Cesium.defined(ori)) {
                return Cesium.Quaternion.IDENTITY;
            }
            // 将 Cylinder 的 Z 轴旋转到 X 轴（即向前）→ 再乘以无人机朝向
            return Cesium.Quaternion.multiply(ori, rotationQuaternion, new Cesium.Quaternion());
        }, false),
        cylinder: {
            length: coneLength,
            topRadius: 0.0,     // 尖端半径为0
            bottomRadius: coneRadius, // 底部半径
            material: Cesium.Color.YELLOW.withAlpha(0.3),
            outline: true,
            outlineColor: Cesium.Color.ORANGE
        }
    });

    viewer.clock.startTime = startJulianTime.clone();
    viewer.clock.stopTime = Cesium.JulianDate.addSeconds(startJulianTime, (smoothPathPoints.value.length - 1) * step, new Cesium.JulianDate());
    viewer.clock.currentTime = startJulianTime.clone();
    viewer.clock.multiplier = 1;
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

    // ✅ 第一件事：标记停止 + 移除锥体
    isFlying.value = false; // 🔥 先设为 false，让回调能检测到

    // ✅ 立即移除锥体，防止后续回调访问无效数据
    if (coneEntity) {
        viewer.entities.remove(coneEntity);
        coneEntity = null;
    }

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

    // ✅ 关键逻辑：判断是自然结束还是手动停止
    let stopPosition = null;
    let isNaturalEnd = false;

    // 检查是否是飞行自然结束 (时钟时间 >= 停止时间)
    if (Cesium.JulianDate.greaterThanOrEquals(viewer.clock.currentTime, viewer.clock.stopTime)) {
        isNaturalEnd = true;
        console.log('飞行自然结束，将停在终点');

        // 自然结束：停在路径的最后一个点
        if (smoothPathPoints.value && smoothPathPoints.value.length > 0) {
            const lastPoint = smoothPathPoints.value[smoothPathPoints.value.length - 1];
            const carto = Cesium.Cartographic.fromCartesian(lastPoint);
            const stopHeight = Math.max(carto.height, 0) + 2;
            stopPosition = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, stopHeight);
        }
    } else {
        console.log('用户手动停止，将停在当前位置');
        // 手动停止：停在当前位置
        if (droneEntity.value && droneEntity.value.position) {
            stopPosition = droneEntity.value.position.getValue(viewer.clock.currentTime);
        }
    }

    // 应用最终停止位置和朝向
    if (stopPosition) {
        // 设置固定位置
        droneEntity.value.position = new Cesium.ConstantPositionProperty(stopPosition);

        // ✅ 设置一个固定的、有效的朝向
        // 创建一个默认的、朝北的朝向
        const fixedHeading = Cesium.Math.toRadians(0); // 0度，正北
        const fixedPitch = Cesium.Math.toRadians(0);   // 0度，水平
        const fixedRoll = Cesium.Math.toRadians(0);    // 0度，不侧倾
        const hpr = new Cesium.HeadingPitchRoll(fixedHeading, fixedPitch, fixedRoll);
        droneEntity.value.orientation = Cesium.Transforms.headingPitchRollQuaternion(stopPosition, hpr);
    } else {
        console.warn('未能获取有效的停止位置，使用默认终点显示');

        //作为兜底方案
        if (smoothPathPoints.value && smoothPathPoints.value.length > 0) {
            const lastPoint = smoothPathPoints.value[smoothPathPoints.value.length - 1];
            const carto = Cesium.Cartographic.fromCartesian(lastPoint);
            const stopHeight = Math.max(carto.height, 0) + 2;
            stopPosition = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, stopHeight);

            // 设置固定位置
            droneEntity.value.position = new Cesium.ConstantPositionProperty(stopPosition);

            // ✅ 设置一个固定的、有效的朝向
            // 创建一个默认的、朝北的朝向
            const fixedHeading = Cesium.Math.toRadians(0); // 0度，正北
            const fixedPitch = Cesium.Math.toRadians(0);   // 0度，水平
            const fixedRoll = Cesium.Math.toRadians(0);    // 0度，不侧倾
            const hpr = new Cesium.HeadingPitchRoll(fixedHeading, fixedPitch, fixedRoll);
            droneEntity.value.orientation = Cesium.Transforms.headingPitchRollQuaternion(stopPosition, hpr);
        }
    }

    isFlying.value = false;
    console.log('无人机飞行已停止');
};

onUnmounted(() => {
    const { viewer } = props;

    if (!viewer) return;

    if (flightTimer) {
        clearInterval(flightTimer)
        flightTimer = null
    }

    // 1. 移除无人机实体（如果存在）
    if (droneEntity.value) {
        viewer.entities.remove(droneEntity.value);
        droneEntity.value = null;
    }

    // 2. 移除飞行路径实体（如果存在）
    if (flightPathEntity) {
        viewer.entities.remove(flightPathEntity);
        flightPathEntity = null;
    }

    // 3. 停止飞行（如果正在飞）
    if (isFlying.value) {
        stopFly();
    }

    // 4. 移除高亮建筑（如果存在）
    if (highlightedBuildingEntity) {
        viewer.entities.remove(highlightedBuildingEntity);
        highlightedBuildingEntity = null;
    }

    // 5. 终止 Worker（避免内存泄漏）
    if (buildingWorker) {
        buildingWorker.terminate();
    }

    console.log('✅ DroneFlyController 已卸载，清理所有实体和资源');
});


</script>

<style scoped>
.drone-fly-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(30, 30, 30, 0.8);
    padding: 16px;
    border-radius: 12px;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    color: white;
    font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

/* 美化按钮样式 */
.action-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 14px;
    transition: all 0.3s ease;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.start-button {
    background: linear-gradient(135deg, #43a047, #2e7d32);
    color: white;
}

.start-button:hover:not(:disabled) {
    background: linear-gradient(135deg, #4caf50, #388e3c);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(67, 160, 71, 0.4);
}

.stop-button {
    background: linear-gradient(135deg, #f44336, #d32f2f);
    color: white;
}

.stop-button:hover:not(:disabled) {
    background: linear-gradient(135deg, #f55a4e, #e53935);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(244, 67, 54, 0.4);
}

.action-button:disabled {
    background: #555;
    color: #888;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

.button-icon {
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
}

/* 美化速度控制面板 */
.speed-control-panel {
    background: rgba(40, 40, 40, 0.7);
    padding: 16px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
}

.control-item {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.control-item:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
}

.control-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: #e0e0e0;
    min-width: 120px;
}

.label-icon {
    font-size: 18px;
}

/* 美化滑块 */
.speed-input-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 16px;
}

.speed-slider {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: #333;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
}

.speed-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #43a047;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    border: 2px solid #2e7d32;
    transition: all 0.2s ease;
}

.speed-slider::-webkit-slider-thumb:hover {
    background: #4caf50;
    transform: scale(1.1);
}

.speed-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #43a047;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    border: 2px solid #2e7d32;
    transition: all 0.2s ease;
}

/* 速度值显示 */
.speed-value-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 80px;
    max-width: 80px;
    /* ✅ 限制最大宽度 */
    text-align: center;
    /* ✅ 文本居中对齐 */
    overflow: hidden;
    /* ✅ 防止内容溢出 */
    text-overflow: ellipsis;
    /* ✅ 溢出时显示省略号 */
    white-space: nowrap;
    /* ✅ 不换行，配合 ellipsis */
}

.speed-value {
    font-size: 18px;
    font-weight: 700;
    color: #43a047;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.speed-unit {
    font-size: 12px;
    color: #aaa;
}

/* 飞行时间显示 */
.duration-display {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 100px;
}

.duration-value {
    font-size: 16px;
    font-weight: 600;
    color: #ff9800;
}

.duration-icon {
    font-size: 18px;
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0% {
        transform: scale(1);
    }

    50% {
        transform: scale(1.1);
    }

    100% {
        transform: scale(1);
    }
}

/* 状态信息 */
.status-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
}

.status-hint {
    color: #888;
    font-style: italic;
}

.status-flying {
    color: #43a047;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
}

.flight-time {
    background: rgba(67, 160, 71, 0.2);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
}

/* 响应式设计 */
@media (max-width: 768px) {
    .drone-fly-controls {
        padding: 12px;
    }

    .control-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
    }

    .control-label {
        min-width: auto;
    }

    .speed-input-wrapper {
        width: 100%;
    }
}

/* 美化数字输入框 */
.speed-input {
    width: 80px;
    padding: 8px 12px;
    border: 2px solid #43a047;
    border-radius: 6px;
    background: #222;
    color: white;
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    outline: none;
    transition: border-color 0.2s ease;
}

.speed-input:focus {
    border-color: #4caf50;
    box-shadow: 0 0 0 3px rgba(67, 160, 71, 0.3);
}

.speed-input::-webkit-outer-spin-button,
.speed-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.speed-input[type="number"] {
    -moz-appearance: textfield;
    /* Firefox 去掉上下箭头 */
}

/* 调整输入框和单位的布局 */
.speed-input-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
}

.speed-unit {
    color: #aaa;
    font-size: 14px;
}
</style>