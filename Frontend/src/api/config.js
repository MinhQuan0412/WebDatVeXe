// Tự động dùng domain hiện tại (hoạt động cả localhost lẫn ngrok)
export const API_BASE_URL = import.meta.env.VITE_API_URL || window.location.origin;
