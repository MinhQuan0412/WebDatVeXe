import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AccountSidebar from '../../components/AccountSidebar/AccountSidebar';
import './LichSuDatVe.css';
import bookingApi from '../../api/bookingApi';
import Swal from 'sweetalert2';
import { authStorage } from '../../utils/authStorage';

const normalizeBookingList = (raw) => {
  if (!raw) return [];
  // Nếu raw là mảng trực tiếp
  if (Array.isArray(raw)) return raw;
  // Nếu raw bọc trong data hoặc docs (Thử mọi trường hợp phổ biến của BE)
  const data = raw.data || raw.docs || raw.doc || raw.bookings || raw.items || raw.result || raw;
  if (Array.isArray(data)) return data;
  return [];
};

const getTripLabel = (ticket) => {
  const chuyen = ticket.chuyenXeId;
  if (!chuyen || typeof chuyen !== 'object') return '—';
  const tuyen = chuyen.tuyenXeId;
  if (tuyen && typeof tuyen === 'object') return `${tuyen.diemDi || ''} - ${tuyen.diemDen || ''}`.trim() || '—';
  return '—';
};

const getDepartDateDisplay = (ticket) => {
  const iso = typeof ticket.chuyenXeId === 'object' ? ticket.chuyenXeId?.thoiGianKhoiHanh : null;
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
};

const bookingStatusVi = (trangThai) => {
  if (trangThai === 'paid') return 'Đã thanh toán';
  if (trangThai === 'hold') return 'Đang giữ chỗ';
  if (trangThai === 'cancelled' || trangThai === 'inactive') return 'Đã hủy';
  if (trangThai === 'expired') return 'Đã hết hạn';
  return trangThai || '—';
};

const formatMoney = (n) => typeof n === 'number' && !Number.isNaN(n) ? `${n.toLocaleString('vi-VN')}đ` : '—';

const canCustomerCancelPending = (ticket) => {
  const status = (ticket.trangThai || '').toLowerCase();
  // Cho phép hủy cả vé paid, confirmed, pending — miễn là trước giờ khởi hành 2 tiếng
  if (status === 'cancelled' || status === 'inactive' || status === 'expired') return false;
  const iso = typeof ticket.chuyenXeId === 'object' ? ticket.chuyenXeId?.thoiGianKhoiHanh : null;
  if (!iso) return true;
  const departureTime = new Date(iso);
  const now = new Date();
  const diffHours = (departureTime - now) / (1000 * 60 * 60);
  return diffHours >= 2;
};

