import * as Cesium from 'cesium';

export default class CesiumHeatmap_canvas2d {
    /**
     * @param options.viewer 已初始化的 Cesium Viewer（必填）
     * @param options.tileset 可选 Tileset 实例
     * @param options.heatmapContainerId 热力图容器ID
     * @param options.dataFile 建筑数据文件路径（可选）
     * @param options.radius 热力图点半径
     * @param options.type 'building' 或 'drone'，决定渲染类型（默认 building）
     */
    constructor(options) {
        if (!options.viewer) throw new Error('Cesium Viewer 实例必须传入');
        this.viewer = options.viewer;
        this.tileset = options.tileset || null;
        this.heatmapContainerId = options.heatmapContainerId;
        this.dataFile = options.dataFile;
        this.radius = options.radius || 20;
        this.type = options.type || 'building';

        this.canvas = null;
        this.ctx = null;
        this.buildings = [];
        this.drones = [];
        this.heatmapData = [];
        this.lastUpdate = 0;

        // 颜色渐变
        this.gradient = {
            0.1: 'blue',
            0.3: 'cyan',
            0.5: 'lime',
            0.7: 'yellow',
            1.0: 'red'
        };
    }

    async init() {
        this.createCanvas();

        // 如果是建筑物类型并且提供数据文件，则加载建筑物
        if (this.type === 'building' && this.dataFile) {
            await this.loadBuildings();
        }

        // 监听 resize
        this.resizeHandler = () => {
            this.resizeCanvas();
        };
        window.addEventListener('resize', this.resizeHandler);

        console.log('CesiumHeatmap 初始化完成，类型:', this.type);
        // 初始化后立即渲染一次热力图
        this.updateHeatmap();
    }

    // ========== 创建 canvas ==========
    createCanvas() {
        const container = document.getElementById(this.heatmapContainerId);
        if (!container) throw new Error('热力图容器未找到');

        // 清空容器
        container.innerHTML = '';

        // 创建 canvas 元素
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none'; // 允许鼠标事件穿透
        container.appendChild(this.canvas);

        // 设置 canvas 尺寸
        this.resizeCanvas();

        // 获取 2D 上下文
        this.ctx = this.canvas.getContext('2d');
    }

    // 调整 canvas 尺寸
    resizeCanvas() {
        const container = document.getElementById(this.heatmapContainerId);
        if (container && this.canvas) {
            this.canvas.width = container.offsetWidth;
            this.canvas.height = container.offsetHeight;
        }
    }

