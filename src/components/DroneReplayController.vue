<template>
  <div class="drone-replay-controls">
    <div class="control-row">
      <div class="input-container">
        <label>ID</label>
        <input type="text" v-model="droneId" placeholder="ID" class="drone-id-input" />
      </div>
      <div class="checkbox-container">
        <input type="checkbox" id="surrounding" v-model="includeSurrounding" />
        <label for="surrounding">周围</label>
      </div>
      <button class="btn-blue" @click="loadData">航线</button>
      <button class="btn-blue" @click="loadPlanPath">计划</button>
    </div>

    <div class="control-row">
      <button class="btn-action play" @click="play" :disabled="isPlaying || isLoading">
        <span>▶</span> 播放
      </button>
      <button class="btn-action" @click="pause" :disabled="!isPlaying">
        <span>‖</span> 暂停
      </button>
      <button class="btn-action" @click="reset">
        <span>↺</span> 重置
      </button>
      <button class="btn-action clear" @click="clearAll">
        <span>🗑</span> 清除
      </button>
    </div>

    <div class="control-row">
      <div class="speed-container">
        <label>回放速度</label>
        <select v-model="speedFactor" @change="onSpeedChange">
          <option value="0.5">0.5x</option>
          <option value="1">1.0x</option>
          <option value="2">2.0x</option>
          <option value="5">5.0x</option>
        </select>
      </div>
    </div>

    <div class="replay-status" v-if="isLoading">数据同步中...</div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import { DroneGroupReplayPlayer } from '@/js/dronegroup_replayplayer';
import { api } from '../js/api.js';

const props = defineProps({
  viewer: {
    type: Object,
    required: true,
  },
});

let replayPlayer = null;
const isLoading = ref(false);
const error = ref('');
const droneId = ref(''); // 默认为 'all'，加载所有无人机数据

// 控制相关状态
const isPlaying = ref(false);
const currentTime = ref(0);
const minTime = ref(0);
const maxTime = ref(100);
const speedFactor = ref(1);
const currentTimeDisplay = ref('');

// 1. 增加状态变量
const includeSurrounding = ref(false);

const validateId = () => {
  if (!droneId.value || droneId.value.trim() === '') {
    alert('请输入无人机ID');
    return false;
  }
  return true;
};

// 2. 修改加载数据函数
const loadDroneData = async (id = 'all') => {
  isLoading.value = true;
  error.value = '';
  try {
    // 调用接口，传入 include_surrounding 参数
    // 假设 api.getFlightPathsByDrone 支持第二个参数，或者直接修改传参逻辑
    const response = await api.getFlightPathsByDrone(id, includeSurrounding.value);
    return response.flyPathInfos || [];
  } catch (err) {
    console.error('加载无人机数据失败:', err);
    // ... 错误处理逻辑保持不变
    return [];
  } finally {
    isLoading.value = false;
  }
};

// 从后端获取计划航线数据
const loadPlanPathData = async (id) => {
  if (!id) {
    error.value = '请输入无人机ID';
    return [];
  }

  isLoading.value = true;
  error.value = '';
  try {
    const response = await api.getFlightPlanPathsByDrone(id);
    // 返回一个包含计划航线的数组，格式与现有数据匹配
    return response.flyPathInfo ? [response.flyPathInfo] : [];
  } catch (err) {
    console.error('加载计划航线数据失败:', err);
    if (err.response && err.response.data && err.response.data.detail) {
      error.value = `加载计划航线失败: ${err.response.data.detail}`;
    } else {
      error.value = `加载计划航线失败: ${err.message || err}`;
    }
    return [];
  } finally {
    isLoading.value = false;
  }
};

// 清除场景中的计划航线
const clearPlanPaths = () => {
  if (replayPlayer) {
    replayPlayer.clearPlanPaths();
  }
};

