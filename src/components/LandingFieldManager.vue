<!-- components/LandingFieldManager.vue -->
<template>

</template>

<script setup>
import { ref, onMounted, onUnmounted, inject, computed, nextTick, watchEffect } from "vue"
import * as Cesium from "cesium"

const props = defineProps({
    viewer: { type: Object, required: true }
})

// 全局状态共享（用于与主组件通信）
const infoContent = ref('')

const currentScene = ref('main') // 'main' | 'landing'
const mainCameraPosition = ref(null)
const landingFields = ref([])
const currentLandingField = ref(null)

// 暴露方法给父组件调用（可选）
defineExpose({
    enterLandingFieldScene,
    returnToMainScene,
    getCurrentScene: () => currentScene.value,
    // 👇 新增方法：允许外部在指定位置添加起降场

})


function addLandingFieldAt(cartesian) {
    if (!props.viewer) {
        console.warn('addLandingFieldAt: viewer 未初始化')
        return
    }

    // 生成唯一ID
    const id = `field_dynamic_${Date.now()}`
    const name = `动态起降场 ${landingFields.value.length + 1}`

    // 转换坐标
    const carto = Cesium.Cartographic.fromCartesian(cartesian)
    const centerLon = Cesium.Math.toDegrees(carto.longitude)
    const centerLat = Cesium.Math.toDegrees(carto.latitude)
    const centerHeight = carto.height || 1

    const newFieldData = {
        id,
        name,
        center: cartesian, // 直接使用传入的 Cartesian3
        unitLayout: {
            rows: 3,
            cols: 4,
            unitWidth: 30,
            unitHeight: 30,
            spacing: 5
        },
        weatherStations: [
            {
                id: 'ws1',
                name: '气象站 #1',
                dimensions: new Cesium.Cartesian3(5, 5, 8),
                data: {
                    temperature: '26°C',
                    humidity: '65%',
                    windSpeed: '3.2 m/s',
                    windDirection: 'NE',
                    pressure: '1013 hPa',
                    updateTime: new Date().toLocaleString()
                }
            }
        ]
    }

    // 创建单个起降场（复用 createLandingFields 的逻辑）
    createSingleLandingField(newFieldData)
}

