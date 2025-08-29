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

                <div class="setting-item">
                    <label>雨滴长度: {{ rainLength }}</label>
                    <input type="range" min="0.5" max="3" step="0.1" v-model="rainLength" @input="updateRainLength" />
                </div>

                <div class="setting-item">
                    <label>远处雨滴增强: {{ farRainBoost }}</label>
                    <input type="range" min="1" max="3" step="0.1" v-model="farRainBoost" @input="updateFarRainBoost" />
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
const rainLength = ref(1.8)
const farRainBoost = ref(1.8) // 新增：远处雨滴增强系数
const debugInfo = ref("")

// Three.js 相关
let scene, camera, renderer, rainSprites = []
let rainData = []
let animationId = null
let threeContainer = null
let rainMaterial = null
let rainTexture = null

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

    renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        precision: 'mediump'
    })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000, 0)
    threeContainer.appendChild(renderer.domElement)

    // 创建雨滴纹理
    rainTexture = createRainTexture()

    // 创建Sprite材质
    rainMaterial = new THREE.SpriteMaterial({
        map: rainTexture,
        color: new THREE.Color(0xAAAAFF),
        transparent: true,
        opacity: 0.8, // 提高基础透明度
        blending: THREE.NormalBlending,
        depthWrite: false,
        alphaTest: 0.15
    })

    createRainSprites()

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
    })
}

// 创建雨滴精灵 - 优化远近效果
// 创建雨滴精灵 - 优化远近和粗细效果
const createRainSprites = () => {
    rainSprites.forEach(sprite => scene.remove(sprite))
    rainSprites = []
    rainData = []

    const count = Math.floor(6000 * rainIntensity.value)

    for (let i = 0; i < count; i++) {
        const sprite = new THREE.Sprite(rainMaterial)

        const x = (Math.random() - 0.5) * 600
        const y = Math.random() * 300 - 50
        const z = (Math.random() - 0.5) * 600
        sprite.position.set(x, y, z)

        // 计算远近
        const dist = Math.sqrt(x * x + z * z)
        const normalizedDist = Math.min(dist / 300, 1)

        // ---- 这里调粗：横向 scaleX 提高一倍 ----
        const nearBoost = (1 - normalizedDist) * 0.6 + 1 // 近处更粗
        const sizeMultiplier = 1 + (normalizedDist * 0.8) * farRainBoost.value

        const scaleX = THREE.MathUtils.lerp(0.3, 0.7, normalizedDist) * rainLength.value * sizeMultiplier * nearBoost
        const scaleY = THREE.MathUtils.lerp(1.0, 2.5, normalizedDist) * rainLength.value * sizeMultiplier

        sprite.scale.set(scaleX, scaleY, 1)

        // 亮度调整（保持原有逻辑）
        const brightness = 1 + (normalizedDist * 0.4)
        sprite.material.color.setRGB(
            Math.min(0.67 * brightness, 1),
            Math.min(0.67 * brightness, 1),
            Math.min(1.0 * brightness, 1)
        )

        const baseVelocity = rainSpeed.value * 0.05
        const velocity = baseVelocity * (0.9 + Math.random() * 0.2)

        rainData.push({
            velocity,
            originalScaleX: scaleX,
            originalScaleY: scaleY,
            originalColor: new THREE.Color().copy(sprite.material.color),
            dist: normalizedDist,
            brightness
        })

        rainSprites.push(sprite)
        scene.add(sprite)
    }
}


// 改进的雨滴纹理 - 让远处雨滴更明显
const createRainTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64 // 增加纹理分辨率
    canvas.height = 256
    const ctx = canvas.getContext('2d')

    // 创建更明显的雨滴渐变
    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0.0, 'rgba(170, 170, 255, 0.0)')
    gradient.addColorStop(0.1, 'rgba(170, 170, 255, 0.4)')
    gradient.addColorStop(0.3, 'rgba(200, 200, 255, 0.9)') // 中间更亮
    gradient.addColorStop(0.7, 'rgba(180, 180, 255, 0.7)')
    gradient.addColorStop(1.0, 'rgba(170, 170, 255, 0.0)')

    ctx.fillStyle = gradient
    // 创建更宽的雨滴，远处更容易看到
    ctx.fillRect(24, 0, 10, 256)

    // 添加高光效果，增强可见性
    const highlightGradient = ctx.createLinearGradient(0, 0, 0, 256)
    highlightGradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.0)')
    highlightGradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.3)')
    highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)')
    highlightGradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.2)')
    highlightGradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)')

    ctx.fillStyle = highlightGradient
    ctx.fillRect(30, 0, 2, 256)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    return texture
}

