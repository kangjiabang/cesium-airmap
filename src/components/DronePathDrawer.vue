<!-- DronePathDrawer.vue -->
<template>
    <div class="control-group drone-group">
        <button @click="startDrawing">{{ drawing ? '航线绘制中' : '开始绘制航线' }}</button>
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

// 自定义图标路径（放在 public/icons/ 下）
const NORMAL_ICON = "/icons/marker_blue.png";
const EDIT_ICON = "/icons/marker_blue.png";

const startDrawing = () => {
    if (drawing.value || editMode.value) return;
    drawing.value = true;
    const { viewer } = props;

    // 👇 新增：清理上一次残留的航点实体
    pathPointEntities.value.forEach(entity => {
        if (entity) viewer.entities.remove(entity);
    });
    pathPointEntities.value = [];

    // 其他清理
    pathPoints.value = [];
    if (tempPolyline.value) {
        viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }
    if (finalPolyline.value) {
        viewer.entities.remove(finalPolyline.value);
        finalPolyline.value = null;
    }

    pathPoints.value = [];
    pathPointEntities.value = [];
    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 临时航线
    tempPolyline.value = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => [...pathPoints.value], false),
            width: 3,
            material: Cesium.Color.BLUE.withAlpha(0.6),
            clampToGround: false,
        },
    });

    // 单击添加航点
    handler.value.setInputAction((click) => {
        const cartesian = viewer.scene.pickPosition(click.position);
        if (cartesian) {
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);
            pathPoints.value.push(newCartesian);

            // 创建航点：billboard
            const pointEntity = viewer.entities.add({
                position: newCartesian,
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
            });
            pathPointEntities.value.push(pointEntity);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 双击结束绘制
    handler.value.setInputAction(() => {
        if (pathPoints.value.length > 1) {
            finishDrawing([...pathPoints.value]);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // 右键结束
    handler.value.setInputAction(() => {
        if (pathPoints.value.length > 1) {
            finishDrawing([...pathPoints.value]);
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

const finishDrawing = (positions) => {
    const { viewer } = props;
    if (tempPolyline.value) {
        viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }

    // 最终航线
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
        // ✅ 新增：如果还在绘制状态，先退出绘制
        if (drawing.value) {
            finishDrawing([...pathPoints.value]); // 正常结束绘制
        }

        // ✅ 新增：确保绘制 handler 被销毁
        if (handler.value) {
            handler.value.destroy();
            handler.value = null;
        }
        startEditMode();
    } else {
        exitEditMode();
    }
};

// 工具函数：计算点到线段的最短距离
function distanceToLineSegment(point, segmentStart, segmentEnd) {
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

    return Cesium.Cartesian3.distance(point, closest);
}

// 工具函数：获取点在线段上的最近点（用于插入位置）
function closestPointOnSegment(point, segmentStart, segmentEnd) {
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

    // ✅ 双重保险：防止旧 handler 存在
    if (handler.value) {
        handler.value.destroy();
        handler.value = null;
    }
    editHandler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 切换为编辑图标
    pathPointEntities.value.forEach((entity) => {
        if (entity.billboard) {
            entity.billboard.show = true;
            entity.billboard.image = EDIT_ICON;
            entity.billboard.scale = 0.5;
        }
    });

    // 鼠标按下开始拖拽
    editHandler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (pickedObject && pickedObject.id) {
            const entity = pickedObject.id;
            const entityIndex = pathPointEntities.value.indexOf(entity);
            if (entityIndex !== -1) {
                isDragging.value = true;
                draggedPointIndex.value = entityIndex;

                const billboard = entity.billboard;
                if (billboard) {
                    billboard.scale = 0.8; // 高亮
                }

                viewer.scene.screenSpaceCameraController.enableRotate = false;
                viewer.scene.screenSpaceCameraController.enableZoom = false;
                viewer.scene.screenSpaceCameraController.enableTranslate = false;
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    // 鼠标移动更新位置
    editHandler.value.setInputAction((movement) => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const cartesian = viewer.scene.pickPosition(movement.endPosition);
            if (cartesian) {
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);

                pathPoints.value[draggedPointIndex.value] = newCartesian;
                pathPointEntities.value[draggedPointIndex.value].position = newCartesian;

                if (draggedPointIndex.value === 0 && droneEntity.value) {
                    droneEntity.value.position = newCartesian;
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 鼠标释放结束拖拽
    editHandler.value.setInputAction(() => {
        if (isDragging.value && draggedPointIndex.value !== -1) {
            const entity = pathPointEntities.value[draggedPointIndex.value];
            if (entity && entity.billboard) {
                entity.billboard.scale = 0.5; // 恢复大小
            }

            isDragging.value = false;
            draggedPointIndex.value = -1;

            viewer.scene.screenSpaceCameraController.enableRotate = true;
            viewer.scene.screenSpaceCameraController.enableZoom = true;
            viewer.scene.screenSpaceCameraController.enableTranslate = true;
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);


    editHandler.value.setInputAction((click) => {
        if (isDragging.value) return;

        const pickedObject = viewer.scene.pick(click.position);
        if (!pickedObject || !pickedObject.id) return;

        const entity = pickedObject.id;
        const entityIndex = pathPointEntities.value.indexOf(entity);
        if (entityIndex === -1) return;

        if (pathPoints.value.length <= 2) {
            alert("航线至少需要 2 个航点，无法删除。");
            return;
        }

        // 获取屏幕坐标（鼠标位置）
        const { x, y } = click.position;

        // 创建确认框
        const confirmBox = document.createElement("div");
        confirmBox.innerHTML = `
        <div style="
            background: white;
            border: 1px solid #ccc;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 12px;
            color: #333;
            width: 180px;
            text-align: center;
        ">
            <div style="padding: 12px;">
                <div style="margin-bottom: 8px; font-weight: bold;">删除航点？</div>
                <div style="margin-bottom: 12px; color: #555; line-height: 1.4;">
                    第 <strong>${entityIndex + 1}</strong> 个点<br>
                    删除后无法恢复
                </div>
                <div>
                    <button id="confirm-delete" style="
                        background: #f44336;
                        color: white;
                        border: none;
                        padding: 4px 12px;
                        margin-right: 8px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                    ">删除</button>
                    <button id="cancel-delete" style="
                        background: #eee;
                        color: #333;
                        border: none;
                        padding: 4px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                    ">取消</button>
                </div>
            </div>
        </div>
    `;

        // 设置位置（相对于 viewport）
        confirmBox.style.position = "absolute";
        confirmBox.style.left = `${x + 10}px`;  // 稍微偏移，避免遮挡鼠标
        confirmBox.style.top = `${y + 10}px`;
        confirmBox.style.zIndex = "10000";
        confirmBox.style.pointerEvents = "auto"; // 允许交互

        document.body.appendChild(confirmBox);

        // 按钮事件
        document.getElementById("confirm-delete").onclick = () => {
            // 执行删除
            pathPoints.value.splice(entityIndex, 1);
            viewer.entities.remove(entity);
            pathPointEntities.value.splice(entityIndex, 1);

            // 更新无人机位置（如果是起点）
            if (entityIndex === 0 && droneEntity.value && pathPoints.value.length > 0) {
                droneEntity.value.position = pathPoints.value[0];
            }

            // 取消高亮（如果实现）
            if (highlightedPolyline.value) {
                unhighlightPolyline();
            }

            // 移除确认框
            document.body.removeChild(confirmBox);
        };

        document.getElementById("cancel-delete").onclick = () => {
            document.body.removeChild(confirmBox);
        };

        // 点击外部关闭（可选）
        const handleClose = () => {
            if (document.body.contains(confirmBox)) {
                document.body.removeChild(confirmBox);
            }
            window.removeEventListener("click", handleClose);
            window.removeEventListener("contextmenu", handleClose);
        };

        // 延迟绑定，避免立即触发
        setTimeout(() => {
            window.addEventListener("click", handleClose);
            window.addEventListener("contextmenu", handleClose);
        }, 100);

    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);


    // ✅ 左键点击：显示添加确认框（插入或追加）
    editHandler.value.setInputAction((click) => {
        if (isDragging.value) return;

        const { x, y } = click.position;
        const cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian || pathPoints.value.length < 1) return;

        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        carto.height = 100.0;
        const liftedClickPoint = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height);

        let minDistance = Number.MAX_VALUE;
        let insertIndex = -1;
        let insertPosition = null;
        let actionType = ""; // 'insert' 或 'append'

        // 判断是否靠近某条线段
        if (pathPoints.value.length >= 2) {
            for (let i = 0; i < pathPoints.value.length - 1; i++) {
                const start = pathPoints.value[i];
                const end = pathPoints.value[i + 1];
                const distance = distanceToLineSegment(liftedClickPoint, start, end);
                if (distance < minDistance) {
                    minDistance = distance;
                    insertIndex = i + 1;
                    insertPosition = closestPointOnSegment(liftedClickPoint, start, end);
                }
            }
        }

        // 决定行为
        if (minDistance < 100 && insertPosition) {
            actionType = "insert";
        } else {
            actionType = "append";
        }

        // 创建确认框
        const confirmBox = document.createElement("div");
        let message = "";
        if (actionType === "insert") {
            message = `在第 ${insertIndex} 个点前插入新航点？`;
        } else {
            message = `在航线末尾追加新航点？`;
        }

        confirmBox.innerHTML = `
        <div style="
            background: white;
            border: 1px solid #ccc;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 12px;
            color: #333;
            width: 200px;
            text-align: center;
        ">
            <div style="padding: 12px;">
                <div style="margin-bottom: 8px; font-weight: bold;">添加航点</div>
                <div style="margin-bottom: 12px; color: #555; line-height: 1.4;">
                    ${message}
                </div>
                <div>
                    <button id="confirm-add" style="
                        background: #4CAF50;
                        color: white;
                        border: none;
                        padding: 4px 12px;
                        margin-right: 8px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                    ">确认</button>
                    <button id="cancel-add" style="
                        background: #eee;
                        color: #333;
                        border: none;
                        padding: 4px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                    ">取消</button>
                </div>
            </div>
        </div>
    `;

        confirmBox.style.position = "absolute";
        confirmBox.style.left = `${x + 10}px`;
        confirmBox.style.top = `${y + 10}px`;
        confirmBox.style.zIndex = "10000";
        confirmBox.style.pointerEvents = "auto";

        document.body.appendChild(confirmBox);

        // 确认添加
        document.getElementById("confirm-add").onclick = () => {
            if (actionType === "insert") {
                pathPoints.value.splice(insertIndex, 0, insertPosition);

                const newEntity = viewer.entities.add({
                    position: insertPosition,
                    billboard: {
                        image: EDIT_ICON,
                        scale: 0.5,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                        pixelOffset: new Cesium.Cartesian2(0, -10),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        scaleByDistance: new Cesium.NearFarScalar(1000, 0.4, 10000, 0.2),
                        translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.1),
                        show: true,
                    },
                });

                pathPointEntities.value.splice(insertIndex, 0, newEntity);
            } else {
                // 追加到末尾
                pathPoints.value.push(liftedClickPoint);

                const newEntity = viewer.entities.add({
                    position: liftedClickPoint,
                    billboard: {
                        image: EDIT_ICON,
                        scale: 0.5,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                        pixelOffset: new Cesium.Cartesian2(0, -10),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        scaleByDistance: new Cesium.NearFarScalar(1000, 0.4, 10000, 0.2),
                        translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.1),
                        show: true,
                    },
                });

                pathPointEntities.value.push(newEntity);
            }

            // 路径变化，取消高亮（如果有）
            if (highlightedPolyline.value) {
                unhighlightPolyline();
            }

            document.body.removeChild(confirmBox);
        };

        // 取消
        document.getElementById("cancel-add").onclick = () => {
            document.body.removeChild(confirmBox);
        };

        // 点击外部关闭
        const handleClose = () => {
            if (document.body.contains(confirmBox)) {
                document.body.removeChild(confirmBox);
            }
            window.removeEventListener("click", handleClose);
            window.removeEventListener("contextmenu", handleClose);
        };

        setTimeout(() => {
            window.addEventListener("click", handleClose);
            window.addEventListener("contextmenu", handleClose);
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

    if (tempPolyline.value) {
        viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }
    if (finalPolyline.value) {
        viewer.entities.remove(finalPolyline.value);
        finalPolyline.value = null;
    }
    if (droneEntity.value) {
        viewer.entities.remove(droneEntity.value);
        droneEntity.value = null;
    }

    pathPointEntities.value.forEach(entity => {
        viewer.entities.remove(entity);
    });
    pathPointEntities.value = [];
    pathPoints.value = [];
};

const clearAll = () => {
    if (editMode.value) {
        editMode.value = false;
        exitEditMode();
    }

    if (handler.value) {
        handler.value.destroy();
        handler.value = null;
    }
    if (editHandler.value) {
        editHandler.value.destroy();
        editHandler.value = null;
    }
    cleanupEntities();
    drawing.value = false;
};

onUnmounted(() => {
    if (handler.value) {
        handler.value.destroy();
        handler.value = null;
    }
    if (editHandler.value) {
        editHandler.value.destroy();
        editHandler.value = null;
    }
    cleanupEntities();
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