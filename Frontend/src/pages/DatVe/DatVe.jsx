import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import bookingApi from '../../api/bookingApi';
import authApi from '../../api/authApi';
import { authStorage } from '../../utils/authStorage';
import Swal from 'sweetalert2';
import socket from '../../utils/socket';
import './DatVe.css';

/* ========== SƠ ĐỒ GHẾ CHUẨN FUTA ========== 
   Layout mỗi tầng: 6 hàng
   Hàng 1-5: 3 ghế (2 bên trái + 1 bên phải)
   Hàng 6:   2 ghế (ghế 16 ở trái, ghế 17 ở phải)
   Tổng: 17 ghế / tầng
*/
const SeatIcon = ({ status }) => {
  let fill = '#f1f7fd', stroke = '#80bfff';
  if (status === 'sold')     { fill = '#e0e0e0'; stroke = '#ccc'; }
  if (status === 'selected') { fill = '#0060C4'; stroke = '#004b9b'; }
  return (
    <svg width="32" height="38" viewBox="0 0 46 56" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="18" width="6" height="22" rx="3" fill={fill} stroke={stroke} strokeWidth="2"/>
      <rect x="38" y="18" width="6" height="22" rx="3" fill={fill} stroke={stroke} strokeWidth="2"/>
      <rect x="8" y="4" width="30" height="38" rx="8" fill={fill} stroke={stroke} strokeWidth="2"/>
      <path d="M11 42 v5 a4 4 0 0 0 4 4 h16 a4 4 0 0 0 4 -4 v-5 Z" fill={fill} stroke={stroke} strokeWidth="2"/>
    </svg>
  );
};

