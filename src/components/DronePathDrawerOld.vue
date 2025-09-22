<!-- DronePathDrawer.vue -->
<template>
    <div class="control-group drone-group">
        <button @click="startDrawing">{{ drawing ? '航线绘制中' : '开始绘制航线' }}</button>
        <!-- 新增：结束绘制按钮 -->
        <button @click="handleFinishDrawing" :disabled="!drawing">
            结束绘制
        </button>
        <button @click="toggleEditMode" :disabled="!pathPoints.length">{{ editMode ? '退出编辑' : '编辑航线' }}</button>
        <button @click="clearAll">清除所有</button>
        <div class="drone-info" :style="{ visibility: pathPoints.length ? 'visible' : 'hidden' }">
            <span>航线点数：{{ pathPoints.length || 0 }}</span>
            <span v-if="editMode" class="edit-hint">拖动图标编辑航线 | 中键编辑高度</span>
        </div>

        <!-- 剖面图容器 -->
        <div class="profile-chart-container">
            <div ref="chartContainer"
                style="width: 100%; height: 300px; border: 1px solid #444; border-radius: 6px; background: #1e1e1e;">
            </div>
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
const finalPolyline = shallowRef(null);
const pathPoints = ref([]);
const droneEntity = shallowRef(null);
const pathPointEntities = ref([]);
const isDragging = ref(false);
const draggedPointIndex = ref(-1);

// 自定义图标路径
const NORMAL_ICON = "/icons/marker_blue.png";
const EDIT_ICON = "/icons/marker_blue.png";

const LINE_HEIGHT_DEFAULT = 100;
const POINT_LINE_DISTANCE = 50;

// --- 新增：ECharts 图表实例 ---
const chartContainer = ref(null);
let chartInstance = null;

// 创建航点（含编号 label）
function createWaypointEntity(position, index, flightHeight = LINE_HEIGHT_DEFAULT) {
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
            terrainHeight: 0,
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
            // 👇 关键：优化缩放行为
            scaleByDistance: new Cesium.NearFarScalar(1000, 1.0, 10000, 0.5), // 平滑缩放
            translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.7),
            // 👉 新增：避免小尺寸下模糊
            showBackground: false,
            backgroundColor: new Cesium.Color(0.16, 0.16, 0.16, 0.4),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            show: true,
        },
    });

    const { terrainHeight, rayEntities } = calculateTerrainHeight(viewer, position);
    entity.billboard.terrainHeight = terrainHeight;
    entity.flightHeight = flightHeight; // 保存飞行高度
    entity.rayEntities = rayEntities;

    // 更新 label 显示高度信息
    updateEntityLabel(entity, index);

    console.log(`📍 航点 ${index + 1} 位置高度: ${terrainHeight.toFixed(2)} 米，飞行高度: ${flightHeight.toFixed(2)} 米`);
    return entity;
}

// 新增：更新实体标签显示高度信息
function updateEntityLabel(entity, index) {
    const flightHeight = entity.flightHeight || LINE_HEIGHT_DEFAULT;
    const terrainHeight = entity.billboard.terrainHeight || 0;
    const relativeHeight = flightHeight - terrainHeight;

    const labelText = `序号:${index + 1}\n相对高度:${relativeHeight.toFixed(0)}m\n飞行高度:${flightHeight.toFixed(0)}m`;
    entity.label.text = labelText;
}

// 更新所有航点编号和高度信息
function updateAllLabels() {
    pathPointEntities.value.forEach((entity, index) => {
        updateEntityLabel(entity, index);
    });
    // 更新剖面图
    updateProfileChart();
}