    // ========== 建筑物数据加载 ==========
    async loadBuildings() {
        const resp = await fetch(this.dataFile);
        const text = await resp.text();
        const lines = text.trim().split('\n');

        function parseCenter(wkt) {
            const match = wkt.match(/\(\(\((.+)\)\)\)/);
            if (!match) return null;
            const coords = match[1].split(',').map(s => s.trim().split(' ').map(Number));
            let sumLng = 0, sumLat = 0;
            coords.forEach(([lng, lat]) => { sumLng += lng; sumLat += lat; });
            return { lng: sumLng / coords.length, lat: sumLat / coords.length };
        }

        this.buildings = lines.map(line => {
            const parts = line.split('","');
            const wkt = parts[0].replace(/^"/, '');
            const value = parseFloat(parts[1].replace(/"$/, ''));
            const center = parseCenter(wkt);
            if (center) return { lng: center.lng, lat: center.lat, occupants: value };
            return null;
        }).filter(b => b !== null);

        this.heatmapData = this.generateHeatmapFromBuildings(this.buildings);
    }

    generateHeatmapFromBuildings(buildings) {
        const maxOcc = Math.max(...buildings.map(b => b.occupants));
        return buildings.map(b => ({
            lng: b.lng,
            lat: b.lat,
            value: b.occupants / maxOcc // 归一化到 0-1
        }));
    }

    // ========== 无人机数据 ==========
    setDroneData(drones) {
        this.type = 'drone';
        this.drones = drones;
        this.heatmapData = this.generateDroneHeatmap(drones);
        this.updateHeatmap();
    }

    generateDroneHeatmap(drones) {
        if (!drones || drones.length === 0) return [];
        const maxHeight = Math.max(...drones.map(d => d.height));
        return drones.map(d => ({
            lng: d.lng,
            lat: d.lat,
            value: d.height / maxHeight // 归一化到 0-1
        }));
    }

    // 获取颜色值
    getColor(value) {
        if (value <= 0.1) return this.gradient[0.1];
        if (value <= 0.3) return this.interpolateColor(this.gradient[0.1], this.gradient[0.3], (value - 0.1) / 0.2);
        if (value <= 0.5) return this.interpolateColor(this.gradient[0.3], this.gradient[0.5], (value - 0.3) / 0.2);
        if (value <= 0.7) return this.interpolateColor(this.gradient[0.5], this.gradient[0.7], (value - 0.5) / 0.2);
        return this.interpolateColor(this.gradient[0.7], this.gradient[1.0], (value - 0.7) / 0.3);
    }

    // 颜色插值
    interpolateColor(color1, color2, factor) {
        const hex = color => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
            return result ? [
                parseInt(result[1], 16),
                parseInt(result[2], 16),
                parseInt(result[3], 16)
            ] : [0, 0, 0];
        };

        const rgb1 = hex(color1);
        const rgb2 = hex(color2);

        const r = Math.round(rgb1[0] + (rgb2[0] - rgb1[0]) * factor);
        const g = Math.round(rgb1[1] + (rgb2[1] - rgb1[1]) * factor);
        const b = Math.round(rgb1[2] + (rgb2[2] - rgb1[2]) * factor);

        return `rgb(${r},${g},${b})`;
    }

    // ========== 更新热力图 ==========
    updateHeatmap() {
        if (!this.ctx || !this.heatmapData.length) return;

        const now = performance.now();
        if (now - this.lastUpdate < 200) return; // 节流
        this.lastUpdate = now;

        // 清除画布
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        let visiblePoints = 0;

        // 绘制热力点
        this.heatmapData.forEach(point => {
            const pos = Cesium.Cartesian3.fromDegrees(point.lng, point.lat);
            const pixel = this.viewer.scene.cartesianToCanvasCoordinates(pos);

            if (pixel && isFinite(pixel.x) && isFinite(pixel.y) &&
                pixel.x >= 0 && pixel.y >= 0 &&
                pixel.x < this.canvas.width &&
                pixel.y < this.canvas.height
            ) {
                visiblePoints++;

                const x = Math.floor(pixel.x);
                const y = Math.floor(pixel.y);
                const color = this.getColor(point.value);
                const alpha = 0.3 + point.value * 0.5; // 透明度根据值变化

                this.ctx.beginPath();
                this.ctx.arc(x, y, this.radius, 0, 2 * Math.PI);

                // 创建径向渐变
                const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, this.radius);
                gradient.addColorStop(0, color.replace('rgb', 'rgba').replace(')', `,${alpha})`));
                gradient.addColorStop(1, color.replace('rgb', 'rgba').replace(')', ',0)'));

                this.ctx.fillStyle = gradient;
                this.ctx.fill();
            }
        });

        console.log('热力图点数:', visiblePoints);
    }

    // 动态修改半径
    setRadius(radius) {
        this.radius = radius;
        this.updateHeatmap();
    }

    // 清理方法
    destroy() {
        if (this.canvas) {
            const container = document.getElementById(this.heatmapContainerId);
            if (container && container.contains(this.canvas)) {
                container.removeChild(this.canvas);
            }
            this.canvas = null;
            this.ctx = null;
        }

        // 移除 resize 监听器
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
    }
}

export { CesiumHeatmap_canvas2d };