let handler = null;
// 激活添加起降场
const enableAddLandingField = () => {
    if (!props.viewer) return;

    if (handler) {
        handler.destroy();
    }
    handler = new Cesium.ScreenSpaceEventHandler(props.viewer.scene.canvas);

    handler.setInputAction((movement) => {
        let cartesian = props.viewer.scene.pickPosition(movement.position);
        if (!cartesian) {
            // 如果 pickPosition 失败，尝试用 ellipsoid
            const ray = props.viewer.camera.getPickRay(movement.position);
            cartesian = props.viewer.scene.globe.pick(ray, props.viewer.scene);
            if (!cartesian) return;
        }

        addLandingFieldAt(cartesian);

    }, Cesium.ScreenSpaceEventType.MIDDLE_CLICK);

    // 右键取消（可选）
    handler.setInputAction(() => {
        // 可以清空当前拖动状态（如果之前有）
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};

// 起降场数据（可外部传入，此处硬编码）
const landingFieldsData = [
    {
        id: 'field1',
        name: '起降场 A',
        center: Cesium.Cartesian3.fromDegrees(119.995161825460514, 30.275375425493404, 1),
        unitLayout: {
            rows: 3,
            cols: 4,
            unitWidth: 30,
            unitHeight: 30,
            spacing: 5
        },
        weatherStations: [
            {
                id: 'ws1',
                name: '气象站 #1',
                dimensions: new Cesium.Cartesian3(5, 5, 8),
                data: {
                    temperature: '26°C',
                    humidity: '65%',
                    windSpeed: '3.2 m/s',
                    windDirection: 'NE',
                    pressure: '1013 hPa',
                    updateTime: '2025-04-05 10:30'
                }
            }
        ]
    }
]

// ✅ 新增：tooltip DOM 元素引用
let tooltipElement = null

// ✅ 创建或获取 tooltip DOM 元素
function getTooltipElement() {
    if (tooltipElement) return tooltipElement

    tooltipElement = document.createElement('div')
    tooltipElement.className = 'tooltip'
    tooltipElement.style.position = 'absolute'
    tooltipElement.style.pointerEvents = 'none'
    tooltipElement.style.zIndex = '1200'
    tooltipElement.style.background = 'rgba(42, 42, 42, 0.9)'
    tooltipElement.style.color = 'white'
    tooltipElement.style.padding = '8px 12px'
    tooltipElement.style.borderRadius = '6px'
    tooltipElement.style.fontSize = '12px'
    tooltipElement.style.lineHeight = '1.4'
    tooltipElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)'
    tooltipElement.style.whiteSpace = 'pre-line'
    tooltipElement.style.maxWidth = '200px'
    tooltipElement.style.textAlign = 'left'
    tooltipElement.style.transform = 'translateX(-50%)'

    // 添加小三角箭头
    const arrow = document.createElement('div')
    arrow.style.position = 'absolute'
    arrow.style.bottom = '-6px'
    arrow.style.left = '50%'
    arrow.style.transform = 'translateX(-50%)'
    arrow.style.width = '0'
    arrow.style.height = '0'
    arrow.style.borderLeft = '6px solid transparent'
    arrow.style.borderRight = '6px solid transparent'
    arrow.style.borderTop = '6px solid rgba(42, 42, 42, 0.9)'
    tooltipElement.appendChild(arrow)

    // 插入到 Cesium 容器中（关键！）
    const cesiumContainer = document.getElementById('cesiumContainer')
    if (cesiumContainer) {
        cesiumContainer.appendChild(tooltipElement)
    }

    return tooltipElement
}

// ✅ 显示 tooltip
function showTooltip(content, x, y) {
    const el = getTooltipElement()
    el.innerHTML = content
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.display = 'block'
}

// ✅ 隐藏 tooltip
function hideTooltip() {
    if (tooltipElement) {
        tooltipElement.style.display = 'none'
    }
}

// 👇 新增函数：创建单个起降场
function createSingleLandingField(fieldData) {
    console.log('createSingleLandingField 执行，fieldData =', fieldData)
    if (!props.viewer) return

    const landingField = {
        id: fieldData.id,
        name: fieldData.name,
        center: fieldData.center,
        units: [],
        boundaryEntity: null,
        baseEntity: null,
        weatherStations: []
    }

    const centerCarto = Cesium.Cartographic.fromCartesian(fieldData.center)
    const centerLon = Cesium.Math.toDegrees(centerCarto.longitude)
    const centerLat = Cesium.Math.toDegrees(centerCarto.latitude)
    const centerHeight = centerCarto.height

    const layout = fieldData.unitLayout
    const { rows, cols, unitWidth, unitHeight, spacing } = layout

    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const offsetX = (col - (cols - 1) / 2) * (unitWidth + spacing)
            const offsetY = ((rows - 1) / 2 - row) * (unitHeight + spacing)

            const metersPerDegreeLat = 111320
            const metersPerDegreeLon = 111320 * Math.cos(Cesium.Math.toRadians(centerLat))

            const deltaLon = offsetX / metersPerDegreeLon
            const deltaLat = offsetY / metersPerDegreeLat

            const unitLon = centerLon + deltaLon
            const unitLat = centerLat + deltaLat
            const unitBaseHeight = centerHeight + 0.15

            const halfWidthDeg = (unitWidth / 2) / metersPerDegreeLon
            const halfHeightDeg = (unitHeight / 2) / metersPerDegreeLat

            const unitWest = unitLon - halfWidthDeg
            const unitEast = unitLon + halfWidthDeg
            const unitSouth = unitLat - halfHeightDeg
            const unitNorth = unitLat + halfHeightDeg

            west = Math.min(west, unitWest)
            east = Math.max(east, unitEast)
            south = Math.min(south, unitSouth)
            north = Math.max(north, unitNorth)

            const corners = [
                Cesium.Cartesian3.fromDegrees(unitWest, unitSouth, unitBaseHeight),
                Cesium.Cartesian3.fromDegrees(unitWest, unitNorth, unitBaseHeight),
                Cesium.Cartesian3.fromDegrees(unitEast, unitNorth, unitBaseHeight),
                Cesium.Cartesian3.fromDegrees(unitEast, unitSouth, unitBaseHeight),
                Cesium.Cartesian3.fromDegrees(unitWest, unitSouth, unitBaseHeight)
            ]

            const unitIndex = row * cols + col
            const unit = props.viewer.entities.add({
                id: `${fieldData.id}_unit_${unitIndex}`,
                polygon: {
                    hierarchy: corners,
                    material: new Cesium.ImageMaterialProperty({
                        image: '/runway.png',
                        repeat: new Cesium.Cartesian2(1, 1),
                        color: Cesium.Color.WHITE,
                        transparent: true
                    }),
                    outline: true,
                    outlineColor: Cesium.Color.BLUE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                    height: 0,
                    extrudedHeight: 1,
                    extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
                },
                properties: {
                    type: 'landingUnit',
                    fieldId: fieldData.id,
                    fieldName: fieldData.name,
                    unitIndex: unitIndex,
                    width: unitWidth,
                    height: unitHeight
                }
            })

            const unitPosition = Cesium.Cartesian3.fromDegrees(unitLon, unitLat, 0.7)
            const labelEntity = props.viewer.entities.add({
                position: unitPosition,
                label: {
                    text: '#' + (unitIndex + 1).toString(),
                    font: '14pt bold sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                    // 👇 加上缩放
                    scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 2000, 0.4),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                properties: {
                    type: 'landingUnitLabel',
                    fieldId: fieldData.id,
                    unitIndex: unitIndex
                }
            })

            landingField.units.push(unit)
        }
    }

    // 底座边界
    const buffer = 10 / 111320
    const baseHeight = centerHeight + 0.05
    //const baseHeight = 0.1
    const baseWest = west - buffer
    const baseEast = east + buffer
    const baseSouth = south - buffer
    const baseNorth = north + buffer

    // 气象站位置
    const weatherStationOffset = 5 / 111320
    const weatherStationLon = baseEast - weatherStationOffset
    const weatherStationLat = baseNorth - weatherStationOffset
    const weatherStationHeight = 1

    const weatherStationPosition = Cesium.Cartesian3.fromDegrees(
        weatherStationLon,
        weatherStationLat,
        weatherStationHeight
    )

    // 底座多边形
    const baseCorners = [
        Cesium.Cartesian3.fromDegrees(baseWest, baseSouth, baseHeight),
        Cesium.Cartesian3.fromDegrees(baseWest, baseNorth, baseHeight),
        Cesium.Cartesian3.fromDegrees(baseEast, baseNorth, baseHeight),
        Cesium.Cartesian3.fromDegrees(baseEast, baseSouth, baseHeight),
        Cesium.Cartesian3.fromDegrees(baseWest, baseSouth, baseHeight)
    ]

    const baseEntity = props.viewer.entities.add({
        id: `${fieldData.id}_base`,
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(baseCorners),
            material: new Cesium.ImageMaterialProperty({
                image: '/image.png',
                repeat: new Cesium.Cartesian2(1, 1),
                color: Cesium.Color.WHITE.withAlpha(0.9),
                transparent: true
            }),
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            height: 0,
            extrudedHeight: 0.1,
            extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
        },
        position: fieldData.center,
        properties: {
            type: 'landingBase',
            fieldId: fieldData.id
        }
    })

    landingField.baseEntity = baseEntity

    // 气象站
    if (fieldData.weatherStations && fieldData.weatherStations.length > 0) {
        landingField.weatherStations = []

        fieldData.weatherStations.forEach(ws => {
            const wsEntity = props.viewer.entities.add({
                id: `${fieldData.id}_weather_${ws.id}`,
                position: weatherStationPosition,
                box: {
                    dimensions: ws.dimensions,
                    material: new Cesium.ImageMaterialProperty({
                        image: '/runway.png',
                        repeat: new Cesium.Cartesian2(1, 1),
                        color: Cesium.Color.WHITE,
                        transparent: true
                    }),
                    outline: true,
                    outlineColor: Cesium.Color.CYAN,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
                },
                label: {
                    text: ws.name,
                    font: '12pt sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    pixelOffset: new Cesium.Cartesian2(0, -6),
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                    // 👇 新增：随距离缩放
                    scaleByDistance: new Cesium.NearFarScalar(1000, 1.0, 5000, 0.2),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                properties: {
                    type: 'weatherStation',
                    fieldId: fieldData.id,
                    stationId: ws.id,
                    name: ws.name,
                    data: ws.data
                }
            })

            landingField.weatherStations.push(wsEntity)
        })
    }

    // 边界标识
    const boundary = props.viewer.entities.add({
        id: `${fieldData.id}_boundary`,
        position: fieldData.center,
        label: {
            text: fieldData.name,
            font: '16pt sans-serif',
            fillColor: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -50),
            // 👇 加上缩放
            scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 2000, 0.4),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        },
        point: {
            pixelSize: 15,
            color: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        },
        properties: {
            type: 'landingField',
            fieldId: fieldData.id,
            fieldName: fieldData.name
        }
    })

    landingField.boundaryEntity = boundary
    landingFields.value.push(landingField)

    // 如果当前是主场景，确保可见
    if (currentScene.value === 'main') {
        boundary.show = true
        if (baseEntity) baseEntity.show = true
        landingField.units.forEach(unit => unit.show = true)
        if (landingField.weatherStations) {
            landingField.weatherStations.forEach(ws => ws.show = true)
        }
    } else {
        // 如果在子场景，隐藏它（除非是当前场景）
        boundary.show = false
        if (baseEntity) baseEntity.show = false
        landingField.units.forEach(unit => unit.show = false)
        if (landingField.weatherStations) {
            landingField.weatherStations.forEach(ws => ws.show = false)
        }
    }
}
// 创建起降场实体
function createLandingFields() {
    console.log('createLandingFields执行，props.viewer =', props.viewer) // 👈 加这个日志！
    if (!props.viewer) return

    landingFieldsData.forEach(fieldData => {
        const landingField = {
            id: fieldData.id,
            name: fieldData.name,
            center: fieldData.center,
            units: [],
            boundaryEntity: null,
            baseEntity: null,
            weatherStations: []
        }

        const centerCarto = Cesium.Cartographic.fromCartesian(fieldData.center)
        const centerLon = Cesium.Math.toDegrees(centerCarto.longitude)
        const centerLat = Cesium.Math.toDegrees(centerCarto.latitude)
        const centerHeight = centerCarto.height

        const layout = fieldData.unitLayout
        const { rows, cols, unitWidth, unitHeight, spacing } = layout

        let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const offsetX = (col - (cols - 1) / 2) * (unitWidth + spacing)
                const offsetY = ((rows - 1) / 2 - row) * (unitHeight + spacing)

                const metersPerDegreeLat = 111320
                const metersPerDegreeLon = 111320 * Math.cos(Cesium.Math.toRadians(centerLat))

                const deltaLon = offsetX / metersPerDegreeLon
                const deltaLat = offsetY / metersPerDegreeLat

                const unitLon = centerLon + deltaLon
                const unitLat = centerLat + deltaLat
                const unitBaseHeight = centerHeight + 0.15

                const halfWidthDeg = (unitWidth / 2) / metersPerDegreeLon
                const halfHeightDeg = (unitHeight / 2) / metersPerDegreeLat

                const unitWest = unitLon - halfWidthDeg
                const unitEast = unitLon + halfWidthDeg
                const unitSouth = unitLat - halfHeightDeg
                const unitNorth = unitLat + halfHeightDeg

                west = Math.min(west, unitWest)
                east = Math.max(east, unitEast)
                south = Math.min(south, unitSouth)
                north = Math.max(north, unitNorth)

                const corners = [
                    Cesium.Cartesian3.fromDegrees(unitWest, unitSouth, unitBaseHeight),
                    Cesium.Cartesian3.fromDegrees(unitWest, unitNorth, unitBaseHeight),
                    Cesium.Cartesian3.fromDegrees(unitEast, unitNorth, unitBaseHeight),
                    Cesium.Cartesian3.fromDegrees(unitEast, unitSouth, unitBaseHeight),
                    Cesium.Cartesian3.fromDegrees(unitWest, unitSouth, unitBaseHeight)
                ]

                const unitIndex = row * cols + col
                const unit = props.viewer.entities.add({
                    id: `${fieldData.id}_unit_${unitIndex}`,
                    polygon: {
                        hierarchy: corners,
                        material: new Cesium.ImageMaterialProperty({
                            image: '/runway.png', // 注意：放在 public/ 下
                            repeat: new Cesium.Cartesian2(1, 1),
                            color: Cesium.Color.WHITE,
                            transparent: true
                        }),
                        outline: true,
                        outlineColor: Cesium.Color.BLUE,
                        outlineWidth: 2,
                        height: 0,
                        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                        extrudedHeight: 1.5,
                        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
                    },
                    properties: {
                        type: 'landingUnit',
                        fieldId: fieldData.id,
                        fieldName: fieldData.name,
                        unitIndex: unitIndex,
                        width: unitWidth,
                        height: unitHeight
                    }
                })

                const unitPosition = Cesium.Cartesian3.fromDegrees(unitLon, unitLat, unitBaseHeight + 0.1)
                const labelEntity = props.viewer.entities.add({
                    position: unitPosition,
                    label: {
                        text: '#' + (unitIndex + 1).toString(),
                        font: '14pt bold sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 3,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                        pixelOffset: new Cesium.Cartesian2(0, -10),
                        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        // 👇 新增：随距离缩放
                        scaleByDistance: new Cesium.NearFarScalar(1000, 1.0, 5000, 0.2)
                    },
                    properties: {
                        type: 'landingUnitLabel',
                        fieldId: fieldData.id,
                        unitIndex: unitIndex
                    }
                })

                landingField.units.push(unit)
            }
        }

        // 底座边界
        const buffer = 10 / 111320
        const baseHeight = centerHeight + 0.05
        const baseWest = west - buffer
        const baseEast = east + buffer
        const baseSouth = south - buffer
        const baseNorth = north + buffer

        // 气象站位置：右上角内部
        const weatherStationOffset = 5 / 111320
        const weatherStationLon = baseEast - weatherStationOffset
        const weatherStationLat = baseNorth - weatherStationOffset
        const weatherStationHeight = baseHeight + 2

        const weatherStationPosition = Cesium.Cartesian3.fromDegrees(
            weatherStationLon,
            weatherStationLat,
            weatherStationHeight
        )

        // 底座多边形
        const baseCorners = [
            Cesium.Cartesian3.fromDegrees(baseWest, baseSouth, baseHeight),
            Cesium.Cartesian3.fromDegrees(baseWest, baseNorth, baseHeight),
            Cesium.Cartesian3.fromDegrees(baseEast, baseNorth, baseHeight),
            Cesium.Cartesian3.fromDegrees(baseEast, baseSouth, baseHeight),
            Cesium.Cartesian3.fromDegrees(baseWest, baseSouth, baseHeight)
        ]

        const baseEntity = props.viewer.entities.add({
            id: `${fieldData.id}_base`,
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(baseCorners),
                material: new Cesium.ImageMaterialProperty({
                    image: '/image.png', // 放在 public/ 下
                    repeat: new Cesium.Cartesian2(1, 1),
                    color: Cesium.Color.WHITE.withAlpha(0.9),
                    transparent: true
                }),
                outline: true,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
                outlineWidth: 2,
                height: 0,
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                extrudedHeight: 0.1,
                extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
            },
            position: fieldData.center,
            properties: {
                type: 'landingBase',
                fieldId: fieldData.id
            }
        })

        landingField.baseEntity = baseEntity

        // 气象站
        if (fieldData.weatherStations && fieldData.weatherStations.length > 0) {
            landingField.weatherStations = []

            fieldData.weatherStations.forEach(ws => {
                const wsEntity = props.viewer.entities.add({
                    id: `${fieldData.id}_weather_${ws.id}`,
                    position: weatherStationPosition,
                    box: {
                        dimensions: ws.dimensions,
                        material: new Cesium.ImageMaterialProperty({
                            image: '/runway.png',
                            repeat: new Cesium.Cartesian2(1, 1),
                            color: Cesium.Color.WHITE,
                            transparent: true
                        }),
                        outline: true,
                        outlineColor: Cesium.Color.CYAN,
                        outlineWidth: 2,
                        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
                    },
                    label: {
                        text: ws.name,
                        font: '12pt sans-serif',
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                        pixelOffset: new Cesium.Cartesian2(0, -6),
                        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                        // 👇 新增：随距离缩放
                        scaleByDistance: new Cesium.NearFarScalar(1000, 1.0, 5000, 0.2),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    },
                    properties: {
                        type: 'weatherStation',
                        fieldId: fieldData.id,
                        stationId: ws.id,
                        name: ws.name,
                        data: ws.data
                    }
                })

                landingField.weatherStations.push(wsEntity)
            })
        }

        // 边界标识
        const boundary = props.viewer.entities.add({
            id: `${fieldData.id}_boundary`,
            position: fieldData.center,
            label: {
                text: fieldData.name,
                font: '16pt sans-serif',
                fillColor: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -50),
                // 👇 加上缩放
                scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 2000, 0.4),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            },
            point: {
                pixelSize: 15,
                color: Cesium.Color.YELLOW,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            },
            properties: {
                type: 'landingField',
                fieldId: fieldData.id,
                fieldName: fieldData.name
            }
        })

        landingField.boundaryEntity = boundary
        landingFields.value.push(landingField)
    })
}

