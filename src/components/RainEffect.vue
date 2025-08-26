<template>
    <div class="rain-control">
        <div class="control-panel">
            <button @click="toggleRain" :class="{ active: isRaining }">
                {{ isRaining ? '停止下雨' : '开始下雨' }}
            </button>

            <div v-if="isRaining" class="rain-settings">
                <div class="setting-item">
                    <label>强度: {{ rainIntensity }}</label>
                    <input type="range" min="0.5" max="3" step="0.1" v-model="rainIntensity" @input="updateIntensity" />
                </div>

                <div class="setting-item">
                    <label>速度: {{ rainSpeed }}</label>
                    <input type="range" min="10" max="50" step="5" v-model="rainSpeed" @input="updateSpeed" />
                </div>
            </div>

            <div v-if="debugInfo" class="debug">
                {{ debugInfo }}
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import * as THREE from 'three'
import * as Cesium from 'cesium'

const props = defineProps({
    viewer: {
        type: Object,
        required: true
    }
})

// 响应式数据
const isRaining = ref(false)
const rainIntensity = ref(1.5)
const rainSpeed = ref(20)
const followCamera = ref(true)
const debugInfo = ref("")

// Three.js 相关
let scene, camera, renderer, rainGeo, rainParticles
let rainData = []
let animationId = null
let threeContainer = null

// 初始化 Three.js 雨滴
const initThreeRain = () => {
    threeContainer = document.createElement('div')
    threeContainer.style.position = 'absolute'
    threeContainer.style.top = '0'
    threeContainer.style.left = '0'
    threeContainer.style.pointerEvents = 'none'
    threeContainer.style.width = '100%'
    threeContainer.style.height = '100%'
    props.viewer.container.appendChild(threeContainer)

    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.z = 50

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000, 0)
    threeContainer.appendChild(renderer.domElement)

    createRainParticles()

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
    })
}

// 创建雨滴粒子
const createRainParticles = () => {
    if (rainParticles) {
        scene.remove(rainParticles)
        rainGeo.dispose()
        rainParticles.material.dispose()
        rainParticles = null
        rainData = []
    }

    const count = Math.floor(40000 * rainIntensity.value)
    rainGeo = new THREE.BufferGeometry()
    const positions = []
    const sizes = []
    rainData = []

    const rainTexture = createRainTexture()

    for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * 400
        const y = Math.random() * 200
        const z = (Math.random() - 0.5) * 400
        positions.push(x, y, z)

        const dist = Math.abs(z)
        const size = THREE.MathUtils.lerp(0.5, 1.2, dist / 200)
        sizes.push(size)

        rainData.push({
            velocity: rainSpeed.value * 0.05 + Math.random() * 0.05,
            size: size,
            //windOffset: (Math.random() - 0.5) * 0.5
        })
    }

    rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    rainGeo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1))

    const rainMaterial = new THREE.PointsMaterial({
        size: 2,
        map: rainTexture,
        color: new THREE.Color(0x87cefa),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    })

    rainParticles = new THREE.Points(rainGeo, rainMaterial)
    scene.add(rainParticles)
}

// 雨滴纹理
const createRainTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 64
    const ctx = canvas.getContext('2d')

    const gradient = ctx.createLinearGradient(0, 0, 0, 64)
    gradient.addColorStop(0, 'rgba(135,206,250,0.3)')
    gradient.addColorStop(1, 'rgba(135,206,250,1.0)')

    ctx.fillStyle = gradient
    ctx.fillRect(7, 0, 2, 64)
    return new THREE.CanvasTexture(canvas)
}

// 动画
const animate = () => {
    animationId = requestAnimationFrame(animate)

    const positions = rainGeo.attributes.position.array
    for (let i = 0; i < rainData.length; i++) {
        const idx = i * 3
        positions[idx + 1] -= rainData[i].velocity
        //positions[idx] += rainData[i].windOffset

        if (positions[idx + 1] < -100) {
            positions[idx + 1] = 100
            positions[idx] = (Math.random() - 0.5) * 400
            positions[idx + 2] = (Math.random() - 0.5) * 400
            //rainData[i].windOffset = (Math.random() - 0.5) * 0.5
        }
    }

    rainGeo.attributes.position.needsUpdate = true
    renderer.render(scene, camera)
}

// 开始雨
const startRain = () => {
    if (!scene) initThreeRain()
    if (!animationId) animate()
    isRaining.value = true
}

// 停止雨
const stopRain = () => {
    if (animationId) cancelAnimationFrame(animationId)
    animationId = null
    isRaining.value = false
    if (threeContainer) {
        threeContainer.remove()
        threeContainer = null
        scene = null
        camera = null
        renderer = null
        rainParticles = null
        rainData = []
    }
}

// 切换
const toggleRain = () => {
    if (isRaining.value) stopRain()
    else startRain()
}

// 更新强度和速度
const updateIntensity = () => {
    if (isRaining.value) createRainParticles()
}

const updateSpeed = () => {
    if (!isRaining.value || !rainData.length) return
    const factor = rainSpeed.value * 0.05
    rainData.forEach(p => p.velocity = factor + Math.random() * 0.05)
}

onUnmounted(() => stopRain())

defineExpose({ startRain, stopRain, toggleRain, isRaining })
</script>

<style scoped>
.rain-control {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 8px;
    color: white;
    margin-top: 8px;
}


.control-panel {

    border-radius: 8px;
    padding: 16px;
    color: white;
    min-width: 200px;
    backdrop-filter: blur(5px);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.control-panel button {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 6px;
    background: #2196F3;
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
}

.control-panel button:hover {
    background: #1976D2;
    transform: translateY(-1px);
}

.control-panel button.active {
    background: #f44336;
}

.control-panel button.active:hover {
    background: #d32f2f;
}

.rain-settings {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.setting-item {
    margin-bottom: 12px;
}

.setting-item:last-child {
    margin-bottom: 0;
}

.setting-item label {
    display: block;
    font-size: 12px;
    margin-bottom: 4px;
    color: #ddd;
}

.setting-item input[type="range"] {
    width: 100%;
    margin: 4px 0;
    accent-color: #2196F3;
}

.setting-item input[type="checkbox"] {
    margin-right: 6px;
    accent-color: #2196F3;
}

.debug {
    margin-top: 12px;
    padding: 8px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 4px;
    font-size: 11px;
    color: #ffeb3b;
    word-break: break-all;
    max-height: 60px;
    overflow-y: auto;
}
</style>
