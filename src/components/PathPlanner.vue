<template>
    <div class="path-planner">
        <div style="display:flex;flex-direction:column;gap:8px;">
            <div>
                <strong>起点:</strong>
                <span v-if="startPos">{{ startPos.lon.toFixed(6) }}, {{ startPos.lat.toFixed(6) }}, {{ startPos.alt
                    }}m</span>
                <span v-else>未选择</span>
            </div>
            <div>
                <strong>目标:</strong>
                <span v-if="goalPos">{{ goalPos.lon.toFixed(6) }}, {{ goalPos.lat.toFixed(6) }}, {{ goalPos.alt
                    }}m</span>
                <span v-else>未选择</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button @click="enableSelect('start')">选择起点</button>
                <input type="number" v-model.number="startAltInput" style="width:50px" />
                <button @click="enableSelect('goal')">选择目标</button>
                <input type="number" v-model.number="goalAltInput" style="width:50px" />
            </div>
            <div style="display:flex;gap:8px;">
                <button @click="planPath" :disabled="!startPos || !goalPos">规划</button>
                <button @click="loadNoFlyZones">加载禁飞区</button>
                <button @click="clearAll">清除</button>
            </div>
            <div v-if="loading">规划中...</div>
            <div v-if="errorMsg" style="color:salmon">{{ errorMsg }}</div>
        </div>
    </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import { api } from '../js/api.js'

const props = defineProps({
    viewer: { type: Object, required: true }
})

const startPos = ref(null)
const goalPos = ref(null)
const startAltInput = ref(20)
const goalAltInput = ref(30)
const loading = ref(false)
const errorMsg = ref('')

let handler = null
let startEntity = null
let goalEntity = null
let pathEntity = null
let waypointEntities = []
let noFlyZoneEntities = [] // 存储禁飞区实体

const enableSelect = (type) => {
    if (!props.viewer) return
    disableHandler()
    handler = new Cesium.ScreenSpaceEventHandler(props.viewer.scene.canvas)
    handler.setInputAction((click) => {
        const pos = pickPosition(click.position)
        if (!pos) {
            errorMsg.value = '无法拾取位置，请在可见地形/椭球面上点击'
            return
        }
        const carto = Cesium.Cartographic.fromCartesian(pos)
        const lon = Cesium.Math.toDegrees(carto.longitude)
        const lat = Cesium.Math.toDegrees(carto.latitude)
        const alt = type === 'start' ? Number(startAltInput.value) : Number(goalAltInput.value)

        if (type === 'start') {
            startPos.value = { lon, lat, alt }
            drawPoint('start')
        } else {
            goalPos.value = { lon, lat, alt }
            drawPoint('goal')
        }

        // 选择一次后取消拾取
        disableHandler()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

const pickPosition = (position) => {
    try {
        const scene = props.viewer.scene
        // 优先使用 pickPosition 获取地形高度，如果不可用退回到椭球体
        let cartesian = scene.pickPosition(position)
        if (!cartesian) {
            cartesian = props.viewer.camera.pickEllipsoid(position, scene.globe.ellipsoid)
        }
        return cartesian
    } catch (e) {
        return null
    }
}

const disableHandler = () => {
    if (handler) {
        handler.destroy()
        handler = null
    }
}

const drawPoint = (which) => {
    if (!props.viewer) return
    if (which === 'start') {
        if (startEntity) props.viewer.entities.remove(startEntity)
        startEntity = props.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(startPos.value.lon, startPos.value.lat, startPos.value.alt),
            point: { pixelSize: 10, color: Cesium.Color.GREEN }
        })
    } else if (which === 'goal') {
        if (goalEntity) props.viewer.entities.remove(goalEntity)
        goalEntity = props.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(goalPos.value.lon, goalPos.value.lat, goalPos.value.alt),
            point: { pixelSize: 10, color: Cesium.Color.RED }
        })
    }
}

