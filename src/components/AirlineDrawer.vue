<!-- AirspaceDrawer.vue -->
<template>
    <div class="drawer-controls">
        <div class="control-header">
            <h4>🚁 航道绘制</h4>
        </div>
        <!-- 🎨 新增：空域颜色选择 -->
        <div class="color-selector">
            <label>填充颜色:</label>
            <input type="color" v-model="fillColor" />
            <label>轮廓颜色:</label>
            <input type="color" v-model="outlineColor" />
            <!-- 🔁 新增：更新颜色按钮 -->
            <button @click="updateSelectedEntityColor" :disabled="!editingEntity" class="color-update-btn">
                更新颜色
            </button>
        </div>

        <div class="control-group">
            <button @click="startDrawing" :disabled="drawing || editing" class="primary-btn">
                {{ getDrawingButtonText() }}
            </button>
            <button @click="toggleEditMode" :disabled="drawing" :class="editing ? 'edit-btn-active' : 'edit-btn'">
                {{ editing ? '退出编辑' : '编辑模式' }}
            </button>
            <button @click="clearAll" class="danger-btn">清除所有</button>

            <!-- 在 clearAll 按钮之后或其他位置添加 -->
            <button @click="saveAirspace" class="save-btn">保存航道</button>
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

                <!-- ✅ 新增：航道宽度（仅当编辑管状空域时显示） -->
                <label> 航道宽度 (m): <input type="number" v-model.number="editTubeWidth" min="10" max="5000" />
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
import { ref, shallowRef, onUnmounted, onMounted, computed } from "vue";
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
const editBottomHeight = ref(100);
const editTopHeight = ref(300);
const selectedShape = ref('tube'); // 默认自定义绘制
const airspaceType = ref('3d'); // 默认立体类型

// 🆕 新增：空域类型（适飞、限飞、禁飞）
const airspaceCategory = ref('suitable');

// 🎨 新增：颜色状态，默认为蓝色填充和青色轮廓
const fillColor = ref('#0000FF'); // 蓝色
const outlineColor = ref('#00FFFF'); // 青色

// 空域多边形数组
const airspacePolygons = ref([]);

const editTubeWidth = ref(100); // 默认宽度 100 米

// 设置默认颜色（根据空域类型）
const setDefaultColors = () => {
    const colors = {
        suitable: { fill: '#00FF00', outline: '#00CC00' }, // 绿色
        restricted: { fill: '#FFA500', outline: '#CC8400' }, // 橙色
        prohibited: { fill: '#FF0000', outline: '#CC0000' }  // 红色
    };
    const selectedColors = colors[airspaceCategory.value];
    fillColor.value = selectedColors.fill;
    outlineColor.value = selectedColors.outline;
};

