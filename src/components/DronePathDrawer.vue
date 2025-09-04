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
            <span v-if="editMode" class="edit-hint">拖动图标编辑航线</span>
        </div>
    </div>
</template>

<script setup>
import { ref, shallowRef, onUnmounted } from "vue";
import * as Cesium from "cesium";

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

// 创建航点（含编号 label）
function createWaypointEntity(position, index) {
    return props.viewer.entities.add({
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
            show: true,
        },
        label: {
            text: (index + 1).toString(),
            font: "bold 20px Microsoft YaHei, sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, -25),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1000, 0.8, 10000, 0.4),
            translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.1),
            show: true,
        },
    });
}

// 更新所有航点编号
function updateAllLabels() {
    pathPointEntities.value.forEach((entity, index) => {
        if (entity.label) {
            entity.label.text = (index + 1).toString();
        }
    });
}
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
        const lifted = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);

        let minDist = Number.MAX_VALUE;
        let insertIdx = -1;
        let insertPos = null;
        let action = "";

        // 如果已有多个点，判断是否靠近某条线段
        if (pathPoints.value.length >= 2) {
            for (let i = 0; i < pathPoints.value.length - 1; i++) {
                const d = distanceToLineSegment(lifted, pathPoints.value[i], pathPoints.value[i + 1]);
                console.log("[Distance]", d);
                if (d < minDist && d < 100) { // 距离阈值 100 米内才允许插入
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
        if (idx === -1 || pathPoints.value.length <= 2) {
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
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);
                const idx = draggedPointIndex.value;
                pathPoints.value[idx] = newCartesian;
                pathPointEntities.value[idx].position = newCartesian;
                if (idx === 0 && droneEntity.value) droneEntity.value.position = newCartesian;
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.value.setInputAction(() => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const entity = pathPointEntities.value[draggedPointIndex.value];
            if (entity && entity.billboard) entity.billboard.scale = 0.5;
            isDragging.value = false;
            draggedPointIndex.value = -1;
            viewer.scene.screenSpaceCameraController.enableRotate = true;
            viewer.scene.screenSpaceCameraController.enableZoom = true;
            viewer.scene.screenSpaceCameraController.enableTranslate = true;
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 双击结束绘制
    handler.value.setInputAction(() => {
        if (pathPoints.value.length >= 2) {
            finishDrawing([...pathPoints.value]);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
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
    return Cesium.Cartesian3.fromRadians(cartoClosest.longitude, cartoClosest.latitude, 100); // 保持飞行高度
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
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);
                const idx = draggedPointIndex.value;
                pathPoints.value[idx] = newCartesian;
                pathPointEntities.value[idx].position = newCartesian;
                if (idx === 0 && droneEntity.value) droneEntity.value.position = newCartesian;
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 拖拽结束
    editHandler.value.setInputAction(() => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const entity = pathPointEntities.value[draggedPointIndex.value];
            if (entity && entity.billboard) entity.billboard.scale = 0.5;
            isDragging.value = false;
            draggedPointIndex.value = -1;
            viewer.scene.screenSpaceCameraController.enableRotate = true;
            viewer.scene.screenSpaceCameraController.enableZoom = true;
            viewer.scene.screenSpaceCameraController.enableTranslate = true;
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 右键删除确认
    editHandler.value.setInputAction((click) => {
        if (isDragging.value) return;
        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;
        const entity = pickedObject.id;
        const idx = pathPointEntities.value.indexOf(entity);
        if (idx === -1 || pathPoints.value.length <= 2) {
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
        carto.height = 100.0;
        const lifted = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);

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
    pathPointEntities.value.forEach(entity => viewer.entities.remove(entity));
    pathPointEntities.value = [];
    pathPoints.value = [];
};

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
    drawing.value = false;
};

onUnmounted(() => {
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
</style>