// 动画 - 优化远近雨滴效果
const animate = () => {
    animationId = requestAnimationFrame(animate)

    for (let i = 0; i < rainSprites.length; i++) {
        const sprite = rainSprites[i]
        const data = rainData[i]

        sprite.position.y -= data.velocity

        // 根据距离动态调整大小和颜色
        const currentDist = Math.sqrt(sprite.position.x * sprite.position.x + sprite.position.z * sprite.position.z) / 300
        const sizeMultiplier = 1 + (currentDist * 0.8) * farRainBoost.value

        sprite.scale.set(
            data.originalScaleX * sizeMultiplier,
            data.originalScaleY * sizeMultiplier,
            1
        )

        // 动态调整颜色亮度，让远处雨滴更明显
        const currentBrightness = 1 + (currentDist * 0.4)
        sprite.material.color.setRGB(
            Math.min(0.67 * currentBrightness, 1),
            Math.min(0.67 * currentBrightness, 1),
            Math.min(1.0 * currentBrightness, 1)
        )

        if (sprite.position.y < -100) {
            resetRaindrop(sprite, data)
        }
    }

    renderer.render(scene, camera)
}

// 重置雨滴
const resetRaindrop = (sprite, data) => {
    sprite.position.y = 250 + Math.random() * 50 // 从更高处开始
    sprite.position.x = (Math.random() - 0.5) * 600
    sprite.position.z = (Math.random() - 0.5) * 600

    // 重新计算距离相关参数
    const dist = Math.sqrt(sprite.position.x * sprite.position.x + sprite.position.z * sprite.position.z) / 300
    const normalizedDist = Math.min(dist, 1)

    const sizeMultiplier = 1 + (normalizedDist * 0.8) * farRainBoost.value
    const opacityMultiplier = 0.7 + (normalizedDist * 0.3) * farRainBoost.value

    data.originalScaleX = THREE.MathUtils.lerp(0.15, 0.4, normalizedDist) * rainLength.value * sizeMultiplier
    data.originalScaleY = THREE.MathUtils.lerp(0.8, 2.5, normalizedDist) * rainLength.value * sizeMultiplier

    data.velocity = (rainSpeed.value * 0.05) * (0.9 + Math.random() * 0.2)
    data.dist = normalizedDist
    data.brightness = 1 + (normalizedDist * 0.4)

    // 设置初始颜色
    sprite.material.color.setRGB(
        Math.min(0.67 * data.brightness, 1),
        Math.min(0.67 * data.brightness, 1),
        Math.min(1.0 * data.brightness, 1)
    )
}

// 开始雨
const startRain = () => {
    if (!scene) initThreeRain()
    if (!animationId) animate()
    isRaining.value = true
    debugInfo.value = `雨滴数量: ${rainSprites.length} | 远处增强: ${farRainBoost.value}x`
}

// 停止雨
const stopRain = () => {
    if (animationId) {
        cancelAnimationFrame(animationId)
        animationId = null
    }
    isRaining.value = false
    debugInfo.value = ""

    cleanupResources()
}

// 清理资源
const cleanupResources = () => {
    if (threeContainer) {
        rainSprites.forEach(sprite => {
            scene.remove(sprite)
        })
        rainSprites = []
        rainData = []

        if (rainMaterial) {
            rainMaterial.dispose()
            rainMaterial = null
        }
        if (rainTexture) {
            rainTexture.dispose()
            rainTexture = null
        }

        threeContainer.remove()
        threeContainer = null
        scene = null
        camera = null
        if (renderer) {
            renderer.dispose()
            renderer = null
        }
    }
}

// 切换
const toggleRain = () => {
    if (isRaining.value) stopRain()
    else startRain()
}

// 更新强度
const updateIntensity = () => {
    if (isRaining.value) {
        createRainSprites()
        debugInfo.value = `雨滴数量: ${rainSprites.length} | 强度: ${rainIntensity.value}`
    }
}

// 更新速度
const updateSpeed = () => {
    if (!isRaining.value || !rainData.length) return
    const baseSpeed = rainSpeed.value * 0.05
    rainData.forEach((data, index) => {
        data.velocity = baseSpeed * (0.9 + Math.random() * 0.2)
    })
    debugInfo.value = `速度更新: ${rainSpeed.value}`
}

// 更新雨滴长度
const updateRainLength = () => {
    if (!isRaining.value || !rainSprites.length) return

    rainSprites.forEach((sprite, index) => {
        const data = rainData[index]
        data.originalScaleX = data.originalScaleX / sprite.scale.x * rainLength.value
        data.originalScaleY = data.originalScaleY / sprite.scale.y * rainLength.value
        sprite.scale.set(data.originalScaleX, data.originalScaleY, 1)
    })
    debugInfo.value = `雨滴长度: ${rainLength.value}`
}

// 更新远处雨滴增强
const updateFarRainBoost = () => {
    if (!isRaining.value || !rainSprites.length) return
    createRainSprites()
    debugInfo.value = `远处雨滴增强: ${farRainBoost.value}x`
}

onUnmounted(() => stopRain())

defineExpose({ startRain, stopRain, toggleRain, isRaining })
</script>

<style scoped>
/* 样式保持不变 */
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