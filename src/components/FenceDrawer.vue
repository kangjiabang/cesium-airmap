<!-- FenceDrawer.vue (原 DronePathDrawer.vue) -->
<template>
    <div class="control-group fence-group"> <!-- 🚧 FENCE MOD: 类名修改 -->
        <!-- 控件按钮和信息 -->
        <div class="fence-controls"> <!-- 🚧 FENCE MOD: 类名修改 -->
            <button @click="startDrawing">{{ drawing ? '围栏绘制中' : '开始绘制围栏' }}</button> <!-- 🚧 FENCE MOD: 文字修改 -->
            <button @click="handleFinishDrawing" :disabled="!drawing">结束绘制</button>
            <button @click="toggleEditMode" :disabled="!pathPoints.length">{{ editMode ? '退出编辑' : '编辑围栏' }}</button>
            <!-- 🚧 FENCE MOD: 文字修改 -->
            <button @click="savePath" :disabled="!pathPoints.length">保存围栏</button> <!-- 🚧 FENCE MOD: 文字修改 -->
            <button @click="clearAll">清除所有</button>
        </div>
        <!-- 围栏信息提示 -->
        <div class="fence-info" :style="{ visibility: pathPoints.length ? 'visible' : 'hidden' }">
            <!-- 🚧 FENCE MOD: 类名修改 -->
            <span>顶点数：{{ pathPoints.length || 0 }}</span> <!-- 🚧 FENCE MOD: 文字修改 -->
            <span v-if="editMode" class="edit-hint">点击顶点编辑 | 拖动调整位置 | 右键删除</span> <!-- 🚧 FENCE MOD: 文字修改 -->
        </div>

    </div>
</template>

<script setup>
import { ref, shallowRef, onUnmounted, watch, onMounted, nextTick } from "vue";
import * as Cesium from "cesium";
import * as echarts from "echarts"; // 引入 echarts
import { calculateTerrainHeight } from '@/js/ray_height_new.js'

const props = defineProps({
    viewer: {
        type: Object,
        required: true,
    },
});

const drawing = ref(false);
const editMode = ref(false);
const handler = ref(null);
const editHandler = ref(null);
const tempPolyline = shallowRef(null);
const finalPolyline = shallowRef(null); // 🚧 FENCE MOD: 对于围栏，finalPolyline 将是一个 Polygon
const pathPoints = ref([]);
const droneEntity = shallowRef(null); // 🚧 FENCE MOD: 名称不贴切，可改为 fenceEntity 或直接移除
const pathPointEntities = ref([]);
const isDragging = ref(false);
const draggedPointIndex = ref(-1);

// 🚧 FENCE MOD: 更换图标，使用更符合“围栏/区域”概念的图标
const NORMAL_ICON = "/icons/marker_blue.png"; // 假设你有这个图标
const EDIT_ICON = "/icons/marker_blue.png"; // 假设你有这个图标
// 🚧 FENCE MOD: 移除 LINE_HEIGHT_DEFAULT, POINT_LINE_DISTANCE 与高度相关逻

// --- 新增：ECharts 图表实例 ---
const chartContainer = ref(null);
let chartInstance = null;

