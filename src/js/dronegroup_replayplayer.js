import * as Cesium from "cesium";

export class DroneGroupReplayPlayer {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.modelUri = options.modelUri;
    this.speedFactor = options.speedFactor || 1;
    this.polylineWidth = options.polylineWidth || 3;

    this.masterId = options.masterId || null;
    this.uavs = new Map();

    this.startTime = null;
    this.endTime = null;
    this.maxSeconds = 0;

    this.isPlaying = false;
    this._removePostRender = null;
    this.onTick = null;

    this.timelineContainer = null;
    this.timelineSlider = null;
    this.timelineCurrent = null;
    this.timelineStart = null;
    this.timelineEnd = null;

    /** 存储最近线位置和中点（由回调读取）
     * 现仅用于存储 主无人机 与其最近邻无人机 的信息 */
    this._nearestPositions = {}; // id → [posA,posB]
    this._midPosition = {}; // id → midpoint
    this._distanceText = {}; // id → "123m"

    console.log("[DroneGroupReplay] 初始化完成");
  }

  addUav(cfg) {
    if (!cfg || !cfg.path || cfg.path.length < 2) return;

    const id = cfg.id || `UAV_${this.uavs.size + 1}`;
    const isMaster = cfg.isMaster;

    /** 平滑路径 */
    const smooth = [];
    const pts = cfg.path;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      // 路径平滑处理（保持原逻辑）
      const steps = 10;
      for (let s = 0; s <= steps; s++) {
        const lon = a.lon + ((b.lon - a.lon) * s) / steps;
        const lat = a.lat + ((b.lat - a.lat) * s) / steps;
        const h = a.height + ((b.height - a.height) * s) / steps;
        const t = new Date(
          new Date(a.time).getTime() +
            ((new Date(b.time) - new Date(a.time)) * s) / steps
        );
        smooth.push({ lon, lat, height: h, time: t });
      }
    }

    /** 轨迹坐标 */
    const path = smooth.map((p) => ({
      position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height),
      time: p.time,
    }));

    /** 主无人机时间 */
    if (isMaster) {
      this.startTime = path[0].time;
      this.endTime = path[path.length - 1].time;
      this.maxSeconds = (this.endTime - this.startTime) / 1000;
      this.masterId = id;
    }

    /** 位置插值 */
    const posProp = new Cesium.SampledPositionProperty();
    path.forEach((p) =>
      posProp.addSample(Cesium.JulianDate.fromDate(p.time), p.position)
    );
    posProp.setInterpolationOptions({
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
      interpolationDegree: 5,
    });

    /** 轨迹线颜色 */
    const colorStr = cfg.color || "green";
    let color;
    try {
      color = Cesium.Color.fromCssColorString(colorStr);
    } catch {
      color = Cesium.Color.fromHsl((this.uavs.size * 0.15) % 1, 0.7, 0.5);
    }

    /** 轨迹线 */
    const polyline = this.viewer.entities.add({
      id: `${id}_polyline`,
      polyline: {
        positions: path.map((p) => p.position),
        width: this.polylineWidth,
        material: isMaster
          ? color.withAlpha(0.9)
          : new Cesium.PolylineDashMaterialProperty({
              color: color.withAlpha(0.9),
              dashLength: 16.0,
            }),
      },
    });

    // --- 新增：添加真实航线标签 ---
    const rawPositions = path.map((p) => p.position);
    const centerIndex = Math.floor(rawPositions.length / 2);
    const centerPosition = rawPositions[centerIndex];

    // 根据是否为主无人机，决定显示“真实航线”还是“周围航线”
    const labelDisplayName = isMaster ? `${id} 真实航线` : `${id} 周围航线`;

    const pathLabel = this.viewer.entities.add({
      name: `${id} 真实航线标签`,
      position: centerPosition,
      label: {
        text: labelDisplayName,
        font: "14pt sans-serif",
        fillColor: color, // 使用该无人机分配的轨迹颜色
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        scale: 0.8,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // 确保标签不被模型遮挡
      },
    });

    /** 无人机本体 */
    const entity = this.viewer.entities.add({
      id,
      name: id,
      position: posProp,
      model: {
        uri: this.modelUri || "/cesium/model/fixedWingUav.glb",
        minimumPixelSize: 128,
        maximumScale: 200,
        color,
      },
      orientation: new Cesium.VelocityOrientationProperty(posProp),
    });

    /** 主机标签 */
    let labelEntity = null;
    if (isMaster) {
      labelEntity = this.viewer.entities.add({
        position: posProp,
        label: {
          text: "",
          font: "16px sans-serif",
          fillColor: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -30),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    /** ⭐ 最近距离连线（CallbackProperty） - 保持原样 */
    const nearestLine = this.viewer.entities.add({
      polyline: {
        // 仅当缓存中有数据时显示
        positions: new Cesium.CallbackProperty(() => {
          return this._nearestPositions[id] || [];
        }, false),
        width: 2,
        material: Cesium.Color.RED.withAlpha(0.7),
      },
    });

    /** ⭐ 距离标签（CallbackProperty） - 保持原样 */
    const distanceLabel = this.viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        return this._midPosition[id] || Cesium.Cartesian3.ZERO;
      }, false),
      label: {
        text: new Cesium.CallbackProperty(() => {
          return this._distanceText[id] || "";
        }, false),
        font: "14px sans-serif",
        fillColor: Cesium.Color.RED,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    /** 保存 UAV */
    this.uavs.set(id, {
      id,
      path,
      posProp,
      entity,
      label: labelEntity,
      pathLabel: pathLabel, // 将标签存入 map 方便清理
      polyline,
      nearestLine,
      distanceLabel,
    });

    console.log(`[DroneGroupReplay] UAV 已添加: ${id}`);

    if (isMaster) this._initTimeline();
  }

  /**
   * 更新最近距离（只计算主无人机与最近无人机的连线）
   * @param {Cesium.JulianDate} jd 当前时间
   */
  _updateNearestDistances(jd) {
    const master = this.uavs.get(this.masterId);
    const list = Array.from(this.uavs.values());

    // 1. 清空所有无人机的连线缓存（包括非主无人机）
    for (const uav of list) {
      this._nearestPositions[uav.id] = [];
      this._midPosition[uav.id] = Cesium.Cartesian3.ZERO;
      this._distanceText[uav.id] = "";
    }

    // 检查主无人机是否存在
    if (!master || list.length < 2) return;

    const posA = master.posProp.getValue(jd);
    if (!posA) return;

    let nearestUav = null;
    let minDist = Infinity;
    let posB_nearest = null;

    // 2. 遍历其他无人机，找到距离主无人机最近的一个
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.id === master.id) continue; // 跳过主无人机本身

      const posB = b.posProp.getValue(jd);
      if (!posB) continue;

      const d = Cesium.Cartesian3.distance(posA, posB);
      if (d < minDist) {
        minDist = d;
        nearestUav = b;
        posB_nearest = posB;
      }
    }

    // 3. 更新主无人机和最近无人机（最近无人机为连线的另一端）的连线缓存
    if (nearestUav) {
      const idA = master.id;
      const idB = nearestUav.id;

      // ⭐ 更新主无人机的连线缓存（连线起点）
      this._nearestPositions[idA] = [posA, posB_nearest];
      const mid = Cesium.Cartesian3.midpoint(
        posA,
        posB_nearest,
        new Cesium.Cartesian3()
      );
      this._midPosition[idA] = mid;
      this._distanceText[idA] = `${minDist.toFixed(1)} m`;

      // ⭐ 更新最近无人机的连线缓存（连线终点）
      // 注意：因为 CallbackProperty 是基于 UAV ID 绑定的，
      // 为了让连线和标签生效，我们必须更新主无人机和最近无人机（nearestUav）两者之一的缓存。
      // 最佳实践是只更新主无人机（或其他唯一的实体）的缓存，并让连线实体只依附于它。
      // 但在您现有的代码结构中，每个 UAV 都创建了 nearestLine 和 distanceLabel 实体，
      // 且它们都绑定到自身的 ID 缓存（_nearestPositions[id]）。
      // 因此，我们选择只更新主无人机的缓存，并通过设置其他 UAV 的缓存为空来隐藏它们的连线。

      // 为了避免重复连线，我们只将距离标签和连线逻辑集中在主无人机实体上（即 idA）。
      // 如果 nearestUav 也显示，则会显示两条重叠的连线和两个标签。
      // 所以，我们只在 master.id 对应的实体上显示连线和标签。

      // 将连线和标签信息也设置给 nearestUav，以便让它的 CallbackProperty 触发绘制。
      // 为了避免在同一个点上绘制两个标签（主无人机和最近无人机的标签重叠），
      // 我们只让主无人机显示连线和标签，而让最近无人机不显示。
      this._nearestPositions[idB] = [];
      this._midPosition[idB] = Cesium.Cartesian3.ZERO;
      this._distanceText[idB] = "";
    }
  }

  /** 播放 */
  play() {
    if (this.uavs.size === 0) return;
    const master = this.uavs.get(this.masterId);
    if (!master) return;

    const startJd = Cesium.JulianDate.fromDate(this.startTime);
    const endJd = Cesium.JulianDate.fromDate(this.endTime);

    const clock = this.viewer.clock;
    clock.startTime = startJd;
    clock.stopTime = endJd;
    clock.currentTime = startJd;
    clock.clockRange = Cesium.ClockRange.CLAMPED;
    clock.multiplier = this.speedFactor;
    clock.shouldAnimate = true;

    this.isPlaying = true;

    /** 只负责更新主标签和最近距离，连线和标签由 CallbackProperty 刷新 */
    this._removePostRender && this._removePostRender();
    const updateFn = () => {
      const jd = this.viewer.clock.currentTime;

      this.uavs.forEach((uav) => {
        // 仅更新主无人机的标签
        if (uav.label && uav.id === this.masterId) this._updateLabel(uav, jd);
      });

      this._updateNearestDistances(jd);

      const curSec = (Cesium.JulianDate.toDate(jd) - this.startTime) / 1000;
      if (this.timelineSlider) this.timelineSlider.value = curSec;
      if (this.timelineCurrent)
        this.timelineCurrent.textContent = this._formatTime(
          new Date(this.startTime.getTime() + curSec * 1000)
        );

      this.onTick && this.onTick(curSec);
    };

    this.viewer.scene.postRender.addEventListener(updateFn);
    this._removePostRender = () =>
      this.viewer.scene.postRender.removeEventListener(updateFn);
  }

  // ... 其他方法保持不变 (pause, reset, setProgress, _updateLabel, _formatTime, _initTimeline, _clearTimeline, clearAll) ...

  pause() {
    this.viewer.clock.shouldAnimate = false;
    this.isPlaying = false;
  }

  reset() {
    this.pause();
    this.setProgress(0);
  }

  setProgress(seconds) {
    if (!this.startTime) return;
    seconds = Math.max(0, Math.min(seconds, this.maxSeconds));
    const target = new Date(this.startTime.getTime() + seconds * 1000);
    const jd = Cesium.JulianDate.fromDate(target);
    this.viewer.clock.currentTime = jd;

    this.uavs.forEach((uav) => {
      if (uav.label && uav.id === this.masterId) this._updateLabel(uav, jd);
    });

    this._updateNearestDistances(jd);

    if (this.timelineSlider) this.timelineSlider.value = seconds;
    if (this.timelineCurrent)
      this.timelineCurrent.textContent = this._formatTime(target);
  }

  _updateLabel(uav, jd) {
    const time = Cesium.JulianDate.toDate(jd);
    const pos = uav.posProp.getValue(jd);
    if (!pos) return;

    const carto = Cesium.Cartographic.fromCartesian(pos);
    const height = carto.height.toFixed(1);
    const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(6);
    const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6);

    uav.label.label.text = `时间:${time.toLocaleTimeString()}  
高度:${height}m  
经纬度:${lon},${lat}`;
  }

  _formatTime(date) {
    if (!(date instanceof Date)) return "00:00:00";
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    const s = String(date.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  _initTimeline() {
    if (!this.viewer || this.timelineContainer) return;

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.bottom = "20px";
    container.style.left = "50%";
    container.style.transform = "translateX(-50%)";
    container.style.width = "60%";
    container.style.padding = "8px 12px";
    container.style.background = "rgba(0,0,0,0.45)";
    container.style.borderRadius = "8px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "6px";
    container.style.color = "white";
    container.style.fontFamily = "sans-serif";
    container.style.zIndex = "999";
    this.timelineContainer = container;

    const currentRow = document.createElement("div");
    currentRow.style.textAlign = "center";
    currentRow.style.fontSize = "14px";
    const current = document.createElement("div");
    current.textContent = "00:00:00";
    this.timelineCurrent = current;
    currentRow.appendChild(current);

    const sliderRow = document.createElement("div");
    sliderRow.style.display = "flex";
    sliderRow.style.alignItems = "center";
    sliderRow.style.gap = "8px";

    const start = document.createElement("div");
    start.style.width = "60px";
    start.style.textAlign = "center";
    start.textContent = this._formatTime(this.startTime);
    this.timelineStart = start;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = this.maxSeconds;
    slider.step = 0.1;
    slider.value = 0;
    slider.style.flex = "1";
    this.timelineSlider = slider;
    slider.addEventListener("input", () =>
      this.setProgress(parseFloat(slider.value))
    );

    const end = document.createElement("div");
    end.style.width = "60px";
    end.style.textAlign = "center";
    end.textContent = this._formatTime(this.endTime);
    this.timelineEnd = end;

    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "4px";

    // const playBtn = document.createElement('button');
    // playBtn.textContent = '▶';
    // playBtn.onclick = () => this.play();

    // const pauseBtn = document.createElement('button');
    // pauseBtn.textContent = '⏸';
    // pauseBtn.onclick = () => this.pause();

    // btnContainer.appendChild(playBtn);
    // btnContainer.appendChild(pauseBtn);

    sliderRow.appendChild(start);
    sliderRow.appendChild(slider);
    sliderRow.appendChild(end);
    sliderRow.appendChild(btnContainer);

    container.appendChild(currentRow);
    container.appendChild(sliderRow);

    document.body.appendChild(container);
  }

  /** 清理 timeline */
  _clearTimeline() {
    if (this.timelineContainer) {
      this.timelineContainer.style.display = "none";
      this.timelineContainer.parentNode?.removeChild(this.timelineContainer);
      this.timelineContainer = null;
      this.timelineSlider = null;
      this.timelineCurrent = null;
      this.timelineStart = null;
      this.timelineEnd = null;
    }
  }

  /** 清理 */
  clearAll() {
    this.pause();
    this._removePostRender && this._removePostRender();
    this._removePostRender = null;

    this.uavs.forEach((uav) => {
      if (uav.entity) this.viewer.entities.remove(uav.entity);
      if (uav.polyline) this.viewer.entities.remove(uav.polyline);
      if (uav.label) this.viewer.entities.remove(uav.label);
      if (uav.pathLabel) this.viewer.entities.remove(uav.pathLabel);
      if (uav.nearestLine) this.viewer.entities.remove(uav.nearestLine);
      if (uav.distanceLabel) this.viewer.entities.remove(uav.distanceLabel);
    });

    this.uavs.clear();

    // 清除之前的计划航线
    this.clearPlanPaths();

    this._clearTimeline();

    this.startTime = null;
    this.endTime = null;
    this.maxSeconds = 0;
    this.masterId = null;

    this._nearestPositions = {};
    this._midPosition = {};
    this._distanceText = {};
  }

  /**
   * 设置播放速度倍数
   * @param {number} factor - 速度倍数
   */
  setSpeedFactor(factor) {
    this.speedFactor = factor;
    if (this.viewer && this.viewer.clock) {
      // 如果当前正在播放，更新时钟的倍速
      if (this.isPlaying) {
        this.viewer.clock.multiplier = this.speedFactor;
      }
    }
  }

  /**
   * 添加计划航线到场景中
   * @param {Array} planPathData - 计划航线数据
   */
  addPlanPathsToScene(planPathData) {
    if (!planPathData || planPathData.length === 0) return;

    // 清除之前的计划航线
    this.clearPlanPaths();

    planPathData.forEach((pathInfo) => {
      // 创建计划航线的路径点坐标
      const positions = pathInfo.path.map((point) =>
        Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.height)
      );

      // 添加计划航线实体到场景中
      const planPathEntity = this.viewer.entities.add({
        name: `${pathInfo.id} 计划航线`,
        polyline: {
          positions: positions,
          width: 3,
          material: Cesium.Color.RED.withAlpha(0.8), // 使用绿色表示计划航线
          clampToGround: false,
        },
      });

      // 计算路径中心点用于标签位置
      const centerIndex = Math.floor(positions.length / 2);
      const centerPosition = positions[centerIndex];

      // 添加标签标识这是计划航线
      const labelEntity = this.viewer.entities.add({
        name: `${pathInfo.id} 计划航线标签`,
        position: centerPosition,
        label: {
          text: `${pathInfo.id} 计划航线`,
          font: "14pt sans-serif",
          fillColor: Cesium.Color.LIME,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          scale: 0.8,
        },
      });

      // 将计划航线实体保存到一个数组中，以便后续清理
      if (!this.planPathEntities) {
        this.planPathEntities = [];
      }
      this.planPathEntities.push(planPathEntity, labelEntity);
    });
  }

  /**
   * 清除场景中的计划航线
   */
  clearPlanPaths() {
    if (this.planPathEntities && this.planPathEntities.length > 0) {
      this.planPathEntities.forEach((entity) => {
        this.viewer.entities.remove(entity);
      });
      this.planPathEntities = [];
    }
  }
}
