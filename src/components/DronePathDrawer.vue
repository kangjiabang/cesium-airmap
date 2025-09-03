<!-- DronePathDrawer.vue -->
<template>
    <div class="control-group drone-group">
        <button @click="startDrawing">{{ drawing ? '航线绘制中' : '开始绘制航线' }}</button>
        <button @click="toggleEditMode" :disabled="!pathPoints.length">{{ editMode ? '退出编辑' : '编辑航线' }}</button>
        <button @click="clearAll">清除所有</button>
        <div class="drone-info" :style="{ visibility: pathPoints.length ? 'visible' : 'hidden' }">
            <span>航线点数：{{ pathPoints.length || 0 }}</span>
            <span v-if="editMode" class="edit-hint">拖动橙色点编辑航线</span>
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

const startDrawing = () => {
    if (drawing.value || editMode.value) return;
    drawing.value = true;
    const { viewer } = props;
    pathPoints.value = [];
    pathPointEntities.value = [];
    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 临时航线
    tempPolyline.value = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => [...pathPoints.value], false),
            width: 6,
            material: Cesium.Color.ORANGE,
            clampToGround: false,
        },
    });

    // 单击添加航点
    handler.value.setInputAction((click) => {
        const cartesian = viewer.scene.pickPosition(click.position);
        if (cartesian) {
            // 设置高度为100米
            const carto = Cesium.Cartographic.fromCartesian(cartesian);
            const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);
            pathPoints.value.push(newCartesian);
            
            const pointEntity = viewer.entities.add({
                position: newCartesian,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.ORANGE,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
            width: 6,
            material: Cesium.Color.ORANGE.withAlpha(0.8),
            clampToGround: false,
        },
    });

    // 添加无人机模型
    if (positions.length > 1) {
        // 起点
        const start = positions[0];
        droneEntity.value = viewer.entities.add({
            name: "无人机",
            position: start,
            model: {
                uri: "models/drone_costum.glb",
                minimumPixelSize: 128,
                maximumScale: 200,
            },
            label: new Cesium.LabelGraphics({
                text: new Cesium.CallbackProperty(() => {
                    const position = droneEntity.value?.position?.getValue(props.viewer.clock.currentTime);
                    if (!position) return "无人机信息\n准备起飞";
                    
                    const cartographic = Cesium.Cartographic.fromCartesian(position);
                    const height = cartographic?.height?.toFixed(1) || '0.0';
                    
                    return `无人机信息\n高度: ${height}m\n速度: 0 m/s\n电量: 100%`;
                }, false),
                font: new Cesium.CallbackProperty(() => {
                    const model = droneEntity.value?.model;
                    if (model) {
                        const pixelSize = model.pixelSize?.getValue(props.viewer.clock.currentTime) || model.minimumPixelSize || 64;
                        const fontSize = Math.max(12, Math.min(24, Math.floor(pixelSize / 8)));
                        return `${fontSize}px sans-serif`;
                    }
                    return "14px sans-serif";
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
        });
    }

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
    
    // 使路径点在编辑模式下更突出
    pathPointEntities.value.forEach((entity, index) => {
        if (entity.point) {
            entity.point.pixelSize = 15;
            entity.point.color = Cesium.Color.YELLOW;
            entity.point.outlineColor = Cesium.Color.RED;
            entity.point.outlineWidth = 3;
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
                // 保持高度为100米
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                const newCartesian = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);
                
                // 更新路径点位置
                pathPoints.value[draggedPointIndex.value] = newCartesian;
                pathPointEntities.value[draggedPointIndex.value].position = newCartesian;
                
                // 如果是第一个点，也更新无人机位置
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
                // 删除路径点
                pathPoints.value.splice(entityIndex, 1);
                props.viewer.entities.remove(pathPointEntities.value[entityIndex]);
                pathPointEntities.value.splice(entityIndex, 1);
                
                // 如果删除的是第一个点，更新无人机位置
                if (entityIndex === 0 && droneEntity.value && pathPoints.value.length > 0) {
                    droneEntity.value.position = pathPoints.value[0];
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

const exitEditMode = () => {
    // 恢复路径点原来的样式
    pathPointEntities.value.forEach((entity) => {
        if (entity.point) {
            entity.point.pixelSize = 10;
            entity.point.color = Cesium.Color.ORANGE;
            entity.point.outlineColor = Cesium.Color.WHITE;
            entity.point.outlineWidth = 2;
        }
    });

    // 销毁编辑处理器
    if (editHandler.value) {
        editHandler.value.destroy();
        editHandler.value = null;
    }

    // 重置拖拽状态
    isDragging.value = false;
    draggedPointIndex.value = -1;

    // 恢复相机控制
    props.viewer.scene.screenSpaceCameraController.enableRotate = true;
    props.viewer.scene.screenSpaceCameraController.enableZoom = true;
    props.viewer.scene.screenSpaceCameraController.enableTranslate = true;
};

const clearAll = () => {
    // 退出编辑模式
    if (editMode.value) {
        editMode.value = false;
        exitEditMode();
    }
    
    props.viewer.entities.removeAll();
    pathPoints.value = [];
    pathPointEntities.value = [];
    droneEntity.value = null;
    finalPolyline.value = null;
    tempPolyline.value = null;
};

onUnmounted(() => {
    if (handler.value) {
        handler.value.destroy();
    }
    if (editHandler.value) {
        editHandler.value.destroy();
    }
    if (tempPolyline.value) {
        props.viewer.entities.remove(tempPolyline.value);
    }
});

// 让父组件可以访问 pathPoints 和 droneEntity
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