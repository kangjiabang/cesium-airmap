import * as Cesium from 'cesium'
import * as turf from '@turf/turf'
export function pointInNoFlyZone(point, zones) {
    let minDist = Number.POSITIVE_INFINITY;
    for (const zone of zones) {
        const positions = zone.positions;
        if (!positions || positions.length < 3) continue;
        const carto = Cesium.Cartographic.fromCartesian(point);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const pt = turf.point([lon, lat]);
        const polyCoords = positions.map(p => {
            const c = Cesium.Cartographic.fromCartesian(p);
            return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
        });
        // 保证首尾闭合
        if (polyCoords.length > 2) {
            const first = polyCoords[0];
            const last = polyCoords[polyCoords.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                polyCoords.push([...first]);
            }
        }
        // turf.polygon expects [ [ [lon,lat], ... ] ]
        const poly = turf.polygon([polyCoords]);
        const dist = turf.pointToPolygonDistance(pt, poly, { units: 'meters' });
        if (dist < minDist) minDist = dist;
    }
    return minDist;
}