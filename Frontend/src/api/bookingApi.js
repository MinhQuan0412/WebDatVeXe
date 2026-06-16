import axiosClient from './axiosClient';

const bookingApi = {
  // --- TRIPS ---
  getRoutes: () => axiosClient.get('/api/routes'),
  getRouteDetail: (id) => axiosClient.get(`/api/routes/${id}`),
  searchTrips: (params) => axiosClient.get('/api/trips/search', { params }),
  getTripDetail: (id) => axiosClient.get(`/api/trips/${id}`),
  
   
  
  // --- BOOKINGS ---
  /** Giữ chỗ: { chuyenXeId, danhSachGhe, hoTen, soDienThoai, email, diemDon, diemTra, tongTien } */
  holdSeats: (data) => axiosClient.post('/api/bookings/hold-seats', data),

  /** Hủy giữ chỗ ngay lập tức */
  cancelHold: (bookingId) => axiosClient.post(`/api/bookings/${bookingId}/cancel-hold`),

  /** Hủy vé đã thanh toán (kèm lý do) */
  cancelBooking: (bookingId, data = {}) => axiosClient.post(`/api/bookings/${bookingId}/cancel`, data),

  /** Áp dụng Voucher: { maVoucher } */
  // Kiểm tra voucher (Bước 1)
  checkVoucher: (data) => axiosClient.post('/api/vouchers/check', data),

  // Lưu voucher vào booking (Bước 2)
  applyVoucher: (bookingId, maVoucher) => axiosClient.patch(`/api/bookings/${bookingId}/apply-voucher`, { maVoucher }),

  /** Lấy chi tiết vé theo ID */
  getBookingDetail: (bookingId) => axiosClient.get(`/api/bookings/${bookingId}`),

  /** Lấy chi tiết vé theo Mã vé (VE-...) */
  getBookingByCode: (code) => axiosClient.get(`/api/bookings/detail/${code}`),

  /** Kiểm tra trạng thái thanh toán theo Mã vé */
  getBookingStatus: (maVe) => axiosClient.get(`/api/bookings/status/${maVe}`),

  /** Lịch sử vé: paid, expired, cancelled */
  getMyBookings: () => axiosClient.get('/api/bookings/my-bookings'),

  /** Lấy QR thanh toán: /api/payments/sepay-qr/:maVe */
  getSePayQR: (maVe) => axiosClient.get(`/api/payments/sepay-qr/${maVe}`),

  // --- VOUCHERS ---
  /** Lấy danh sách Voucher theo tongTien */
  getVouchers: (params) => axiosClient.get('/api/vouchers', { params }),

  // --- OTHERS ---
  getInvoice: (bookingId) => axiosClient.get(`/api/bookings/${bookingId}/invoice`),
  getTicketPDF: (bookingId) => axiosClient.get(`/api/bookings/${bookingId}/pdf`, { responseType: 'blob' }),
  getCaptcha: () => axiosClient.get('/api/auth/captcha'),
  verifyInvoice: (data) => axiosClient.post('/api/bookings/verify-invoice', data),
};

export default bookingApi;