// 获取绘制按钮文字
const getDrawingButtonText = () => {
    if (!drawing.value) {
        switch (selectedShape.value) {

            case 'tube': return '开始绘制管状航道';
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

        case 'tube':
            return '🖱️ 左键点击添加路径点，右键结束绘制管状空域';
    }
};

const onCategoryChange = () => {
    if (drawing.value) {
        stopDrawing();
    }
    // if (editing.value) {
    //     exitEditMode();
    // }
    // 根据空域类型设置默认颜色
    setDefaultColors();
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
        editBottomHeight.value = 100;
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
            // if (editingEntity.value) {
            //     finishEditingEntity();
            // }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

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

    // ✅ 新增：自动选中并开始编辑第一个空域
    // 在进入编辑模式后，立即尝试编辑第一个空域
    const firstAirspaceEntity = airspacePolygons.value.length > 0 ? airspacePolygons.value[0].entity : null;
    if (firstAirspaceEntity) {
        startEditingEntity(firstAirspaceEntity);
        console.log('已自动选中第一个空域:', firstAirspaceEntity.name);
    } else {
        console.log('没有可编辑的空域');
    }
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

        // ✅ 同步颜色
        if (airspace.fillColor && airspace.outlineColor) {
            fillColor.value = airspace.fillColor;
            outlineColor.value = airspace.outlineColor;
        }
        // ✅ 同步空域类型
        airspaceCategory.value = airspace.category || 'suitable';

        // ✅ 如果是管状空域，加载宽度
        if (airspace.shape === 'tube') {
            editTubeWidth.value = airspace.width || 100;
        }
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

// 开始绘制管状空域
const startDrawingTube = () => {
    const { viewer } = props;
    const positions = [];
    handler.value = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 左键添加点
    handler.value.setInputAction((click) => {
        const cartesian = getCartesianFromClick(click);
        if (cartesian) {
            positions.push(cartesian);
            addPointMarker(cartesian, positions.length);
            console.log(`已添加第${positions.length}个路径点`);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 右键结束绘制
    handler.value.setInputAction(() => {
        if (positions.length >= 2) {
            finishDrawingTube(positions);
        } else {
            console.warn('管状空域至少需要2个点，当前点数:', positions.length);
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

// 完成管状空域绘制
// 完成管状空域绘制（使用 polylineVolume）
const finishDrawingTube = (positions) => {
    const { viewer } = props;
    const heights = getCurrentHeights();
    const width = 100;
    const height = airspaceType.value === '3d' ? (heights.top - heights.bottom) : 100;

    // ✅ 关键修复：将路径点高度统一设为底部高度（3D 模式）
    let adjustedPositions = positions;
    if (airspaceType.value === '3d') {
        adjustedPositions = positions.map(pos => {
            const carto = Cesium.Cartographic.fromCartesian(pos);
            return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, heights.bottom);
        });
    } else {
        // 2D 模式：统一设为 100m
        adjustedPositions = positions.map(pos => {
            const carto = Cesium.Cartographic.fromCartesian(pos);
            return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 100);
        });
    }

    // 构建横截面
    const shape2D = [
        new Cesium.Cartesian2(-width / 2, -height / 2),
        new Cesium.Cartesian2(width / 2, -height / 2),
        new Cesium.Cartesian2(width / 2, height / 2),
        new Cesium.Cartesian2(-width / 2, height / 2)
    ];

    const entityConfig = {
        name: `管状空域_${Date.now()}`,
        polylineVolume: {
            positions: adjustedPositions, // ✅ 使用调整后的点
            shape: shape2D,
            material: Cesium.Color.fromCssColorString(fillColor.value).withAlpha(0.4),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(outlineColor.value),
        },
        _isAirspacePolygon: true,
    };

    const entity = viewer.entities.add(entityConfig);

    // ✅ 添加管状空域每段的距离标签
    const distanceLabels = [];
    const numPositions = adjustedPositions.length;
    for (let i = 0; i < numPositions - 1; i++) {
        const start = adjustedPositions[i];
        const end = adjustedPositions[i + 1];
        const distance = Cesium.Cartesian3.distance(start, end);
        const midPoint = Cesium.Cartesian3.lerp(start, end, 0.5, new Cesium.Cartesian3());
        const labelEntity = viewer.entities.add({
            position: midPoint,
            label: {
                text: `${Math.round(distance)}m`,
                font: "bold 14px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -10),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5),
            },
            _isAirspaceLineMarker: true, // 用于后续清除
        });
        distanceLabels.push(labelEntity);
    }

    airspacePolygons.value.push({
        positions: [...adjustedPositions], // ✅ 保存调整后的点
        entity: entity,
        entityId: entity.id,
        bottomHeight: heights.bottom,
        topHeight: heights.top,
        shape: 'tube',
        width: width,
        height: height,
        type: airspaceType.value,
        category: airspaceCategory.value,
        fillColor: fillColor.value,
        outlineColor: outlineColor.value,
        // ✅ 保存距离标签
        distanceLabels: distanceLabels,
    });

    makeEditable(entity);
    stopDrawing();
};

// 🔽 新增：保存空域信息到控制台
const saveAirspace = () => {
    if (airspacePolygons.value.length === 0) {
        console.log('❌ 没有可保存的空域。');
        return;
    }

    console.log('✅ 开始保存空域信息...');
    console.log('='.repeat(50));

    airspacePolygons.value.forEach((airspace, index) => {
        console.log(`📌 空域 ${index + 1}: ${airspace.entity.name}`);
        console.log(`   类型: ${airspace.category === 'suitable' ? '适飞区' :
            airspace.category === 'restricted' ? '限飞区' : '禁飞区'}`);
        console.log(`   形状: ${airspace.shape === 'custom' ? '自定义' :
            airspace.shape === 'circle' ? '圆形' :
                airspace.shape === 'rectangle' ? '矩形' : '正方形'}`);
        console.log(`   3D模式: ${airspace.type === '3d' ? '是' : '否'}`);

        // 输出高度信息
        if (airspace.type === '3d') {
            console.log(`   📏 高度: 底部 ${airspace.bottomHeight}m, 顶部 ${airspace.topHeight}m`);
        } else {
            console.log(`   📏 高度: 平面 (固定高度)`); // 2D 模式下的处理
        }

        if (airspace.shape === 'tube') {
            console.log(`   🚇 管状空域宽度: ${airspace.width} 米`);
            console.log(`   📍 路径点 (${airspace.positions.length} 个):`);
            airspace.positions.forEach((pos, i) => {
                const carto = Cesium.Cartographic.fromCartesian(pos);
                const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(6);
                const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6);
                const height = carto.height.toFixed(2);
                console.log(`     [${i + 1}] 经度: ${lon}, 纬度: ${lat}, 高度: ${height}m`);
            });
        } else {
            // 圆形：输出中心点和半径
            const centerCarto = Cesium.Cartographic.fromCartesian(airspace.center);
            const centerLon = Cesium.Math.toDegrees(centerCarto.longitude).toFixed(6);
            const centerLat = Cesium.Math.toDegrees(centerCarto.latitude).toFixed(6);
            const centerHeight = centerCarto.height.toFixed(2);
            console.log(`   🔵 圆形中心: 经度 ${centerLon}, 纬度 ${centerLat}, 高度 ${centerHeight}m`);
            console.log(`   🔵 半径: ${airspace.radius.toFixed(2)} 米`);
        }

        console.log('-'.repeat(40));
    });

    console.log('✅ 所有空域信息已保存到控制台。');
    console.log('='.repeat(50));
};

// 🔁 这个函数是实现“刷新颜色”的核心
const updateSelectedEntityColor = () => {
    if (!editingEntity.value) {
        console.warn('没有选中的空域，无法更新颜色');
        return;
    }
    const entity = editingEntity.value;
    const newFillColor = Cesium.Color.fromCssColorString(fillColor.value).withAlpha(0.4);
    const newOutlineColor = Cesium.Color.fromCssColorString(outlineColor.value);

    try {
        if (entity.polylineVolume) {
            // ✅ 新增：支持管状空域颜色更新
            entity.polylineVolume.material = new Cesium.ColorMaterialProperty(newFillColor);
            entity.polylineVolume.outlineColor = new Cesium.ConstantProperty(newOutlineColor);
        }

        // ✅ 更新存储的数据
        const airspace = airspacePolygons.value.find(a => a.entity === entity);
        if (airspace) {
            airspace.fillColor = fillColor.value;
            airspace.outlineColor = outlineColor.value;
        }

        console.log('空域颜色已更新:', entity.name);
    } catch (error) {
        console.error('更新空域颜色时出错:', error);
    }
};

// 创建编辑顶点（改进版本）
const createEditVertices = (entity) => {
    const { viewer } = props;
    const airspace = airspacePolygons.value.find(a => a.entity === entity);

    // if (!airspace || airspace.shape === 'tube') {
    //     console.warn('管状空域暂不支持编辑');
    //     return;
    // }

    if (!airspace) return;

    // 清除之前的编辑顶点
    clearEditVertices();

    let positions = [];

    if (airspace.shape === 'circle') {
        // 圆形：创建中心点和半径点
        // ✅ 获取空域的底部高度
        const bottomHeight = airspace.bottomHeight;

        // ✅ 1. 创建中心点编辑顶点 (C)
        // 将原始中心点提升到空域的底部高度
        const centerCarto = Cesium.Cartographic.fromCartesian(airspace.center);
        const elevatedCenterCarto = new Cesium.Cartographic(
            centerCarto.longitude,
            centerCarto.latitude,
            bottomHeight // ✅ 使用正确的底部高度
        );
        const elevatedCenter = Cesium.Cartesian3.fromRadians(
            elevatedCenterCarto.longitude,
            elevatedCenterCarto.latitude,
            elevatedCenterCarto.height
        );
        positions.push(elevatedCenter);

        // ✅ 2. 创建半径点编辑顶点 (R)
        // 计算半径点位置（在中心点的东方向），同样提升到相同高度
        const radiusCarto = new Cesium.Cartographic(
            centerCarto.longitude + (airspace.radius / (6378137.0 * Math.cos(centerCarto.latitude))),
            centerCarto.latitude,
            bottomHeight // ✅ 高度一致
        );
        const elevatedRadiusPoint = Cesium.Cartesian3.fromRadians(
            radiusCarto.longitude,
            radiusCarto.latitude,
            radiusCarto.height
        );
        positions.push(elevatedRadiusPoint);
    } else {
        // 多边形：使用存储的顶点位置
        positions = [...airspace.positions];
    }

    const entityHeight = airspace.bottomHeight;


    positions.forEach((position, index) => {

        // ✅ 关键：将点提升到空域底部高度
        const carto = Cesium.Cartographic.fromCartesian(position);
        const elevatedPosition = Cesium.Cartesian3.fromRadians(
            carto.longitude,
            carto.latitude,
            entityHeight // ✅ 设置为底部高度
        );

        const vertex = viewer.entities.add({
            position: elevatedPosition, // ✅ 使用提升后的高度
            point: {
                pixelSize: 12,
                color: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                //heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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

    const { viewer } = props;
    // 改变光标样式
    props.viewer.canvas.style.cursor = 'move';
    // 👉 彻底禁用相机控制的输入
    viewer.scene.screenSpaceCameraController.enableInputs = false;

    // 动态放大顶点
    vertex.point.pixelSize = 18; // 放大到 18px
    vertex.point.color = Cesium.Color.RED; // 变红表示活跃
};

// 处理顶点拖拽
// 处理顶点拖拽
const handleVertexDrag = (screenPosition) => {
    if (!draggedVertex.value) return;

    const { viewer } = props;
    const cartesian = getCartesianFromScreenPosition(screenPosition);

    if (cartesian) {
        // ✅ 获取当前空域的底部高度
        const airspace = airspacePolygons.value.find(a => a.entity === draggedVertex.value._parentEntity);
        if (!airspace) return;

        // ✅ 修改：直接使用存储的 bottomHeight
        const entityHeight = airspace.bottomHeight;

        // ✅ 提取经纬度，设置固定高度
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const elevatedPosition = Cesium.Cartesian3.fromRadians(
            carto.longitude,
            carto.latitude,
            entityHeight // ✅ 使用一致的高度
        );

        // ✅ 更新顶点位置（保持在空中）
        draggedVertex.value.position = elevatedPosition;

        // 更新父实体的几何形状
        updateEntityGeometry(draggedVertex.value._parentEntity, draggedVertex.value._vertexIndex, elevatedPosition);
    }
};

// 完成顶点拖拽
const finishVertexDrag = () => {
    if (!draggedVertex.value) return;

    const { viewer } = props;
    // 恢复相机输入
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    // 恢复原始大小
    draggedVertex.value.point.pixelSize = 12;
    draggedVertex.value.point.color = Cesium.Color.YELLOW;
    console.log('完成顶点拖拽:', draggedVertex.value._vertexIndex);
    draggedVertex.value = null;
    props.viewer.canvas.style.cursor = 'pointer';

};

// 从屏幕位置获取世界坐标
const getCartesianFromScreenPosition = (screenPosition) => {
    const { viewer } = props;
    if (!screenPosition) {
        console.warn("screenPosition 为空，无法计算世界坐标");
        return null;
    }
    try {
        let cartesian = viewer.scene.pickPosition(screenPosition);
        if (Cesium.defined(cartesian)) {
            return cartesian;
        }

        const ellipsoid = viewer.scene.globe.ellipsoid;
        cartesian = viewer.camera.pickEllipsoid(screenPosition, ellipsoid);
        if (Cesium.defined(cartesian)) {
            return cartesian;
        }

        return null;
    } catch (error) {
        console.warn("获取屏幕坐标对应的世界坐标时出错:", error);
        return null;
    }
};


// 更新实体几何形状
const updateEntityGeometry = (entity, vertexIndex, newPosition) => {
    const airspace = airspacePolygons.value.find(a => a.entity === entity);
    if (!airspace) return;

    if (airspace.shape === 'tube') {
        // ✅ 管状空域：更新路径点
        airspace.positions[vertexIndex] = newPosition;
        // ✅ 直接赋值数组，Cesium 会自动处理
        entity.polylineVolume.positions = [...airspace.positions]; // 使用新数组触发更新

        // ✅ 更新距离标签（管状空域）
        if (airspace.distanceLabels && airspace.distanceLabels.length > 0) {
            airspace.distanceLabels.forEach(label => {
                try {
                    props.viewer.entities.remove(label);
                } catch (e) {
                    console.warn('移除旧距离标签失败:', e);
                }
            });
        }
        const newDistanceLabels = [];
        const pos = airspace.positions;
        for (let i = 0; i < pos.length - 1; i++) {
            const start = pos[i];
            const end = pos[i + 1];
            const dist = Cesium.Cartesian3.distance(start, end);
            const mid = Cesium.Cartesian3.lerp(start, end, 0.5, new Cesium.Cartesian3());
            const lbl = props.viewer.entities.add({
                position: mid,
                label: {
                    text: `${Math.round(dist)}m`,
                    font: "bold 14px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5),
                },
                _isAirspaceLineMarker: true,
            });
            newDistanceLabels.push(lbl);
        }
        airspace.distanceLabels = newDistanceLabels;
    } else {
        // 多边形逻辑不变
        airspace.positions[vertexIndex] = newPosition;
        if (entity.polygon) {
            entity.polygon.hierarchy = new Cesium.PolygonHierarchy([...airspace.positions]);
        }

        // ✅ 新增：编辑顶点后，更新所有边的距离标签
        // 1. 移除旧的标签
        if (airspace.distanceLabels && airspace.distanceLabels.length > 0) {
            airspace.distanceLabels.forEach(labelEntity => {
                try {
                    props.viewer.entities.remove(labelEntity);
                } catch (error) {
                    console.warn('移除旧距离标签时出错:', error);
                }
            });
        }
        // 2. 重新创建新的距离标签
        const distanceLabels = [];
        const numPositions = airspace.positions.length;
        for (let i = 0; i < numPositions; i++) {
            const start = airspace.positions[i];
            const end = airspace.positions[(i + 1) % numPositions];
            const distance = Cesium.Cartesian3.distance(start, end);
            const midPoint = Cesium.Cartesian3.lerp(start, end, 0.5, new Cesium.Cartesian3());

            const labelEntity = props.viewer.entities.add({
                position: midPoint,
                label: {
                    text: `${Math.round(distance)}m`,
                    font: "bold 14px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5),
                },
                _isAirspaceLineMarker: true,
            });
            distanceLabels.push(labelEntity);
        }
        // 3. 更新存储的引用
        airspace.distanceLabels = distanceLabels;
    }
};

// 更新半径线和标签
const updateRadiusLine = (airspace) => {
    if (!airspace.radiusLine || !airspace.radiusLabel) return;

    const { viewer } = props;
    const center = airspace.center;
    const radius = airspace.radius;
    const bottomHeight = airspace.bottomHeight;

    // 提升中心点到目标高度
    const centerWithHeight = Cesium.Cartesian3.fromRadians(
        Cesium.Cartographic.fromCartesian(center).longitude,
        Cesium.Cartographic.fromCartesian(center).latitude,
        bottomHeight
    );

    // 东方向点也提升到相同高度
    const eastCartesian = computeEastPoint(center, radius, bottomHeight);

    // 更新线段
    airspace.radiusLine.polyline.positions = [centerWithHeight, eastCartesian];

    // 更新标签（中点）
    const midPoint = Cesium.Cartesian3.lerp(centerWithHeight, eastCartesian, 0.5, new Cesium.Cartesian3());
    airspace.radiusLabel.position = midPoint;
    airspace.radiusLabel.label.text = `${Math.round(radius)}m`;
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

        case 'tube':
            startDrawingTube();
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


// 工具函数：在给定中心点和距离下，计算正东方向的点
const computeEastPoint = (center, distance, height = 0) => {
    const carto = Cesium.Cartographic.fromCartesian(center);
    const R = 6378137.0; // 地球半径
    const deltaLon = distance / (R * Math.cos(carto.latitude));

    const eastCarto = new Cesium.Cartographic(
        carto.longitude + deltaLon,
        carto.latitude,
        height // 使用传入的高度
    );

    return Cesium.Cartesian3.fromRadians(
        eastCarto.longitude,
        eastCarto.latitude,
        eastCarto.height
    );
};


const createSquareHierarchy = (center, sideLength) => {
    const carto = Cesium.Cartographic.fromCartesian(center);
    const halfSide = sideLength / 2;
    const R = 6378137.0; // 地球半径（米）

    // 计算经度和纬度的变化量（以弧度为单位）
    // 注意：经度的变化量受纬度影响（纬度越高，相同经度差对应的东西距离越短）
    const deltaLon = halfSide / (R * Math.cos(carto.latitude)); // 半边长对应的东西方向弧度差
    const deltaLat = halfSide / R; // 半边长对应的南北方向弧度差

    // 计算四个角点的经纬度（弧度）
    const west = carto.longitude - deltaLon;
    const east = carto.longitude + deltaLon;
    const south = carto.latitude - deltaLat;
    const north = carto.latitude + deltaLat;

    // 逆时针顺序创建点集 (SW -> SE -> NE -> NW)
    // 这是 Cesium PolygonHierarchy 推荐的顺序
    return [
        Cesium.Cartesian3.fromRadians(west, south), // 西南角 (SW)
        Cesium.Cartesian3.fromRadians(east, south), // 东南角 (SE)
        Cesium.Cartesian3.fromRadians(east, north), // 东北角 (NE)
        Cesium.Cartesian3.fromRadians(west, north)  // 西北角 (NW)
    ];
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

    // 👉 清除所有临时标记（包括 'C'、'1'、'2' 等）
    const { viewer } = props;
    viewer.entities.values
        .filter(entity => entity._isAirspaceMarker)
        .forEach(entity => {
            viewer.entities.remove(entity);
        });

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
// 更新高度（支持 polylineVolume）
const updateHeights = () => {
    if (!editingEntity.value || airspaceType.value === '2d') return;

    // ✅ 使用 id 匹配，而非引用
    const editingId = editingEntity.value.id;
    const airspace = airspacePolygons.value.find(a => a.entityId === editingId);
    if (!airspace) {
        console.warn('未找到对应空域数据，entityId:', editingId);
        return;
    }

    const newBottom = editBottomHeight.value;
    const newTop = editTopHeight.value;
    const newHeight = newTop - newBottom;

    // 更新数据
    airspace.bottomHeight = newBottom;
    airspace.topHeight = newTop;
    airspace.height = newHeight;

    // 更新实体
    const entity = editingEntity.value;

    if (entity.polygon) {
        entity.polygon.height = newBottom;
        entity.polygon.extrudedHeight = newTop;
    } else if (entity.ellipse) {
        entity.ellipse.height = newBottom;
        entity.ellipse.extrudedHeight = newTop;
    } else if (entity.polylineVolume) {
        // ✅ 处理 polylineVolume：重建 shape2D 和 positions

        // 1. 更新横截面（保持宽度不变，更新高度）
        const width = editTubeWidth.value;
        const shape2D = [
            new Cesium.Cartesian2(-width / 2, -newHeight / 2),
            new Cesium.Cartesian2(width / 2, -newHeight / 2),
            new Cesium.Cartesian2(width / 2, newHeight / 2),
            new Cesium.Cartesian2(-width / 2, newHeight / 2)
        ];
        entity.polylineVolume.shape = shape2D;

        // 2. 更新路径点高度：使管子中心位于 (bottom + top) / 2
        const centerHeight = (newBottom + newTop) / 2;
        const updatedPositions = airspace.positions.map(pos => {
            const carto = Cesium.Cartographic.fromCartesian(pos);
            return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, centerHeight);
        });
        entity.polylineVolume.positions = updatedPositions;

        // 3. 同步 airspace.positions 的高度（用于后续编辑/保存）
        airspace.positions = updatedPositions;
    }

    // ✅ 更新空域类型和颜色（已有逻辑）
    airspace.category = airspaceCategory.value;
    const colors = {
        suitable: { fill: '#00FF00', outline: '#00CC00' },
        restricted: { fill: '#FFA500', outline: '#CC8400' },
        prohibited: { fill: '#FF0000', outline: '#CC0000' }
    };
    const selectedColors = colors[airspaceCategory.value];
    fillColor.value = selectedColors.fill;
    outlineColor.value = selectedColors.outline;
    updateSelectedEntityColor();

    console.log('空域高度和类型已更新:', entity.name);
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

    // 👉 清除所有临时标记（包括 'C'、'1'、'2' 等）
    viewer.entities.values
        .filter(entity => entity._isAirspaceLineMarker)
        .forEach(entity => {
            viewer.entities.remove(entity);
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

// 组件挂载时设置默认颜色
onMounted(() => {
    setDefaultColors();
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
.save-btn {
    background: linear-gradient(135deg, #4299e1 0%, #3182ce 100%);
    color: white;
}

.save-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #3182ce 0%, #2b6cb0 100%);
    transform: translateY(-1px);
}

.save-btn:disabled {
    background: #4a5568;
    cursor: not-allowed;
    opacity: 0.6;
}

/* 🎨 新增：颜色选择器样式 */
.color-selector {
    margin-bottom: 16px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.color-selector label {
    display: block;
    font-size: 12px;
    color: #cbd5e0;
    font-weight: 500;
    white-space: nowrap;
}

.color-selector input[type="color"] {
    width: 36px;
    height: 36px;
    border: 2px solid #4a5568;
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    background: transparent;
}

/* 🆕 新增：空域类型选择器样式 */
.type-selector:nth-of-type(1) {
    margin-bottom: 12px;
}

.type-selector:nth-of-type(1) label {
    color: #90cdf4;
}

/* 🔁 新增：更新颜色按钮样式 */
.color-update-btn {
    padding: 6px 12px;
    background: linear-gradient(135deg, #805ad5 0%, #6b46c1 100%);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.2s ease;
    margin-top: 4px;
    align-self: flex-end;
}

.color-update-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #6b46c1 0%, #553c9a 100%);
    transform: translateY(-1px);
}

.color-update-btn:disabled {
    background: #4a5568;
    cursor: not-allowed;
    opacity: 0.6;
}

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