// 进入子场景
function enterLandingFieldScene(fieldId) {
    if (!props.viewer) return

    currentScene.value = 'landing'
    const field = landingFields.value.find(f => f.id === fieldId)
    if (!field) return

    currentLandingField.value = field

    mainCameraPosition.value = {
        destination: props.viewer.camera.position.clone(),
        orientation: {
            heading: props.viewer.camera.heading,
            pitch: props.viewer.camera.pitch,
            roll: props.viewer.camera.roll
        }
    }

    // 隐藏其他起降场
    landingFields.value.forEach(otherField => {
        if (otherField.id !== fieldId) {
            otherField.boundaryEntity.show = false
            otherField.units.forEach(unit => (unit.show = false))
            if (otherField.baseEntity) otherField.baseEntity.show = false
            if (otherField.weatherStations) {
                otherField.weatherStations.forEach(ws => (ws.show = false))
            }
        }
    })

    props.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(field.center).longitude),
            Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(field.center).latitude),
            200
        ),
        orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-70),
            roll: 0
        },
        duration: 2.0
    })

    infoContent.value = `
    <strong>${field.name} 详情：</strong><br>
    • 起降单元数量: ${field.units.length}<br>
    • 场地位置: ${Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(field.center).longitude).toFixed(4)}°, 
    ${Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(field.center).latitude).toFixed(4)}°<br>
    • 点击起降单元查看详情
  `
}