const FutaSeatMap = ({ seats, bookedSeats = [], selectedSeats = [], onToggle, title }) => {
  const rows = [];
  for (let i = 0; i < seats.length; i += 3) {
    rows.push(seats.slice(i, i + 3));
  }

  const renderSeat = (s) => {
    if (!s) return null;
    const id = s.maGhe || s.id;
    const isSold = bookedSeats.includes(id);
    const isSelected = selectedSeats.includes(id);
    const status = isSold ? 'sold' : isSelected ? 'selected' : 'available';
    return (
      <div key={id} className={`futa-seat ${status}`} onClick={() => !isSold && onToggle(id)}>
        <SeatIcon status={status} />
        <span className="futa-seat-label">{id}</span>
      </div>
    );
  };
  
  return (
    <div className="futa-deck-col">
      <div className="futa-deck-title">{title}</div>
      <div className="futa-seat-rows">
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className={`futa-seat-row ${row.length === 2 ? 'last-row' : ''}`}>
            {/* Cột trái (2 ghế nếu row=3, 1 ghế nếu row=2) */}
            <div className="futa-seat-pair">
              {row.length === 2 ? renderSeat(row[0]) : row.slice(0, 2).map(s => renderSeat(s))}
            </div>
            {/* Cột phải (1 ghế) */}
            <div className="futa-seat-single">
              {row.length === 2 ? renderSeat(row[1]) : (row.length > 2 && renderSeat(row[2]))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const DatVe = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  
  const state = location.state || {};
  const tripIdFromQuery = query.get('tripId');
  const tripId = state.trip?._id || state.trip?.maChuyen || tripIdFromQuery;

  const [detailData, setDetailData] = useState(null);
  const [selectedSeats, setSelectedSeats] = useState(state.selectedSeats || []);
  const [lockedSeats, setLockedSeats] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [selectedBoarding, setSelectedBoarding] = useState('');
  const [selectedDropoff, setSelectedDropoff] = useState('');

  // Tự động điền thông tin từ tài khoản đã đăng nhập
  const loggedUser = authStorage.getUser();
  const [fullName, setFullName] = useState(loggedUser?.hoTen || loggedUser?.name || '');
  const [phone, setPhone] = useState(loggedUser?.soDienThoai || loggedUser?.phone || '');
  const [email, setEmail] = useState(loggedUser?.email || '');

  /* ===== API: Lấy chi tiết chuyến xe (gheDaDat, diemDon, diemTra, giaVe) ===== */
  const fetchTripDetail = useCallback(async (isFirstLoad = false) => {
    if (!tripId) return;
    if (isFirstLoad) setLoading(true);
    
    try {
      const res = await bookingApi.getTripDetail(tripId);
      const data = res.data || res;
      
      // Chỉ cập nhật nếu có sự thay đổi thực sự ở danh sách ghế đã đặt để tránh jitter UI
      setDetailData(prev => {
        if (!prev) return data;
        const prevBooked = JSON.stringify(prev.gheDaDat || []);
        const nextBooked = JSON.stringify(data.gheDaDat || []);
        if (prevBooked === nextBooked && prev._id === data._id) return prev;
        return data;
      });
      
      if (data?.diemDon?.length > 0 && !selectedBoarding) setSelectedBoarding(data.diemDon[0].tenDiem);
      if (data?.diemTra?.length > 0 && !selectedDropoff) setSelectedDropoff(data.diemTra[0].tenDiem);
    } catch (err) {
      console.error(err);
      if (isFirstLoad) Swal.fire('Lỗi', 'Không tải được thông tin chuyến xe', 'error');
    } finally {
      if (isFirstLoad) setLoading(false);
    }
  }, [tripId, selectedBoarding, selectedDropoff]);

  // Load dữ liệu chuyến xe lần đầu
  useEffect(() => { 
    fetchTripDetail(true);
  }, [tripId, fetchTripDetail]);

  // Polling: Tự động làm mới danh sách ghế mỗi 5s để đồng bộ ghế đã giữ từ người dùng khác
  useEffect(() => {
    if (!tripId) return;
    const interval = setInterval(() => fetchTripDetail(false), 2000);
    return () => clearInterval(interval);
  }, [tripId, fetchTripDetail]);

  // Socket realtime — tách riêng, chỉ phụ thuộc tripId để tránh re-register listener
  useEffect(() => {
    if (!tripId) return;

    console.log('🚀 [Socket] tripId =', tripId);
    console.log('🚀 [Socket] socket.connected =', socket.connected, '| socket.id =', socket.id);

    const onConnect = () => {
      console.log('✅ [Socket] onConnect fired, joining room:', tripId);
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Đã kết nối Socket! (ID: ${socket.id})`, showConfirmButton: false, timer: 3000 });
      socket.emit('joinTripRoom', tripId);
    };

    const onInitialLockedSeats = (data) => {
      console.log('🔒 [Socket] initial_locked_seats received:', data);
      const id = data.chuyenXeId;
      const seats = data.seats || [];
      if (id === tripId) {
        setLockedSeats(prev => [...new Set([...prev, ...seats])]);
      }
    };

    const onSeatLocked = (data) => {
      console.log('🔒 [Socket] seat_locked received:', data, '| tripId:', tripId);
      const id = data.chuyenXeId || data.tripId || data.chuyenXe;
      const seats = data.danhSachGhe || data.seats || data.ghe || [];
      if (id === tripId) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: `Có người vừa khóa ghế ${seats.join(', ')}`, showConfirmButton: false, timer: 2000 });
        setLockedSeats(prev => [...new Set([...prev, ...seats])]);
        // Tự động bỏ chọn nếu ghế đang được mình chọn nhưng bị người khác khóa
        setSelectedSeats(prev => prev.filter(s => !seats.includes(s)));
        // Re-fetch ngay để có data mới nhất từ server
        fetchTripDetail(false);
      } else {
        console.warn('⚠️ [Socket] seat_locked ID không khớp:', id, '!=', tripId);
      }
    };

    const onSeatReleased = (data) => {
      console.log('🔓 [Socket] seat_released received:', data);
      const id = data.chuyenXeId || data.tripId || data.chuyenXe;
      const seats = data.danhSachGhe || data.seats || data.ghe || [];
      if (id === tripId) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Ghế ${seats.join(', ')} vừa được nhả`, showConfirmButton: false, timer: 2000 });
        setLockedSeats(prev => prev.filter(seat => !seats.includes(seat)));
        setDetailData(prev => {
          if (!prev || !prev.gheDaDat) return prev;
          return { ...prev, gheDaDat: prev.gheDaDat.filter(seat => !seats.includes(seat)) };
        });
      }
    };

    const onSeatsUpdated = (data) => {
      console.log('🔄 [Socket] seatsUpdated received:', data);
      const id = data.chuyenXeId || data.tripId || data.chuyenXe || data._id;
      const booked = data.bookedSeats || data.gheDaDat || [];
      if (id === tripId || !id) {
        setDetailData(prev => prev ? { ...prev, gheDaDat: booked } : prev);
        setLockedSeats(prev => prev.filter(seat => !booked.includes(seat)));
      }
    };

    const onBookingCancelled = (data) => {
      console.log('❌ [Socket] booking_cancelled received:', data);
      const id = data.chuyenXeId || data.tripId || data.chuyenXe || data._id;
      const releasedSeats = data.gheTraLai || data.danhSachGhe || data.seats || data.ghe || [];
      
      // Chỉ nhả ghế nếu sự kiện thuộc về chuyến xe đang xem (hoặc nếu BE không gửi tripId thì vẫn nhả)
      if ((!id || id === tripId) && releasedSeats.length > 0) {
        setLockedSeats(prev => prev.filter(seat => !releasedSeats.includes(seat)));
        setDetailData(prev => {
          if (!prev || !prev.gheDaDat) return prev;
          return { ...prev, gheDaDat: prev.gheDaDat.filter(seat => !releasedSeats.includes(seat)) };
        });
      }
    };

    // Đăng ký listeners TRƯỚC KHI emit joinTripRoom để tránh race condition
    socket.on('connect', onConnect);
    socket.on('initial_locked_seats', onInitialLockedSeats);
    socket.on('seat_locked', onSeatLocked);
    socket.on('seat_released', onSeatReleased);
    socket.on('seatsUpdated', onSeatsUpdated);
    socket.on('booking_cancelled', onBookingCancelled);

    // Nếu socket đã connected rồi thì join ngay sau khi đã đăng ký xong listeners
    if (socket.connected) {
      socket.emit('joinTripRoom', tripId);
      console.log('✅ [Socket] Đã joinTripRoom (connected sẵn):', tripId);
    }

    return () => {
      console.log('🧹 [Socket] cleanup, leaving room:', tripId);
      socket.emit('leaveTripRoom', tripId);
      socket.off('connect', onConnect);
      socket.off('initial_locked_seats', onInitialLockedSeats);
      socket.off('seat_locked', onSeatLocked);
      socket.off('seat_released', onSeatReleased);
      socket.off('seatsUpdated', onSeatsUpdated);
      socket.off('booking_cancelled', onBookingCancelled);
    };
  }, [tripId]);

  // Fetch thêm profile để auto-fill chính xác nhất từ server
  useEffect(() => {
    const fetchLatestProfile = async () => {
      const token = authStorage.getToken();
      if (!token) return;
      try {
        const res = await authApi.getMe();
        const user = res.data || res.user || res;
        if (user) {
          if (user.hoTen || user.name) setFullName(user.hoTen || user.name);
          if (user.soDienThoai || user.phone) setPhone(user.soDienThoai || user.phone);
          if (user.email) setEmail(user.email);
        }
      } catch (err) {
        console.error('Không thể tự động điền thông tin:', err);
      }
    };
    fetchLatestProfile();
  }, []);

  /* ===== Tạo sơ đồ 34 ghế (A01-A17, B01-B17) ===== */
  const { lowerDeck, upperDeck } = useMemo(() => {
    const lower = Array.from({ length: 17 }, (_, i) => ({ maGhe: `A${(i + 1).toString().padStart(2, '0')}` }));
    const upper = Array.from({ length: 17 }, (_, i) => ({ maGhe: `B${(i + 1).toString().padStart(2, '0')}` }));
    return { lowerDeck: lower, upperDeck: upper };
  }, []);

  // Parse giá vé an toàn (có thể là string hoặc number)
  const getPriceNum = (val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val.replace(/[^\d]/g, '')) || 0;
    return 0;
  };
  const giaVe = getPriceNum(detailData?.giaVe || state.trip?.giaVe || state.trip?.tuyenXeId?.giaVe || 0);
  const totalAmount = giaVe * selectedSeats.length;
  const bookedSeats = detailData?.gheDaDat || [];

  const handleToggleSeat = (seatId) => {
    if (bookedSeats.includes(seatId) || lockedSeats.includes(seatId)) return;
    
    const isSelected = selectedSeats.includes(seatId);
    
    if (!isSelected && selectedSeats.length >= 6) {
      return Swal.fire('Thông báo', 'Bạn chỉ được chọn tối đa 6 ghế!', 'warning');
    }

    setSelectedSeats(prev => isSelected ? prev.filter(s => s !== seatId) : [...prev, seatId]);

    // Emit event socket real-time khi thao tác ghế
    socket.emit(isSelected ? 'seat_released' : 'seat_locked', {
      chuyenXeId: tripId,
      danhSachGhe: [seatId]
    });
  };

  // ===== NHẢ GHẾ KHI RỜI TRANG =====
  // Lưu bookingId vào ref để dùng trong cleanup (tránh stale closure)
  const holdBookingIdRef = React.useRef(null);
  // Lưu selectedSeats vào ref để dùng trong cleanup
  const selectedSeatsRef = React.useRef(selectedSeats);
  useEffect(() => { selectedSeatsRef.current = selectedSeats; }, [selectedSeats]);

  // Hàm nhả ghế — gọi API cancelHold (nếu đã hold) + emit socket
  const releaseHold = useCallback(async () => {
    const seats = selectedSeatsRef.current;
    // Nhả socket trước (real-time cho người khác)
    if (seats.length > 0) {
      socket.emit('seat_released', { chuyenXeId: tripId, danhSachGhe: seats });
    }
    // Nếu đã tạo booking hold thì gọi API hủy
    if (holdBookingIdRef.current) {
      const bookingId = holdBookingIdRef.current;
      holdBookingIdRef.current = null;
      try {
        await bookingApi.cancelHold(bookingId);
      } catch (e) {
        // Ignore — ghế sẽ tự hết hạn theo TTL của BE
      }
    }
  }, [tripId]);

  // Cleanup khi component unmount (navigate đi, đóng tab...)
  useEffect(() => {
    return () => {
      const seats = selectedSeatsRef.current;
      if (seats.length > 0) {
        socket.emit('seat_released', { chuyenXeId: tripId, danhSachGhe: seats });
      }
      // Nếu còn holdBookingId (chưa đi thanh toán) thì gọi sendBeacon
      if (holdBookingIdRef.current) {
        const apiBase = (typeof __API_BASE_URL__ !== 'undefined' ? __API_BASE_URL__ : '') || '';
        navigator.sendBeacon?.(`${apiBase}/api/bookings/${holdBookingIdRef.current}/cancel-hold`);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // Bắt sự kiện đóng tab / reload trang
  useEffect(() => {
    const onBeforeUnload = () => {
      if (holdBookingIdRef.current) {
        const apiBase = (typeof __API_BASE_URL__ !== 'undefined' ? __API_BASE_URL__ : '') || '';
        navigator.sendBeacon?.(`${apiBase}/api/bookings/${holdBookingIdRef.current}/cancel-hold`);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const handleBooking = async () => {
    if (selectedSeats.length === 0) return Swal.fire('Thông báo', 'Bạn chưa chọn ghế', 'warning');
    if (!selectedBoarding || !selectedDropoff || !fullName || !phone) {
      return Swal.fire('Thông báo', 'Vui lòng điền đủ thông tin', 'warning');
    }

    try {
      const payload = {
        chuyenXeId: tripId,
        danhSachGhe: selectedSeats,
        hoTen: fullName,
        soDienThoai: phone,
        email,
        diemDon: selectedBoarding,
        diemTra: selectedDropoff,
        tongTien: totalAmount
      };
      const res = await bookingApi.holdSeats(payload);
      const data = res.data || res;

      // Lưu bookingId vào ref — khi navigate sang thanh toán thì xóa ref để cleanup không nhả ghế
      holdBookingIdRef.current = data._id || data.bookingId;

      // Emit socket để báo cho tất cả tab khác biết ghế này đã bị hold
      socket.emit('seat_locked', {
        chuyenXeId: tripId,
        danhSachGhe: selectedSeats
      });

      // Xóa ref TRƯỚC khi navigate — cleanup sẽ không nhả ghế nữa
      holdBookingIdRef.current = null;

      navigate('/thanh-toan', {
        state: {
          bookingId: data._id || data.bookingId,
          maVe: data.maVe,
          trip: detailData || state.trip,
          selectedSeats,
          total: totalAmount,
          customer: { hoTen: fullName, soDienThoai: phone, email },
          diemDon: detailData?.diemDon?.find(p => p.tenDiem === selectedBoarding) || { tenDiem: selectedBoarding },
          diemTra: detailData?.diemTra?.find(p => p.tenDiem === selectedDropoff) || { tenDiem: selectedDropoff },
          holdExpires: data.holdExpires
        }
      });
    } catch (err) {
      Swal.fire('Thất bại', err.response?.data?.message || err.message || 'Lỗi đặt chỗ', 'error');
    }
  };

  if (loading) return <div style={{textAlign:'center', padding:'80px 0', fontSize:'16px', color:'#666'}}>Đang tải thông tin xe...</div>;
  if (!tripId) return <div style={{textAlign:'center', padding:'80px 0', fontSize:'16px', color:'#666'}}>Không có thông tin chuyến xe.</div>;

  return (
    <div className="bb-booking-wrapper">
      {/* HEADER */}
      <div className="bb-header-banner">
        <div className="bb-header-content">
           <button className="bb-back-btn" onClick={async () => { await releaseHold(); navigate(-1); }}>Quay lại</button>
           <div className="bb-header-titles">
             <h2>{detailData?.tuyenXeId?.diemDi || state.trip?.tuyenXeId?.diemDi} – {detailData?.tuyenXeId?.diemDen || state.trip?.tuyenXeId?.diemDen}</h2>
             <p>{detailData?.thoiGianKhoiHanh ? new Date(detailData.thoiGianKhoiHanh).toLocaleString('vi-VN', {weekday:'long', day:'2-digit', month:'2-digit'}) : '---'}</p>
           </div>
        </div>
      </div>

      <div className="bb-main-container">
        <div className="bb-layout">
          
          {/* ========== CỘT TRÁI ========== */}
          <div className="bb-col-left">
            
            {/* 1. CHỌN GHẾ */}
            <div className="bb-card">
              <div className="bb-card-header d-flex-between">
                <span>Chọn ghế</span>
              </div>
              <div className="bb-card-body">
                <div className="futa-seats-section">
                  <FutaSeatMap title="Tầng dưới" seats={lowerDeck} bookedSeats={[...bookedSeats, ...lockedSeats]} selectedSeats={selectedSeats} onToggle={handleToggleSeat} />
                  <FutaSeatMap title="Tầng trên" seats={upperDeck} bookedSeats={[...bookedSeats, ...lockedSeats]} selectedSeats={selectedSeats} onToggle={handleToggleSeat} />
                  <div className="futa-legend">
                     <div className="futa-legend-item"><SeatIcon status="sold" /> <span>Đã bán</span></div>
                     <div className="futa-legend-item"><SeatIcon status="available" /> <span>Còn trống</span></div>
                     <div className="futa-legend-item"><SeatIcon status="selected" /> <span>Đang chọn</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. THÔNG TIN KHÁCH HÀNG + ĐIỀU KHOẢN */}
            <div className="bb-card mt-20">
              <div className="bb-customer-split">
                <div className="bb-customer-form">
                   <div className="bb-section-title">Thông tin khách hàng</div>
                   <div className="bb-input-group">
                      <label>Họ và tên <span className="req">*</span></label>
                      <input type="text" placeholder="Họ và tên" value={fullName} onChange={e => setFullName(e.target.value)} />
                   </div>
                   <div className="bb-input-group">
                      <label>Số điện thoại <span className="req">*</span></label>
                      <input type="text" placeholder="Số điện thoại" value={phone} onChange={e => setPhone(e.target.value)} />
                   </div>
                   <div className="bb-input-group">
                      <label>Email <span className="req">*</span></label>
                      <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                   </div>
                   <label className="bb-agree">
                      <input type="checkbox" /> Chấp nhận điều khoản đặt vé & chính sách bảo mật thông tin của BlueBus
                   </label>
                </div>
                <div className="bb-customer-rules">
                   <div className="bb-section-title text-center" style={{color:'#ef532b'}}>ĐIỀU KHOẢN & LƯU Ý</div>
                   <ul className="bb-rules-list">
                      <li>Quý khách vui lòng có mặt tại bến xuất phát trước ít nhất 30 phút giờ xe khởi hành.</li>
                      <li>Mang theo thông báo thanh toán vé thành công hoặc mã vé.</li>
                   </ul>
                </div>
              </div>
            </div>

            {/* 3. ĐIỂM ĐÓN TRẢ (không trung chuyển) */}
            <div className="bb-card mt-20">
              <div className="bb-card-header">Thông tin đón trả</div>
              <div className="bb-card-body">
                 <div className="bb-location-split">
                    <div className="bb-loc-col">
                       <div className="bb-loc-title">ĐIỂM ĐÓN</div>
                       <select className="bb-select" value={selectedBoarding} onChange={e => setSelectedBoarding(e.target.value)}>
                          {detailData?.diemDon?.length ? detailData.diemDon.map((p, i) => <option key={i} value={p.tenDiem}>{p.tenDiem}</option>) : <option value="">Chọn điểm đón</option>}
                       </select>
                    </div>
                    <div className="bb-loc-col">
                       <div className="bb-loc-title">ĐIỂM TRẢ</div>
                       <select className="bb-select" value={selectedDropoff} onChange={e => setSelectedDropoff(e.target.value)}>
                          {detailData?.diemTra?.length ? detailData.diemTra.map((p, i) => <option key={i} value={p.tenDiem}>{p.tenDiem}</option>) : <option value="">Chọn điểm trả</option>}
                       </select>
                    </div>
                 </div>
              </div>
            </div>
          </div>

          {/* ========== CỘT PHẢI (SIDEBAR) ========== */}
          <div className="bb-col-right">
             <div className="bb-sticky-sidebar">
                <div className="bb-card">
                   <div className="bb-card-header d-flex-between">
                      <span>Thông tin chuyến đi</span>
                      <span className="bb-text-blue" style={{fontSize:'12px', cursor:'pointer'}}>Chi tiết</span>
                   </div>
                   <div className="bb-card-body">
                      <div className="bb-sum-row"><span className="bb-sum-label">Tuyến xe</span><strong>{detailData?.tuyenXeId?.diemDi} – {detailData?.tuyenXeId?.diemDen}</strong></div>
                      <div className="bb-sum-row"><span className="bb-sum-label">Thời gian xuất bến</span><strong>{detailData?.thoiGianKhoiHanh ? new Date(detailData.thoiGianKhoiHanh).toLocaleString('vi-VN') : '--'}</strong></div>
                      <div className="bb-sum-row"><span className="bb-sum-label">Số lượng ghế</span><strong>{selectedSeats.length} Ghế</strong></div>
                      <div className="bb-sum-row"><span className="bb-sum-label">Số ghế</span><strong className="bb-text-blue">{selectedSeats.join(', ') || '—'}</strong></div>
                      <div className="bb-sum-row bb-border-top"><span className="bb-sum-label">Tổng tiền</span><strong className="bb-text-blue">{totalAmount.toLocaleString('vi-VN')}đ</strong></div>
                   </div>
                </div>

                <div className="bb-card mt-20">
                   <div className="bb-card-header">Chi tiết giá</div>
                   <div className="bb-card-body">
                      <div className="bb-sum-row"><span className="bb-sum-label">Giá vé</span><strong>{totalAmount.toLocaleString('vi-VN')}đ</strong></div>
                      <div className="bb-sum-row"><span className="bb-sum-label">Phí thanh toán</span><strong>0đ</strong></div>
                      <div className="bb-sum-row bb-border-top"><span className="bb-sum-label">Tổng tiền</span><strong className="bb-text-blue" style={{fontSize:'18px'}}>{totalAmount.toLocaleString('vi-VN')}đ</strong></div>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* FOOTER CỐ ĐỊNH */}
      <div className="bb-footer-fixed">
         <div className="bb-footer-container">
            <div className="bb-footer-left">
                <span className="bb-footer-label">Tổng tiền</span>
                <div className="bb-footer-total">{totalAmount.toLocaleString('vi-VN')}đ</div>
            </div>
            <div className="bb-footer-right">
               <button className="bb-btn-cancel" onClick={async () => { await releaseHold(); navigate(-1); }}>Hủy</button>
               <button className="bb-btn-pay" onClick={handleBooking}>Thanh toán</button>
            </div>
         </div>
      </div>
    </div>
  );
};

export default DatVe;