const initDronePlayer = async () => {
  const options = {
    modelUri: '/models/four_drone.glb',
    speedFactor: speedFactor.value
  };

  const viewer = props.viewer;
  replayPlayer = new DroneGroupReplayPlayer(viewer, options);
};
// 加载指定无人机ID的数据
const loadData = async () => {
  if (!validateId()) return;
  const droneData = await loadDroneData(droneId.value);

  if (droneData.length > 0) {

    let hasMaster = false;
    if (droneData) {
      droneData.forEach((uav) => {
        replayPlayer.addUav(uav);
        if (uav.isMaster) {
          hasMaster = true;
        }
      });
    }

    if (!hasMaster) {
      alert('请指定一个主无人机');
    }

    // 初始化时间范围
    if (droneData.length > 0) {
      // 简单计算时间范围，实际可以根据数据中的时间戳计算
      minTime.value = 0;
      // 假设每条路径至少有一个点
      maxTime.value = Math.max(...droneData.map(d => d.path.length)) * 5; // 每个点5秒
    }
  }
};

// 加载计划航线
const loadPlanPath = async () => {
  if (!validateId()) return;
  const planPathData = await loadPlanPathData(droneId.value);

  if (planPathData.length > 0) {
    // 添加计划航线到场景
    if (replayPlayer) {
      replayPlayer.addPlanPathsToScene(planPathData);
    }
  }
};

// 初始化时加载默认数据
onMounted(async () => {
  await initDronePlayer();
});

onUnmounted(() => {
  if (replayPlayer) {
    replayPlayer.clearAll();
    replayPlayer = null;
  }
});

// 控制方法
const play = () => {
  if (replayPlayer) {
    replayPlayer.play();
    isPlaying.value = true;
  }
};

const pause = () => {
  if (replayPlayer) {
    replayPlayer.pause();
    isPlaying.value = false;
  }
};

// 清除所有数据和场景实体
const clearAll = () => {
  if (replayPlayer) {
    replayPlayer.clearAll();
    isPlaying.value = false;
    // 重置相关状态
    droneId.value = 'all';
    console.log("场景已清除");
  }
};

// 确保将该方法暴露（如果是在 standard script 中，但在 script setup 中直接定义即可）
const reset = () => {
  if (replayPlayer) {
    replayPlayer.reset();
    isPlaying.value = false;
  }
};

const onSliderChange = () => {
  if (replayPlayer) {
    replayPlayer.seekToTime(parseInt(currentTime.value));
  }
};

const onSpeedChange = () => {
  if (replayPlayer) {
    replayPlayer.setSpeedFactor(parseFloat(speedFactor.value));
  }
};
</script>

<style scoped>
/* 新增勾选框容器样式 */
.checkbox-container {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.checkbox-container label {
  font-size: 12px;
  color: #aaa;
  white-space: nowrap;
  cursor: pointer;
}

.checkbox-container input[type="checkbox"] {
  cursor: pointer;
  accent-color: #2196F3;
  /* 勾选框颜色 */
  width: 14px;
  height: 14px;
}

/* 微调输入框容器宽度以容纳新元素 */
.input-container {
  flex: 1.5;
  /* 稍微给 ID 输入框多一点空间 */
}

.drone-replay-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(30, 30, 30, 0.9);
  /* 加深背景，避免穿透 */
  backdrop-filter: blur(4px);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  width: 280px;
  /* 固定面板宽度 */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 统一间距 */
  width: 100%;
}

/* 输入框组合样式 */
.input-container,
.speed-container {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 0 8px;
  height: 32px;
  flex: 1;
  /* 占据剩余空间 */
}

.input-container label,
.speed-container label {
  font-size: 12px;
  color: #aaa;
  margin-right: 8px;
  white-space: nowrap;
}

.drone-id-input {
  width: 100%;
  background: transparent;
  border: none;
  color: #2196F3;
  font-size: 13px;
  outline: none;
}

/* 按钮基础样式 */
button {
  height: 32px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: white;
  white-space: nowrap;
  padding: 0 10px;
  transition: opacity 0.2s;
}

.btn-blue {
  background: #2196F3;
}

/* 让四个按钮平分第二行 */
.btn-action {
  background: #444;
  flex: 1;
  padding: 0 4px;
  /* 略微减小内边距以适应四个按钮 */
}

/* 清除按钮专用红色 */
.btn-action.clear {
  background: #f44336;
}

.btn-action.clear:hover {
  background: #d32f2f;
}

button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* 速度选择框 */
select {
  background: transparent;
  border: none;
  color: white;
  font-size: 12px;
  outline: none;
  cursor: pointer;
  width: 100%;
}

.replay-status {
  font-size: 11px;
  color: #ffca28;
  text-align: center;
}
</style>