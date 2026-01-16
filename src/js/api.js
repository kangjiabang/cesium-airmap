import axios from "axios";

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: "http://127.0.0.1:8000", // 设置基础 URL
  timeout: 10000, // 请求超时时间
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证 token 等
    // config.headers.Authorization = `Bearer ${getToken()}`;
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 对响应数据做处理
    return response.data;
  },
  (error) => {
    // 对错误响应做处理
    console.error("API Error:", error);
    return Promise.reject(error);
  }
);

// API 接口定义
export const api = {
  // 规划路径
  planPath: (data) => {
    return apiClient.post("/plan", data);
  },

  // 获取禁飞区
  getNoFlyZones: () => {
    return apiClient.get("/nofly-zones");
  },

  // 获取飞行航线
  getFlightPaths: () => {
    return apiClient.get("/fly-paths");
  },

  // 冲突分析
  analyzeCollision: () => {
    return apiClient.post("/collision-analysis");
  },

  // 根据无人机获取飞行路径
  getFlightPlanPathsByDrone: (droneId = "") => {
    return apiClient.get(`/fly-plan-paths-by-drone?drone_id=${droneId}`);
  },

  // 根据无人机获取计划航线
  // 确保这里接收第二个参数 includeSurrounding
  getFlightPathsByDrone: (droneId, includeSurrounding = false) => {
    // 使用模板字符串手动拼接参数
    return apiClient.get(`/fly-paths-by-drone`, {
      params: {
        drone_id: droneId,
        include_surrounding: includeSurrounding,
      },
    });
  },

  // 风险分析
  getDroneRiskAnalysis: (droneId) => {
    return apiClient.post(`/drone-nofly-risk-analysis?drone_id=${droneId}`);
  },
};

export default apiClient;