// 新增：显示高度编辑对话框
function showHeightEditDialog(entity, index, clickPosition) {
    const { x, y } = clickPosition;
    const currentHeight = entity.flightHeight || LINE_HEIGHT_DEFAULT;
    const terrainHeight = entity.billboard.terrainHeight || 0;
    const relativeHeight = currentHeight - terrainHeight;

    const heightDialog = document.createElement("div");
    heightDialog.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,0.3);font-size:13px;color:#333;width:280px;padding:0;">
            <div style="background:#4CAF50;color:white;padding:12px;border-radius:8px 8px 0 0;font-weight:bold;text-align:center;">
                编辑航点 ${index + 1} 高度
            </div>
            <div style="padding:16px;">
                <div style="margin-bottom:12px;">
                    <div style="margin-bottom:4px;font-weight:bold;color:#555;">地面高度：${terrainHeight.toFixed(1)} 米</div>
                    <div style="margin-bottom:8px;color:#666;font-size:12px;">当前相对高度：${relativeHeight.toFixed(1)} 米</div>
                </div>
                
                <div style="margin-bottom:16px;">
                    <label style="display:block;margin-bottom:6px;font-weight:bold;color:#555;">飞行高度 (米)：</label>
                    <input type="number" id="flight-height-input" value="${currentHeight.toFixed(1)}" 
                           min="${terrainHeight + 5}" max="${terrainHeight + 500}" step="0.1"
                           style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">
                    <div style="font-size:11px;color:#888;margin-top:4px;">
                        范围：${(terrainHeight + 5).toFixed(1)} - ${(terrainHeight + 500).toFixed(1)} 米
                    </div>
                </div>
                
                <div style="margin-bottom:16px;">
                    <label style="display:block;margin-bottom:6px;font-weight:bold;color:#555;">相对地面高度 (米)：</label>
                    <input type="number" id="relative-height-input" value="${relativeHeight.toFixed(1)}" 
                           min="5" max="500" step="0.1"
                           style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">
                    <div style="font-size:11px;color:#888;margin-top:4px;">
                        范围：5 - 500 米
                    </div>
                </div>
                
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button id="cancel-height" style="background:#eee;color:#333;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">取消</button>
                    <button id="confirm-height" style="background:#4CAF50;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">确认</button>
                </div>
            </div>
        </div>`;

    heightDialog.style.position = "absolute";
    heightDialog.style.left = `${Math.min(x + 10, window.innerWidth - 300)}px`;
    heightDialog.style.top = `${Math.min(y + 10, window.innerHeight - 350)}px`;
    heightDialog.style.zIndex = "10000";
    heightDialog.style.pointerEvents = "auto";
    document.body.appendChild(heightDialog);

    const flightHeightInput = document.getElementById("flight-height-input");
    const relativeHeightInput = document.getElementById("relative-height-input");

    // 飞行高度输入联动相对高度
    flightHeightInput.addEventListener('input', (e) => {
        const flightHeight = parseFloat(e.target.value) || terrainHeight + 5;
        const newRelativeHeight = flightHeight - terrainHeight;
        relativeHeightInput.value = newRelativeHeight.toFixed(1);
    });

    // 相对高度输入联动飞行高度
    relativeHeightInput.addEventListener('input', (e) => {
        const relativeHeight = parseFloat(e.target.value) || 5;
        const newFlightHeight = terrainHeight + relativeHeight;
        flightHeightInput.value = newFlightHeight.toFixed(1);
    });

    // 确认按钮
    document.getElementById("confirm-height").onclick = () => {
        const newFlightHeight = parseFloat(flightHeightInput.value);
        const minHeight = 5;
        const maxHeight = 500;

        if (isNaN(newFlightHeight) || newFlightHeight < minHeight || newFlightHeight > maxHeight) {
            alert(`请输入有效的高度值 (${minHeight.toFixed(1)} - ${maxHeight.toFixed(1)} 米)`);
            return;
        }

        // 更新航点位置和高度
        const cartographic = Cesium.Cartographic.fromCartesian(entity.position._value);
        const newPosition = Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            newFlightHeight
        );

        // 更新数据
        pathPoints.value[index] = newPosition;
        entity.position = newPosition;
        entity.flightHeight = newFlightHeight;

        const { viewer } = props;
        //移出原有的射线
        clearRays(entity, viewer);

        const { terrainHeight, rayEntities } = calculateTerrainHeight(viewer, newPosition);
        entity.billboard.terrainHeight = terrainHeight;
        entity.rayEntities = rayEntities;

        // 更新标签
        updateEntityLabel(entity, index);

        // 更新图表
        updateProfileChart();

        console.log(`✏️ 航点 ${index + 1} 高度已更新：${newFlightHeight.toFixed(2)} 米 (相对地面 ${(newFlightHeight - terrainHeight).toFixed(2)} 米)`);

        document.body.removeChild(heightDialog);
    };

    // 取消按钮
    document.getElementById("cancel-height").onclick = () => {
        document.body.removeChild(heightDialog);
    };

    // 点击外部关闭
    const closeDialog = (e) => {
        if (!heightDialog.contains(e.target)) {
            if (document.body.contains(heightDialog)) {
                document.body.removeChild(heightDialog);
            }
            document.removeEventListener("click", closeDialog);
        }
    };

    setTimeout(() => {
        document.addEventListener("click", closeDialog);
        flightHeightInput.select(); // 自动选中文本便于编辑
    }, 100);
}

// --- 初始化 ECharts 图表 ---
const initChart = () => {
    nextTick(() => {
        if (chartContainer.value) {
            chartInstance = echarts.init(chartContainer.value);
            updateProfileChart(); // 初始空图
        }
    });
};

// --- 更新剖面图 ---
const updateProfileChart = () => {
    if (!chartInstance) return;

    // 提取航点的序号、地面高度和飞行高度
    const terrainData = pathPointEntities.value.map((entity, index) => {
        const terrainHeight = entity.billboard.terrainHeight || 0;
        return [index + 1, terrainHeight];
    });

    const flightData = pathPointEntities.value.map((entity, index) => {
        const flightHeight = entity.flightHeight || LINE_HEIGHT_DEFAULT;
        return [index + 1, flightHeight];
    });

    const maxHeight = Math.max(
        ...flightData.map(d => d[1]),
        ...terrainData.map(d => d[1]),
        100
    );

    const option = {
        title: {
            text: '航线高度剖面',
            left: 'center',
            textStyle: { color: '#eee', fontSize: 16 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: (params) => {
                let result = `航点 ${params[0].value[0]}<br/>`;
                params.forEach(p => {
                    if (p.seriesName === '地面高度') {
                        result += `地面高度: ${p.value[1].toFixed(2)} m<br/>`;
                    } else if (p.seriesName === '飞行高度') {
                        const terrainHeight = terrainData.find(d => d[0] === p.value[0])?.[1] || 0;
                        const relativeHeight = p.value[1] - terrainHeight;
                        result += `飞行高度: ${p.value[1].toFixed(2)} m<br/>`;
                        result += `相对高度: ${relativeHeight.toFixed(2)} m`;
                    }
                });
                return result;
            }
        },
        legend: {
            data: ['地面高度', '飞行高度'],
            top: 30,
            textStyle: { color: '#ccc' }
        },
        xAxis: {
            type: 'value',
            name: '航线点序号',
            nameLocation: 'middle',
            nameGap: 30,
            min: 1,
            max: Math.max(flightData.length, 1),
            axisLine: { lineStyle: { color: '#aaa' } },
            axisLabel: { color: '#ccc' },
            splitLine: { show: true, lineStyle: { color: '#333', type: 'dashed' } }
        },
        yAxis: {
            type: 'value',
            name: '高度 (m)',
            nameLocation: 'middle',
            nameGap: 50,
            min: 0,
            max: maxHeight * 1.1,
            axisLine: { lineStyle: { color: '#aaa' } },
            axisLabel: { color: '#ccc' },
            splitLine: { lineStyle: { color: '#333' } }
        },
        series: [
            {
                name: '地面高度',
                type: 'line',
                data: terrainData,
                smooth: true,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: {
                    width: 2,
                    color: '#8B4513'
                },
                itemStyle: {
                    color: '#A0522D'
                },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(139, 69, 19, 0.3)' },
                        { offset: 1, color: 'rgba(139, 69, 19, 0.1)' }
                    ])
                }
            },
            {
                name: '飞行高度',
                type: 'line',
                data: flightData,
                smooth: true,
                symbol: 'circle',
                symbolSize: 6,
                lineStyle: {
                    width: 3,
                    color: '#4CAF50'
                },
                itemStyle: {
                    color: '#43A047'
                }
            }
        ],
        grid: { right: 60, left: 60, bottom: 60, top: 80 },
        backgroundColor: 'transparent'
    };

    chartInstance.setOption(option, true);
};

const startDrawing = () => {
    if (drawing.value || editMode.value) return;
    drawing.value = true;
    const { viewer } = props;

    // 清理上一次残留
    cleanupEntities();

    // 创建临时航线
    tempPolyline.value = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => [...pathPoints.value], false),
            width: 3,
            material: Cesium.Color.BLUE.withAlpha(0.6),
            clampToGround: false,
        },
    });

    // 初始化事件处理器
    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 左键点击：尝试添加航点（插入或追加）
    handler.value.setInputAction((click) => {
        if (isDragging.value) return; // 防止拖拽冲突

        const cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian) return;

        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const lifted = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, LINE_HEIGHT_DEFAULT);

        let minDist = Number.MAX_VALUE;
        let insertIdx = -1;
        let insertPos = null;
        let action = "";

        // 如果已有多个点，判断是否靠近某条线段
        if (pathPoints.value.length >= 2) {
            for (let i = 0; i < pathPoints.value.length - 1; i++) {
                const d = distanceToLineSegment(lifted, pathPoints.value[i], pathPoints.value[i + 1]);
                console.log("[Distance]", d);
                if (d < minDist && d < POINT_LINE_DISTANCE) { // 距离阈值 50 米内才允许插入
                    minDist = d;
                    insertIdx = i + 1;
                    insertPos = closestPointOnSegment(lifted, pathPoints.value[i], pathPoints.value[i + 1]);
                }
            }
        }

        action = insertIdx !== -1 ? "insert" : "append";
        const { x, y } = click.position;

        const confirmBox = document.createElement("div");

        const msg = action === "insert"
            ? `在第 ${insertIdx + 1} 个点前插入航点？`
            : "添加新航点？";

        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:200px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">添加航点</div>
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
            const finalPos = action === "insert" ? insertPos : lifted;
            const index = action === "insert" ? insertIdx : pathPoints.value.length;

            pathPoints.value.splice(index, 0, finalPos);
            const entity = createWaypointEntity(finalPos, index);
            pathPointEntities.value.splice(index, 0, entity);

            updateAllLabels(); // 更新编号
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

    // 右键删除航点
    handler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;
        const entity = pickedObject.id;
        const idx = pathPointEntities.value.indexOf(entity);

        if (idx === -1) {
            return;
        }
        if (pathPoints.value.length <= 2) {
            alert("至少保留 2 个航点！");
            return;
        }

        const { x, y } = click.position;
        const confirmBox = document.createElement("div");
        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:180px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">删除航点？</div>
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

    // 拖拽支持
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
                const currentHeight = entity.flightHeight || LINE_HEIGHT_DEFAULT;
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, currentHeight);
                const idx = draggedPointIndex.value;
                pathPoints.value[idx] = newCartesian;
                pathPointEntities.value[idx].position = newCartesian;
                if (idx === 0 && droneEntity.value) droneEntity.value.position = newCartesian;
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

            //移出原有的射线
            clearRays(entity, viewer);

            const { terrainHeight, rayEntities } = calculateTerrainHeight(viewer, position);
            entity.billboard.terrainHeight = terrainHeight;
            entity.rayEntities = rayEntities;

            // 更新标签显示
            updateEntityLabel(entity, originalPointIndex);

            // 手动更新图表
            updateProfileChart();

            console.log(`📍 航点 ${originalPointIndex + 1} 位置高度: ${terrainHeight.toFixed(2)} 米`);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 双击结束绘制
    handler.value.setInputAction(() => {
        if (pathPoints.value.length >= 2) {
            finishDrawing([...pathPoints.value]);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // 中键点击：编辑高度
    handler.value.setInputAction((click) => {

        if (isDragging.value) return;
        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;

        const entity = pickedObject.id;
        const idx = pathPointEntities.value.indexOf(entity);

        if (idx !== -1) {
            showHeightEditDialog(entity, idx, click.position);
        }
    }, Cesium.ScreenSpaceEventType.MIDDLE_CLICK);
};

const handleFinishDrawing = () => {
    if (!drawing.value || pathPoints.value.length < 2) {
        alert("至少需要 2 个航点才能结束绘制！");
        return;
    }
    finishDrawing([...pathPoints.value]); // 调用原有的 finishDrawing 逻辑
};

const finishDrawing = (positions) => {
    const { viewer } = props;
    if (tempPolyline.value) {
        viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }

    finalPolyline.value = viewer.entities.add({
        name: "无人机航线",
        polyline: {
            positions: new Cesium.CallbackProperty(() => [...pathPoints.value], false),
            width: 3,
            material: Cesium.Color.BLUE.withAlpha(0.8),
            clampToGround: false,
        },
    });

    handler.value?.destroy();
    handler.value = null;
    drawing.value = false;
};

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

function clearRays(entity, viewer) {
    if (entity.rayEntities) {
        entity.rayEntities.forEach(re => {
            viewer.entities.remove(re);
        });
    }
}

function distanceToLineSegment(point, segmentStart, segmentEnd) {
    // 提取经纬度（忽略高度），转为 Cartographic
    const cartoPoint = Cesium.Cartographic.fromCartesian(point);
    const cartoStart = Cesium.Cartographic.fromCartesian(segmentStart);
    const cartoEnd = Cesium.Cartographic.fromCartesian(segmentEnd);

    // 转换为笛卡尔坐标，但统一高度为 0（仅保留经度、纬度）
    const p = Cesium.Cartesian3.fromRadians(cartoPoint.longitude, cartoPoint.latitude, 0);
    const a = Cesium.Cartesian3.fromRadians(cartoStart.longitude, cartoStart.latitude, 0);
    const b = Cesium.Cartesian3.fromRadians(cartoEnd.longitude, cartoEnd.latitude, 0);

    return distance2D(p, a, b);
}

function closestPointOnSegment(point, segmentStart, segmentEnd) {
    const cartoPoint = Cesium.Cartographic.fromCartesian(point);
    const cartoStart = Cesium.Cartographic.fromCartesian(segmentStart);
    const cartoEnd = Cesium.Cartographic.fromCartesian(segmentEnd);

    const p = Cesium.Cartesian3.fromRadians(cartoPoint.longitude, cartoPoint.latitude, 0);
    const a = Cesium.Cartesian3.fromRadians(cartoStart.longitude, cartoStart.latitude, 0);
    const b = Cesium.Cartesian3.fromRadians(cartoEnd.longitude, cartoEnd.latitude, 0);

    const closest2D = closestPoint2D(p, a, b);

    // 返回时恢复原始高度？或统一为 100（根据你的需求）
    const cartoClosest = Cesium.Cartographic.fromCartesian(closest2D);
    return Cesium.Cartesian3.fromRadians(cartoClosest.longitude, cartoClosest.latitude, LINE_HEIGHT_DEFAULT); // 保持飞行高度
}

function distance2D(point, segmentStart, segmentEnd) {
    const direction = Cesium.Cartesian3.subtract(segmentEnd, segmentStart, new Cesium.Cartesian3());
    const length = Cesium.Cartesian3.magnitude(direction);
    if (length === 0) return Cesium.Cartesian3.distance(point, segmentStart);

    const normalizedDirection = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
    const toPoint = Cesium.Cartesian3.subtract(point, segmentStart, new Cesium.Cartesian3());
    const projection = Cesium.Cartesian3.dot(toPoint, normalizedDirection);
    const clampedProjection = Cesium.Math.clamp(projection, 0.0, length);

    const closest = Cesium.Cartesian3.add(
        segmentStart,
        Cesium.Cartesian3.multiplyByScalar(normalizedDirection, clampedProjection, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
    );

    return Cesium.Cartesian3.distance(closest, point);
}

function closestPoint2D(point, segmentStart, segmentEnd) {
    const direction = Cesium.Cartesian3.subtract(segmentEnd, segmentStart, new Cesium.Cartesian3());
    const length = Cesium.Cartesian3.magnitude(direction);
    if (length === 0) return Cesium.Cartesian3.clone(segmentStart);

    const normalizedDirection = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
    const toPoint = Cesium.Cartesian3.subtract(point, segmentStart, new Cesium.Cartesian3());
    const projection = Cesium.Cartesian3.dot(toPoint, normalizedDirection);
    const clampedProjection = Cesium.Math.clamp(projection, 0.0, length);

    return Cesium.Cartesian3.add(
        segmentStart,
        Cesium.Cartesian3.multiplyByScalar(normalizedDirection, clampedProjection, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
    );
}

const startEditMode = () => {
    const { viewer } = props;

    if (handler.value) {
        handler.value.destroy();
        handler.value = null;
    }
    editHandler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    pathPointEntities.value.forEach((entity) => {
        if (entity.billboard) {
            entity.billboard.image = EDIT_ICON;
            entity.billboard.scale = 0.5;
        }
    });

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
                const currentHeight = entity.flightHeight || LINE_HEIGHT_DEFAULT;
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, currentHeight);
                const idx = draggedPointIndex.value;
                pathPoints.value[idx] = newCartesian;
                pathPointEntities.value[idx].position = newCartesian;
                if (idx === 0 && droneEntity.value) droneEntity.value.position = newCartesian;
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

            //移出原有的射线
            clearRays(entity, viewer);
            const { terrainHeight, rayEntities } = calculateTerrainHeight(viewer, position);
            entity.billboard.terrainHeight = terrainHeight;
            entity.rayEntities = rayEntities;

            // 更新标签显示
            updateEntityLabel(entity, originalPointIndex);

            console.log(`📍 航点 ${originalPointIndex + 1} 位置高度: ${terrainHeight.toFixed(2)} 米`);
            // 手动更新图表
            updateProfileChart();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 中键点击：编辑高度
    editHandler.value.setInputAction((click) => {

        if (isDragging.value) return;
        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;

        const entity = pickedObject.id;
        const idx = pathPointEntities.value.indexOf(entity);

        if (idx !== -1) {
            showHeightEditDialog(entity, idx, click.position);
        }
    }, Cesium.ScreenSpaceEventType.MIDDLE_CLICK);

    // 右键删除确认
    editHandler.value.setInputAction((click) => {
        if (isDragging.value) return;
        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;
        const entity = pickedObject.id;
        const idx = pathPointEntities.value.indexOf(entity);

        if (idx === -1) {
            return;
        }
        if (pathPoints.value.length <= 2) {
            alert("至少保留 2 个航点！");
            return;
        }

        const { x, y } = click.position;
        const confirmBox = document.createElement("div");
        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:180px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">删除航点？</div>
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
            if (idx === 0 && droneEntity.value && pathPoints.value.length > 0) {
                droneEntity.value.position = pathPoints.value[0];
            }
            updateAllLabels(); // 更新编号
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
        if (isDragging.value) return;
        const { x, y } = click.position;
        const cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian || pathPoints.value.length < 1) return;

        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        carto.height = LINE_HEIGHT_DEFAULT;
        const lifted = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, LINE_HEIGHT_DEFAULT);

        let minDist = Number.MAX_VALUE, insertIdx = -1, insertPos = null, action = "";

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

        action = minDist < 100 ? "insert" : "append";

        const confirmBox = document.createElement("div");
        const msg = action === "insert" ? `在第 ${insertIdx + 1} 个点前插入？` : "在末尾追加新航点？";

        confirmBox.innerHTML = `
        <div style="background:white;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:12px;color:#333;width:200px;text-align:center;">
            <div style="padding:12px;">
                <div style="margin-bottom:8px;font-weight:bold;">添加航点</div>
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
            updateAllLabels(); // 插入后刷新编号
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

    if (editHandler.value) {
        editHandler.value.destroy();
        editHandler.value = null;
    }

    isDragging.value = false;
    draggedPointIndex.value = -1;

    props.viewer.scene.screenSpaceCameraController.enableRotate = true;
    props.viewer.scene.screenSpaceCameraController.enableZoom = true;
    props.viewer.scene.screenSpaceCameraController.enableTranslate = true;
};

