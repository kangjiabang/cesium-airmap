import * as Cesium from 'cesium'

// 碰撞预警效果（红色闪烁）
export function warning_effects(droneEntity) {
    droneEntity.model.color = new Cesium.CallbackProperty(function (time) {
        const alpha = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        return Cesium.Color.RED.withAlpha(alpha);
    }, false);
}

// 碰撞效果（彩虹色+脉冲缩放）
export function collision_effects(droneEntity) {
    droneEntity.model.color = new Cesium.CallbackProperty(function (time) {
        // 彩虹色循环 (HSV色彩空间)
        const hue = (Date.now() / 1000) % 1.0;
        const color = Cesium.Color.fromHsl(hue, 1.0, 0.5, 0.8);
        // 脉冲缩放 (0.8~1.2倍)
        const scale = 1.0 + 0.5 * Math.sin(Date.now() / 200);
        droneEntity.model.scale = new Cesium.ConstantProperty(scale);
        return color;
    }, false);
}
