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
const EDIT_ICON = "/icons/marker_red.png";

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

            // 创建航点：同时包含 point 和 billboard
            const pointEntity = viewer.entities.add({
                position: newCartesian,
                // 编辑时显示的图标（默认隐藏）
                billboard: {
                    image: NORMAL_ICON,
                    scale: 0.5,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance: new Cesium.NearFarScalar(1000, 0.4, 10000, 0.2), // 距离越远越小
                    translucencyByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.1),
                    show: true, // 编辑时再显示
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
        startEditMode();
    } else {
        exitEditMode();
    }
};

const startEditMode = () => {
    const { viewer } = props;
    editHandler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 切换为自定义图标
    pathPointEntities.value.forEach((entity) => {
        if (entity.point) entity.point.show = false;
        if (entity.billboard) {
            entity.billboard.show = true;
            entity.billboard.image = EDIT_ICON;
            entity.billboard.scale = 0.6; // 编辑时稍大
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

                // 👇 高亮选中的点
                const billboard = entity.billboard;
                if (billboard) {
                    // 方式一：放大 + 变色（推荐）
                    billboard.scale = 0.8; // 放大
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
        if (isDragging.value) {
            isDragging.value = false;
            draggedPointIndex.value = -1;
            viewer.scene.screenSpaceCameraController.enableRotate = true;
            viewer.scene.screenSpaceCameraController.enableZoom = true;
            viewer.scene.screenSpaceCameraController.enableTranslate = true;
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 右键删除路径点
    editHandler.value.setInputAction((click) => {
        const pickedObject = viewer.scene.pick(click.position);
        if (pickedObject && pickedObject.id) {
            const entity = pickedObject.id;
            const entityIndex = pathPointEntities.value.indexOf(entity);
            if (entityIndex !== -1 && pathPoints.value.length > 2) {
                pathPoints.value.splice(entityIndex, 1);
                props.viewer.entities.remove(pathPointEntities.value[entityIndex]);
                pathPointEntities.value.splice(entityIndex, 1);

                if (entityIndex === 0 && droneEntity.value && pathPoints.value.length > 0) {
                    droneEntity.value.position = pathPoints.value[0];
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

const exitEditMode = () => {
    // 恢复为圆形点
    pathPointEntities.value.forEach((entity) => {
        if (entity.billboard) {

            entity.billboard.image = NORMAL_ICON;
            entity.billboard.scale = 0.5;
        }

        // if (entity.point) {
        //     entity.point.show = true;
        //     entity.point.pixelSize = 10;
        //     entity.point.color = Cesium.Color.ORANGE;
        //     entity.point.outlineColor = Cesium.Color.WHITE;
        //     entity.point.outlineWidth = 2;
        // }
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

// 在 clearAll 中调用
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

// 在 onUnmounted 中也调用
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