// 🚧 FENCE MOD: 创建围栏顶点实体
function createWaypointEntity(position, index) { // 🚧 FENCE MOD: 函数名可改为 createFenceVertexEntity

    // 🛡️ 校验 position 是否有效
    if (!Cesium.defined(position) || !(position instanceof Cesium.Cartesian3)) {
        console.error("无效的顶点位置:", position);
        return null;
    }
    const { viewer } = props;
    const entity = viewer.entities.add({
        position: position,
        billboard: {
            image: NORMAL_ICON,
            scale: 0.5,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1000, 0.4, 10000, 0.2),
            translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.1),
            terrainHeight: 0, // 🚧 FENCE MOD: 保留地面高度用于显示
            show: true,
        },
        label: {
            text: (index + 1).toString(),
            font: "bold 18px Microsoft YaHei, sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, -30),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1000, 1.0, 10000, 0.5),
            translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.7),
            showBackground: false,
            backgroundColor: new Cesium.Color(0.16, 0.16, 0.16, 0.4),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            show: true,
        },
    });

    // 🚧 FENCE MOD: 计算地面高度，用于标签显示
    const { terrainHeight, rayEntities } = calculateTerrainHeight(viewer, position);
    if (!rayEntities) {
        return;
    }

    entity.billboard.terrainHeight = terrainHeight;
    entity.rayEntities = rayEntities;

    // 🚧 FENCE MOD: 更新标签，仅显示序号和地面高度
    updateEntityLabel(entity, index);

    console.log(`📍 围栏顶点 ${index + 1} 位置高度: ${terrainHeight.toFixed(2)} 米`);
    return entity;
}

// 🚧 FENCE MOD: 更新实体标签
function updateEntityLabel(entity, index) {
    const terrainHeight = entity.billboard.terrainHeight || 0;
    const labelText = `顶点:${index + 1}
地面高度:${terrainHeight.toFixed(0)}m`;
    entity.label.text = labelText;
    // 🚧 FENCE MOD: 移除基于飞行高度的颜色逻辑
    entity.label.fillColor = new Cesium.ConstantProperty(Cesium.Color.WHITE);
}

// 🚧 FENCE MOD: 移除 updateAllLabels 中与飞行高度相关的调用
function updateAllLabels() {
    pathPointEntities.value.forEach((entity, index) => {
        updateEntityLabel(entity, index);
    });

}

// 🚧 FENCE MOD: 移除 getLineColorByAltitude，围栏统一使用一种颜色，例如红色表示警告区域
// function getLineColorByAltitude() { ... }

// 🚧 FENCE MOD: 移除 showHeightEditDialog 函数，围栏顶点不再编辑高度
// function showHeightEditDialog(entity, index, clickPosition) { ... }

// --- 初始化 ECharts 图表 ---
// 🚧 FENCE MOD: 对于围栏，剖面图逻辑不适用。这里可以改为显示围栏的面积、周长，或者直接禁用。
// 为简化，我们暂时保留原逻辑，但它显示的数据将只有地面高度。
const initChart = () => {
    nextTick(() => {
        if (chartContainer.value) {
            chartInstance = echarts.init(chartContainer.value);
            updateProfileChart(); // 初始空图
        }
    });
};