const LichSuDatVe = () => {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('current');
  
  const [filterMaVe, setFilterMaVe] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const hasToken = !!authStorage.getToken();

  const fetchMine = useCallback(async () => {
    if (!hasToken) { setLoading(false); return; }
    setLoading(true);
    try {
      const raw = await bookingApi.getMyBookings();
      setBookings(normalizeBookingList(raw));
    } catch (e) {
      setLoadError(e.response?.data?.message || 'Không tải được lịch sử.');
    } finally { setLoading(false); }
  }, [hasToken]);

  useEffect(() => { fetchMine(); }, [fetchMine]);

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const departureTime = typeof b.chuyenXeId === 'object' ? b.chuyenXeId?.thoiGianKhoiHanh : null;
      const isDeparted = departureTime ? new Date(departureTime) < new Date() : false;
      const isHistory = 
        ['cancelled', 'inactive', 'expired', 'completed', 'refunded'].includes(b.trangThai) || 
        isDeparted;

      if (activeTab === 'current' && isHistory) return false;
      if (activeTab === 'history' && !isHistory) return false;

      const maVe = (b.maVe || b._id || '').toString().toLowerCase();
      if (filterMaVe.trim() && !maVe.includes(filterMaVe.trim().toLowerCase())) return false;
      
      if (filterStatus) {
        if (filterStatus === 'cancelled') {
          if (b.trangThai !== 'cancelled' && b.trangThai !== 'inactive') return false;
        } else if (b.trangThai !== filterStatus) {
          return false;
        }
      }
      
      const tripDate = typeof b.chuyenXeId === 'object' ? b.chuyenXeId?.thoiGianKhoiHanh : '';
      const dayStr = tripDate ? new Date(tripDate).toISOString().slice(0, 10) : '';
      if (filterDate && dayStr !== filterDate) return false;

      return true;
    });
  }, [bookings, activeTab, filterMaVe, filterDate, filterStatus]);

  const handlePay = (ticket) => {
    navigate('/thanh-toan', {
      state: { bookingId: ticket._id, trip: ticket.chuyenXeId, seats: ticket.danhSachGhe, total: ticket.tongTien, holdExpires: ticket.holdExpires, diemDon: ticket.diemDon, diemTra: ticket.diemTra }
    });
  };

  const handleCancel = async (ticket) => {
    const { value: lyDo, isConfirmed } = await Swal.fire({
      title: 'Hủy vé',
      html: `
        <p style="margin-bottom:8px;color:#555">Vé: <strong>${ticket.maVe || ticket._id}</strong></p>
        <p style="margin-bottom:12px;color:#555">Tuyến: <strong>${getTripLabel(ticket)}</strong></p>
      `,
      input: 'textarea',
      inputPlaceholder: 'Nhập lý do hủy vé (tối thiểu 5 ký tự)...',
      inputAttributes: { style: 'min-height:90px;resize:vertical' },
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#E53935',
      confirmButtonText: 'Xác nhận hủy vé',
      cancelButtonText: 'Đóng',
      inputValidator: (value) => {
        if (!value || value.trim().length < 5) {
          return 'Vui lòng nhập lý do hủy (tối thiểu 5 ký tự)';
        }
      }
    });

    if (!isConfirmed || !lyDo) return;

    try {
      const trimmedReason = lyDo.trim();
      await bookingApi.cancelBooking(ticket._id, {
        lyDo: trimmedReason,
        lyDoHuy: trimmedReason,
        reason: trimmedReason,
        cancelReason: trimmedReason,
      });
      Swal.fire({
        icon: 'success',
        title: 'Đã hủy vé!',
        text: 'Hủy vé thành công. Email xác nhận đã được gửi đến bạn.',
        timer: 3000,
        showConfirmButton: false
      });
      fetchMine();
    } catch (err) {
      // err có thể là object { message: "..." } từ BE hoặc string
      const errMsg = typeof err === 'string' ? err : (err?.message || err?.error || 'Không thể hủy vé lúc này.');
      Swal.fire('Lỗi', errMsg, 'error');
    }
  };

  return (
    <div className="account-page-wrapper">
      <div className="account-page-container">
        <AccountSidebar activeTab="lich-su" />

        <div className="account-content">
          <h2 className="content-title">Lịch sử mua vé</h2>
          
          <div className="futa-tabs-container mb-4">
             <button className={`futa-tab ${activeTab === 'current' ? 'active' : ''}`} onClick={() => setActiveTab('current')}>Đang thực hiện</button>
             <button className={`futa-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>Lịch sử khác</button>
          </div>

          <div className="history-filter-container">
            <div className="filter-group"><label>Mã vé</label><input type="text" placeholder="Tìm mã vé..." value={filterMaVe} onChange={e => setFilterMaVe(e.target.value)} /></div>
            <div className="filter-group"><label>Ngày đi</label><input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} /></div>
            <div className="filter-group">
               <label>Trạng thái</label>
               <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">Tất cả</option>
                  <option value="hold">Đang giữ chỗ</option>
                  <option value="paid">Đã thanh toán</option>
                  <option value="expired">Đã hết hạn</option>
                  <option value="cancelled">Đã hủy</option>
               </select>
            </div>
            <div className="filter-group btn-group">
               <button className="btn-search-history" onClick={fetchMine}>Tải lại</button>
            </div>
          </div>

          <div className="history-table-container">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Mã vé</th>
                  <th>Ghế</th>
                  <th>Tuyến đường</th>
                  <th>Ngày khởi hành</th>
                  <th>Số tiền</th>
                  <th>Trạng thái</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan="7" className="text-center py-5">Đang tải dữ liệu...</td></tr> : 
                 filtered.length === 0 ? <tr><td colSpan="7" className="text-center py-5 color-grey">Không tìm thấy vé nào phù hợp.</td></tr> :
                 filtered.map((ticket) => {
                    const id = ticket.maVe || String(ticket._id || '').slice(-8).toUpperCase();
                    const isPaid = ticket.trangThai === 'paid';
                    const isHold = ticket.trangThai === 'hold';
                    const canCancel = canCustomerCancelPending(ticket);
                    return (
                      <tr key={ticket._id}>
                        <td><strong className="text-dark">{id}</strong></td>
                        <td>{ticket.danhSachGhe?.join(', ') || '—'}</td>
                        <td>{getTripLabel(ticket)}</td>
                        <td>{getDepartDateDisplay(ticket)}</td>
                        <td className="text-danger font-bold">{formatMoney(ticket.tongTien)}</td>
                        <td><span className={`status-badge status-${ticket.trangThai}`}>{bookingStatusVi(ticket.trangThai)}</span></td>
                        <td>
                          <div className="action-buttons-wrapper">
                            {isHold && (
                              <button className="btn-action-pay" onClick={() => handlePay(ticket)}>
                                <i className="fas fa-credit-card"></i> Thanh toán
                              </button>
                            )}
                            {canCancel && (
                              <button className="btn-action-cancel" onClick={() => handleCancel(ticket)}>
                                <i className="fas fa-times-circle"></i> Hủy vé
                              </button>
                            )}
                            {isPaid && (
                              <button className="btn-action-view" onClick={() => navigate(`/hoa-don?code=${ticket.maVe}`)}>
                                <i className="fas fa-eye"></i> Xem vé
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                 })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LichSuDatVe;
