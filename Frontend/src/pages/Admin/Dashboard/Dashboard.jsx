import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import { FaMoneyBillWave, FaTicketAlt, FaHeadset, FaBus, FaRoute } from 'react-icons/fa';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import adminApi from '../../../api/adminApi';

const COLORS = ['#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6'];

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [activeRoutesCount, setActiveRoutesCount] = useState(0);
  const [activeTripsCount, setActiveTripsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const [statsData, routesData, tripsData] = await Promise.all([
        adminApi.getDashboardStats(),
        adminApi.getRoutes(),
        adminApi.getTrips()
      ]);
      
      console.log('Dashboard Stats:', statsData);
      setStats(statsData);

      // Tuyến đang hoạt động
      const routesList = Array.isArray(routesData) ? routesData : (routesData.doc || routesData.routes || []);
      setActiveRoutesCount(routesList.filter(r => r.trangThai === 'active' || r.trangThai === 'Active').length);

      // Chuyến đang chờ khởi hành hoặc đang chạy
      const tripsList = Array.isArray(tripsData) ? tripsData : (tripsData.doc || tripsData.trips || []);
      setActiveTripsCount(tripsList.filter(t => 
        t.trangThai === 'active' || 
        t.trangThai === 'Chờ khởi hành' || 
        t.trangThai === 'running' || 
        t.trangThai === 'ĐANG CHẠY'
      ).length);
      
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center' }}>Đang tải dữ liệu thống kê...</div>;

  const { summary, dailyStats, topRoutes, statusDistribution } = stats || {};

  // Map revenue data for chart
  const revenueChartData = (dailyStats || []).map(s => ({
    name: s._id,
    revenue: (s.revenue || 0) / 1000000, // Chuyển sang triệu
    tickets: s.tickets
  }));

  // Map top routes for chart
  const topRoutesChartData = (topRoutes || []).map(r => ({
    name: r.tenTuyen,
    vé: r.soVe,
    doanhThu: r.doanhThu
  }));

  // Map status distribution for pie chart
  const statusMap = {
    'pending': 'Chờ thanh toán',
    'paid': 'Đã thanh toán',
    'confirmed': 'Đã xác nhận',
    'cancelled': 'Đã hủy',
    'refunded': 'Đã hoàn tiền',
    'completed': 'Đã hoàn thành',
    'expired': 'Đã hết hạn',
    'hold': 'Đang giữ chỗ'
  };
  const pieData = (statusDistribution || []).map(s => ({
    name: statusMap[s._id] || s._id,
    value: s.count
  }));

  const formatCurrency = (val) => (val || 0).toLocaleString('vi-VN') + ' đ';

  return (
    <div className="w-dashboard-page fade-in">
      
      {/* Hàng 1: 4 Thẻ thống kê */}
      <div className="w-stats-grid">
        <div className="w-stat-card">
          <div className="w-stat-icon bg-blue-100 text-blue-600"><FaTicketAlt /></div>
          <div className="w-stat-content">
            <p className="w-stat-title">Tổng số vé đã bán</p>
            <h3 className="w-stat-value">{summary?.totalTickets || 0} <span className="w-stat-unit">vé</span></h3>
          </div>
        </div>
        <div className="w-stat-card">
          <div className="w-stat-icon bg-emerald-100 text-emerald-600"><FaMoneyBillWave /></div>
          <div className="w-stat-content">
            <p className="w-stat-title">Doanh thu tổng</p>
            <h3 className="w-stat-value" style={{ fontSize: '20px' }}>{formatCurrency(summary?.totalRevenue)}</h3>
          </div>
        </div>
        <div className="w-stat-card">
          <div className="w-stat-icon" style={{ background: '#fef3c7', color: '#d97706' }}><FaMoneyBillWave /></div>
          <div className="w-stat-content">
            <p className="w-stat-title">Doanh thu hôm nay</p>
            <h3 className="w-stat-value" style={{ fontSize: '18px', color: '#d97706' }}>{formatCurrency(summary?.todayRevenue)}</h3>
          </div>
        </div>
        <div className="w-stat-card">
          <div className="w-stat-icon bg-amber-100 text-amber-600"><FaBus /></div>
          <div className="w-stat-content">
            <p className="w-stat-title">Chuyến xe đang chạy</p>
            <h3 className="w-stat-value">{activeTripsCount} <span className="w-stat-unit">chuyến</span></h3>
          </div>
        </div>
        <div className="w-stat-card">
          <div className="w-stat-icon bg-purple-100 text-purple-600"><FaRoute /></div>
          <div className="w-stat-content">
            <p className="w-stat-title">Số tuyến hiện có</p>
            <h3 className="w-stat-value">{activeRoutesCount} <span className="w-stat-unit">tuyến</span></h3>
          </div>
        </div>
      </div>

      {/* Hàng 2: Biểu đồ doanh thu & Trạng thái vé */}
      <div className="w-grid-2-col">
        <div className="w-card w-chart-card">
          <h3 className="w-card-title">Biểu đồ doanh thu</h3>
          <p className="w-card-subtitle">Doanh thu theo ngày bán vé — 7 ngày gần nhất (Đơn vị: Triệu VNĐ)</p>
          <div className="w-chart-wrapper" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => value.toFixed(2) + ' Tr VNĐ'} />
                <Bar dataKey="revenue" fill="#06B6D4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="w-card w-chart-card">
          <h3 className="w-card-title">Phân bổ trạng thái vé</h3>
          <p className="w-card-subtitle">Tỉ lệ các loại vé trong hệ thống</p>
          <div className="w-chart-wrapper" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Hàng 3: Top Tuyến (Trái) & Bảng chi tiết (Dưới) */}
      <div className="w-grid-2-col">
        <div className="w-card w-chart-card">
          <h3 className="w-card-title">Top Tuyến Đường Phổ Biến</h3>
          <p className="w-card-subtitle">Dựa trên số lượng vé đã bán</p>
          <div className="w-chart-wrapper" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topRoutesChartData} layout="vertical">
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="vé" fill="#3B82F6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="w-card w-latest-transactions">
          <h3 className="w-card-title">Chi tiết doanh thu tuyến</h3>
          <div className="w-table-wrapper">
            <table className="w-table">
              <thead>
                <tr>
                  <th>Tuyến đường</th>
                  <th>Số chuyến</th>
                  <th>Số vé</th>
                  <th>Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {(topRoutes || []).map((route, i) => (
                  <tr key={i}>
                    <td><FaRoute className="inline mr-2 text-blue-500"/> {route.tenTuyen}</td>
                    <td>{route.soChuyen}</td>
                    <td>{route.soVe}</td>
                    <td style={{ fontWeight: 'bold', color: '#10B981' }}>{formatCurrency(route.doanhThu)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