const planPath = async () => {
    if (!startPos.value || !goalPos.value) return
    loading.value = true
    errorMsg.value = ''
    try {
        const body = {
            start: startPos.value,
            goal: goalPos.value,
            scale: 0.5
        }
        const data = await api.planPath(body)
        if (!data.path || !Array.isArray(data.path)) throw new Error('返回数据格式不正确')
        drawPath(data.path)
    } catch (e) {
        console.error(e)
        // 检查是否是后端返回的错误信息
        if (e.response && e.response.data && e.response.data.detail) {
            errorMsg.value = '规划失败：' + e.response.data.detail
        } else {
            errorMsg.value = '规划失败：' + (e.message || e)
        }
    } finally {
        loading.value = false
    }
}

const loadNoFlyZones = async () => {
    try {
        const data = await api.getNoFlyZones()
        if (!data.zones || !Array.isArray(data.zones)) throw new Error('返回数据格式不正确')
        drawNoFlyZones(data.zones)
    } catch (e) {
        console.error(e)
        // 检查是否是后端返回的错误信息
        if (e.response && e.response.data && e.response.data.detail) {
            errorMsg.value = '加载禁飞区失败：' + e.response.data.detail
        } else {
            errorMsg.value = '加载禁飞区失败：' + (e.message || e)
        }
    }
}

const drawNoFlyZones = (zones) => {
    // 清除之前绘制的禁飞区
    clearNoFlyZones()

    zones.forEach(zone => {
        if (zone.geometry && zone.geometry.type === 'Polygon') {
            const coordinates = zone.geometry.coordinates[0]
            const positions = coordinates.map(coord =>
                Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0)
            )

            // 创建一个实体来表示禁飞区
            const entity = props.viewer.entities.add({
                polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(positions),
                    material: Cesium.Color.RED.withAlpha(0.5), // 红色半透明
                    height: zone.z_min || 0, // 从最小高度开始
                    extrudedHeight: zone.z_max || 200, // 拉伸到最大高度
                    outline: true,
                    outlineColor: Cesium.Color.RED,
                    outlineWidth: 2
                },
                description: `禁飞区<br>
                    最小高度: ${zone.z_min}m<br>
                    最大高度: ${zone.z_max}m<br>
                    缓冲区: ${zone.buffer}m`
            })

            noFlyZoneEntities.push(entity)
        }
    })
}

const clearNoFlyZones = () => {
    noFlyZoneEntities.forEach(entity => {
        props.viewer.entities.remove(entity)
    })
    noFlyZoneEntities = []
}

const drawPath = (path) => {
    if (!props.viewer) return
    // 清理之前的
    if (pathEntity) props.viewer.entities.remove(pathEntity)
    waypointEntities.forEach(ent => props.viewer.entities.remove(ent))
    waypointEntities = []

    const positions = path.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt))

    pathEntity = props.viewer.entities.add({
        polyline: {
            positions: positions,
            width: 3,
            material: Cesium.Color.YELLOW
        }
    })

    // 绘制航路点
    path.forEach((p, idx) => {
        const ent = props.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
            point: { pixelSize: 6, color: Cesium.Color.CYAN }
        })
        waypointEntities.push(ent)
    })

    // 飞到航线中点
    if (positions.length > 0) {
        props.viewer.zoomTo(pathEntity)
    }
}

const clearAll = () => {
    if (startEntity) props.viewer.entities.remove(startEntity)
    if (goalEntity) props.viewer.entities.remove(goalEntity)
    if (pathEntity) props.viewer.entities.remove(pathEntity)
    waypointEntities.forEach(ent => props.viewer.entities.remove(ent))
    clearNoFlyZones()
    startEntity = goalEntity = pathEntity = null
    waypointEntities = []
    startPos.value = null
    goalPos.value = null
    errorMsg.value = ''
}

onUnmounted(() => {
    disableHandler()
    clearAll()
})
</script>

<style scoped>
.path-planner {
    color: white;
}

.path-planner button {
    background: #2d8cf0;
    color: white;
    border: none;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
}

.path-planner button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.path-planner input {
    padding: 4px 6px;
    border-radius: 4px;
    border: 1px solid #ccc;
}
</style>