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

        <!-- 空域类型选择 -->
        <div class="type-selector">
            <label>空域类型:</label>
            <select v-model="airspaceType" @change="onTypeChange">
                <option value="3d">立体</option>
                <option value="2d">平面</option>
            </select>
        </div>

        <div class="control-group">
            <button @click="startDrawing" :disabled="drawing || editing" class="primary-btn">
                {{ getDrawingButtonText() }}
            </button>
            <button @click="toggleEditMode" :disabled="drawing" :class="editing ? 'edit-btn-active' : 'edit-btn'">
                {{ editing ? '退出编辑' : '编辑模式' }}
            </button>
            <button @click="clearAll" class="danger-btn">清除所有</button>
        </div>

        <!-- 编辑模式说明 -->
        <div v-if="editing" class="edit-info">
            <p><small>📝 编辑模式已激活</small></p>
            <p><small>• 点击空域进入编辑状态</small></p>
            <p><small>• 拖拽顶点修改形状</small></p>
            <p><small>• 点击空白区域完成编辑</small></p>
        </div>

        <div v-if="editingEntity" class="height-controls">
            <h5>高度设置</h5>
            <div class="height-inputs">
                <label>
                    底部高度 (m):
                    <input type="number" v-model.number="editBottomHeight" min="0" max="10000"
                        :disabled="airspaceType === '2d'" />
                </label>
                <label>
                    顶部高度 (m):
                    <input type="number" v-model.number="editTopHeight" min="0" max="10000"
                        :disabled="airspaceType === '2d'" />
                </label>
            </div>
            <div class="edit-controls">
                <button @click="updateHeights" class="update-btn" :disabled="airspaceType === '2d'">更新高度</button>
                <button @click="deleteSelectedEntity" class="delete-btn">删除空域</button>
            </div>
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
const editing = ref(false);
const handler = ref(null);
const editHandler = ref(null);
const tempEntity = shallowRef(null); // 临时实体（可能是线、圆等）
const editingEntity = shallowRef(null); // 当前编辑的实体
const editingVertices = ref([]); // 编辑顶点实体数组
const draggedVertex = ref(null); // 当前拖拽的顶点
const editBottomHeight = ref(10);
const editTopHeight = ref(300);
const selectedShape = ref('custom'); // 默认自定义绘制
const airspaceType = ref('3d'); // 默认立体类型

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
    if (editing.value) {
        return '📝 点击空域进入编辑，拖拽顶点修改形状';
    }
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
    if (editing.value) {
        exitEditMode();
    }
};

// 类型改变时的处理
const onTypeChange = () => {
    if (drawing.value) {
        stopDrawing();
    }
    if (editing.value) {
        exitEditMode();
    }
    // 如果切换到平面模式，重置高度
    if (airspaceType.value === '2d') {
        editBottomHeight.value = 0;
        editTopHeight.value = 0;
    } else {
        editBottomHeight.value = 10;
        editTopHeight.value = 300;
    }
};

// 切换编辑模式
const toggleEditMode = () => {
    if (editing.value) {
        exitEditMode();
    } else {
        enterEditMode();
    }
};

