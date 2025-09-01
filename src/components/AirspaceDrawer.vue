<!-- AirspaceDrawer.vue -->
<template>
    <div class="drawer-controls">
        <div class="control-header">
            <h4>🚁 空域绘制</h4>
        </div>
        <div class="control-group">
            <button @click="startDrawing" :disabled="drawing" class="primary-btn">
                {{ drawing ? '绘制中...' : '开始绘制空域' }}
            </button>
            <button @click="clearAll" class="danger-btn">清除所有</button>
        </div>

        <div v-if="editingEntity" class="height-controls">
            <h5>高度设置</h5>
            <div class="height-inputs">
                <label>
                    底部高度 (m):
                    <input type="number" v-model.number="editBottomHeight" min="0" max="10000" />
                </label>
                <label>
                    顶部高度 (m):
                    <input type="number" v-model.number="editTopHeight" min="0" max="10000" />
                </label>
            </div>
            <button @click="updateHeights" class="update-btn">更新高度</button>
        </div>

        <div class="instructions">
            <p><small>🖱️ 左键点击添加点，双击完成绘制</small></p>
            <p v-if="drawing"><small>⚡ 绘制模式激活中...</small></p>
        </div>
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

// 空域多边形数组
const airspacePolygons = ref([]);

// 开始绘制
const startDrawing = () => {
    if (drawing.value) return;

    console.log('开始绘制空域...');
    drawing.value = true;

    const { viewer } = props;
    const positions = []; // 存储点

    // 设置绘制模式的鼠标样式
    viewer.canvas.style.cursor = 'crosshair';

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 添加临时预览线
    tempPolyline.value = viewer.entities.add({
        polyline: {
            positions: new Cesium.CallbackProperty(() => [...positions], false),
            width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.3,
                color: Cesium.Color.YELLOW,
            }),
            clampToGround: true,
        },
    });

    // 单击添加点
    handler.value.setInputAction((click) => {
        const cartesian = viewer.scene.pickPosition(click.position);
        if (!cartesian) {
            // 如果pickPosition失败，尝试使用camera.pickEllipsoid
            const ellipsoid = viewer.scene.globe.ellipsoid;
            const cartesian2 = viewer.camera.pickEllipsoid(click.position, ellipsoid);
            if (cartesian2) {
                positions.push(cartesian2);
                addPointMarker(cartesian2, positions.length);
            }
        } else {
            positions.push(cartesian);
            addPointMarker(cartesian, positions.length);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 双击结束绘制
    handler.value.setInputAction((event) => {
        event.preventDefault?.(); // 防止默认行为
        if (positions.length > 2) {
            finishDrawing(positions);
        } else {
            console.warn('需要至少3个点才能构成空域');
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // 右键结束（备用）
    handler.value.setInputAction(() => {
        if (positions.length > 2) {
            finishDrawing(positions);
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

// 添加点标记
const addPointMarker = (position, index) => {
    const { viewer } = props;
    viewer.entities.add({
        position: position,
        point: {
            pixelSize: 8,
            color: Cesium.Color.ORANGE,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(1.5e2, 2.0, 1.5e7, 0.5),
        },
        label: {
            text: index.toString(),
            font: "12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5),
        },
        _isAirspaceMarker: true,
    });
};

// 完成绘制
const finishDrawing = (positions) => {
    const { viewer } = props;

    console.log('完成空域绘制，点数:', positions.length);

    // 移除临时线
    if (tempPolyline.value) {
        viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }

    // 恢复鼠标样式
    viewer.canvas.style.cursor = 'default';

    // 创建最终多边形
    const entity = viewer.entities.add({
        name: `空域区域_${Date.now()}`,
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.BLUE.withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            outlineWidth: 2,
            extrudedHeight: editTopHeight.value, // 顶部高度
            height: editBottomHeight.value, // 底部高度
            perPositionHeight: false,
        },
        _isAirspacePolygon: true,
    });

    // 保存多边形点集到暴露数据
    airspacePolygons.value.push({
        positions: [...positions],
        entity: entity,
        bottomHeight: editBottomHeight.value,
        topHeight: editTopHeight.value,
    });

    // 设置为可编辑
    makeEditable(entity);

    // 清理
    stopDrawing();

    console.log('空域总数:', airspacePolygons.value.length);
};

// 停止绘制
const stopDrawing = () => {
    if (handler.value) {
        handler.value.destroy();
        handler.value = null;
    }

    if (tempPolyline.value) {
        props.viewer.entities.remove(tempPolyline.value);
        tempPolyline.value = null;
    }

    // 恢复鼠标样式
    if (props.viewer?.canvas) {
        props.viewer.canvas.style.cursor = 'default';
    }

    drawing.value = false;
    console.log('停止绘制模式');
};

// 使多边形可编辑（显示控制点）
const makeEditable = (entity) => {
    const { viewer } = props;
    const positions = entity.polygon.hierarchy.getValue().positions;
    editingEntity.value = entity;
    editBottomHeight.value = entity.polygon.height.getValue() || 200;
    editTopHeight.value = entity.polygon.extrudedHeight.getValue() || 600;

    console.log('设置空域为可编辑模式');
};

// 更新高度
const updateHeights = () => {
    if (!editingEntity.value) return;

    const polygon = editingEntity.value.polygon;
    polygon.height = editBottomHeight.value;
    polygon.extrudedHeight = editTopHeight.value;

    // 更新存储的数据
    const airspace = airspacePolygons.value.find(a => a.entity === editingEntity.value);
    if (airspace) {
        airspace.bottomHeight = editBottomHeight.value;
        airspace.topHeight = editTopHeight.value;
    }

    console.log('高度已更新:', { bottom: editBottomHeight.value, top: editTopHeight.value });
};

// 清除所有
const clearAll = () => {
    const { viewer } = props;

    // 清除所有标记为空域的实体
    const entitiesToRemove = [];
    viewer.entities.values.forEach(entity => {
        if (entity._isAirspacePolygon || entity._isAirspaceMarker) {
            entitiesToRemove.push(entity);
        }
    });

    entitiesToRemove.forEach(entity => {
        viewer.entities.remove(entity);
    });

    editingEntity.value = null;
    airspacePolygons.value = [];
    stopDrawing();

    console.log('已清除所有空域');
};

// 组件卸载时清理
onUnmounted(() => {
    stopDrawing();
});

// 暴露给父组件的接口
defineExpose({
    airspacePolygons,
    startDrawing,
    stopDrawing,
    clearAll,
});
</script>

<style scoped>
.drawer-controls {
    /* 移除绝对定位，让父组件控制布局 */
    background: rgba(42, 42, 42, 0.95);
    color: white;
    padding: 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(8px);
    min-width: 280px;
    max-width: 350px;
}

.control-header {
    margin-bottom: 12px;
}

.control-header h4 {
    margin: 0;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
}

.control-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
}

.drawer-controls button {
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    min-height: 36px;
}

.primary-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

.primary-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%);
    transform: translateY(-1px);
}

.primary-btn:disabled {
    background: #4a5568;
    cursor: not-allowed;
    opacity: 0.6;
}

.danger-btn {
    background: linear-gradient(135deg, #fc8181 0%, #e53e3e 100%);
    color: white;
}

.danger-btn:hover {
    background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);
    transform: translateY(-1px);
}

.update-btn {
    background: linear-gradient(135deg, #68d391 0%, #38a169 100%);
    color: white;
}

.update-btn:hover {
    background: linear-gradient(135deg, #48bb78 0%, #2f855a 100%);
    transform: translateY(-1px);
}

.height-controls {
    padding: 12px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    margin-bottom: 16px;
}

.height-controls h5 {
    margin: 0 0 8px 0;
    color: #cbd5e0;
    font-size: 14px;
}

.height-inputs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
}

.height-inputs label {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    color: #a0aec0;
    gap: 4px;
}

.height-inputs input {
    padding: 6px 8px;
    border: 1px solid #4a5568;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: white;
    font-size: 14px;
}

.height-inputs input:focus {
    outline: none;
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.15);
}

.instructions {
    font-size: 12px;
    color: #a0aec0;
    line-height: 1.4;
}

.instructions p {
    margin: 4px 0;
}

.instructions small {
    font-size: 11px;
}
</style>