// 返回主场景
function returnToMainScene() {
    if (!props.viewer) return

    currentScene.value = 'main'
    currentLandingField.value = null

    landingFields.value.forEach(field => {
        field.boundaryEntity.show = true
        field.units.forEach(unit => (unit.show = true))
        if (field.baseEntity) field.baseEntity.show = true
        if (field.weatherStations) {
            field.weatherStations.forEach(ws => (ws.show = true))
        }
    })

    if (mainCameraPosition.value) {
        props.viewer.camera.flyTo({
            destination: mainCameraPosition.value.destination,
            orientation: mainCameraPosition.value.orientation,
            duration: 2.0
        })
    }

    infoContent.value = `
    <strong>操作说明：</strong><br>
    • 点击任意起降场进入子场景<br>
    • 起降场由多个矩形起降单元组成<br>
    • 子场景中可查看起降单元详情
  `
}

// 设置点击事件监听器
function setupClickHandlers() {
    if (!props.viewer) return

    const handler = new Cesium.ScreenSpaceEventHandler(props.viewer.scene.canvas)

    handler.setInputAction((click) => {
        const pickedObject = props.viewer.scene.pick(click.position)

        // 隐藏上一次的 tooltip
        hideTooltip()

        if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const entity = pickedObject.id
            const properties = entity.properties

            if (properties && properties.type) {
                const type = properties.type._value

                if (type === 'landingField' && currentScene.value === 'main') {
                    enterLandingFieldScene(properties.fieldId._value)
                } else if (type === 'landingUnit' && currentScene.value === 'landing') {
                    const unitIndex = properties.unitIndex._value
                    const fieldName = properties.fieldName._value
                    const width = properties.width._value
                    const height = properties.height._value

                    const content = `
                        <strong>单元 #${unitIndex + 1}</strong><br>
                        ${width}m × ${height}m<br>
                        <span style="color: #4caf50;">状态: 可用</span>
                    `

                    const positions = entity.polygon.hierarchy.getValue(props.viewer.clock.currentTime).positions
                    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions)
                    const position = boundingSphere.center
                    const screenPosition = props.viewer.scene.cartesianToCanvasCoordinates(position)

                    if (Cesium.defined(screenPosition)) {
                        showTooltip(content, screenPosition.x, screenPosition.y - 40)
                    }

                    const originalMaterial = entity.polygon.material
                    entity.polygon.material = Cesium.Color.ORANGE.withAlpha(0.8)
                    setTimeout(() => {
                        entity.polygon.material = originalMaterial
                        hideTooltip()
                    }, 2000)

                    infoContent.value = `
                        <strong>起降单元详情：</strong><br>
                        • 所属场地: ${fieldName}<br>
                        • 单元编号: ${unitIndex + 1}<br>
                        • 尺寸: ${width}m × ${height}m<br>
                        • 状态: 可用
                    `
                } else if (type === 'weatherStation' && currentScene.value === 'landing') {
                    const stationName = properties.name._value
                    const data = properties.data._value

                    const content = `
                        <strong>${stationName}</strong><br>
                        温度: ${data.temperature}<br>
                        湿度: ${data.humidity}<br>
                        风速: ${data.windSpeed}<br>
                        风向: ${data.windDirection}<br>
                        气压: ${data.pressure}<br>
                        更新: ${data.updateTime}
                    `

                    const position = entity.position.getValue(props.viewer.clock.currentTime)
                    const screenPosition = props.viewer.scene.cartesianToCanvasCoordinates(position)

                    if (Cesium.defined(screenPosition)) {
                        showTooltip(content, screenPosition.x, screenPosition.y - 60)
                    }

                    setTimeout(() => {
                        hideTooltip()
                    }, 1000)

                    const carto = Cesium.Cartographic.fromCartesian(position)
                    infoContent.value = `
                        <strong>气象站详情：</strong><br>
                        • 名称: ${stationName}<br>
                        • 位置: ${Cesium.Math.toDegrees(carto.longitude).toFixed(4)}°, 
                        ${Cesium.Math.toDegrees(carto.latitude).toFixed(4)}°<br>
                        • 点击查看实时气象数据
                    `
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

// ==================== 生命周期 ====================
// onMounted(async () => {
//     if (!props.viewer) {
//         console.error('LandingFieldManager: 未注入 props.viewer')
//         return
//     }

//     createLandingFields()
//     setupClickHandlers()

//     // 初始化 info 内容
//     infoContent.value = `
//     <strong>操作说明：</strong><br>
//     • 点击任意起降场进入子场景<br>
//     • 起降场由多个矩形起降单元组成<br>
//     • 子场景中可查看起降单元详情
//   `
// })

// ✅ 关键：监听 props.viewer 是否变为非 null
watchEffect(() => {
    console.log('watchEffect 执行，props.viewer =', props.viewer) // 👈 加这个日志！

    if (props.viewer) {
        console.log('✅ props.viewer 存在，调用 createLandingFields')
        createLandingFields()
        setupClickHandlers()

        enableAddLandingField()
    } else {
        console.log('❌ props.viewer 为 null，跳过 createLandingFields')
    }
})
onUnmounted(() => {

    if (handler) {
        handler.destroy()
        handler = null
    }

    // 清理事件处理器
    if (props.viewer && props.viewer.screenSpaceEventHandler) {
        props.viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
    }
})
</script>
<style>
/* 全局样式，必须非 scoped，否则无法作用于动态插入的元素 */
.tooltip {
    position: absolute;
    background: rgba(42, 42, 42, 0.9);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.4;
    z-index: 1200;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    white-space: pre-line;
    max-width: 200px;
    text-align: left;
    transform: translateX(-50%);
}

.tooltip::before {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid rgba(42, 42, 42, 0.9);
}
</style>