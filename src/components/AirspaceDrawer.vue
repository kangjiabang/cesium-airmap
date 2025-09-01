<!-- AirspaceDrawer.vue -->
<template>
    <div class="drawer-controls">
        <div class="control-header">
            <h4>🚁 空域绘制</h4>
        </div>

        <!-- 空域形状选择 -->
        <div class="shape-selector">
            <label>空域形状:</label>
            <select v-model="selectedShape" @change="onShapeChange">
                <option value="custom">自定义绘制</option>
                <option value="circle">圆形</option>
                <option value="rectangle">矩形</option>
                <option value="square">正方形</option>
            </select>
        </div>

        <div class="control-group">
            <button @click="startDrawing" :disabled="drawing" class="primary-btn">
                {{ getDrawingButtonText() }}
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
            <p><small>{{ getInstructionText() }}</small></p>
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
const tempEntity = shallowRef(null); // 临时实体（可能是线、圆等）
const editingEntity = shallowRef(null); // 当前编辑的实体
const editBottomHeight = ref(10);
const editTopHeight = ref(300);
const selectedShape = ref('custom'); // 默认自定义绘制

// 空域多边形数组
const airspacePolygons = ref([]);

// 获取绘制按钮文字
const getDrawingButtonText = () => {
    if (!drawing.value) {
        switch (selectedShape.value) {
            case 'circle': return '开始绘制圆形空域';
            case 'rectangle': return '开始绘制矩形空域';
            case 'square': return '开始绘制正方形空域';
            case 'custom': return '开始绘制空域';
        }
    }
    return '绘制中...';
};

// 获取提示文字
const getInstructionText = () => {
    switch (selectedShape.value) {
        case 'circle':
            return '🖱️ 点击中心点，再点击边缘确定半径';
        case 'rectangle':
            return '🖱️ 点击两个对角点绘制矩形';
        case 'square':
            return '🖱️ 点击中心点，再点击边缘确定大小';
        case 'custom':
            return '🖱️ 左键点击添加点，双击完成绘制';
    }
};

// 形状改变时的处理
const onShapeChange = () => {
    if (drawing.value) {
        stopDrawing();
    }
};

// 开始绘制
const startDrawing = () => {
    if (drawing.value) return;

    console.log('开始绘制空域...', selectedShape.value);
    drawing.value = true;

    const { viewer } = props;
    viewer.canvas.style.cursor = 'crosshair';

    switch (selectedShape.value) {
        case 'circle':
            startDrawingCircle();
            break;
        case 'rectangle':
            startDrawingRectangle();
            break;
        case 'square':
            startDrawingSquare();
            break;
        case 'custom':
        default:
            startDrawingCustom();
            break;
    }
};

