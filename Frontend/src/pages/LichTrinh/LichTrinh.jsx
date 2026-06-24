import React, { useState, useEffect } from 'react';
import './LichTrinh.css';
import { FaSearch, FaExchangeAlt, FaBus } from 'react-icons/fa';
import bookingApi from '../../api/bookingApi';

// Chuẩn hoá hiển thị thời gian hành trình: luôn kèm "tiếng"
const formatThoiGian = (val) => {
  if (!val && val !== 0) return '—';
  const str = String(val).trim();
  if (str.toLowerCase().includes('tiếng') || str.toLowerCase().includes('giờ')) return str;
  return `${str} tiếng`;
};

const LichTrinh = () => {
  const [routes, setRoutes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [diemDiQuery, setDiemDiQuery] = useState('');
  const [diemDenQuery, setDiemDenQuery] = useState('');

  useEffect(() => {
    const fetchRoutes = async () => {
      try {
        const res = await bookingApi.getRoutes();
        console.log('📦 getRoutes raw response:', res);
        // axiosClient đã unwrap response.data, nên res có thể là:
        // - mảng trực tiếp: [...]
        // - object bọc: { data: [...] } hoặc { routes: [...] } hoặc { result: [...] }
        const data = Array.isArray(res)
          ? res
          : Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.routes) ? res.routes
          : Array.isArray(res?.result) ? res.result
          : Array.isArray(res?.docs) ? res.docs
          : [];
        setRoutes(data);
      } catch (err) {
        console.error('Lỗi khi tải lịch trình:', err);
        console.error('Chi tiết lỗi:', JSON.stringify(err));
      } finally {
        setIsLoading(false);
      }
    };
    fetchRoutes();
  }, []);

  const handleSwap = () => {
    setDiemDiQuery(diemDenQuery);
    setDiemDenQuery(diemDiQuery);
  };

  const filteredRoutes = routes.filter(r => 
    (r.diemDi?.toLowerCase().includes(diemDiQuery.toLowerCase())) &&
    (r.diemDen?.toLowerCase().includes(diemDenQuery.toLowerCase()))
  );

  return (
    <div className="schedule-page fade-in">
      <div className="schedule-container">
        
        {/* Search Bar - Matching Screenshot */}
        <div className="schedule-search-grid">
          <div className="search-input-wrapper">
            <FaSearch className="si-icon" />
            <input 
              type="text" 
              placeholder="Nhập điểm đi" 
              value={diemDiQuery}
              onChange={(e) => setDiemDiQuery(e.target.value)}
            />
          </div>
          <button className="search-swap-btn" onClick={handleSwap}>
            <FaExchangeAlt />
          </button>
          <div className="search-input-wrapper">
            <FaSearch className="si-icon" />
            <input 
              type="text" 
              placeholder="Nhập điểm đến" 
              value={diemDenQuery}
              onChange={(e) => setDiemDenQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Table Header - Matching Screenshot */}
        <div className="schedule-table-header">
          <div className="col-route">Tuyến xe</div>
          <div className="col-type">Loại xe</div>
          <div className="col-dist">Quãng đường</div>
          <div className="col-time">Thời gian hành trình</div>
          <div className="col-price">Giá vé</div>
        </div>

        {/* Table Body / List */}
        <div className="schedule-list">
          {isLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>Đang tải lịch trình...</div>
          ) : filteredRoutes.length > 0 ? (
            <div className="schedule-card-wrapper">
              {filteredRoutes.map((route) => (
                <div className="schedule-row" key={route._id}>
                  <div className="col-route route-name-cell">
                    {route.diemDi} - {route.diemDen}
                  </div>
                  <div className="col-type">{route.loaiXe || 'Limousine'}</div>
                  <div className="col-dist">{route.khoangCach}</div>
                  <div className="col-time">{formatThoiGian(route.thoiGian || route.thoiGianDi)}</div>
                  <div className="col-price route-price-cell">{Number(String(route.giaVe || 0).replace(/[^0-9]/g, '')).toLocaleString('vi-VN')} đ</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-schedule">Không tìm thấy tuyến đường nào phù hợp.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LichTrinh;
