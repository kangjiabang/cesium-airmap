import * as Cesium from 'cesium'

// 碰撞预警效果（红色闪烁）
export function warning_effects(droneEntity) {
    droneEntity.model.color = new Cesium.CallbackProperty(function (time) {
        const alpha = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        return Cesium.Color.RED.withAlpha(alpha);
    }, false);
}

export function warning_effects_2(droneEntity,viewer) {
   let lastChange = 0;
    droneEntity.model.color = new Cesium.CallbackProperty(function(time) {
        const now = Date.now();
        
        // 每100ms有30%几率触发"故障"
        if (now - lastChange > 100 && Math.random() < 0.3) {
            lastChange = now;
            return Cesium.Color.fromRandom({
                alpha: 0.8,
                minimumRed: 0.7,
                maximumRed: 1.0,
                minimumGreen: 0.0,
                maximumGreen: 0.3,
                minimumBlue: 0.7,
                maximumBlue: 1.0
            });
        }
        
        // 正常状态下的呼吸灯效果
        const pulse = 0.5 + 0.5 * Math.sin(now / 300);
        return new Cesium.Color(1.0, pulse, 0.3, 0.8);
    }, false);

    // 添加模型扭曲效果
    droneEntity.model.nodeTransformations = {
        "模型节点名": {
            translation: new Cesium.CallbackProperty(function() {
                return new Cesium.Cartesian3(
                    Math.random() * 0.2 - 0.1,
                    Math.random() * 0.2 - 0.1,
                    0
                );
            }, false)
        }
    };

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