// 绘制矩形（完全修复版本）
// 绘制矩形（终极修复版本）
// 绘制矩形（最保守修复版本）
const startDrawingRectangle = () => {
    const { viewer } = props;
    const points = [];

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.value.setInputAction((click) => {
        const cartesian = getCartesianFromClick(click);
        if (!cartesian) {
            console.warn('无法获取有效的点击坐标');
            return;
        }

        points.push(cartesian);
        addPointMarker(cartesian, points.length);

        if (points.length === 1) {
            // 第一个点：只添加标记，不创建临时实体
            console.log('已添加第一个点，等待第二个点');
        } else if (points.length === 2) {
            // 第二个点，完成矩形
            finishDrawingRectangle(points);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 鼠标移动时也不创建临时预览（避免问题）
};
// 工具函数：创建小矩形占位符
const createSmallRectanglePlaceholder = (centerPoint) => {
    try {
        if (!centerPoint) return [];

        // 转换为地理坐标
        const cartographic = Cesium.Cartographic.fromCartesian(centerPoint);
        if (!cartographic) return [];

        // 创建一个非常小的矩形（大约1米）
        const offset = 0.00001; // 约1米的偏移

        const west = cartographic.longitude - offset;
        const east = cartographic.longitude + offset;
        const south = cartographic.latitude - offset;
        const north = cartographic.latitude + offset;

        return [
            Cesium.Cartesian3.fromRadians(west, north),  // 西北
            Cesium.Cartesian3.fromRadians(east, north),  // 东北
            Cesium.Cartesian3.fromRadians(east, south),  // 东南
            Cesium.Cartesian3.fromRadians(west, south),  // 西南
        ];
    } catch (error) {
        console.warn('创建小矩形占位符时出错:', error);
        return [];
    }
};

// 完成矩形绘制（修复版本）
const finishDrawingRectangle = (points) => {
    // 添加验证
    if (!points || points.length < 2 || !points[0] || !points[1]) {
        console.warn("矩形绘制需要两个有效的点");
        stopDrawing();
        return;
    }

    const { viewer } = props;

    // 移除临时实体
    if (tempEntity.value) {
        try {
            viewer.entities.remove(tempEntity.value);
        } catch (error) {
            console.warn('移除临时实体时出错:', error);
        }
        tempEntity.value = null;
    }

    // 创建矩形点集
    let positions;
    try {
        positions = createRectangleHierarchy(points[0], points[1]);
    } catch (error) {
        console.warn('创建矩形层次结构时出错:', error);
        stopDrawing();
        return;
    }

    // 验证生成的点是否有效
    if (!positions || !Array.isArray(positions) || positions.length < 4) {
        console.warn("生成的矩形点集无效，点数:", positions ? positions.length : 'null');
        stopDrawing();
        return;
    }

    // 验证所有点是否有效
    const hasInvalidPoint = positions.some(point => !point || !Cesium.defined(point));
    if (hasInvalidPoint) {
        console.warn("矩形点集中包含无效点");
        stopDrawing();
        return;
    }

    try {
        const entity = viewer.entities.add({
            name: `矩形空域_${Date.now()}`,
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: Cesium.Color.BLUE.withAlpha(0.4),
                outline: true,
                outlineColor: Cesium.Color.CYAN,
                height: editBottomHeight.value,
                extrudedHeight: editTopHeight.value,
            },
            _isAirspacePolygon: true,
        });

        airspacePolygons.value.push({
            positions: positions,
            entity: entity,
            bottomHeight: editBottomHeight.value,
            topHeight: editTopHeight.value,
            shape: 'rectangle',
            cornerPoints: points,
        });

        makeEditable(entity);
    } catch (error) {
        console.error('创建矩形实体时出错:', error);
    }

    stopDrawing();
};

// 改进的矩形点集创建函数
const createRectangleHierarchy = (point1, point2) => {
    try {
        if (!point1 || !point2) {
            throw new Error('矩形点坐标不能为空');
        }

        const carto1 = Cesium.Cartographic.fromCartesian(point1);
        const carto2 = Cesium.Cartographic.fromCartesian(point2);

        if (!carto1 || !carto2) {
            throw new Error('无法转换为地理坐标');
        }

        const west = Math.min(carto1.longitude, carto2.longitude);
        const east = Math.max(carto1.longitude, carto2.longitude);
        const south = Math.min(carto1.latitude, carto2.latitude);
        const north = Math.max(carto1.latitude, carto2.latitude);

        const rectanglePoints = [
            Cesium.Cartesian3.fromRadians(west, north),   // 西北角
            Cesium.Cartesian3.fromRadians(east, north),   // 东北角
            Cesium.Cartesian3.fromRadians(east, south),   // 东南角
            Cesium.Cartesian3.fromRadians(west, south),   // 西南角
        ];

        // 验证所有点是否有效
        const hasInvalidPoint = rectanglePoints.some(point => !point || !Cesium.defined(point));
        if (hasInvalidPoint) {
            throw new Error('生成的矩形点中包含无效点');
        }

        return rectanglePoints;
    } catch (error) {
        console.warn('创建矩形层次结构时出错:', error);
        return []; // 返回空数组而不是undefined
    }
};

// 工具函数改进
const getCartesianFromClick = (click) => {
    const { viewer } = props;
    try {
        // 优先使用pickPosition
        let cartesian = viewer.scene.pickPosition(click.position);
        if (cartesian && Cesium.defined(cartesian)) {
            return cartesian;
        }

        // 如果pickPosition失败，使用pickEllipsoid
        const ellipsoid = viewer.scene.globe.ellipsoid;
        cartesian = viewer.camera.pickEllipsoid(click.position, ellipsoid);
        if (cartesian && Cesium.defined(cartesian)) {
            return cartesian;
        }

        console.warn('无法获取有效的点击坐标');
        return null;
    } catch (error) {
        console.warn('获取点击坐标时出错:', error);
        return null;
    }
};

const getCartesianFromMovement = (movement) => {
    const { viewer } = props;
    try {
        // 优先使用pickPosition
        let cartesian = viewer.scene.pickPosition(movement.endPosition);
        if (cartesian && Cesium.defined(cartesian)) {
            return cartesian;
        }

        // 如果pickPosition失败，使用pickEllipsoid
        const ellipsoid = viewer.scene.globe.ellipsoid;
        cartesian = viewer.camera.pickEllipsoid(movement.endPosition, ellipsoid);
        if (cartesian && Cesium.defined(cartesian)) {
            return cartesian;
        }

        return null;
    } catch (error) {
        console.warn('获取鼠标移动坐标时出错:', error);
        return null;
    }
};

// 绘制圆形
// 绘制圆形（最保守修复版本）
const startDrawingCircle = () => {
    const { viewer } = props;
    const points = [];
    let centerPoint = null;

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.value.setInputAction((click) => {
        const cartesian = getCartesianFromClick(click);
        if (!cartesian) {
            console.warn('无法获取有效的点击坐标');
            return;
        }

        if (!centerPoint) {
            // 第一次点击 - 设置中心点
            centerPoint = cartesian;
            points.push(cartesian);

            // 添加中心点标记
            addPointMarker(cartesian, 'C');

            // 第一个点：只添加标记，不创建临时实体
            console.log('已设置圆形中心点，等待确定半径');
        } else {
            // 第二次点击 - 确定半径并完成
            points[1] = cartesian;
            const radius = Cesium.Cartesian3.distance(centerPoint, cartesian);
            finishDrawingCircle(centerPoint, radius);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 鼠标移动时不创建临时预览（避免问题）
};

// 绘制正方形
// 绘制正方形（最保守修复版本）
const startDrawingSquare = () => {
    const { viewer } = props;
    const points = [];
    let centerPoint = null;

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.value.setInputAction((click) => {
        const cartesian = getCartesianFromClick(click);
        if (!cartesian) {
            console.warn('无法获取有效的点击坐标');
            return;
        }

        if (!centerPoint) {
            // 第一次点击 - 设置中心点
            centerPoint = cartesian;
            points.push(cartesian);
            addPointMarker(cartesian, 'C');

            // 第一个点：只添加标记，不创建临时实体
            console.log('已设置正方形中心点，等待确定大小');
        } else {
            // 第二次点击 - 确定大小并完成
            points[1] = cartesian;
            const sideLength = Cesium.Cartesian3.distance(centerPoint, cartesian);
            finishDrawingSquare(centerPoint, sideLength);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 鼠标移动时不创建临时预览（避免问题）
};

// 创建小正方形占位符
const createSmallSquarePlaceholder = (centerPoint) => {
    try {
        if (!centerPoint) return [];
        const cartographic = Cesium.Cartographic.fromCartesian(centerPoint);
        if (!cartographic) return [];

        const offset = 0.00001;

        return [
            Cesium.Cartesian3.fromRadians(cartographic.longitude - offset, cartographic.latitude + offset),
            Cesium.Cartesian3.fromRadians(cartographic.longitude + offset, cartographic.latitude + offset),
            Cesium.Cartesian3.fromRadians(cartographic.longitude + offset, cartographic.latitude - offset),
            Cesium.Cartesian3.fromRadians(cartographic.longitude - offset, cartographic.latitude - offset),
        ];
    } catch (error) {
        console.warn('创建小正方形占位符时出错:', error);
        return [];
    }
};

const createSquareHierarchy = (center, sideLength) => {
    const carto = Cesium.Cartographic.fromCartesian(center);
    const halfSide = sideLength / 2;

    // 简化计算，在地表创建正方形
    const deltaLon = halfSide / (6371000 * Math.cos(carto.latitude));
    const deltaLat = halfSide / 6371000;

    return [
        Cesium.Cartesian3.fromRadians(carto.longitude - deltaLon, carto.latitude + deltaLat),
        Cesium.Cartesian3.fromRadians(carto.longitude + deltaLon, carto.latitude + deltaLat),
        Cesium.Cartesian3.fromRadians(carto.longitude + deltaLon, carto.latitude - deltaLat),
        Cesium.Cartesian3.fromRadians(carto.longitude - deltaLon, carto.latitude - deltaLat),
    ];
};

// 自定义绘制（原有逻辑）
const startDrawingCustom = () => {
    const { viewer } = props;
    const positions = [];

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 添加临时预览线
    tempEntity.value = viewer.entities.add({
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
        const cartesian = getCartesianFromClick(click);
        if (cartesian) {
            positions.push(cartesian);
            addPointMarker(cartesian, positions.length);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 双击结束绘制
    handler.value.setInputAction((event) => {
        event.preventDefault?.();
        if (positions.length > 2) {
            finishDrawingCustom(positions);
        } else {
            console.warn('需要至少3个点才能构成空域');
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // 右键结束（备用）
    handler.value.setInputAction(() => {
        if (positions.length > 2) {
            finishDrawingCustom(positions);
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

// 完成绘制的函数
const finishDrawingCircle = (center, radius) => {
    const { viewer } = props;

    if (tempEntity.value) {
        viewer.entities.remove(tempEntity.value);
        tempEntity.value = null;
    }

    const entity = viewer.entities.add({
        name: `圆形空域_${Date.now()}`,
        position: center,
        ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            material: Cesium.Color.BLUE.withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            height: editBottomHeight.value,
            extrudedHeight: editTopHeight.value,
        },
        _isAirspacePolygon: true,
    });

    // 转换为多边形点集保存
    const positions = [];
    const segments = 32;
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = center.x + radius * Math.cos(angle);
        const y = center.y + radius * Math.sin(angle);
        const z = center.z;
        positions.push(new Cesium.Cartesian3(x, y, z));
    }

    airspacePolygons.value.push({
        positions: positions,
        entity: entity,
        bottomHeight: editBottomHeight.value,
        topHeight: editTopHeight.value,
        shape: 'circle',
        center: center,
        radius: radius,
    });

    makeEditable(entity);
    stopDrawing();
};

const finishDrawingSquare = (center, sideLength) => {
    const { viewer } = props;

    if (tempEntity.value) {
        viewer.entities.remove(tempEntity.value);
        tempEntity.value = null;
    }

    const positions = createSquareHierarchy(center, sideLength);

    const entity = viewer.entities.add({
        name: `正方形空域_${Date.now()}`,
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.BLUE.withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            height: editBottomHeight.value,
            extrudedHeight: editTopHeight.value,
        },
        _isAirspacePolygon: true,
    });

    airspacePolygons.value.push({
        positions: positions,
        entity: entity,
        bottomHeight: editBottomHeight.value,
        topHeight: editTopHeight.value,
        shape: 'square',
        center: center,
        sideLength: sideLength,
    });

    makeEditable(entity);
    stopDrawing();
};

const finishDrawingCustom = (positions) => {
    const { viewer } = props;

    if (tempEntity.value) {
        viewer.entities.remove(tempEntity.value);
        tempEntity.value = null;
    }

    const entity = viewer.entities.add({
        name: `自定义空域_${Date.now()}`,
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.BLUE.withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            extrudedHeight: editTopHeight.value,
            height: editBottomHeight.value,
            perPositionHeight: false,
        },
        _isAirspacePolygon: true,
    });

    airspacePolygons.value.push({
        positions: [...positions],
        entity: entity,
        bottomHeight: editBottomHeight.value,
        topHeight: editTopHeight.value,
        shape: 'custom',
    });

    makeEditable(entity);
    stopDrawing();
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

// 停止绘制
const stopDrawing = () => {
    if (handler.value) {
        try {
            handler.value.destroy();
        } catch (error) {
            console.warn('销毁事件处理器时出错:', error);
        }
        handler.value = null;
    }

    if (tempEntity.value) {
        try {
            props.viewer.entities.remove(tempEntity.value);
        } catch (error) {
            console.warn('移除临时实体时出错:', error);
        }
        tempEntity.value = null;
    }

    if (props.viewer?.canvas) {
        props.viewer.canvas.style.cursor = 'default';
    }

    drawing.value = false;
    console.log('停止绘制模式');
};

// 使多边形可编辑
const makeEditable = (entity) => {
    editingEntity.value = entity;
    if (entity.polygon) {
        editBottomHeight.value = entity.polygon.height.getValue() || 200;
        editTopHeight.value = entity.polygon.extrudedHeight.getValue() || 600;
    } else if (entity.ellipse) {
        editBottomHeight.value = entity.ellipse.height.getValue() || 200;
        editTopHeight.value = entity.ellipse.extrudedHeight.getValue() || 600;
    }
    console.log('设置空域为可编辑模式');
};

// 更新高度
const updateHeights = () => {
    if (!editingEntity.value) return;

    if (editingEntity.value.polygon) {
        editingEntity.value.polygon.height = editBottomHeight.value;
        editingEntity.value.polygon.extrudedHeight = editTopHeight.value;
    } else if (editingEntity.value.ellipse) {
        editingEntity.value.ellipse.height = editBottomHeight.value;
        editingEntity.value.ellipse.extrudedHeight = editTopHeight.value;
    }

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

    const entitiesToRemove = [];
    viewer.entities.values.forEach(entity => {
        if (entity._isAirspacePolygon || entity._isAirspaceMarker) {
            entitiesToRemove.push(entity);
        }
    });

    entitiesToRemove.forEach(entity => {
        try {
            viewer.entities.remove(entity);
        } catch (error) {
            console.warn('移除实体时出错:', error);
        }
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

.shape-selector {
    margin-bottom: 16px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
}

.shape-selector label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    color: #cbd5e0;
    font-weight: 500;
}

.shape-selector select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #4a5568;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-size: 14px;
    cursor: pointer;
}

.shape-selector select:focus {
    outline: none;
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.2);
}

.shape-selector select option {
    background: #2d3748;
    color: white;
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