const startDrawing = () => {
    if (drawing.value || editMode.value) return;
    drawing.value = true;
    const { viewer } = props;
    cleanupEntities();

    // 创建临时围栏（开放的折线）
    tempPolyline.value = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => [...pathPoints.value], false),
            width: 3,
            // 🚧 FENCE MOD: 使用醒目的颜色，如红色
            material: Cesium.Color.RED.withAlpha(0.8),
            clampToGround: false,
        },
    });

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 左键点击：添加围栏顶点
    handler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        // 🚧 FENCE MOD: 如果点击的是现有顶点，在编辑模式下才允许编辑，绘制模式下通常不允许
        // 这里简化处理，绘制模式下点击顶点无反应。
        if (pickedObject && pickedObject.id && pathPointEntities.value.includes(pickedObject.id)) {
            if (editMode.value) {
                const entity = pickedObject.id;
                const idx = pathPointEntities.value.indexOf(entity);
                // 🚧 FENCE MOD: 不再弹出高度编辑框，可以改为弹出“确认删除”或忽略
                // 这里选择忽略，保持绘制流畅。
                // showHeightEditDialog(entity, idx, click.position);
            }
            return;
        }

        if (isDragging.value) return;
        const cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian) return;

        // 🚧 FENCE MOD: 顶点高度直接使用地面高度或一个默认值，这里使用地面高度
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        // 获取地面高度
        //const { terrainHeight } = calculateTerrainHeight(viewer, cartesian);
        const lifted = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);

        const { x, y } = click.position;
        const confirmBox = document.createElement("div");
        const msg = "添加新顶点？";
        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:200px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">添加顶点</div> <!-- 🚧 FENCE MOD: 文字修改 -->
                <div style="margin-bottom:12px;color:#555;">${msg}</div>
                <div>
                    <button id="confirm-add" style="background:#4CAF50;color:white;border:none;padding:4px 12px;margin-right:8px;border-radius:4px;cursor:pointer;font-size:12px;">确认</button>
                    <button id="cancel-add" style="background:#eee;color:#333;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">取消</button>
                </div>
            </div>
        </div>`;
        confirmBox.style.position = "absolute";
        confirmBox.style.left = `${x + 10}px`;
        confirmBox.style.top = `${y + 10}px`;
        confirmBox.style.zIndex = "10000";
        confirmBox.style.pointerEvents = "auto";
        document.body.appendChild(confirmBox);

        document.getElementById("confirm-add").onclick = () => {
            const index = pathPoints.value.length;
            pathPoints.value.push(lifted);
            const entity = createWaypointEntity(lifted, index); // 🚧 FENCE MOD: 创建顶点
            pathPointEntities.value.push(entity);
            updateAllLabels();
            // 🚧 FENCE MOD: 不再调用 updateSegmentedPolyline，因为绘制中是单条开放折线
            document.body.removeChild(confirmBox);
        };

        document.getElementById("cancel-add").onclick = () => {
            document.body.removeChild(confirmBox);
        };

        const close = () => {
            if (document.body.contains(confirmBox)) document.body.removeChild(confirmBox);
            window.removeEventListener("click", close);
            window.removeEventListener("contextmenu", close);
        };
        setTimeout(() => {
            window.addEventListener("click", close);
            window.addEventListener("contextmenu", close);
        }, 100);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 右键删除顶点
    handler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;
        const entity = pickedObject.id;
        const idx = pathPointEntities.value.indexOf(entity);
        if (idx === -1) return;

        // 🚧 FENCE MOD: 围栏至少需要3个点
        if (pathPoints.value.length <= 3) {
            alert("至少保留 3 个顶点！");
            return;
        }

        const { x, y } = click.position;
        const confirmBox = document.createElement("div");
        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:180px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">删除顶点？</div> <!-- 🚧 FENCE MOD: 文字修改 -->
                <div style="margin-bottom:12px;color:#555;">第 <strong>${idx + 1}</strong> 个点<br>删除后无法恢复</div>
                <div>
                    <button id="confirm-delete" style="background:#f44336;color:white;border:none;padding:4px 12px;margin-right:8px;border-radius:4px;cursor:pointer;font-size:12px;">删除</button>
                    <button id="cancel-delete" style="background:#eee;color:#333;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">取消</button>
                </div>
            </div>
        </div>`;
        confirmBox.style.position = "absolute";
        confirmBox.style.left = `${x + 10}px`;
        confirmBox.style.top = `${y + 10}px`;
        confirmBox.style.zIndex = "10000";
        confirmBox.style.pointerEvents = "auto";
        document.body.appendChild(confirmBox);

        document.getElementById("confirm-delete").onclick = () => {
            pathPoints.value.splice(idx, 1);
            clearRays(entity, viewer);
            viewer.entities.remove(entity);
            pathPointEntities.value.splice(idx, 1);
            updateAllLabels();
            document.body.removeChild(confirmBox);
        };

        document.getElementById("cancel-delete").onclick = () => {
            document.body.removeChild(confirmBox);
        };

        const close = () => {
            if (document.body.contains(confirmBox)) document.body.removeChild(confirmBox);
            window.removeEventListener("click", close);
            window.removeEventListener("contextmenu", close);
        };
        setTimeout(() => {
            window.addEventListener("click", close);
            window.addEventListener("contextmenu", close);
        }, 100);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // 拖拽支持 (在绘制模式下允许拖拽调整刚添加的点)
    handler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (pickedObject && pickedObject.id) {
            const entity = pickedObject.id;
            const idx = pathPointEntities.value.indexOf(entity);
            if (idx !== -1) {
                isDragging.value = true;
                draggedPointIndex.value = idx;
                if (entity.billboard) entity.billboard.scale = 0.8;
                viewer.scene.screenSpaceCameraController.enableRotate = false;
                viewer.scene.screenSpaceCameraController.enableZoom = false;
                viewer.scene.screenSpaceCameraController.enableTranslate = false;
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.value.setInputAction((movement) => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const cartesian = viewer.scene.pickPosition(movement.endPosition);
            if (cartesian) {
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const entity = pathPointEntities.value[draggedPointIndex.value];
                // 🚧 FENCE MOD: 拖拽时，保持其当前高度（即地面高度）
                const currentHeight = Cesium.Cartographic.fromCartesian(entity.position._value).height;
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, currentHeight);
                const idx = draggedPointIndex.value;
                pathPoints.value[idx] = newCartesian;
                pathPointEntities.value[idx].position = newCartesian;
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.value.setInputAction((click) => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const originalPointIndex = draggedPointIndex.value;
            const position = pathPoints.value[draggedPointIndex.value]
            const entity = pathPointEntities.value[draggedPointIndex.value];
            if (entity && entity.billboard) entity.billboard.scale = 0.5;
            isDragging.value = false;
            draggedPointIndex.value = -1;
            viewer.scene.screenSpaceCameraController.enableRotate = true;
            viewer.scene.screenSpaceCameraController.enableZoom = true;
            viewer.scene.screenSpaceCameraController.enableTranslate = true;

            clearRays(entity, viewer);
            const { terrainHeight, rayEntities } = calculateTerrainHeight(viewer, position);
            entity.billboard.terrainHeight = terrainHeight;
            entity.rayEntities = rayEntities;

            updateEntityLabel(entity, originalPointIndex);
            updateProfileChart();
            // 🚧 FENCE MOD: 绘制模式下，拖拽结束不更新线段，因为是单条折线
            console.log(`📍 围栏顶点 ${originalPointIndex + 1} 位置高度: ${terrainHeight.toFixed(2)} 米`);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 双击结束绘制
    handler.value.setInputAction(() => {
        if (pathPoints.value.length >= 3) { // 🚧 FENCE MOD: 至少3个点
            finishDrawing([...pathPoints.value]);
        } else {
            alert("请至少添加 3 个顶点！");
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
};

const handleFinishDrawing = () => {
    if (!drawing.value || pathPoints.value.length < 3) { // 🚧 FENCE MOD: 至少3个点
        alert("至少需要 3 个顶点才能结束绘制！");
        return;
    }
    finishDrawing([...pathPoints.value]);
};

// 🚧 FENCE MOD: finishDrawing 逻辑大改，创建闭合的 Polygon
const finishDrawing = (positions) => {
    const { viewer } = props;
    if (tempPolyline.value) {
        viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }

    // 🛡️ 校验
    positions = positions.filter(p => Cesium.defined(p) && p instanceof Cesium.Cartesian3);
    if (positions.length < 3) {
        alert("围栏至少需要 3 个有效顶点！");
        drawing.value = false;
        return;
    }

    // 闭合多边形
    const firstPos = positions[0];
    const lastPos = positions[positions.length - 1];
    if (!Cesium.Cartesian3.equals(firstPos, lastPos)) {
        positions.push(Cesium.Cartesian3.clone(firstPos));
    }

    // 🚧 创建立体电子围栏墙
    finalPolyline.value = viewer.entities.add({
        name: '电子围栏',
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: new Cesium.StripeMaterialProperty({
                orientation: Cesium.StripeOrientation.HORIZONTAL,
                evenColor: Cesium.Color.RED.withAlpha(0.1),
                oddColor: Cesium.Color.YELLOW.withAlpha(0.2),
                repeat: 5.0,
            }),
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
            outlineWidth: 3,
            height: 0,
            extrudedHeight: 3.0,  // 墙体高度 3 米
            perPositionHeight: true,
        }
    });

    // 💡 生成顶部位置（保证和墙体顶一致）
    const topPositions = positions.map(pos => {
        const carto = Cesium.Cartographic.fromCartesian(pos);
        const h = isFinite(carto.height) ? carto.height : 0;
        return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, h + 3.0);
    });

    // 💡 创建顶部脉冲发光线 —— 用 CallbackProperty 实现动态 glow
    const pulseLine = viewer.entities.add({
        polyline: {
            positions: topPositions,
            width: 10,
            material: new Cesium.PolylineGlowMaterialProperty({
                color: Cesium.Color.YELLOW,
                glowPower: new Cesium.CallbackProperty(() => {
                    // 时间驱动发光强度
                    const t = Date.now() * 0.3;
                    return 0.18 + 0.05 * Math.sin(t);
                }, false),
                taperPower: 0.5,
            }),
        },
    });

    // ✅ 不需要手动 tickListener 了
    handler.value?.destroy();
    handler.value = null;
    drawing.value = false;
};


// 🚧 FENCE MOD: updateSegmentedPolyline 对于已闭合的围栏不再需要，因为是一个整体 Polygon
// 但在编辑模式下，为了方便拖拽和删除，我们可能需要将其分解为顶点和线段。
// 这里简化处理，在编辑模式激活时，销毁 Polygon，恢复为顶点和开放折线。
// function updateSegmentedPolyline() { ... }

const toggleEditMode = () => {
    if (pathPoints.value.length === 0) return;
    editMode.value = !editMode.value;
    if (editMode.value) {
        if (drawing.value) finishDrawing([...pathPoints.value]);
        if (handler.value) {
            handler.value.destroy();
            handler.value = null;
        }
        startEditMode();
    } else {
        exitEditMode();
    }
};

// ... clearRays, distanceToLineSegment, closestPointOnSegment, distance2D, closestPoint2D 函数保持不变 ...

const startEditMode = () => {
    const { viewer } = props;
    if (handler.value) {
        handler.value.destroy();
        handler.value = null;
    }

    // 🚧 FENCE MOD: 进入编辑模式，销毁 Polygon，恢复显示顶点和临时折线
    if (finalPolyline.value) {
        viewer.entities.remove(finalPolyline.value);
        finalPolyline.value = null;
    }

    // 创建临时折线用于编辑
    tempPolyline.value = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => {
                // 🚧 FENCE MOD: 在编辑模式下，折线不自动闭合，方便编辑
                return [...pathPoints.value];
            }, false),
            width: 3,
            material: Cesium.Color.YELLOW.withAlpha(0.8), // 编辑时用黄色
            clampToGround: false,
        },
    });

    pathPointEntities.value.forEach((entity) => {
        if (entity.billboard) {
            entity.billboard.image = EDIT_ICON;
            entity.billboard.scale = 0.5;
        }
    });

    // ... 拖拽、右键删除、左键添加的逻辑基本与 startDrawing 中的相同 ...
    // 唯一区别是，左键点击现有顶点时，我们不做任何事（或可以弹出一个简单的“选中”提示）
    // 这里省略重复代码，实际项目中可以将公共逻辑提取为函数。

    editHandler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 拖拽开始
    editHandler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (pickedObject && pickedObject.id) {
            const entity = pickedObject.id;
            const idx = pathPointEntities.value.indexOf(entity);
            if (idx !== -1) {
                isDragging.value = true;
                draggedPointIndex.value = idx;
                if (entity.billboard) entity.billboard.scale = 0.8;
                viewer.scene.screenSpaceCameraController.enableRotate = false;
                viewer.scene.screenSpaceCameraController.enableZoom = false;
                viewer.scene.screenSpaceCameraController.enableTranslate = false;
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    // 拖拽中
    editHandler.value.setInputAction((movement) => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const cartesian = viewer.scene.pickPosition(movement.endPosition);
            if (cartesian) {
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const entity = pathPointEntities.value[draggedPointIndex.value];
                const currentHeight = Cesium.Cartographic.fromCartesian(entity.position._value).height;
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, currentHeight);
                const idx = draggedPointIndex.value;
                pathPoints.value[idx] = newCartesian;
                pathPointEntities.value[idx].position = newCartesian;
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 拖拽结束
    editHandler.value.setInputAction((click) => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const originalPointIndex = draggedPointIndex.value;
            const position = pathPoints.value[draggedPointIndex.value]
            const entity = pathPointEntities.value[draggedPointIndex.value];
            if (entity && entity.billboard) entity.billboard.scale = 0.5;
            isDragging.value = false;
            draggedPointIndex.value = -1;
            viewer.scene.screenSpaceCameraController.enableRotate = true;
            viewer.scene.screenSpaceCameraController.enableZoom = true;
            viewer.scene.screenSpaceCameraController.enableTranslate = true;

            clearRays(entity, viewer);
            const { terrainHeight, rayEntities } = calculateTerrainHeight(viewer, position);
            entity.billboard.terrainHeight = terrainHeight;
            entity.rayEntities = rayEntities;

            updateEntityLabel(entity, originalPointIndex);
            updateProfileChart();
            // 🚧 FENCE MOD: 编辑模式下，拖拽结束更新临时折线
            console.log(`📍 围栏顶点 ${originalPointIndex + 1} 位置高度: ${terrainHeight.toFixed(2)} 米`);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 右键删除确认
    editHandler.value.setInputAction((click) => {
        if (isDragging.value) return;
        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;
        const entity = pickedObject.id;
        const idx = pathPointEntities.value.indexOf(entity);
        if (idx === -1) return;

        if (pathPoints.value.length <= 3) {
            alert("至少保留 3 个顶点！");
            return;
        }

        const { x, y } = click.position;
        const confirmBox = document.createElement("div");
        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:180px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">删除顶点？</div>
                <div style="margin-bottom:12px;color:#555;">第 <strong>${idx + 1}</strong> 个点<br>删除后无法恢复</div>
                <div>
                    <button id="confirm-delete" style="background:#f44336;color:white;border:none;padding:4px 12px;margin-right:8px;border-radius:4px;cursor:pointer;font-size:12px;">删除</button>
                    <button id="cancel-delete" style="background:#eee;color:#333;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">取消</button>
                </div>
            </div>
        </div>`;
        confirmBox.style.position = "absolute";
        confirmBox.style.left = `${x + 10}px`;
        confirmBox.style.top = `${y + 10}px`;
        confirmBox.style.zIndex = "10000";
        confirmBox.style.pointerEvents = "auto";
        document.body.appendChild(confirmBox);

        document.getElementById("confirm-delete").onclick = () => {
            pathPoints.value.splice(idx, 1);
            clearRays(entity, viewer);
            viewer.entities.remove(entity);
            pathPointEntities.value.splice(idx, 1);
            updateAllLabels();
            document.body.removeChild(confirmBox);
        };

        document.getElementById("cancel-delete").onclick = () => {
            document.body.removeChild(confirmBox);
        };

        const close = () => {
            if (document.body.contains(confirmBox)) document.body.removeChild(confirmBox);
            window.removeEventListener("click", close);
            window.removeEventListener("contextmenu", close);
        };
        setTimeout(() => {
            window.addEventListener("click", close);
            window.addEventListener("contextmenu", close);
        }, 100);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // 左键添加确认
    editHandler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        // 🚧 FENCE MOD: 点击顶点，在编辑模式下可以考虑高亮或忽略，这里忽略
        if (pickedObject && pickedObject.id && pathPointEntities.value.includes(pickedObject.id)) {
            return;
        }

        if (isDragging.value) return;
        const { x, y } = click.position;
        const cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian || pathPoints.value.length < 1) return;

        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const { terrainHeight } = calculateTerrainHeight(viewer, cartesian);
        const lifted = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, terrainHeight + 100);

        let minDist = Number.MAX_VALUE, insertIdx = -1, insertPos = null;
        if (pathPoints.value.length >= 2) {
            for (let i = 0; i < pathPoints.value.length - 1; i++) {
                const d = distanceToLineSegment(lifted, pathPoints.value[i], pathPoints.value[i + 1]);
                if (d < minDist) {
                    minDist = d;
                    insertIdx = i + 1;
                    insertPos = closestPointOnSegment(lifted, pathPoints.value[i], pathPoints.value[i + 1]);
                }
            }
        }

        const action = minDist < 100 ? "insert" : "append";
        const confirmBox = document.createElement("div");
        const msg = action === "insert" ? `在第 ${insertIdx + 1} 个点前插入？` : "在末尾追加新顶点？";
        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:200px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">添加顶点</div>
                <div style="margin-bottom:12px;color:#555;">${msg}</div>
                <div>
                    <button id="confirm-add" style="background:#4CAF50;color:white;border:none;padding:4px 12px;margin-right:8px;border-radius:4px;cursor:pointer;font-size:12px;">确认</button>
                    <button id="cancel-add" style="background:#eee;color:#333;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">取消</button>
                </div>
            </div>
        </div>`;
        confirmBox.style.position = "absolute";
        confirmBox.style.left = `${x + 10}px`;
        confirmBox.style.top = `${y + 10}px`;
        confirmBox.style.zIndex = "10000";
        confirmBox.style.pointerEvents = "auto";
        document.body.appendChild(confirmBox);

        document.getElementById("confirm-add").onclick = () => {
            if (action === "insert") {
                pathPoints.value.splice(insertIdx, 0, insertPos);
                const entity = createWaypointEntity(insertPos, insertIdx);
                pathPointEntities.value.splice(insertIdx, 0, entity);
            } else {
                pathPoints.value.push(lifted);
                const entity = createWaypointEntity(lifted, pathPoints.value.length - 1);
                pathPointEntities.value.push(entity);
            }
            updateAllLabels();
            // 🚧 FENCE MOD: 编辑模式下，添加点后更新临时折线
            document.body.removeChild(confirmBox);
        };

        document.getElementById("cancel-add").onclick = () => {
            document.body.removeChild(confirmBox);
        };

        const close = () => {
            if (document.body.contains(confirmBox)) document.body.removeChild(confirmBox);
            window.removeEventListener("click", close);
            window.removeEventListener("contextmenu", close);
        };
        setTimeout(() => {
            window.addEventListener("click", close);
            window.addEventListener("contextmenu", close);
        }, 100);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
};

const exitEditMode = () => {
    pathPointEntities.value.forEach((entity) => {
        if (entity.billboard) {
            entity.billboard.image = NORMAL_ICON;
            entity.billboard.scale = 0.5;
        }
    });

    // 🚧 FENCE MOD: 退出编辑模式，销毁临时折线和编辑处理器，重新创建闭合的 Polygon
    if (tempPolyline.value) {
        props.viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }

    if (editHandler.value) {
        editHandler.value.destroy();
        editHandler.value = null;
    }

    isDragging.value = false;
    draggedPointIndex.value = -1;
    props.viewer.scene.screenSpaceCameraController.enableRotate = true;
    props.viewer.scene.screenSpaceCameraController.enableZoom = true;
    props.viewer.scene.screenSpaceCameraController.enableTranslate = true;

    // 重新创建闭合的围栏
    if (pathPoints.value.length >= 3) {
        finishDrawing([...pathPoints.value]);
    }
};

// ... cleanupEntities, cleanupEntityClickHandlers 函数保持不变 ...

// 🚧 FENCE MOD: 保存围栏信息
const savePath = () => {
    if (pathPointEntities.value.length === 0) {
        alert("没有可保存的围栏！");
        return;
    }

    // 🚧 FENCE MOD: 保存围栏顶点
    const vertices = pathPointEntities.value.map((entity, index) => {
        const position = entity.position.getValue(Cesium.JulianDate.now());
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        return {
            sequence: index + 1,
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            // 🚧 FENCE MOD: 保存地面高度，或可以保存一个统一的围栏高度
            terrainHeight: entity.billboard.terrainHeight || 0,
        };
    });

    // 🚧 FENCE MOD: 可以额外计算并保存围栏的面积和周长
    let area = 0;
    let perimeter = 0;
    if (vertices.length >= 3) {
        const cartographicArray = vertices.map(v =>
            Cesium.Cartographic.fromDegrees(v.longitude, v.latitude, v.terrainHeight)
        );
        // 使用 Cesium 计算面积和周长 (近似)
        const polygon = new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromRadiansArray(cartographicArray))
        });
        const geometry = Cesium.PolygonGeometry.createGeometry(polygon);
        if (geometry) {
            area = geometry._area; // 注意：这是近似值，单位是平方米
            // 周长计算较复杂，需要遍历每条边
            for (let i = 0; i < cartographicArray.length; i++) {
                const start = cartographicArray[i];
                const end = cartographicArray[(i + 1) % cartographicArray.length];
                const distance = Cesium.Cartesian3.distance(
                    Cesium.Cartesian3.fromRadians(start.longitude, start.latitude, start.height),
                    Cesium.Cartesian3.fromRadians(end.longitude, end.latitude, end.height)
                );
                perimeter += distance;
            }
        }
    }

    const fenceData = {
        vertices: vertices,
        area: area.toFixed(2), // 平方米
        perimeter: perimeter.toFixed(2), // 米
        vertexCount: vertices.length
    };

    console.log("📋 保存的电子围栏信息:", fenceData);
    console.group("📋 电子围栏详情");
    console.log(`顶点数量: ${fenceData.vertexCount}`);
    console.log(`围栏面积: ${fenceData.area} 平方米`);
    console.log(`围栏周长: ${fenceData.perimeter} 米`);
    fenceData.vertices.forEach(v => {
        console.log(`顶点 ${v.sequence}: 经度: ${v.longitude.toFixed(6)}°, 纬度: ${v.latitude.toFixed(6)}°, 地面高度: ${v.terrainHeight.toFixed(2)} m`);
    });
    console.groupEnd();

    alert(`电子围栏保存成功！
顶点数: ${fenceData.vertexCount}
面积: ${fenceData.area} 平方米
周长: ${fenceData.perimeter} 米
详细信息已输出到控制台。`);
};

// ... clearAll, onMounted, onUnmounted, defineExpose 保持不变 ...

const cleanupEntities = () => {
    const { viewer } = props;
};
</script>

<style scoped>
/* 🚧 FENCE MOD: 更新类名 */
.control-group.fence-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(0, 0, 0, 0.6);
    padding: 12px;
    border-radius: 8px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
    color: white;
    font-family: 'Microsoft YaHei', sans-serif;
    max-width: 300px;
    margin: 16px;
}

.fence-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-evenly;
}

/* 🚧 FENCE MOD: 按钮颜色可以调整为更警示的颜色，如红色系 */
.fence-group button {
    margin: 2px 0;
    padding: 8px 12px;
    background: #e53935;
    /* 深红色 */
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.3s;
}

.fence-group button:hover {
    background: #c62828;
    /* 更深的红色 */
}

.fence-group button:disabled {
    background: #cccccc;
    cursor: not-allowed;
}

.fence-info {
    white-space: nowrap;
    color: white;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    text-align: center;
}

.edit-hint {
    font-size: 12px;
    color: #ffeb3b;
    font-style: italic;
}

.profile-chart-container {
    width: 100%;
    margin-top: 16px;
    border-top: 1px dashed #555;
    padding-top: 16px;
    display: flex;
    justify-content: center;
}

.profile-chart-container canvas {
    pointer-events: none;
}
</style>