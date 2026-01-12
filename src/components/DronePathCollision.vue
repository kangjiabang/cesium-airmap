<template>
  <div class="drone-path-collision">
    <div class="control-panel">
      <h3>航线冲突检测</h3>
      <div class="button-group">
        <button @click="loadFlightPaths">加载航线</button>
        <button @click="performCollisionAnalysis">冲突检测</button>
        <button @click="clearAll">清除所有</button>
      </div>
      <div v-if="loading" class="loading">处理中...</div>
      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import * as Cesium from 'cesium';
import { api } from '../js/api.js';

const props = defineProps({
  viewer: { type: Object, required: true }
});

const loading = ref(false);
const error = ref('');

let flightPathEntities = [];
let collisionEntities = [];

const loadFlightPaths = async () => {
  loading.value = true;
  error.value = '';
  try {
    // 清除之前的航线
    clearFlightPaths();
    
    const response = await api.getFlightPaths();
    const paths = response.paths;
    
    paths.forEach((path, index) => {
      if (path.geometry && path.geometry.type === 'LineString') {
        const coordinates = path.geometry.coordinates;
        const positions = coordinates.map(coord => 
          Cesium.Cartesian3.fromDegrees(coord[0], coord[1], coord[2])
        );
        
        // 创建航线实体
        const pathEntity = props.viewer.entities.add({
          name: path.name || `Flight Path ${index}`, // 使用后端返回的 name 字段，如果不存在则使用默认名称
          polyline: {
            positions: positions,
            width: 3,
            material: Cesium.Color.BLUE,
            clampToGround: false
          }
        });
        
        // 计算航线的中心点，用于放置标签
        const centerIndex = Math.floor(positions.length / 2);
        const centerPosition = positions[centerIndex];
        
        // 创建独立的标签实体
        const labelEntity = props.viewer.entities.add({
          name: `Label for ${path.name || `Flight Path ${index}`}`,
          position: centerPosition,
          label: {
            text: path.name || `Flight Path ${index}`, // 显示航线名称的标签
            font: '14pt sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10), // 标签稍微偏移，避免覆盖航线
            scale: 0.8
          }
        });
        
        flightPathEntities.push(pathEntity, labelEntity);
      }
    });
  } catch (err) {
    console.error(err);
    if (err.response && err.response.data && err.response.data.detail) {
      error.value = `加载航线失败: ${err.response.data.detail}`;
    } else {
      error.value = `加载航线失败: ${err.message || err}`;
    }
  } finally {
    loading.value = false;
  }
};

