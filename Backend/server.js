// Server start
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Setup Socket.io
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for dev
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Gán io vào app để các routes có thể gọi req.app.get('io')
app.set('io', io);

// Lưu trữ ghế đang được chọn tạm thời trong bộ nhớ (temp lock)
// Cấu trúc: { [chuyenXeId]: { [seatId]: socketId } }
const tempLockedSeats = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Tham gia phòng của chuyến xe
  socket.on('joinTripRoom', (tripId) => {
    socket.join(tripId);
    
    // Gửi danh sách ghế đang bị khóa tạm thời cho user mới vào phòng
    const lockedInTrip = [];
    if (tempLockedSeats[tripId]) {
      for (const [seatId, lockedSocketId] of Object.entries(tempLockedSeats[tripId])) {
        lockedInTrip.push(seatId);
      }
    }
    socket.emit('initial_locked_seats', { chuyenXeId: tripId, seats: lockedInTrip });
  });

  // Lắng nghe khi có người chọn ghế (chưa thanh toán, mới đang bấm)
  socket.on('seat_locked', (data) => {
    const { chuyenXeId, danhSachGhe } = data;
    if (chuyenXeId && danhSachGhe && danhSachGhe.length > 0) {
      if (!tempLockedSeats[chuyenXeId]) {
        tempLockedSeats[chuyenXeId] = {};
      }
      danhSachGhe.forEach(seatId => {
        tempLockedSeats[chuyenXeId][seatId] = socket.id;
      });
    }
    // Phát lại cho TẤT CẢ mọi người khác trong cùng chuyến xe (trừ người gửi)
    socket.broadcast.to(chuyenXeId).emit('seat_locked', data);
  });

  // Lắng nghe khi người dùng bỏ chọn ghế
  socket.on('seat_released', (data) => {
    const { chuyenXeId, danhSachGhe } = data;
    if (chuyenXeId && danhSachGhe && tempLockedSeats[chuyenXeId]) {
      danhSachGhe.forEach(seatId => {
        if (tempLockedSeats[chuyenXeId][seatId] === socket.id) {
          delete tempLockedSeats[chuyenXeId][seatId];
        }
      });
      if (Object.keys(tempLockedSeats[chuyenXeId]).length === 0) {
        delete tempLockedSeats[chuyenXeId];
      }
    }
    socket.broadcast.to(chuyenXeId).emit('seat_released', data);
  });
  
  socket.on('leaveTripRoom', (tripId) => {
    socket.leave(tripId);
    if (tempLockedSeats[tripId]) {
      const releasedSeats = [];
      for (const [seatId, lockedSocketId] of Object.entries(tempLockedSeats[tripId])) {
        if (lockedSocketId === socket.id) {
          releasedSeats.push(seatId);
          delete tempLockedSeats[tripId][seatId];
        }
      }
      if (releasedSeats.length > 0) {
        if (Object.keys(tempLockedSeats[tripId]).length === 0) {
          delete tempLockedSeats[tripId];
        }
        socket.broadcast.to(tripId).emit('seat_released', {
          chuyenXeId: tripId,
          danhSachGhe: releasedSeats
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    
    // Tự động giải phóng tất cả ghế đang khóa bởi socket này khi mất kết nối
    for (const [chuyenXeId, seatsObj] of Object.entries(tempLockedSeats)) {
      const releasedSeats = [];
      for (const [seatId, lockedSocketId] of Object.entries(seatsObj)) {
        if (lockedSocketId === socket.id) {
          releasedSeats.push(seatId);
          delete tempLockedSeats[chuyenXeId][seatId];
        }
      }
      
      if (releasedSeats.length > 0) {
        if (Object.keys(tempLockedSeats[chuyenXeId]).length === 0) {
          delete tempLockedSeats[chuyenXeId];
        }
        socket.broadcast.to(chuyenXeId).emit('seat_released', {
          chuyenXeId,
          danhSachGhe: releasedSeats
        });
      }
    }
  });
});

const PORT = process.env.PORT || 5001;

// Trust proxy (required for ngrok/proxies)
app.set('trust proxy', 1);

// Import Routes
const authRoutes = require('./routes/authRoutes');
const tripRoutes = require('./routes/tripRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const routeRoutes = require('./routes/routeRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const contactRoutes = require('./routes/contactRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const hoaDonRoutes = require('./routes/hoaDonRoutes');
const supportRoutes = require('./routes/supportRoutes');
const voucherRoutes = require('./routes/voucherRoutes');
// Middleware
app.use(cors());
app.use(express.json());

// Initialize cron jobs — chỉ khởi động SAU khi MongoDB connect thành công

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/invoices', hoaDonRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/support-requests', supportRoutes); // Alias cho FE
app.use('/api/vouchers', voucherRoutes);
// Test Route
app.get('/api', (req, res) => {
  res.json({ message: 'Bus Booking API is running on port ' + PORT });
});


// Serve Frontend static files (dist)
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Database connection
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000, // timeout 10s khi không tìm thấy server
  socketTimeoutMS: 45000,          // timeout 45s cho mỗi query
})
  .then(() => {
    console.log('Connected to MongoDB');
    // Khởi động cron job SAU KHI MongoDB đã connect thành công
    require('./cron');
    server.listen(PORT, () => {
      console.log(`Server is running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database connection error:', err);
  });

// Tự động reconnect khi mất kết nối
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected! Attempting to reconnect...');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected!');
});