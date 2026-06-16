import axios from 'axios';
import { API_BASE_URL } from './config';
import { authStorage } from '../utils/authStorage';

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

console.log("Dự án đang kết nối tới Server tại:", API_BASE_URL);

axiosClient.defaults.headers.common['Content-Type'] = 'application/json';
axiosClient.defaults.headers.common['ngrok-skip-browser-warning'] = '69420'; // Bypass ngrok
axiosClient.defaults.headers.common['bypass-tunnel-reminder'] = 'true';       // Bypass localtunnel

// Interceptor cho Request: Gắn token vào header
axiosClient.interceptors.request.use(
  (config) => {
    // Thử lấy cả adminToken và token thường từ authStorage (cả localStorage/sessionStorage)
    const token = authStorage.getAdminToken() || authStorage.getToken();
    if (token) {
      // Đảm bảo có dấu cách chuẩn xác sau 'Bearer '
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor cho Response: Xử lý lỗi tập trung và lấy data
axiosClient.interceptors.response.use(
  (response) => {
    // Axios luôn bọc response trong object { data, status, headers... }
    // Để tiện sử dụng, ta trả về thẳng response.data
    return response.data;
  },
  (error) => {
    return Promise.reject(error.response?.data || error.message);
  }
);

export default axiosClient;