const performCollisionAnalysis = async () => {
  loading.value = true;
  error.value = '';
  try {
    // 首先确保有航线数据
    if (flightPathEntities.length === 0) {
      error.value = '请先加载航线';
      return;
    }

    // 清除之前的冲突检测结果
    clearCollisionResults();

    const response = await api.analyzeCollision();
    const analysisResult = response;

    if (analysisResult.risk_paths && analysisResult.risk_paths.length > 0) {
      analysisResult.risk_paths.forEach(risk => {
        // 获取最近点坐标
        const point1 = risk.nearest_points.point1;
        const point2 = risk.nearest_points.point2;

        // 创建连接两点的冲突线
        const collisionLine = props.viewer.entities.add({
          name: `Collision Line`,
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(point1[0], point1[1], point1[2]),
              Cesium.Cartesian3.fromDegrees(point2[0], point2[1], point2[2])
            ],
            width: 3,
            // 根据风险等级设置不同的材质
            material: getRiskLevelMaterial(risk.risk_level),
            clampToGround: false
          }
        });

        // 计算两点之间的距离
        const distance = Cesium.Cartesian3.distance(
          Cesium.Cartesian3.fromDegrees(point1[0], point1[1], point1[2]),
          Cesium.Cartesian3.fromDegrees(point2[0], point2[1], point2[2])
        );

        // 在冲突线的中点添加距离标签
        const midPoint = Cesium.Cartesian3.lerp(
          Cesium.Cartesian3.fromDegrees(point1[0], point1[1], point1[2]),
          Cesium.Cartesian3.fromDegrees(point2[0], point2[1], point2[2]),
          0.5,
          new Cesium.Cartesian3()
        );

        const distanceLabel = props.viewer.entities.add({
          position: midPoint,
          label: {
            text: `${distance.toFixed(2)}m`,
            font: '14pt sans-serif',
            fillColor: getRiskLevelColor(risk.risk_level),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            scale: 0.8
          }
        });

        // 在最近点处放置标记
        const point1Marker = props.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(point1[0], point1[1], point1[2]),
          point: {
            pixelSize: 10,
            color: getRiskLevelColor(risk.risk_level),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          },
          description: `冲突点 1<br>Risk Level: ${risk.risk_level}<br>Min Distance: ${risk.min_distance.toFixed(2)}m`
        });

        const point2Marker = props.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(point2[0], point2[1], point2[2]),
          point: {
            pixelSize: 10,
            color: getRiskLevelColor(risk.risk_level),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          },
          description: `冲突点 2<br>Risk Level: ${risk.risk_level}<br>Min Distance: ${risk.min_distance.toFixed(2)}m`
        });

        collisionEntities.push(collisionLine, distanceLabel, point1Marker, point2Marker);
      });

      // 如果有冲突，放大到冲突点位置
      if (collisionEntities.length > 0) {
        const firstCollision = collisionEntities[0];
        setTimeout(() => {
          props.viewer.flyTo(firstCollision, {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(
              0,
              -Cesium.Math.PI_OVER_TWO / 2,
              5000
            )
          });
        }, 500);
      }
    } else {
      error.value = '没有发现冲突';
    }
  } catch (err) {
    console.error(err);
    if (err.response && err.response.data && err.response.data.detail) {
      error.value = `冲突检测失败: ${err.response.data.detail}`;
    } else {
      error.value = `冲突检测失败: ${err.message || err}`;
    }
  } finally {
    loading.value = false;
  }
};

// 根据风险等级返回对应的颜色
const getRiskLevelColor = (level) => {
  switch (level) {
    case 'fatal':
      return Cesium.Color.RED;
    case 'warn':
      return Cesium.Color.ORANGE;
    case 'safe':
      return Cesium.Color.YELLOW;
    default:
      return Cesium.Color.GRAY;
  }
};

// 根据风险等级返回对应的材质（虚线样式）
const getRiskLevelMaterial = (level) => {
  switch (level) {
    case 'fatal':
      return new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.RED.withAlpha(0.8),
        dashLength: 8
      });
    case 'warn':
      return new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.ORANGE.withAlpha(0.8),
        dashLength: 10
      });
    case 'safe':
      return new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.GREEN.withAlpha(0.8),
        dashLength: 15
      });
    default:
      return new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.GRAY.withAlpha(0.8),
        dashLength: 16
      });
  }
};

const clearFlightPaths = () => {
  flightPathEntities.forEach(entity => {
    props.viewer.entities.remove(entity);
  });
  flightPathEntities = [];
};

const clearCollisionResults = () => {
  collisionEntities.forEach(entity => {
    props.viewer.entities.remove(entity);
  });
  collisionEntities = [];
};

const clearAll = () => {
  clearFlightPaths();
  clearCollisionResults();
};

onUnmounted(() => {
  clearAll();
});
</script>

<style scoped>
.drone-path-collision {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 15px;
  border-radius: 8px;
  min-width: 200px;
}

.control-panel h3 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 16px;
}

.button-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 10px;
}

button {
  background: #2d8cf0;
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

button:hover {
  background: #57a3f3;
}

.loading {
  color: #2d8cf0;
  font-weight: bold;
  margin-top: 10px;
}

.error {
  color: #ff6b6b;
  margin-top: 10px;
  word-break: break-word;
}
</style>