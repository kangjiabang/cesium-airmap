// src/workers/buildingWorker.js
import { getNearstBuildingsWithinDistance } from '@/js/poligon_infos_intersect_distance.js'

self.onmessage = async (event) => {
    const { dronePoint, detectionRadius, height } = event.data
    try {
        const nearest = await getNearstBuildingsWithinDistance(dronePoint, detectionRadius, height)
        self.postMessage({ success: true, result: nearest })
    } catch (err) {
        self.postMessage({ success: false, error: err.message })
    }
}