const cleanupEntities = () => {
    const { viewer } = props;
    [tempPolyline, finalPolyline, droneEntity].forEach(ref => {
        if (ref.value) {
            viewer.entities.remove(ref.value);
            ref.value = null;
        }
    });
    pathPointEntities.value.forEach(entity => {
        clearRays(entity, viewer);
        viewer.entities.remove(entity)
    });
    pathPointEntities.value = [];
    pathPoints.value = [];
};

function cleanupEntityClickHandlers() {
    pathPointEntities.value.forEach(entity => {
        if (entity._clickHandler) {
            entity._clickHandler.destroy();
            entity._clickHandler = null;
        }
    });
}

const clearAll = () => {
    if (editMode.value) {
        editMode.value = false;
        exitEditMode();
    }
    [handler, editHandler].forEach(h => {
        if (h.value) {
            h.value.destroy();
            h.value = null;
        }
    });

    cleanupEntities();
    updateAllLabels(); // 刷新编号
    drawing.value = false;
};

// --- 组件挂载后初始化图表 ---
onMounted(() => {
    initChart();
    window.addEventListener('resize', () => {
        if (chartInstance) chartInstance.resize();
    });
});

// --- 组件卸载前清理图表 ---
onUnmounted(() => {
    if (chartInstance) {
        chartInstance.dispose();
        chartInstance = null;
    }
    clearAll();
});

defineExpose({ pathPoints, droneEntity, editMode });
</script>

<style scoped>
.drone-group {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-evenly;
}

.drone-group button {
    margin: 5px 0;
    padding: 8px 12px;
    background: #ff9800;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.3s;
}

.drone-group button:hover {
    background: #f57c00;
}

.drone-group button:disabled {
    background: #cccccc;
    cursor: not-allowed;
}

.drone-info {
    white-space: nowrap;
    color: white;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.edit-hint {
    font-size: 12px;
    color: #ffeb3b;
    font-style: italic;
}

.profile-chart-container {
    width: 100%;
    margin-top: 16px;
    display: flex;
    justify-content: center;
}

.profile-chart-container canvas {
    /* 防止选中 */
    pointer-events: none;
}
</style>