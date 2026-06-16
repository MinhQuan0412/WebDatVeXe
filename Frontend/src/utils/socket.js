import { io } from 'socket.io-client';
import { API_BASE_URL } from '../api/config';

// Khởi tạo kết nối Socket.io kết nối đến Backend
const socket = io(API_BASE_URL, {
  autoConnect: true,
  transports: ['polling', 'websocket'], // Phải dùng polling trước để gửi được extraHeaders trong trình duyệt
  extraHeaders: {
    'ngrok-skip-browser-warning': '69420',  // Bypass ngrok
    'bypass-tunnel-reminder': 'true'         // Bypass localtunnel
  }
});

socket.on('connect', () => {
  console.log('🔌 Socket.io connected to server:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('❌ Socket.io disconnected:', reason);
});

socket.on('connect_error', (error) => {
  console.error('⚠️ Socket.io connection error:', error);
});

export default socket;
