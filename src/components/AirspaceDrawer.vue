<!-- AirspaceDrawer.vue -->
<template>
    <div class="drawer-controls unified-controls">
        <div class="control-group">
            <button @click="startDrawing">开始绘制空域</button>
            <button @click="clearAll">清除所有</button>
            <div v-if="editingEntity">
                <label>底部高度 (m):
                    <input type="number" v-model.number="editBottomHeight" />
                </label>
                <label>顶部高度 (m):
                    <input type="number" v-model.number="editTopHeight" />
                </label>
                <button @click="updateHeights">更新高度</button>
            </div>
        </div>
        <!-- 占位：航线按钮将在父组件统一排列 -->
        <slot name="drone-path" />
    </div>
</template>

<script setup>
import { ref, shallowRef, onUnmounted } from "vue";
import * as Cesium from "cesium";

// 暴露空域多边形数组给父组件
import { defineExpose } from "vue";

// 接收 viewer 实例
const props = defineProps({
    viewer: {
        type: Object,
        required: true,
    },
});

// 状态
const drawing = ref(false);
const handler = ref(null);
const tempPolyline = shallowRef(null); // 临时线
const editingEntity = shallowRef(null); // 当前编辑的实体
const editBottomHeight = ref(200);
const editTopHeight = ref(600);

// 开始绘制
const startDrawing = () => {
    if (drawing.value) return;
    drawing.value = true;

    const { viewer } = props;
    const positions = []; // 存储点

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 添加临时预览线
    tempPolyline.value = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => [...positions], false),
            width: 8, // 线宽加粗
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.2,
                color: Cesium.Color.YELLOW,
            }),
            clampToGround: false,
        },
    });

    // 单击添加点
    handler.value.setInputAction((click) => {
        const cartesian = viewer.scene.pickPosition(click.position);
        if (cartesian) {
            positions.push(cartesian);
            // 添加红点标记
            viewer.entities.add({
                position: cartesian,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.RED,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 双击结束绘制
    handler.value.setInputAction(() => {
        if (positions.length > 2) {
            finishDrawing(positions);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // 右键结束（备用）
    handler.value.setInputAction(() => {
        if (positions.length > 2) {
            finishDrawing(positions);
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

// 完成绘制
const finishDrawing = (positions) => {
    const { viewer } = props;

    // 移除临时线
    if (tempPolyline.value) {
        viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }

    // 创建最终多边形
    const entity = viewer.entities.add({
        name: "空域区域",
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.BLUE.withAlpha(0.3),
            outline: true,
            outlineColor: Cesium.Color.WHITE,
            extrudedHeight: editTopHeight.value, // 顶部高度
            height: editBottomHeight.value, // 底部高度
            perPositionHeight: false,
        },
    });

    // 保存多边形点集到暴露数据
    airspacePolygons.value.push({ positions: [...positions] });

    // 设置为可编辑
    makeEditable(entity);

    // 清理
    handler.value?.destroy();
    handler.value = null;
    drawing.value = false;
};

// 使多边形可编辑（显示控制点）
const makeEditable = (entity) => {
    const { viewer } = props;
    const positions = entity.polygon.hierarchy.getValue().positions;
    editingEntity.value = entity;
    editBottomHeight.value = entity.polygon.height.getValue();
    editTopHeight.value = entity.polygon.extrudedHeight.getValue();

    // 添加控制点
    positions.forEach((pos, index) => {
        viewer.entities.add({
            position: pos,
            point: {
                pixelSize: 8,
                color: Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
                text: (index + 1).toString(),
                font: "14px sans-serif",
                horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(10, 0),
            },
            _editIndex: index,
            _parentEntity: entity,
        });
    });
};

// 更新高度
const updateHeights = () => {
    if (!editingEntity.value) return;
    const polygon = editingEntity.value.polygon;

    polygon.height.setValue(editBottomHeight.value);
    polygon.extrudedHeight.setValue(editTopHeight.value);
};

// 清除所有
const clearAll = () => {
    props.viewer.entities.removeAll();
    editingEntity.value = null;
    airspacePolygons.value = [];
};

// 组件卸载时清理
onUnmounted(() => {
    if (handler.value) {
        handler.value.destroy();
    }
    if (tempPolyline.value) {
        props.viewer.entities.remove(tempPolyline.value);
    }
});

const airspacePolygons = ref([]);
defineExpose({ airspacePolygons });
</script>

<style scoped>
.unified-controls {
    position: absolute;
    top: 20px;
    left: 20px;
    background: white;
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 250px;
}

.control-group {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-evenly;
}

.drawer-controls button {
    margin: 5px 0;
    padding: 8px 12px;
    background: #1976d2;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.drawer-controls input {
    margin: 0 10px 10px 0;
    padding: 5px;
    width: 80px;
}

.drawer-controls label {
    white-space: nowrap;
}
</style>