// 进入编辑模式
const enterEditMode = () => {
    if (drawing.value) return;

    editing.value = true;
    console.log('进入编辑模式');

    const { viewer } = props;
    viewer.canvas.style.cursor = 'pointer';

    // 设置编辑模式的事件处理器
    editHandler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 点击选择空域进行编辑
    editHandler.value.setInputAction((click) => {
        const picked = viewer.scene.pick(click.position);
        if (picked && picked.id && picked.id._isAirspacePolygon) {
            startEditingEntity(picked.id);
        } else if (picked && picked.id && picked.id._isEditVertex) {
            // 点击编辑顶点
            startDraggingVertex(picked.id, click.position);
        } else {
            // 点击空白区域，完成当前编辑
            if (editingEntity.value) {
                finishEditingEntity();
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 鼠标移动处理拖拽
    editHandler.value.setInputAction((movement) => {
        if (draggedVertex.value) {
            handleVertexDrag(movement.endPosition);
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 释放拖拽
    editHandler.value.setInputAction(() => {
        if (draggedVertex.value) {
            finishVertexDrag();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
};

// 退出编辑模式
const exitEditMode = () => {
    editing.value = false;

    if (editingEntity.value) {
        finishEditingEntity();
    }

    if (editHandler.value) {
        editHandler.value.destroy();
        editHandler.value = null;
    }

    props.viewer.canvas.style.cursor = 'default';
    console.log('退出编辑模式');
};

// 开始编辑某个实体
const startEditingEntity = (entity) => {
    if (editingEntity.value) {
        finishEditingEntity();
    }

    editingEntity.value = entity;
    console.log('开始编辑实体:', entity.name);

    // 高亮显示选中的实体
    highlightEntity(entity, true);

    // 创建编辑顶点
    createEditVertices(entity);

    // 更新高度控制器的值
    const airspace = airspacePolygons.value.find(a => a.entity === entity);
    if (airspace) {
        editBottomHeight.value = airspace.bottomHeight;
        editTopHeight.value = airspace.topHeight;
    }
};

// 完成编辑实体
const finishEditingEntity = () => {
    if (!editingEntity.value) return;

    console.log('完成编辑实体:', editingEntity.value.name);

    // 取消高亮
    highlightEntity(editingEntity.value, false);

    // 清除编辑顶点
    clearEditVertices();

    editingEntity.value = null;
};

// 高亮/取消高亮实体
const highlightEntity = (entity, highlight) => {
    if (entity.polygon) {
        entity.polygon.outlineColor = highlight ? Cesium.Color.YELLOW : Cesium.Color.CYAN;
        entity.polygon.outlineWidth = highlight ? 3 : 1;
    } else if (entity.ellipse) {
        entity.ellipse.outlineColor = highlight ? Cesium.Color.YELLOW : Cesium.Color.CYAN;
        entity.ellipse.outlineWidth = highlight ? 3 : 1;
    }
};

// 创建编辑顶点（改进版本）
const createEditVertices = (entity) => {
    const { viewer } = props;
    const airspace = airspacePolygons.value.find(a => a.entity === entity);

    if (!airspace) return;

    // 清除之前的编辑顶点
    clearEditVertices();

    let positions = [];

    if (airspace.shape === 'circle') {
        // 圆形：创建中心点和半径点
        positions = [airspace.center];
        // 计算半径点位置（在中心点的东方向）
        const centerCarto = Cesium.Cartographic.fromCartesian(airspace.center);
        const radiusCarto = new Cesium.Cartographic(
            centerCarto.longitude + (airspace.radius / (6378137.0 * Math.cos(centerCarto.latitude))),
            centerCarto.latitude,
            centerCarto.height
        );
        const radiusPoint = Cesium.Cartesian3.fromRadians(radiusCarto.longitude, radiusCarto.latitude, radiusCarto.height);
        positions.push(radiusPoint);
    } else {
        // 多边形：使用存储的顶点位置
        positions = [...airspace.positions];
    }

    positions.forEach((position, index) => {
        const vertex = viewer.entities.add({
            position: position,
            point: {
                pixelSize: 12,
                color: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.5, 1.5e7, 0.5),
            },
            label: airspace.shape === 'circle' && index === 0 ? {
                text: 'C',
                font: "bold 10px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5),
            } : (airspace.shape === 'circle' && index === 1 ? {
                text: 'R',
                font: "bold 10px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5),
            } : undefined),
            _isEditVertex: true,
            _vertexIndex: index,
            _parentEntity: entity,
        });

        editingVertices.value.push(vertex);
    });

    console.log('已创建', editingVertices.value.length, '个编辑顶点');
};

// 清除编辑顶点
const clearEditVertices = () => {
    const { viewer } = props;
    editingVertices.value.forEach(vertex => {
        try {
            viewer.entities.remove(vertex);
        } catch (error) {
            console.warn('移除编辑顶点时出错:', error);
        }
    });
    editingVertices.value = [];
};

// 开始拖拽顶点
const startDraggingVertex = (vertex, clickPosition) => {
    draggedVertex.value = vertex;
    console.log('开始拖拽顶点:', vertex._vertexIndex);

    // 改变光标样式
    props.viewer.canvas.style.cursor = 'move';
};

// 处理顶点拖拽
const handleVertexDrag = (screenPosition) => {
    if (!draggedVertex.value) return;

    const { viewer } = props;
    const cartesian = getCartesianFromScreenPosition(screenPosition);

    if (cartesian) {
        // 更新顶点位置
        draggedVertex.value.position = cartesian;

        // 更新父实体的几何形状
        updateEntityGeometry(draggedVertex.value._parentEntity, draggedVertex.value._vertexIndex, cartesian);
    }
};

// 完成顶点拖拽
const finishVertexDrag = () => {
    if (!draggedVertex.value) return;

    console.log('完成顶点拖拽:', draggedVertex.value._vertexIndex);
    draggedVertex.value = null;
    props.viewer.canvas.style.cursor = 'pointer';
};

// 从屏幕位置获取世界坐标
const getCartesianFromScreenPosition = (screenPosition) => {
    const { viewer } = props;
    try {
        let cartesian = viewer.scene.pickPosition(screenPosition);
        if (cartesian && Cesium.defined(cartesian)) {
            return cartesian;
        }

        const ellipsoid = viewer.scene.globe.ellipsoid;
        cartesian = viewer.camera.pickEllipsoid(screenPosition, ellipsoid);
        if (cartesian && Cesium.defined(cartesian)) {
            return cartesian;
        }

        return null;
    } catch (error) {
        console.warn('获取屏幕坐标对应的世界坐标时出错:', error);
        return null;
    }
};

// 更新实体几何形状
const updateEntityGeometry = (entity, vertexIndex, newPosition) => {
    const airspace = airspacePolygons.value.find(a => a.entity === entity);
    if (!airspace) return;

    if (airspace.shape === 'circle') {
        if (vertexIndex === 0) {
            // 移动中心点
            airspace.center = newPosition;
            entity.position = newPosition;

            // 重新计算并更新编辑顶点位置
            const radiusVertex = editingVertices.value[1];
            if (radiusVertex) {
                const radiusPoint = new Cesium.Cartesian3(
                    newPosition.x + airspace.radius,
                    newPosition.y,
                    newPosition.z
                );
                radiusVertex.position = radiusPoint;
            }
        } else if (vertexIndex === 1) {
            // 调整半径
            const newRadius = Cesium.Cartesian3.distance(airspace.center, newPosition);
            airspace.radius = newRadius;
            entity.ellipse.semiMajorAxis = newRadius;
            entity.ellipse.semiMinorAxis = newRadius;
        }
    } else {
        // 多边形形状：更新顶点位置
        airspace.positions[vertexIndex] = newPosition;

        if (entity.polygon) {
            entity.polygon.hierarchy = new Cesium.PolygonHierarchy([...airspace.positions]);
        }
    }
};

// 删除选中的实体
const deleteSelectedEntity = () => {
    if (!editingEntity.value) return;

    const entityToDelete = editingEntity.value;

    // 从空域数组中移除
    const index = airspacePolygons.value.findIndex(a => a.entity === entityToDelete);
    if (index !== -1) {
        airspacePolygons.value.splice(index, 1);
    }

    // 清除编辑状态
    finishEditingEntity();

    // 从场景中移除实体
    try {
        props.viewer.entities.remove(entityToDelete);
        console.log('已删除空域:', entityToDelete.name);
    } catch (error) {
        console.error('删除实体时出错:', error);
    }
};

// 开始绘制
const startDrawing = () => {
    if (drawing.value || editing.value) return;

    console.log('开始绘制空域...', selectedShape.value, '类型:', airspaceType.value);
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

// 获取当前使用的高度值
const getCurrentHeights = () => {
    if (airspaceType.value === '2d') {
        return { bottom: 0, top: 0 };
    }
    return {
        bottom: editBottomHeight.value,
        top: editTopHeight.value
    };
};

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
};

// 完成矩形绘制
const finishDrawingRectangle = (points) => {
    if (!points || points.length < 2 || !points[0] || !points[1]) {
        console.warn("矩形绘制需要两个有效的点");
        stopDrawing();
        return;
    }

    const { viewer } = props;
    const heights = getCurrentHeights();

    // 创建矩形点集
    let positions;
    try {
        positions = createRectangleHierarchy(points[0], points[1]);
    } catch (error) {
        console.warn('创建矩形层次结构时出错:', error);
        stopDrawing();
        return;
    }

    if (!positions || !Array.isArray(positions) || positions.length < 4) {
        console.warn("生成的矩形点集无效");
        stopDrawing();
        return;
    }

    const hasInvalidPoint = positions.some(point => !point || !Cesium.defined(point));
    if (hasInvalidPoint) {
        console.warn("矩形点集中包含无效点");
        stopDrawing();
        return;
    }

    try {
        const entityConfig = {
            name: `矩形空域_${Date.now()}`,
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: Cesium.Color.BLUE.withAlpha(0.4),
                outline: true,
                outlineColor: Cesium.Color.CYAN,
            },
            _isAirspacePolygon: true,
        };

        // 根据类型设置高度属性
        if (airspaceType.value === '3d') {
            entityConfig.polygon.height = heights.bottom;
            entityConfig.polygon.extrudedHeight = heights.top;
        } else {
            entityConfig.polygon.height = 100;

        }

        const entity = viewer.entities.add(entityConfig);

        airspacePolygons.value.push({
            positions: positions,
            entity: entity,
            bottomHeight: heights.bottom,
            topHeight: heights.top,
            shape: 'rectangle',
            cornerPoints: points,
            type: airspaceType.value,
        });

        makeEditable(entity);
    } catch (error) {
        console.error('创建矩形实体时出错:', error);
    }

    stopDrawing();
};

// 改进的矩形点集创建函数
const createRectangleHierarchy = (point1, point2) => {
    const carto1 = Cesium.Cartographic.fromCartesian(point1);
    const carto2 = Cesium.Cartographic.fromCartesian(point2);

    const west = Math.min(carto1.longitude, carto2.longitude);
    const east = Math.max(carto1.longitude, carto2.longitude);
    const south = Math.min(carto1.latitude, carto2.latitude);
    const north = Math.max(carto1.latitude, carto2.latitude);

    // 逆时针顺序：SW -> SE -> NE -> NW
    return [
        Cesium.Cartesian3.fromRadians(west, south), // SW
        Cesium.Cartesian3.fromRadians(east, south), // SE
        Cesium.Cartesian3.fromRadians(east, north), // NE
        Cesium.Cartesian3.fromRadians(west, north), // NW
    ];
};


// 工具函数改进
const getCartesianFromClick = (click) => {
    const { viewer } = props;
    try {
        let cartesian = viewer.scene.pickPosition(click.position);
        if (cartesian && Cesium.defined(cartesian)) {
            return cartesian;
        }

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
            addPointMarker(cartesian, 'C');
            console.log('已设置圆形中心点，等待确定半径');
        } else {
            // 第二次点击 - 确定半径并完成
            points[1] = cartesian;
            const radius = Cesium.Cartesian3.distance(centerPoint, cartesian);
            finishDrawingCircle(centerPoint, radius);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
};

// 完成圆形绘制
const finishDrawingCircle = (center, radius) => {
    const { viewer } = props;
    const heights = getCurrentHeights();

    const entityConfig = {
        name: `圆形空域_${Date.now()}`,
        position: center,
        ellipse: {
            semiMajorAxis: radius,
            semiMinorAxis: radius,
            material: Cesium.Color.BLUE.withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
        },
        _isAirspacePolygon: true,
    };

    // 根据类型设置高度属性
    if (airspaceType.value === '3d') {
        entityConfig.ellipse.height = heights.bottom;
        entityConfig.ellipse.extrudedHeight = heights.top;
    } else {
        entityConfig.ellipse.height = 100;
    }

    const entity = viewer.entities.add(entityConfig);

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
        bottomHeight: heights.bottom,
        topHeight: heights.top,
        shape: 'circle',
        center: center,
        radius: radius,
        type: airspaceType.value,
    });

    makeEditable(entity);
    stopDrawing();
};

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
            console.log('已设置正方形中心点，等待确定大小');
        } else {
            // 第二次点击 - 确定大小并完成
            points[1] = cartesian;
            const sideLength = Cesium.Cartesian3.distance(centerPoint, cartesian);
            finishDrawingSquare(centerPoint, sideLength);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
};

// 完成正方形绘制
const finishDrawingSquare = (center, sideLength) => {
    const { viewer } = props;
    const heights = getCurrentHeights();

    const positions = createSquareHierarchy(center, sideLength);

    const entityConfig = {
        name: `正方形空域_${Date.now()}`,
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.BLUE.withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
        },
        _isAirspacePolygon: true,
    };

    // 根据类型设置高度属性
    if (airspaceType.value === '3d') {
        entityConfig.polygon.height = heights.bottom;
        entityConfig.polygon.extrudedHeight = heights.top;
    } else {
        entityConfig.polygon.height = 100;
    }

    const entity = viewer.entities.add(entityConfig);

    airspacePolygons.value.push({
        positions: positions,
        entity: entity,
        bottomHeight: heights.bottom,
        topHeight: heights.top,
        shape: 'square',
        center: center,
        sideLength: sideLength,
        type: airspaceType.value,
    });

    makeEditable(entity);
    stopDrawing();
};

const createSquareHierarchy = (center, sideLength) => {
    const carto = Cesium.Cartographic.fromCartesian(center);
    const halfSide = sideLength / 2;

    const R = 6378137.0; // 地球半径（更精确）
    const deltaLon = halfSide / (R * Math.cos(carto.latitude));
    const deltaLat = halfSide / R;

    // 逆时针顺序：SW -> SE -> NE -> NW
    return [
        Cesium.Cartesian3.fromRadians(carto.longitude - deltaLon, carto.latitude + deltaLat), // NW
    ];
};


// 自定义绘制（最保守修复版本）
const startDrawingCustom = () => {
    const { viewer } = props;
    const positions = [];

    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 单击添加点
    handler.value.setInputAction((click) => {
        const cartesian = getCartesianFromClick(click);
        if (cartesian) {
            positions.push(cartesian);
            addPointMarker(cartesian, positions.length);
            console.log(`已添加第${positions.length}个点`);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 双击结束绘制
    handler.value.setInputAction((event) => {
        event.preventDefault?.();
        if (positions.length > 2) {
            finishDrawingCustom(positions);
        } else {
            console.warn('需要至少3个点才能构成空域，当前点数:', positions.length);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // 右键结束（备用）
    handler.value.setInputAction(() => {
        if (positions.length > 2) {
            finishDrawingCustom(positions);
        } else {
            console.warn('需要至少3个点才能构成空域，当前点数:', positions.length);
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

// 完成自定义绘制
const finishDrawingCustom = (positions) => {
    if (!positions || positions.length < 3) {
        console.warn("自定义绘制需要至少3个点");
        stopDrawing();
        return;
    }

    const { viewer } = props;
    const heights = getCurrentHeights();

    const entityConfig = {
        name: `自定义空域_${Date.now()}`,
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.BLUE.withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
        },
        _isAirspacePolygon: true,
    };

    // 根据类型设置高度属性
    if (airspaceType.value === '3d') {
        entityConfig.polygon.height = heights.bottom;
        entityConfig.polygon.extrudedHeight = heights.top;
    } else {
        entityConfig.polygon.height = 100;

    }

    const entity = viewer.entities.add(entityConfig);

    airspacePolygons.value.push({
        positions: [...positions],
        entity: entity,
        bottomHeight: heights.bottom,
        topHeight: heights.top,
        shape: 'custom',
        type: airspaceType.value,
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
        props.viewer.canvas.style.cursor = editing.value ? 'pointer' : 'default';
    }

    drawing.value = false;
    console.log('停止绘制模式');
};

// 使多边形可编辑
const makeEditable = (entity) => {
    editingEntity.value = entity;
    const heights = getCurrentHeights();
    editBottomHeight.value = heights.bottom;
    editTopHeight.value = heights.top;
    console.log('设置空域为可编辑模式');
};

// 更新高度
const updateHeights = () => {
    if (!editingEntity.value || airspaceType.value === '2d') return;

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
        if (entity._isAirspacePolygon || entity._isAirspaceMarker || entity._isEditVertex) {
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
    editingVertices.value = [];
    airspacePolygons.value = [];
    stopDrawing();
    if (editing.value) {
        exitEditMode();
    }

    console.log('已清除所有空域');
};

// 组件卸载时清理
onUnmounted(() => {
    stopDrawing();
    if (editing.value) {
        exitEditMode();
    }
});

// 暴露给父组件的接口
defineExpose({
    airspacePolygons,
    startDrawing,
    stopDrawing,
    clearAll,
    toggleEditMode,
    editing,
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

.shape-selector,
.type-selector {
    margin-bottom: 16px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
}

.shape-selector label,
.type-selector label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    color: #cbd5e0;
    font-weight: 500;
}

.shape-selector select,
.type-selector select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #4a5568;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-size: 14px;
    cursor: pointer;
}

.shape-selector select:focus,
.type-selector select:focus {
    outline: none;
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.2);
}

.shape-selector select option,
.type-selector select option {
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

.edit-btn {
    background: linear-gradient(135deg, #4fd1c7 0%, #38b2ac 100%);
    color: white;
}

.edit-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #38b2ac 0%, #319795 100%);
    transform: translateY(-1px);
}

.edit-btn-active {
    background: linear-gradient(135deg, #f6ad55 0%, #ed8936 100%);
    color: white;
}

.edit-btn-active:hover {
    background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
    transform: translateY(-1px);
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

.update-btn:disabled {
    background: #4a5568;
    cursor: not-allowed;
    opacity: 0.6;
}

.delete-btn {
    background: linear-gradient(135deg, #fc8181 0%, #e53e3e 100%);
    color: white;
}

.delete-btn:hover {
    background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);
    transform: translateY(-1px);
}

.edit-info {
    padding: 10px;
    background: rgba(72, 187, 120, 0.15);
    border: 1px solid rgba(72, 187, 120, 0.3);
    border-radius: 6px;
    margin-bottom: 16px;
}

.edit-info p {
    margin: 2px 0;
    font-size: 12px;
    color: #9ae6b4;
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

.height-inputs input:disabled {
    background: rgba(255, 255, 255, 0.05);
    color: #718096;
    cursor: not-allowed;
}

.height-inputs input:focus {
    outline: none;
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.15);
}

.edit-controls {
    display: flex;
    gap: 8px;
}

.edit-controls button {
    flex: 1;
    padding: 8px 12px;
    font-size: 12px;
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