<template>
    <div class="snow-control">
        <div class="control-panel">
            <button @click="toggleSnow" :class="{ active: isSnowing }">
                {{ isSnowing ? '停止下雪' : '开始下雪' }}
            </button>

            <div v-if="isSnowing" class="snow-settings">
                <div class="setting-item">
                    <label>强度: {{ snowIntensity }}</label>
                    <input type="range" min="0.5" max="3" step="0.1" v-model="snowIntensity" @input="updateIntensity" />
                </div>

                <div class="setting-item">
                    <label>速度: {{ snowSpeed }}</label>
                    <input type="range" min="0.1" max="1.0" step="0.05" v-model="snowSpeed" @input="updateSpeed" />
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

const props = defineProps({
    viewer: { type: Object, required: true }
})

const isSnowing = ref(false)
const snowIntensity = ref(1.5)
const snowSpeed = ref(0.4)
const debugInfo = ref("")

let scene, camera, renderer, snowGeo, snowParticles
let snowData = []
let animationId = null
let threeContainer = null

const initThreeSnow = () => {
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

    createSnowParticles()

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
    })
}

const createSnowParticles = () => {
    if (!scene) return

    // 清理旧粒子
    if (snowParticles) {
        scene.remove(snowParticles)
        snowGeo.dispose()
        snowParticles.material.dispose()
        snowParticles = null
        snowData = []
    }

    const count = Math.floor(80000 * snowIntensity.value)
    snowGeo = new THREE.BufferGeometry()
    const positions = []
    const sizes = []
    snowData = []

    const snowTextures = [
        createCircleSnowTexture(),
        createHexSnowTexture(),
        createStarSnowTexture()
    ]

    for (let i = 0; i < count; i++) {
        let x = (Math.random() - 0.5) * 400
        let y = Math.random() * 200
        let z = (Math.random() - 0.5) * 400

        if (![x, y, z].every(v => Number.isFinite(v))) {
            x = 0; y = 0; z = 0
        }

        positions.push(x, y, z)

        const distance = Math.abs(z)
        let size = 1 - distance * 0.01 + Math.min(distance / 200, 1.0) + Math.random() * 1.0
        size = THREE.MathUtils.clamp(size, 0.1, 3)
        sizes.push(size)

        const alpha = THREE.MathUtils.clamp(1 - distance / 100, 0.3, 1)

        snowData.push({
            velocity: snowSpeed.value,
            rotation: Math.random() * 2 * Math.PI,
            rotationSpeed: (Math.random() - 0.5) * 0.02,
            texture: snowTextures[Math.floor(Math.random() * snowTextures.length)],
            size,
            opacity: alpha
        })
    }

    snowGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    snowGeo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1))

    const snowMaterial = new THREE.PointsMaterial({
        size: 2,
        map: snowTextures[2],
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    })

    snowParticles = new THREE.Points(snowGeo, snowMaterial)
    scene.add(snowParticles)
}

function createCircleSnowTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(32, 32, 28, 0, Math.PI * 2)
    ctx.fill()
    return new THREE.CanvasTexture(canvas)
}

function createHexSnowTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 3 * i
        const x = 32 + 20 * Math.cos(angle)
        const y = 32 + 20 * Math.sin(angle)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
    return new THREE.CanvasTexture(canvas)
}

function createStarSnowTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
        const angle = Math.PI / 4 * i
        const x1 = 32 + 20 * Math.cos(angle)
        const y1 = 32 + 20 * Math.sin(angle)
        const x2 = 32 - 20 * Math.cos(angle)
        const y2 = 32 - 20 * Math.sin(angle)
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
    }
    ctx.stroke()
    return new THREE.CanvasTexture(canvas)
}

const animate = () => {
    animationId = requestAnimationFrame(animate)
    if (!snowGeo) return

    const positions = snowGeo.attributes.position.array
    const sizes = snowGeo.attributes.size.array

    for (let i = 0; i < snowData.length; i++) {
        const idx = i * 3
        positions[idx + 1] -= snowData[i].velocity
        positions[idx] += Math.sin(snowData[i].rotation) * 0.05
        positions[idx + 2] += Math.cos(snowData[i].rotation) * 0.05
        snowData[i].rotation += snowData[i].rotationSpeed
        sizes[i] = snowData[i].size

        if (positions[idx + 1] < -100) {
            positions[idx + 1] = 100
            positions[idx] = (Math.random() - 0.5) * 400
            positions[idx + 2] = (Math.random() - 0.5) * 400
        }
    }

    snowGeo.attributes.position.needsUpdate = true
    snowGeo.attributes.size.needsUpdate = true
    renderer.render(scene, camera)
}

const startSnow = () => {
    if (!scene) initThreeSnow()
    if (!animationId) animate()
    isSnowing.value = true
}

const stopSnow = () => {
    if (animationId) cancelAnimationFrame(animationId)
    animationId = null
    isSnowing.value = false
    if (threeContainer) {
        threeContainer.remove()
        threeContainer = null
        scene = null
        camera = null
        renderer = null
        snowParticles = null
        snowData = []
    }
}

const toggleSnow = () => {
    if (isSnowing.value) stopSnow()
    else startSnow()
}

const updateIntensity = () => {
    if (!isSnowing.value || !scene) return
    // 只清理旧粒子
    if (snowParticles) {
        scene.remove(snowParticles)
        snowGeo.dispose()
        snowParticles.material.dispose()
        snowParticles = null
        snowData = []
    }
    // 创建新粒子
    createSnowParticles()
}

const updateSpeed = () => {
    if (!isSnowing.value || !snowData.length) return
    // 实时修改速度
    snowData.forEach(p => p.velocity = snowSpeed.value)
}

onUnmounted(() => stopSnow())
defineExpose({ startSnow, stopSnow, toggleSnow, isSnowing })
</script>

<style scoped>
/* 样式不变 */
.snow-control {
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

.snow-settings {
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
