<!-- DronePathDrawer.vue -->
<template>
    <div class="control-group drone-group">
        <button @click="startDrawing">开始绘制航线</button>
        <button @click="clearAll">清除所有</button>
        <div v-if="pathPoints.length" class="drone-info">
            <span>航线点数：{{ pathPoints.length }}</span>
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
const handler = ref(null);
const tempPolyline = shallowRef(null);
const pathPoints = ref([]);
const droneEntity = shallowRef(null);

const startDrawing = () => {
    if (drawing.value) return;
    drawing.value = true;
    const { viewer } = props;
    pathPoints.value = [];
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
            viewer.entities.add({
                position: newCartesian,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.ORANGE,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
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
    viewer.entities.add({
        name: "无人机航线",
        polyline: {
            positions: positions,
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
                minimumPixelSize: 128, // 更大像素尺寸
                maximumScale: 200,     // 更大缩放比例
            },
        });
        console.log('无人机实体', droneEntity.value);
        // 注意：不自动设置无人机飞行属性，需手动点击按钮后才设置 SampledPositionProperty
    }

    handler.value?.destroy();
    handler.value = null;
    drawing.value = false;
};

const clearAll = () => {
    props.viewer.entities.removeAll();
    pathPoints.value = [];
    droneEntity.value = null;
};

onUnmounted(() => {
    if (handler.value) {
        handler.value.destroy();
    }
    if (tempPolyline.value) {
        props.viewer.entities.remove(tempPolyline.value);
    }
});

// 让父组件可以访问 pathPoints 和 droneEntity
defineExpose({ pathPoints, droneEntity });
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
}

.drone-info {
    white-space: nowrap;
}
</style>
