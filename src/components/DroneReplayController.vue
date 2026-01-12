<template>

</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { DroneGroupReplayPlayer } from '@/js/dronegroup_replayplayer';

const props = defineProps({
    viewer: {
        type: Object,
        required: true,
    },
});

let replayPlayer = null;

/**
   * 无人机回放初始化以及加载数据
   * @param {Object} options
   * @param {string} options.modelUri - 无人机显示模型
   * @param {number} options.speedFactor - 回放的速度，默认为1
   * @param {Array} options.droneData - 无人机显示模型
   * 
   * 数据示例： const options = {
        modelUri: '/models/four_drone.glb',
        speedFactor: 1,
        droneData: [
          {
            id: "A1", color: "yellow", path: [
              { lon: 119.9900, lat: 30.27000, height: 50, time: "2025-02-01 10:00:00" },
              { lon: 119.9924, lat: 30.27200, height: 60, time: "2025-02-01 10:00:05" },
              { lon: 119.9940, lat: 30.27400, height: 70, time: "2025-02-01 10:00:10" },
              { lon: 119.9970, lat: 30.27600, height: 80, time: "2025-02-01 10:00:15" },
              { lon: 119.9980, lat: 30.27800, height: 90, time: "2025-02-01 10:00:20" },
              { lon: 120.0000, lat: 30.28000, height: 100, time: "2025-02-01 10:00:25" },
            ], isMaster: true
          },
          {
            id: "B2", color: "cyan", path: [
              { lon: 119.9940, lat: 30.27300, height: 50, time: "2025-02-01 10:00:02" },
              { lon: 119.9925, lat: 30.27200, height: 60, time: "2025-02-01 10:00:07" },
              { lon: 119.9950, lat: 30.27400, height: 70, time: "2025-02-01 10:00:09" },
              { lon: 119.9975, lat: 30.27600, height: 80, time: "2025-02-01 10:00:12" },
              { lon: 119.9988, lat: 30.27800, height: 90, time: "2025-02-01 10:00:20" },
              { lon: 120.0200, lat: 30.28300, height: 100, time: "2025-02-01 10:00:27" },
            ]
          },
          {
            id: "C3", path: [
              { lon: 119.9800, lat: 30.26800, height: 50, time: "2025-02-01 09:59:58" },
              { lon: 119.9924, lat: 30.27200, height: 60, time: "2025-02-01 10:00:05" },
              { lon: 119.9944, lat: 30.27450, height: 70, time: "2025-02-01 10:00:08" },
              { lon: 119.9970, lat: 30.27640, height: 80, time: "2025-02-01 10:00:15" },
              { lon: 119.9983, lat: 30.27820, height: 90, time: "2025-02-01 10:00:20" },
              { lon: 120.0010, lat: 30.28200, height: 100, time: "2025-02-01 10:00:30" },]
          }]
      }
   *
   */
function droneReplayInitAndLoadData(options) {
    const viewer = props.viewer;
    const replayPlayer = new DroneGroupReplayPlayer(viewer, options);

    let hasMaster = false;
    if (options.droneData) {
        options.droneData.forEach((uav) => {
            replayPlayer.addUav(uav);
            if (uav.isMaster) {
                hasMaster = true;
            }
        });
    }

    if (!hasMaster) {
        alert('请指定一个主无人机');
    }
    return replayPlayer;
}

const options = {
    modelUri: '/models/four_drone.glb',
    speedFactor: 1,
    droneData: [
        {
            id: 'A1',
            color: 'yellow',
            path: [
                { lon: 119.99, lat: 30.27, height: 50, time: '2025-02-01 10:00:00' },
                { lon: 119.9924, lat: 30.272, height: 60, time: '2025-02-01 10:00:05' },
                { lon: 119.994, lat: 30.274, height: 70, time: '2025-02-01 10:00:10' },
                { lon: 119.997, lat: 30.276, height: 80, time: '2025-02-01 10:00:15' },
                { lon: 119.998, lat: 30.278, height: 90, time: '2025-02-01 10:00:20' },
                { lon: 120.0, lat: 30.28, height: 100, time: '2025-02-01 10:00:25' },
            ],
            isMaster: false,
        },
        {
            id: 'B2',
            color: 'cyan',
            path: [
                { lon: 119.994, lat: 30.273, height: 50, time: '2025-02-01 10:00:02' },
                { lon: 119.9925, lat: 30.272, height: 60, time: '2025-02-01 10:00:07' },
                { lon: 119.995, lat: 30.274, height: 70, time: '2025-02-01 10:00:09' },
                { lon: 119.9975, lat: 30.276, height: 80, time: '2025-02-01 10:00:12' },
                { lon: 119.9988, lat: 30.278, height: 90, time: '2025-02-01 10:00:20' },
                { lon: 120.02, lat: 30.283, height: 100, time: '2025-02-01 10:00:27' },
            ],
            isMaster: false,
        },
        {
            id: 'C3',
            path: [
                { lon: 119.98, lat: 30.268, height: 50, time: '2025-02-01 09:59:58' },
                { lon: 119.9924, lat: 30.272, height: 60, time: '2025-02-01 10:00:05' },
                { lon: 119.9944, lat: 30.2745, height: 70, time: '2025-02-01 10:00:08' },
                { lon: 119.997, lat: 30.2764, height: 80, time: '2025-02-01 10:00:15' },
                { lon: 119.9983, lat: 30.2782, height: 90, time: '2025-02-01 10:00:20' },
                { lon: 120.001, lat: 30.282, height: 100, time: '2025-02-01 10:00:30' },
            ],
            isMaster: true,
        },
    ],
};

onMounted(() => {

    replayPlayer = droneReplayInitAndLoadData(options);
});
onUnmounted(() => {
    if (replayPlayer) {
        replayPlayer.clearAll();
        replayPlayer = null;
    }
});

</script>

<style scoped>
.drone-replay-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 8px;
    color: white;
    margin-top: 8px;
}

.replay-controls-group,
.replay-slider-group,
.replay-speed-group {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.replay-controls-group button {
    padding: 8px 16px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.replay-controls-group button:disabled {
    background: #666;
    cursor: not-allowed;
}

.replay-slider-group {
    flex-direction: column;
    align-items: stretch;
}

.time-slider {
    width: 100%;
    height: 20px;
}

.time-display {
    font-family: monospace;
    font-size: 14px;
    min-width: 100px;
    text-align: center;
}

.replay-speed-group select {
    padding: 6px;
    border-radius: 4px;
    background: white;
}

.replay-warning {
    color: #ffcc00;
    font-size: 14px;
    text-align: center;
    padding: 8px;
}

.time-ticks {
    position: relative;
    height: 20px;
    margin-top: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
}

.time-tick {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    width: 2px;
    height: 10px;
    background: #ffcc00;
    font-size: 10px;
    color: #ffcc00;
    text-align: center;
    margin-top: 10px;
}

.time-tick::after {
    content: attr(title);
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 4px;
    border-radius: 3px;
    font-size: 10px;
    opacity: 0;
    transition: opacity 0.2s;
}

.time-tick:hover::after {
    opacity: 1;
}
</style>