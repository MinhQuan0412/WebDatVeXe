import React from 'react';
import { useNavigate } from 'react-router-dom';
import SearchForm from '../../components/SearchForm/SearchForm';
import bookingApi from '../../api/bookingApi';
import './Home.css';
import { FaUsers, FaBus, FaMapMarkerAlt } from 'react-icons/fa';

const Home = () => {
  const navigate = useNavigate();
  const [routes, setRoutes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchRoutes = async () => {
      try {
        const res = await bookingApi.getRoutes();
        setRoutes(res?.data || (Array.isArray(res) ? res : []));
      } catch (err) {
        console.error('Lỗi khi tải tuyến phổ biến:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchRoutes();
  }, []);

  const getRoutesByOrigin = (originName) => {
    return routes.filter(r => r.diemDi?.toLowerCase().includes(originName.toLowerCase())).slice(0, 3);
  };

  const handleRouteClick = (origin, destination) => {
    if (!destination) return;
    navigate('/tim-chuyen', { 
      state: { 
        origin, 
        destination, 
        date: new Date().toLocaleDateString('vi-VN'), 
        tickets: '1' 
      } 
    });
  };

  const renderRouteCard = (originTitle, originSearch, bgUrl) => {
    const cityRoutes = getRoutesByOrigin(originSearch);
    return (
      <div className="bb-route-card">
        <div className="route-thumbnail" onClick={() => handleRouteClick(originTitle, cityRoutes[0]?.diemDen || '')}>
          <div className="route-bg" style={{ backgroundImage: `url('${bgUrl}')` }}></div>
          <div className="route-thumb-overlay">
            <span className="route-thumb-label">Tuyến xe từ</span>
            <h3 className="route-thumb-city">{originTitle}</h3>
          </div>
        </div>
        <div className="route-list">
          {cityRoutes.length > 0 ? cityRoutes.map(route => (
            <div key={route._id} className="route-item" onClick={() => handleRouteClick(route.diemDi, route.diemDen)}>
              <div className="route-item-left">
                <span className="destination">{route.diemDen}</span>
                <span className="distance">{route.khoangCach} - {route.thoiGian}</span>
              </div>
              <div className="route-item-right">
                <span className="price">{Number(String(route.giaVe || 0).replace(/[^0-9]/g, '')).toLocaleString('vi-VN')} đ</span>
              </div>
            </div>
          )) : (
            <div className="route-item-empty">Đang cập nhật tuyến đường...</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bb-home-page fade-in">
      <section className="bb-hero-section">
        <div className="hero-banner-wrapper">
          <img 
            src="/commercial_bus_banner_wide_new.png" 
            alt="Blue Bus Banner" 
            className="hero-bus-image"
          />
        </div>
      </section>

      {/* Search Section overlapping the banner */}
      <section className="bb-search-section">
        <div className="container">
          <SearchForm />
        </div>
      </section>

      {/* POPULAR ROUTES SECTION */}
      <section className="bb-popular-routes">
        <div className="container">
          <h2 className="bb-section-title text-center" style={{ color: '#0060C4', marginBottom: '5px' }}>TUYẾN PHỔ BIẾN</h2>
          <p className="text-center" style={{ color: '#555', marginBottom: '30px' }}>Được khách hàng tin tưởng và lựa chọn</p>
          <div className="bb-routes-grid">
            {loading ? (
              <div style={{ textAlign: 'center', width: '100%', padding: '40px' }}>Đang tải dữ liệu...</div>
            ) : (
              <>
                {renderRouteCard('Tp Hồ Chí Minh', 'Hồ Chí Minh', 'https://images.unsplash.com/photo-1583417319070-4a69db38a482?auto=format&fit=crop&q=80&w=800')}
                {renderRouteCard('Đà Lạt', 'Đà Lạt', '/dalat_route_card.png')}
                {renderRouteCard('Đà Nẵng', 'Đà Nẵng', 'https://images.unsplash.com/photo-1559592413-7cec4d0cae2b?auto=format&fit=crop&q=80&w=800')}
              </>
            )}
          </div>
        </div>
      </section>

      {/* STATS SECTION */}
      <section className="bb-stats-section">
        <div className="container">
          <h2 className="bb-section-title text-center">Chất lượng là danh dự</h2>
          <div className="bb-stats-grid">
            <div className="stat-item">
              <div className="stat-icon"><FaUsers /></div>
              <h3>20M+</h3>
              <p>Hơn 20 triệu lượt khách</p>
            </div>
            <div className="stat-item">
              <div className="stat-icon"><FaMapMarkerAlt /></div>
              <h3>500+</h3>
              <p>Hơn 500 phòng vé, trạm trung chuyển</p>
            </div>
            <div className="stat-item">
              <div className="stat-icon"><FaBus /></div>
              <h3>1,000+</h3>
              <p>Hơn 1,000 chuyến xe</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
