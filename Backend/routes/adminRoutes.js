const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const NhanVien = require('../models/NhanVien');
const KhachHang = require('../models/KhachHang');
const Xe = require('../models/Xe');
const TuyenXe = require('../models/TuyenXe');
const ChuyenXe = require('../models/ChuyenXe');
const Ve = require('../models/Ve');
const SupportTicket = require('../models/SupportTicket');
const adminMiddleware = require('../middleware/adminMiddleware');
const checkPermission = require('../middleware/permissionMiddleware');
const sendEmail = require('../utils/sendEmail');
const ThongBao = require('../models/ThongBao');
const DanhGia = require('../models/DanhGia');
const LienHe = require('../models/LienHe');
const SoDoGhe = require('../models/SoDoGhe');
const Voucher = require('../models/Voucher');
const router = express.Router();

// ============================================================
// SUPPORT TICKET MANAGEMENT (QUẢN LÝ HỖ TRỢ)
// ============================================================

// @route   GET /api/admin/support-tickets
// @desc    Lấy danh sách yêu cầu hỗ trợ (Admin) - Gộp cả từ mục Liên hệ
router.get('/support-tickets', adminMiddleware, async (req, res) => {
  try {
    const { trangThai } = req.query;
    
    // 1. Lấy từ SupportTicket
    let ticketQuery = {};
    if (trangThai && trangThai !== 'all') {
        ticketQuery.trangThai = (trangThai === 'pending') ? 'open' : trangThai;
    }
    
    const tickets = await SupportTicket.find(ticketQuery)
      .populate('khachHangId', 'hoTen soDienThoai email')
      .lean();

    // 2. Lấy từ LienHe
    let contactQuery = {};
    if (trangThai && trangThai !== 'all') {
        contactQuery.trangThai = (trangThai === 'open') ? 'pending' : trangThai;
    }

    const contacts = await LienHe.find(contactQuery).lean();

    // 3. Chuẩn hóa dữ liệu
    const formattedContacts = contacts.map(c => ({
      ...c,
      tieuDe: `[Liên hệ] ${c.tieuDe}`,
      trangThai: (c.trangThai === 'pending') ? 'open' : (c.trangThai || 'open'),
      createdAt: c.createdAt || c.ngayGui
    }));

    const formattedTickets = tickets.map(t => ({
      ...t,
      tieuDe: `[Hỗ trợ] ${t.tieuDe}`,
      createdAt: t.createdAt
    }));

    // 4. Gộp và sắp xếp
    const allRequests = [...formattedTickets, ...formattedContacts].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json(allRequests);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách hỗ trợ', error: err.message });
  }
});

// @route   PUT /api/admin/support-tickets/:id
// @desc    Phản hồi và cập nhật trạng thái yêu cầu hỗ trợ (có gửi email cho khách)
router.put('/support-tickets/:id', adminMiddleware, async (req, res) => {
  try {
    // Hỗ trợ linh hoạt tên field từ FE
    const phanHoi = req.body.phanHoi || req.body.phanHoiKhachHang;
    const trangThai = req.body.trangThai;
    const ghiChuNoiBo = req.body.ghiChuNoiBo;

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Không tìm thấy yêu cầu hỗ trợ' });

    if (phanHoi) ticket.phanHoi = phanHoi;
    if (trangThai) ticket.trangThai = trangThai;
    if (ghiChuNoiBo) ticket.ghiChuNoiBo = ghiChuNoiBo;

    await ticket.save();

    // ✅ GỬI EMAIL PHẢN HỒI CHO KHÁCH HÀNG
    if (phanHoi && ticket.email) {
      const statusMap = {
        'open': 'Đang chờ xử lý',
        'in_progress': 'Đang xử lý',
        'resolved': 'Đã giải quyết',
        'closed': 'Đã đóng'
      };
      try {
        await sendEmail({
          email: ticket.email,
          subject: `[BlueBus] Phản hồi yêu cầu hỗ trợ: ${ticket.tieuDe}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
              <h2 style="color: #ef5222; text-align: center;">Phản Hồi Từ BlueBus</h2>
              <p>Chào <strong>${ticket.hoTen}</strong>,</p>
              <p>BlueBus xin phản hồi về yêu cầu hỗ trợ của bạn:</p>
              <p><b>Tiêu đề:</b> ${ticket.tieuDe}</p>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 5px solid #ef5222;">
                <p><strong>Nội dung phản hồi:</strong></p>
                <p>${phanHoi}</p>
                <p style="margin-top: 10px; font-size: 0.9em; color: #666;">
                  Trạng thái: <b>${statusMap[ticket.trangThai] || ticket.trangThai}</b>
                </p>
              </div>
              <p>Nếu bạn cần hỗ trợ thêm, vui lòng liên hệ hotline <b>1900 1234</b>.</p>
              <p>Trân trọng,<br/>Đội ngũ hỗ trợ BlueBus</p>
            </div>
          `
        });
        console.log(`[SUPPORT] Đã gửi email phản hồi cho ${ticket.email}`);
      } catch (emailErr) {
        console.error('Lỗi gửi email phản hồi ticket:', emailErr);
      }
    }

    res.json({ message: 'Đã cập nhật phản hồi thành công', ticket });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi phản hồi hỗ trợ', error: err.message });
  }
});

// Helper chuẩn hóa tên thành phố (Phiên bản siêu mạnh - Đã gia cố theo yêu cầu)
const normalizeCity = (city) => {
  if (!city) return city;
  let s = city.trim().toLowerCase();

  // 1. Xử lý TP. Hồ Chí Minh (Tuyệt đối không để Sài Gòn/HCM)
  const hcmKeywords = ['hcm', 'saigon', 'sài gòn', 'ho chi minh', 'hồ chí minh', 'thành phố hồ chí minh', 'tp hcm', 'tphcm'];
  if (hcmKeywords.some(k => s.includes(k) || s === k)) return 'TP. Hồ Chí Minh';

  // 2. Xử lý Đà Lạt (Trường hợp đặc biệt, Lâm Đồng tự hiểu là Đà Lạt)
  const dalatKeywords = ['da lat', 'đà lạt', 'dalat', 'lâm đồng', 'lam dong', 'lamdong', 'lâmđồng'];
  if (dalatKeywords.some(k => s.includes(k) || s === k)) return 'Đà Lạt';

  // 3. Xử lý các tỉnh thành khác (Đưa về tên Tỉnh chuẩn nếu là các tỉnh lớn)
  if (s.includes('đà nẵng') || s === 'danang') return 'Đà Nẵng';
  if (s.includes('hà nội') || s === 'hanoi') return 'Hà Nội';
  if (s.includes('cần thơ') || s === 'cantho') return 'Cần Thơ';
  if (s.includes('hải phòng') || s === 'haiphong') return 'Hải Phòng';

  // Viết hoa chữ cái đầu cho đẹp
  return city.trim().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

// ==========================================
// 1. AUTHENTICATION & PROFILE
// ==========================================
router.post('/login', async (req, res) => {
  try {
    const { soDienThoai, matKhau } = req.body;
    if (!soDienThoai || !matKhau) return res.status(400).json({ message: 'Vui lòng nhập số điện thoại và mật khẩu' });

    const user = await NhanVien.findOne({ soDienThoai });
    if (!user) return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không chính xác' });

    if (user.trangThai !== 'active') return res.status(403).json({ message: 'Tài khoản nhân viên này đã bị vô hiệu hóa' });

    const isMatch = await user.comparePassword(matKhau);
    if (!isMatch) return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không chính xác' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, hoTen: user.hoTen, soDienThoai: user.soDienThoai, vaiTro: user.vaiTro } });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi đăng nhập', error: err.message });
  }
});

router.post('/logout', adminMiddleware, (req, res) => {
  res.json({ message: 'Đã đăng xuất thành công' });
});

router.get('/me', adminMiddleware, (req, res) => {
  res.json({ admin: req.admin });
});

// ==========================================
// 2. KHÁCH HÀNG (CUSTOMER MANAGEMENT) — CHỈ ADMIN
// ==========================================
router.get('/customers', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    const { search } = req.query;
    let query = {}; // Hiển thị tất cả khách hàng (không lọc inactive)

    if (search) {
      let searchStr = search.trim();
      // Chuẩn hóa SĐT nếu search là số
      if (/^\+?84/.test(searchStr)) searchStr = '0' + searchStr.replace(/^\+?84/, '');

      query.$or = [
        { hoTen: { $regex: searchStr, $options: 'i' } },
        { soDienThoai: { $regex: searchStr, $options: 'i' } },
        { email: { $regex: searchStr, $options: 'i' } }
      ];
    }
    // Lấy danh sách khách hàng và thông tin vé
    const customers = await KhachHang.find(query).select('-matKhau').sort({ createdAt: -1 });

    // Đếm số vé cho từng khách hàng
    const formattedCustomers = await Promise.all(customers.map(async (c) => {
      // Chỉ đếm các vé đã thanh toán thành công hoặc đã hoàn thành
      const ticketCount = await Ve.countDocuments({
        khachHangId: c._id,
        trangThai: { $in: ['paid', 'confirmed', 'completed'] }
      });
      const customerObj = c.toObject();
      customerObj.totalTickets = ticketCount;
      return customerObj;
    }));

    res.json(formattedCustomers);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách khách hàng', error: err.message });
  }
});

router.put('/customers/:id', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    const { hoTen, soDienThoai, email, trangThai, lyDoKhoa } = req.body;

    // Logic khóa khách hàng
    if (trangThai === 'inactive') {
      if (!lyDoKhoa || !lyDoKhoa.trim()) {
        return res.status(400).json({ message: 'Vui lòng cung cấp lý do khi khóa tài khoản khách hàng' });
      }

      // Tự động hủy các vé chưa khởi hành (hold, pending)
      const pendingTickets = await Ve.find({
        khachHangId: req.params.id,
        trangThai: { $in: ['hold', 'pending'] }
      });

      for (const ticket of pendingTickets) {
        const trip = await ChuyenXe.findById(ticket.chuyenXeId);
        if (trip) {
          trip.gheDaDat = trip.gheDaDat.filter(seat => !ticket.danhSachGhe.includes(seat));
          await trip.save();
        }
        ticket.trangThai = 'cancelled';
        ticket.ghiChu = 'Hệ thống tự động hủy do tài khoản bị khóa: ' + lyDoKhoa;
        await ticket.save();
      }
    }

    // Logic khi Mở khóa (active)
    let updateData = { hoTen, soDienThoai, email, trangThai, lyDoKhoa };
    if (trangThai === 'active') {
      updateData.lyDoKhoa = null; // Xóa lý do khóa khi mở lại
    }

    const customer = await KhachHang.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-matKhau');

    const msg = (trangThai === 'active') ? 'Đã mở khóa tài khoản thành công' : 'Cập nhật thành công';
    res.json({ message: msg, customer });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.delete('/customers/:id', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    // Soft delete
    const customer = await KhachHang.findByIdAndUpdate(req.params.id, { trangThai: 'inactive' }, { new: true });
    res.json({ message: 'Đã vô hiệu hóa khách hàng', customer });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// ==========================================
// 3. NHÂN VIÊN (STAFF MANAGEMENT) — CHỈ ADMIN
// ==========================================
router.get('/staff', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    // Lấy danh sách nhân viên nhưng loại trừ tài khoản Admin và Tài khoản Nhân viên chung
    const staff = await NhanVien.find({
      trangThai: { $ne: 'inactive' },
      soDienThoai: { $nin: ['0987654321', '0987654322'] }
    }).select('-matKhau').sort({ createdAt: -1 });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.post('/staff', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    const { hoTen, email, matKhau, soDienThoai, vaiTro } = req.body;

    // Check email exists
    const emailExists = await NhanVien.findOne({ email });
    if (emailExists) return res.status(400).json({ message: 'Email đã tồn tại' });

    // Check phone exists
    const phoneExists = await NhanVien.findOne({ soDienThoai });
    if (phoneExists) return res.status(400).json({ message: 'Số điện thoại đã tồn tại' });

    const newStaff = new NhanVien({
      hoTen, email, matKhau: matKhau || 'shared_account_no_password', soDienThoai,
      vaiTro: vaiTro || 'staff'
    });
    await newStaff.save();

    res.status(201).json({ message: 'Tạo nhân viên thành công', staff: { id: newStaff._id, email, vaiTro: newStaff.vaiTro } });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.put('/staff/:id', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    const { hoTen, soDienThoai, email, trangThai, vaiTro } = req.body;

    // Kiểm tra trùng Email/SĐT nếu có thay đổi
    if (email || soDienThoai) {
      const query = { _id: { $ne: req.params.id } };
      const conditions = [];
      if (email) conditions.push({ email });
      if (soDienThoai) conditions.push({ soDienThoai });

      const exists = await NhanVien.findOne({ ...query, $or: conditions });
      if (exists) {
        return res.status(400).json({ message: 'Email hoặc Số điện thoại đã được sử dụng bởi nhân viên khác' });
      }
    }

    const staff = await NhanVien.findByIdAndUpdate(req.params.id, { hoTen, soDienThoai, vaiTro, trangThai, email }, { new: true }).select('-matKhau');
    res.json({ message: 'Cập nhật thành công', staff });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.delete('/staff/:id', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    if (req.params.id === req.admin._id.toString()) return res.status(400).json({ message: 'Không thể tự vô hiệu hóa bản thân' });
    const staff = await NhanVien.findByIdAndUpdate(req.params.id, { trangThai: 'inactive' }, { new: true });
    res.json({ message: 'Đã vô hiệu hóa tài khoản', staff });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// ==========================================
// 3.5 SƠ ĐỒ GHẾ (SEAT MAPS)
// ==========================================
router.get('/seat-maps', adminMiddleware, async (req, res) => {
  try {
    const data = await SoDoGhe.find().sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.post('/seat-maps', adminMiddleware, async (req, res) => {
  try {
    const { tenSoDo, tongSoGhe, soTang, danhSachGhe } = req.body;
    if (!tenSoDo || !danhSachGhe || danhSachGhe.length !== Number(tongSoGhe)) {
      return res.status(400).json({ message: 'Dữ liệu sơ đồ ghế không hợp lệ' });
    }
    const exists = await SoDoGhe.findOne({ tenSoDo });
    if (exists) return res.status(400).json({ message: 'Tên sơ đồ này đã tồn tại' });

    const doc = new SoDoGhe(req.body);
    await doc.save();
    res.status(201).json({ message: 'Tạo sơ đồ thành công', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.put('/seat-maps/:id', adminMiddleware, async (req, res) => {
  try {
    const doc = await SoDoGhe.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ message: 'Cập nhật thành công', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.delete('/seat-maps/:id', adminMiddleware, async (req, res) => {
  try {
    // Kiểm tra có xe nào đang dùng sơ đồ này không
    const used = await Xe.findOne({ soDoGheId: req.params.id });
    if (used) return res.status(400).json({ message: 'Không thể xóa sơ đồ đang được sử dụng bởi xe ' + used.bienSo });

    await SoDoGhe.findByIdAndDelete(req.params.id);
    res.json({ message: 'Xóa thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// 4. XE (VEHICLES)
// ==========================================
router.get('/vehicles', adminMiddleware, async (req, res) => {
  try {
    const { availableForTrip, tuyenXeId } = req.query;

    // 1. TỰ ĐỘNG CẬP NHẬT TRẠNG THÁI CHUYẾN XE (Để giải phóng xe đã chạy xong)
    await ChuyenXe.updateMany(
      {
        trangThai: { $in: ['active', 'scheduled', 'running'] },
        thoiGianDen: { $lt: new Date() }
      },
      { trangThai: 'completed' }
    );

    let query = { trangThai: { $ne: 'inactive' } }; // Lấy tất cả xe đang hoạt động (trừ xe đã xóa/ẩn)

    // Lọc theo Tuyến xe nếu có
    if (tuyenXeId) {
      query.tuyenXeId = tuyenXeId;
    }

    const allVehicles = await Xe.find(query)
      .populate('soDoGheId')
      .populate('tuyenXeId')
      .sort({ bienSo: 1 });

    // 2. TÌM CÁC XE ĐANG BẬN (Có chuyến đang chạy hoặc sắp chạy)
    const busyTrips = await ChuyenXe.find({
      trangThai: { $in: ['active', 'running', 'scheduled'] },
      thoiGianDen: { $gt: new Date() }
    }).select('xeId');

    const busyVehicleIds = busyTrips.map(t => t.xeId?.toString());

    // 3. XỬ LÝ DỮ LIỆU TRẢ VỀ (Tự động gán nhãn trạng thái vận hành)
    const formattedVehicles = allVehicles.map(v => {
      const xe = v.toObject();
      if (busyVehicleIds.includes(xe._id.toString())) {
        xe.trangThaiHienTai = 'Đang bận (Có chuyến)';
        xe.isBusy = true;
      } else {
        xe.trangThaiHienTai = 'Sẵn sàng';
        xe.isBusy = false;
      }
      return xe;
    });

    if (availableForTrip === 'true') {
      const availableVehicles = formattedVehicles.filter(v => !v.isBusy && v.trangThai === 'active');
      return res.json(availableVehicles);
    }

    res.json(formattedVehicles);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách xe', error: err.message });
  }
});

router.post('/vehicles', adminMiddleware, async (req, res) => {
  try {
    let { bienSo, loaiXe, tongSoGhe, soDoGheId, trangThai, tuyenXeId } = req.body;

    if (!bienSo) return res.status(400).json({ message: 'Vui lòng nhập biển số xe' });
    if (!soDoGheId) return res.status(400).json({ message: 'Bắt buộc phải chọn sơ đồ ghế' });
    if (!tuyenXeId) return res.status(400).json({ message: 'Xe phải được gán cố định cho một Tuyến xe' });
    if (!tongSoGhe) return res.status(400).json({ message: 'Vui lòng nhập tổng số ghế' });

    const sodo = await SoDoGhe.findById(soDoGheId);
    if (!sodo) return res.status(404).json({ message: 'Sơ đồ ghế không tồn tại' });

    // KIỂM TRA KHỚP SỐ GHẾ VỚI SƠ ĐỒ
    if (Number(tongSoGhe) !== sodo.tongSoGhe) {
        return res.status(400).json({ 
            message: `Số ghế nhập vào (${tongSoGhe}) không khớp với cấu hình sơ đồ (${sodo.tongSoGhe} ghế).` 
        });
    }

    const exists = await Xe.findOne({ bienSo: bienSo.trim().toUpperCase() });
    if (exists) return res.status(400).json({ message: 'Biển số xe đã tồn tại' });

    const doc = new Xe({
      bienSo: bienSo.trim().toUpperCase(),
      loaiXe: loaiXe || 'Limousine Giường Nằm',
      tongSoGhe: sodo.tongSoGhe,
      soDoGheId,
      tuyenXeId,
      soTang: sodo.soTang,
      trangThai: trangThai || 'active'
    });
    await doc.save();
    res.status(201).json({ message: 'Tạo xe thành công', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo xe', error: err.message });
  }
});

router.put('/vehicles/:id', adminMiddleware, async (req, res) => {
  try {
    const idOrBienSo = req.params.id;
    let xe;

    if (mongoose.Types.ObjectId.isValid(idOrBienSo)) {
      xe = await Xe.findById(idOrBienSo);
    } else {
      xe = await Xe.findOne({ bienSo: idOrBienSo });
    }

    if (!xe) return res.status(404).json({ message: 'Không tìm thấy xe' });

    // 1. Kiểm tra xem xe có đang trong bất kỳ chuyến đi nào chưa hoàn thành không
    const busyTrip = await ChuyenXe.findOne({ 
      xeId: xe._id, 
      trangThai: { $in: ['active', 'running', 'scheduled'] } 
    });

    if (busyTrip) {
      return res.status(400).json({ 
        message: `Không thể cập nhật/thay đổi thông tin xe khi xe đang có chuyến xe chưa hoàn thành (Trạng thái chuyến: ${busyTrip.trangThai})` 
      });
    }

    if (req.body.soDoGheId) {
      const sodo = await SoDoGhe.findById(req.body.soDoGheId);
      if (!sodo) return res.status(404).json({ message: 'Sơ đồ ghế không tồn tại' });
      req.body.tongSoGhe = sodo.tongSoGhe;
      req.body.soTang = sodo.soTang;
    }
    // Tuyệt đối không cho phép đổi biển số xe sau khi đã tạo
    delete req.body.bienSo;

    const doc = await Xe.findByIdAndUpdate(xe._id, req.body, { new: true });
    res.json({ message: 'Cập nhật thành công (Lưu ý: Biển số xe không được thay đổi)', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật xe', error: err.message });
  }
});

router.get('/vehicles/:id/seat-map', adminMiddleware, async (req, res) => {
  try {
    const idOrBienSo = req.params.id;
    let xe;

    if (mongoose.Types.ObjectId.isValid(idOrBienSo)) {
      xe = await Xe.findById(idOrBienSo).populate('soDoGheId');
    } else {
      xe = await Xe.findOne({ bienSo: idOrBienSo }).populate('soDoGheId');
    }

    if (!xe) return res.status(404).json({ message: 'Không tìm thấy xe để lấy sơ đồ' });

    res.json({
      xeId: xe._id,
      bienSo: xe.bienSo,
      tongSoGhe: xe.tongSoGhe,
      soDoGhe: xe.soDoGheId ? xe.soDoGheId.danhSachGhe : []
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy sơ đồ xe', error: err.message });
  }
});

router.delete('/vehicles/:id', adminMiddleware, async (req, res) => {
  try {
    const idOrBienSo = req.params.id;
    let xe;

    if (mongoose.Types.ObjectId.isValid(idOrBienSo)) {
      xe = await Xe.findById(idOrBienSo);
    } else {
      xe = await Xe.findOne({ bienSo: idOrBienSo });
    }

    if (!xe) return res.status(404).json({ message: 'Không tìm thấy xe' });

    // Kiểm tra xe có bất kỳ chuyến nào chưa hoàn thành không (active, running, scheduled)
    const busyTrip = await ChuyenXe.findOne({ 
      xeId: xe._id, 
      trangThai: { $in: ['active', 'running', 'scheduled'] } 
    });

    if (busyTrip) {
      return res.status(400).json({ 
        message: `Không thể xóa/ẩn xe này vì đang có chuyến xe chưa hoàn thành (Trạng thái chuyến: ${busyTrip.trangThai}).` 
      });
    }

    const doc = await Xe.findByIdAndUpdate(xe._id, { trangThai: 'inactive' }, { new: true });
    res.json({ message: 'Đã ngừng hoạt động xe thành công. Xe sẽ không xuất hiện khi tạo chuyến mới nhưng vẫn được giữ trong lịch sử.', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa xe', error: err.message });
  }
});

// ==========================================
// 5. TUYẾN XE (ROUTES)
// ==========================================
router.get('/routes', adminMiddleware, async (req, res) => {
  try {
    const data = await TuyenXe.find({ trangThai: { $ne: 'inactive' } }).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// Xem chi tiết 1 tuyến xe
router.get('/routes/:id', adminMiddleware, async (req, res) => {
  try {
    const doc = await TuyenXe.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy tuyến xe' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// Lấy danh sách điểm đón/trả của tuyến xe
router.get('/routes/:id/stops', adminMiddleware, async (req, res) => {
  try {
    const doc = await TuyenXe.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy tuyến xe' });
    res.json({
      tuyenXeId: doc._id,
      tenTuyen: `${doc.diemDi} → ${doc.diemDen}`,
      diemDon: doc.diemDon || [],
      diemTra: doc.diemTra || []
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// Thêm/cập nhật điểm đón, điểm trả cho tuyến xe
router.route(['/routes/:id/points', '/routes/:id/stops'])
  .all(adminMiddleware)
  .post(async (req, res) => {
    // Logic sẽ nằm chung ở dưới, ta gọi hàm xử lý chung
    return handleUpsertStops(req, res);
  })
  .put(async (req, res) => {
    return handleUpsertStops(req, res);
  });

const handleUpsertStops = async (req, res) => {
  try {
    const doc = await TuyenXe.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy tuyến xe' });

    // Hỗ trợ 2 format:
    // Format 1: Body là mảng [{tenDiem, diaChi, loai: "don"/"tra", ...}]
    // Format 2: Body là object { diemDon: [...], diemTra: [...] }

    if (Array.isArray(req.body)) {
      // Validate array elements
      for (const d of req.body) {
        if (!d.tenDiem || !d.tenDiem.trim()) return res.status(400).json({ message: 'Tên điểm không được để trống' });
        if (!d.diaChi || !d.diaChi.trim()) return res.status(400).json({ message: 'Địa chỉ không được để trống' });
        if (d.thuTu === undefined || d.thuTu < 0) return res.status(400).json({ message: `Thứ tự của điểm ${d.tenDiem} không hợp lệ` });
      }

      // Check duplicate thuTu
      const thuTuSet = new Set(req.body.map(d => d.thuTu));
      if (thuTuSet.size !== req.body.length) {
        return res.status(400).json({ message: 'Thứ tự các điểm không được trùng nhau' });
      }

      // Format 1: tự phân loại theo field "loai"
      const diemDon = req.body.filter(d => d.loai === 'don').map(d => ({
        tenDiem: d.tenDiem.trim(),
        diaChi: d.diaChi.trim(),
        thoiGian: d.thoiGian,
        thuTu: d.thuTu
      }));
      const diemTra = req.body.filter(d => d.loai === 'tra').map(d => ({
        tenDiem: d.tenDiem.trim(),
        diaChi: d.diaChi.trim(),
        thoiGian: d.thoiGian,
        thuTu: d.thuTu
      }));

      if (diemDon.length > 0) doc.diemDon = diemDon;
      if (diemTra.length > 0) doc.diemTra = diemTra;
    } else {
      // Format 2: object { diemDon, diemTra }
      const { diemDon, diemTra } = req.body;


      const validateStopArray = (arr, label) => {
        if (!arr) return;
        if (!Array.isArray(arr)) throw new Error(`${label} phải là một mảng`);

        const localThuTu = new Set();
        for (const d of arr) {
          if (!d.tenDiem || !d.tenDiem.trim()) throw new Error(`Tên điểm trong ${label} không được để trống`);
          if (!d.tinhThanh || !d.tinhThanh.trim()) throw new Error(`Tỉnh thành của điểm "${d.tenDiem}" không được để trống`);

          if (d.thuTu === undefined || d.thuTu < 0) throw new Error(`Thứ tự trong ${label} không hợp lệ`);
          if (localThuTu.has(d.thuTu)) throw new Error(`Thứ tự ${d.thuTu} trong ${label} bị trùng lặp`);
          localThuTu.add(d.thuTu);
          d.tinhThanh = normalizeCity(d.tinhThanh);
        }
      };

      try {
        validateStopArray(diemDon, 'Điểm đón');
        validateStopArray(diemTra, 'Điểm trả');

        const allPoints = [...(diemDon || []), ...(diemTra || [])];
        if (allPoints.length > 0) {
          // Sắp xếp để tìm điểm đầu và điểm cuối
          const sortedPoints = [...allPoints].sort((a, b) => a.thuTu - b.thuTu);
          const firstPoint = sortedPoints[0];
          const lastPoint = sortedPoints[sortedPoints.length - 1];

          const checkMatch = (city1, city2) => {
            const c1 = normalizeCity(city1);
            const c2 = normalizeCity(city2);
            if (c1 === c2) return true;
            // Ngoại lệ Đà Lạt - Lâm Đồng
            return (c1 === 'Đà Lạt' && c2 === 'Lâm Đồng') || (c1 === 'Lâm Đồng' && c2 === 'Đà Lạt');
          };

          // Kiểm tra điểm đầu tiên
          if (!checkMatch(firstPoint.tinhThanh, doc.diemDi)) {
            return res.status(400).json({ message: `Điểm bắt đầu "${firstPoint.tenDiem}" (${firstPoint.tinhThanh}) phải thuộc tỉnh/thành đi của tuyến ("${doc.diemDi}")` });
          }

          // Kiểm tra điểm cuối cùng
          if (!checkMatch(lastPoint.tinhThanh, doc.diemDen)) {
            return res.status(400).json({ message: `Điểm kết thúc "${lastPoint.tenDiem}" (${lastPoint.tinhThanh}) phải thuộc tỉnh/thành đến của tuyến ("${doc.diemDen}")` });
          }
        }

        // Kiểm tra trùng lặp tên điểm + địa chỉ
        const seenPoints = new Set();
        for (const p of allPoints) {
          const key = `${p.tenDiem.trim().toLowerCase()}|${(p.diaChi || '').trim().toLowerCase()}|${p.tinhThanh.trim().toLowerCase()}`;
          if (seenPoints.has(key)) {
            return res.status(400).json({ message: `Điểm "${p.tenDiem}" bị trùng lặp thông tin (tên, địa chỉ, tỉnh thành). Vui lòng kiểm tra lại.` });
          }
          seenPoints.add(key);
        }

        // Logic bổ sung: Tất cả điểm đón phải có thứ tự trước hoặc bằng điểm trả
        if (diemDon && diemTra && diemDon.length > 0 && diemTra.length > 0) {
          const maxThuTuDon = Math.max(...diemDon.map(d => d.thuTu));
          const minThuTuTra = Math.min(...diemTra.map(d => d.thuTu));
          if (maxThuTuDon > minThuTuTra) {
            return res.status(400).json({ message: 'Quy trình không hợp lệ: Điểm ĐÓN cuối cùng không được nằm sau điểm TRẢ đầu tiên (Ví dụ đúng: Đón 1, 2 - Trả 2, 3, 4)' });
          }
        }
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }

      if (diemDon) doc.diemDon = diemDon;
      if (diemTra) doc.diemTra = diemTra;
    }

    await doc.save();

    res.json({ message: 'Cập nhật điểm đón/trả thành công', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
};

router.post('/routes', adminMiddleware, async (req, res) => {
  try {
    const { diemDi, diemDen, giaVe, khoangCach, thoiGianDi } = req.body;

    // Validate required fields
    if (!diemDi || !diemDi.trim()) {
      return res.status(400).json({ message: 'Điểm đi không được để trống' });
    }
    if (!diemDen || !diemDen.trim()) {
      return res.status(400).json({ message: 'Điểm đến không được để trống' });
    }

    const cleanDiemDi = normalizeCity(diemDi);
    const cleanDiemDen = normalizeCity(diemDen);

    if (cleanDiemDi.toLowerCase() === cleanDiemDen.toLowerCase()) {
      return res.status(400).json({ message: 'Điểm đi và điểm đến không được giống nhau' });
    }

    // Validate khoangCach phải có đơn vị km
    if (khoangCach) {
      if (typeof khoangCach !== 'string' || !khoangCach.toLowerCase().includes('km')) {
        return res.status(400).json({ message: 'Khoảng cách phải bao gồm đơn vị "km" (VD: "300 km")' });
      }
    } else {
      return res.status(400).json({ message: 'Khoảng cách không được để trống và phải có đơn vị km' });
    }

    // Kiểm tra trùng tuyến (cùng điểm đi + điểm đến)
    const exists = await TuyenXe.findOne({
      diemDi: cleanDiemDi,
      diemDen: cleanDiemDen
    });

    if (exists) {
      // Nếu đã tồn tại (dù là active hay inactive), ta cập nhật thông tin mới đè lên
      exists.giaVe = giaVe.trim();
      exists.khoangCach = khoangCach.trim();
      exists.thoiGianDi = thoiGianDi.trim();
      exists.trangThai = 'active'; // Kích hoạt lại nếu đang bị ẩn
      await exists.save();
      return res.status(200).json({ message: 'Tuyến này đã tồn tại, hệ thống đã tự động cập nhật thông tin mới', doc: exists });
    }

    // Validate giaVe phải có đơn vị đ (Ví dụ: "250.000 đ")
    if (giaVe) {
      if (typeof giaVe !== 'string' || !giaVe.toLowerCase().includes('đ')) {
        return res.status(400).json({ message: 'Giá vé phải bao gồm đơn vị "đ" (VD: "250.000 đ")' });
      }
    } else {
      return res.status(400).json({ message: 'Giá vé không được để trống và phải có đơn vị "đ"' });
    }

    // Validate thoiGianDi phải có đơn vị giờ (Ví dụ: "6 giờ")
    if (thoiGianDi) {
      if (typeof thoiGianDi !== 'string' || !thoiGianDi.toLowerCase().includes('giờ')) {
        return res.status(400).json({ message: 'Thời gian đi phải bao gồm đơn vị "giờ" (VD: "6 giờ")' });
      }
    } else {
      return res.status(400).json({ message: 'Thời gian đi không được để trống và phải có đơn vị "giờ"' });
    }

    const doc = new TuyenXe({
      ...req.body,
      diemDi: cleanDiemDi,
      diemDen: cleanDiemDen,
      khoangCach: khoangCach.trim(),
      giaVe: giaVe.trim(),
      thoiGianDi: thoiGianDi.trim()
    });
    await doc.save();
    res.status(201).json({ message: 'Tạo thành công', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.put('/routes/:id', adminMiddleware, async (req, res) => {
  try {
    const { trangThai, diemDi, diemDen, giaVe, khoangCach } = req.body;
    const route = await TuyenXe.findById(req.params.id);
    if (!route) return res.status(404).json({ message: 'Không tìm thấy tuyến xe' });

    // 1. Kiểm tra nếu có thay đổi thông tin quan trọng (Điểm đi, điểm đến, giá vé, ...)
    const isMajorChange = (diemDi && diemDi !== route.diemDi) ||
      (diemDen && diemDen !== route.diemDen) ||
      (giaVe && giaVe !== route.giaVe);

    if (isMajorChange) {
      // Chuẩn hóa trước khi lưu
      if (req.body.diemDi) req.body.diemDi = normalizeCity(req.body.diemDi);
      if (req.body.diemDen) req.body.diemDen = normalizeCity(req.body.diemDen);
      
      // Chặn nếu có BẤT KỲ chuyến xe nào đang hoạt động trên tuyến này
      const activeTrip = await ChuyenXe.findOne({
        tuyenXeId: route._id,
        trangThai: 'active'
      });
      if (activeTrip) {
        return res.status(400).json({ message: 'Không thể sửa thông tin quan trọng của tuyến vì đang có chuyến xe hoạt động' });
      }
    }

    // 2. Validate numeric fields
    if (giaVe !== undefined && giaVe < 0) return res.status(400).json({ message: 'Giá vé không được là số âm' });
    if (khoangCach !== undefined && khoangCach < 0) return res.status(400).json({ message: 'Khoảng cách không được là số âm' });

    // 3. Prevent active if no stops
    if (trangThai === 'active') {
      if ((!route.diemDon || route.diemDon.length === 0) && (!route.diemTra || route.diemTra.length === 0)) {
        return res.status(400).json({ message: 'Không thể kích hoạt tuyến đường khi chưa có điểm đón hoặc điểm trả' });
      }
    }

    // 4. Kiểm tra trùng tuyến nếu đổi điểm đi/đến
    if (diemDi || diemDen) {
      const checkDiemDi = normalizeCity(diemDi || route.diemDi);
      const checkDiemDen = normalizeCity(diemDen || route.diemDen);

      if (checkDiemDi.toLowerCase() === checkDiemDen.toLowerCase()) {
        return res.status(400).json({ message: 'Điểm đi và điểm đến không được giống nhau' });
      }

      const duplicate = await TuyenXe.findOne({
        diemDi: checkDiemDi,
        diemDen: checkDiemDen,
        _id: { $ne: req.params.id },
        trangThai: { $ne: 'inactive' }
      });
      if (duplicate) return res.status(400).json({ message: 'Thông tin điểm đi/đến này trùng với một tuyến khác đang hoạt động' });

      req.body.diemDi = checkDiemDi;
      req.body.diemDen = checkDiemDen;
    }

    // Validate khoangCach có km nếu có gửi cập nhật
    if (khoangCach && !khoangCach.toLowerCase().includes('km')) {
      return res.status(400).json({ message: 'Khoảng cách phải bao gồm đơn vị "km"' });
    }

    // Validate giaVe có đ nếu có gửi cập nhật
    if (req.body.giaVe && !req.body.giaVe.toLowerCase().includes('đ')) {
      return res.status(400).json({ message: 'Giá vé phải bao gồm đơn vị "đ"' });
    }

    // Validate thoiGianDi có giờ nếu có gửi cập nhật
    if (req.body.thoiGianDi && !req.body.thoiGianDi.toLowerCase().includes('giờ')) {
      return res.status(400).json({ message: 'Thời gian đi phải bao gồm đơn vị "giờ"' });
    }

    const doc = await TuyenXe.findByIdAndUpdate(req.params.id, req.body, { new: true });

    res.json({ message: 'Cập nhật thành công', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

router.delete('/routes/:id', adminMiddleware, async (req, res) => {
  try {
    // Kiểm tra tuyến có chuyến xe active không
    const activeTrip = await ChuyenXe.findOne({ tuyenXeId: req.params.id, trangThai: 'active' });
    if (activeTrip) {
      return res.status(400).json({
        message: 'Không thể xóa tuyến xe vì đang có chuyến xe đang hoạt động (active).',
        activeTripId: activeTrip._id,
        note: 'Bạn cần hủy hoặc hoàn thành chuyến xe này trước khi xóa tuyến.'
      });
    }

    const doc = await TuyenXe.findByIdAndUpdate(req.params.id, { trangThai: 'inactive' }, { new: true });
    res.json({ message: 'Đã ẩn tuyến xe', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// ==========================================
// 6. CHUYẾN XE (TRIPS)
// ==========================================
router.get('/trips', adminMiddleware, async (req, res) => {
  try {
    const now = new Date();

    // TỰ ĐỘNG CẬP NHẬT TRẠNG THÁI THEO THỜI GIAN

    // 1. Tự động BẮT ĐẦU: active (Chờ khởi hành) -> running (Đang chạy)
    const autoStarted = await ChuyenXe.updateMany(
      {
        trangThai: 'active',
        thoiGianKhoiHanh: { $lte: now }
      },
      { trangThai: 'running' }
    );

    // 2. Tự động HOÀN THÀNH: running (Đang chạy) -> completed (Đã hoàn thành)
    const autoCompleted = await ChuyenXe.updateMany(
      {
        trangThai: 'running',
        thoiGianDen: { $lt: now }
      },
      { trangThai: 'completed' }
    );

    if (autoStarted.modifiedCount > 0 || autoCompleted.modifiedCount > 0) {
      console.log(`[AutoUpdate] Started: ${autoStarted.modifiedCount}, Completed: ${autoCompleted.modifiedCount}`);
    }

    const trips = await ChuyenXe.find({ trangThai: { $ne: 'inactive' } })
      .populate('tuyenXeId')
      .populate('xeId')
      .sort({ thoiGianKhoiHanh: -1 });

    const data = trips.map(t => {
      const trip = t.toObject();
      const max = trip.xeId ? trip.xeId.tongSoGhe : 34;
      trip.tongSoGheDaDat = (trip.gheDaDat || []).length;
      trip.tongSoGheTrong = max - trip.tongSoGheDaDat;
      return trip;
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách chuyến xe', error: err.message });
  }
});

router.post('/trips', adminMiddleware, async (req, res) => {
  try {
    let { xeId, tuyenXeId, thoiGianKhoiHanh, thoiGianDen } = req.body;

    if (tuyenXeId) {
      const tuyen = await TuyenXe.findById(tuyenXeId);
      if (!tuyen) return res.status(404).json({ message: 'Không tìm thấy tuyến xe' });
      if (tuyen.trangThai === 'inactive') {
        return res.status(400).json({ message: 'Tuyến xe này hiện đang bị ẩn, không thể tạo chuyến.' });
      }
      // Bắt buộc Tuyến phải có điểm đón/trả mới cho tạo chuyến
      if (!tuyen.diemDon || tuyen.diemDon.length === 0 || !tuyen.diemTra || tuyen.diemTra.length === 0) {
        return res.status(400).json({ message: 'Tuyến xe này chưa cấu hình Điểm đón/trả. Vui lòng cập nhật Điểm đón/trả cho tuyến trước khi tạo chuyến.' });
      }
    }
    // Validate ngày đi hợp lệ
    if (!thoiGianKhoiHanh || new Date(thoiGianKhoiHanh) < new Date()) {
      return res.status(400).json({ message: 'Thời gian khởi hành phải trong tương lai' });
    }

    // Tự động tính toán thoiGianDen nếu không truyền (Lấy từ tuyến xe)
    if (!thoiGianDen && thoiGianKhoiHanh && tuyenXeId) {
      const tuyen = await TuyenXe.findById(tuyenXeId);
      if (tuyen && tuyen.thoiGianDi) {
        let durationMinutes = 240;
        const matchHours = tuyen.thoiGianDi.match(/(\d+\.?\d*)\s*(giờ|tiếng)/i);
        const matchMinutes = tuyen.thoiGianDi.match(/(\d+)\s*phút/i);

        if (matchHours) {
          durationMinutes = parseFloat(matchHours[1]) * 60;
        } else if (matchMinutes) {
          durationMinutes = parseInt(matchMinutes[1]);
        }

        thoiGianDen = new Date(new Date(thoiGianKhoiHanh).getTime() + durationMinutes * 60 * 1000);
        req.body.thoiGianDen = thoiGianDen;
      }
    }

    if (!thoiGianDen) {
      return res.status(400).json({ message: 'Không thể xác định thời gian đến. Vui lòng kiểm tra lại Tuyến xe.' });
    }

    // Không cho giờ đến < giờ đi
    if (new Date(thoiGianDen) <= new Date(thoiGianKhoiHanh)) {
      return res.status(400).json({ message: 'Thời gian đến phải sau thời gian khởi hành' });
    }
    // 4. KIỂM TRA XE & TUYẾN
    let xe = await Xe.findById(xeId);
    if (!xe) xe = await Xe.findOne({ bienSo: xeId });
    if (!xe) return res.status(404).json({ message: 'Không tìm thấy xe với ID hoặc Biển số này' });

    if (xe.trangThai !== 'active') {
        return res.status(400).json({ message: `Xe ${xe.bienSo} hiện không khả dụng (trạng thái: ${xe.trangThai})` });
    }

    // KIỂM TRA XE CÓ THUỘC TUYẾN NÀY KHÔNG
    if (xe.tuyenXeId && xe.tuyenXeId.toString() !== tuyenXeId.toString()) {
        return res.status(400).json({ 
            message: `Xe ${xe.bienSo} đã được phân công cho tuyến khác, không thể chạy tuyến này.` 
        });
    }

    // 5. KIỂM TRA TRÙNG LỊCH (OVERLAP CHECK)

      // ✅ CHẶN TẠO CHUYẾN TRONG QUÁ KHỨ
      if (new Date(thoiGianKhoiHanh) < new Date()) {
        return res.status(400).json({ message: 'Không được tạo chuyến xe trong quá khứ.' });
      }

      // ✅ LOGIC CHẶN TRÙNG LỊCH (OVERLAP CHECK)
      if (xeId) {
        let xe = await Xe.findById(xeId);
        if (!xe) xe = await Xe.findOne({ bienSo: xeId });

        if (xe) {
          // Tự động gán đúng ID từ DB
          req.body.xeId = xe._id;

          // Kiểm tra xem xe này có thuộc tuyến này không
          if (xe.tuyenXeId && xe.tuyenXeId.toString() !== tuyenXeId.toString()) {
            return res.status(400).json({ message: `Xe ${xe.bienSo} đã được phân công cho tuyến khác, không thể chạy tuyến này.` });
          }

          // Tính thời gian kết thúc dự kiến (bao gồm 30p quay đầu)
          const buffer = 30 * 60 * 1000;
          const startNew = new Date(thoiGianKhoiHanh).getTime();
          const endNew = new Date(thoiGianDen).getTime() + buffer;
          const startWithBuffer = startNew - buffer;

          // Tìm bất kỳ chuyến nào của xe này (active/running/scheduled) mà bị trùng giờ
          const overlappingTrip = await ChuyenXe.findOne({
            xeId: xe._id,
            trangThai: { $in: ['active', 'running', 'scheduled'] },
            $or: [
              {
                thoiGianKhoiHanh: { $lt: new Date(endNew) },
                thoiGianDen: { $gt: new Date(startWithBuffer) }
              }
            ]
          });

          if (overlappingTrip) {
            return res.status(400).json({
              message: `Xe ${xe.bienSo} đã có lịch chạy từ ${new Date(overlappingTrip.thoiGianKhoiHanh).toLocaleString()} đến ${new Date(overlappingTrip.thoiGianDen).toLocaleString()}. Vui lòng chọn khung giờ khác.`
            });
          }
        }
      }

    // Tự động tính toán thoiGianDen nếu không truyền
    if (!thoiGianDen && thoiGianKhoiHanh && tuyenXeId) {
      const tuyen = await TuyenXe.findById(tuyenXeId);
      if (tuyen && tuyen.thoiGianDi) {
        // Hỗ trợ "giờ", "tiếng", "phút" và cả số thập phân "4.5 giờ"
        let durationMinutes = 240; // Mặc định 4h
        const matchHours = tuyen.thoiGianDi.match(/(\d+\.?\d*)\s*(giờ|tiếng)/i);
        const matchMinutes = tuyen.thoiGianDi.match(/(\d+)\s*phút/i);

        if (matchHours) {
          durationMinutes = parseFloat(matchHours[1]) * 60;
        } else if (matchMinutes) {
          durationMinutes = parseInt(matchMinutes[1]);
        }

        thoiGianDen = new Date(new Date(thoiGianKhoiHanh).getTime() + durationMinutes * 60 * 1000);
        req.body.thoiGianDen = thoiGianDen;
      }
    }

    const doc = new ChuyenXe(req.body);
    await doc.save();

    const fullDoc = await ChuyenXe.findById(doc._id).populate('tuyenXeId').populate('xeId');
    res.status(201).json({ message: 'Tạo chuyến xe thành công', doc: fullDoc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// 6.3 Cập nhật chuyến xe (Đổi xe, đổi giờ)
router.put('/trips/:id', adminMiddleware, async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.id).populate('tuyenXeId');
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    const { xeId, tuyenXeId, thoiGianKhoiHanh, trangThai } = req.body;

    // 1. Kiểm tra vé đã đặt
    const activeBooking = await Ve.findOne({
      chuyenXeId: trip._id,
      trangThai: { $nin: ['cancelled', 'refunded'] }
    });

    if (activeBooking) {
      // Nếu đã có khách, chặn đổi Tuyến đường tuyệt đối
      if (tuyenXeId && tuyenXeId.toString() !== trip.tuyenXeId._id.toString()) {
        return res.status(400).json({ message: 'Không thể đổi Tuyến đường vì đã có khách đặt vé.' });
      }
    }

    // 2. Tự động tính toán lại thời gian đến nếu đổi Giờ đi hoặc đổi Tuyến
    if (thoiGianKhoiHanh || tuyenXeId) {
      const targetTuyenId = tuyenXeId || trip.tuyenXeId._id;
      const targetTuyen = await TuyenXe.findById(targetTuyenId);
      const targetStart = thoiGianKhoiHanh ? new Date(thoiGianKhoiHanh) : new Date(trip.thoiGianKhoiHanh);

      if (targetStart < new Date() && !thoiGianKhoiHanh) {
        // Nếu không đổi giờ đi mà giờ đi cũ đã qua, không cần check quá khứ
      } else if (thoiGianKhoiHanh && targetStart < new Date()) {
        return res.status(400).json({ message: 'Thời gian khởi hành mới không được ở quá khứ.' });
      }

      if (targetTuyen && targetTuyen.thoiGianDi) {
        let durationMinutes = 240;
        const matchHours = targetTuyen.thoiGianDi.match(/(\d+\.?\d*)\s*(giờ|tiếng)/i);
        const matchMinutes = targetTuyen.thoiGianDi.match(/(\d+)\s*phút/i);
        if (matchHours) durationMinutes = parseFloat(matchHours[1]) * 60;
        else if (matchMinutes) durationMinutes = parseInt(matchMinutes[1]);

        req.body.thoiGianDen = new Date(targetStart.getTime() + durationMinutes * 60 * 1000);
      }
    }

    // 3. Kiểm tra trùng lịch khi đổi Xe hoặc đổi Giờ đi
    if (xeId || thoiGianKhoiHanh) {
      const targetXeId = xeId || trip.xeId;
      const targetStart = thoiGianKhoiHanh ? new Date(thoiGianKhoiHanh) : new Date(trip.thoiGianKhoiHanh);
      const targetEndWithBuffer = new Date(new Date(req.body.thoiGianDen || trip.thoiGianDen).getTime() + 30 * 60 * 1000);
      const targetStartWithBuffer = new Date(targetStart.getTime() - 30 * 60 * 1000);

      const overlap = await ChuyenXe.findOne({
        _id: { $ne: trip._id },
        xeId: targetXeId,
        trangThai: { $in: ['active', 'scheduled', 'completed'] },
        $or: [
          {
            thoiGianKhoiHanh: { $lt: targetEndWithBuffer },
            thoiGianDen: { $gt: targetStartWithBuffer }
          }
        ]
      });

      if (overlap) {
        return res.status(400).json({
          message: `Xe đã có lịch chạy khác từ ${new Date(overlap.thoiGianKhoiHanh).toLocaleString()} đến ${new Date(overlap.thoiGianDen).toLocaleString()}. Không thể đổi.`
        });
      }
    }

    // ❌ CHẶN ADMIN TỰ Ý ĐỔI TRẠNG THÁI SANG RUNNING/COMPLETED (Phải để hệ thống tự động theo thời gian)
    if (trangThai && ['running', 'completed'].includes(trangThai)) {
      return res.status(400).json({
        message: 'Trạng thái "Đang chạy" và "Hoàn thành" được hệ thống cập nhật tự động theo thời gian khởi hành/đến. Admin không được phép thay đổi thủ công.'
      });
    }

    const doc = await ChuyenXe.findByIdAndUpdate(req.params.id, req.body, { new: true });

    // Xử lý gửi mail và thông báo nếu hủy chuyến
    if (req.body.trangThai === 'cancelled' && trip.trangThai !== 'cancelled') {
      const bookings = await Ve.find({ chuyenXeId: trip._id, trangThai: { $nin: ['cancelled', 'refunded'] } }).populate('khachHangId');
      
      const routeInfo = trip.tuyenXeId ? `${trip.tuyenXeId.diemDi} - ${trip.tuyenXeId.diemDen}` : 'Không xác định';
      const departureTime = new Date(trip.thoiGianKhoiHanh).toLocaleString('vi-VN');

      for (const b of bookings) {
        b.trangThai = 'cancelled';
        await b.save();

        const emailHtml = `
          <div style="font-family: Arial, sans-serif; border: 1px solid #ef5222; padding: 20px; border-radius: 10px; max-width: 600px; margin: auto;">
              <h2 style="color: #ef5222; text-align: center;">THÔNG BÁO HỦY CHUYẾN XE</h2>
              <p>Chào <b>${b.hoTen || (b.khachHangId ? b.khachHangId.hoTen : 'Quý khách')}</b>,</p>
              <p>Chúng tôi rất tiếc phải thông báo rằng chuyến xe của bạn đã bị hủy vì lý do kỹ thuật hoặc điều kiện vận hành.</p>
              <div style="background-color: #f9f9f9; padding: 15px; margin: 15px 0; border-left: 4px solid #ef5222;">
                  <p><b>Mã vé:</b> ${b.maVe}</p>
                  <p><b>Tuyến đường:</b> ${routeInfo}</p>
                  <p><b>Giờ khởi hành:</b> ${departureTime}</p>
              </div>
              <p>Hệ thống sẽ tiến hành hoàn tiền (nếu bạn đã thanh toán) theo chính sách của BlueBus trong vòng 3-5 ngày làm việc.</p>
              <p>Mọi thắc mắc xin vui lòng liên hệ Hotline hoặc phản hồi lại email này.</p>
              <p>Thành thật xin lỗi quý khách vì sự bất tiện này!</p>
          </div>
        `;
        await sendEmail({ email: b.email, subject: '[BlueBus] Rất tiếc, chuyến xe của bạn đã bị hủy', html: emailHtml });
      }

      // Tạo thông báo cho Admin
      try {
        const thongBao = new ThongBao({
          tieuDe: 'Hủy chuyến xe',
          noiDung: `Chuyến xe thuộc tuyến ${routeInfo} (Khởi hành: ${departureTime}) vừa bị hủy.`,
          loai: 'system',
          daDoc: false
        });
        await thongBao.save();

        // Bắn sự kiện socket cho các Admin
        const io = req.app.get('io');
        if (io) {
          io.emit('admin_notification', {
             message: thongBao.noiDung,
             type: 'warning',
             title: 'Chuyến xe bị hủy'
          });
        }
      } catch (err) {
         console.error('Lỗi khi tạo thông báo hoặc gửi socket admin:', err);
      }
    }

    res.json({ message: 'Cập nhật chuyến xe thành công', doc });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật', error: err.message });
  }
});

// @route   POST /api/admin/trips/:id/cancel
// @desc    Admin hủy chuyến xe → Hủy tất cả vé liên quan + gửi email + emit socket booking_cancelled và admin_notification
router.post('/trips/:id/cancel', adminMiddleware, async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.id).populate('tuyenXeId');
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    if (trip.trangThai === 'cancelled') {
      return res.status(400).json({ message: 'Chuyến xe này đã được hủy từ trước.' });
    }

    // 1. Cập nhật trạng thái chuyến xe sang cancelled và giải phóng toàn bộ ghế
    trip.trangThai = 'cancelled';
    trip.gheDaDat = []; // Giải phóng toàn bộ ghế
    await trip.save();

    // 2. Tìm tất cả vé chưa bị hủy hoặc hoàn tiền của chuyến này
    const bookings = await Ve.find({
      chuyenXeId: trip._id,
      trangThai: { $nin: ['cancelled', 'refunded'] }
    }).populate('khachHangId');

    const routeInfo = trip.tuyenXeId ? `${trip.tuyenXeId.diemDi} - ${trip.tuyenXeId.diemDen}` : 'Không xác định';
    const departureTime = new Date(trip.thoiGianKhoiHanh).toLocaleString('vi-VN');

    // 3. Thực hiện hủy từng vé, gửi email và bắn socket
    const io = req.app.get('io');
    
    for (const b of bookings) {
      b.trangThai = 'cancelled';
      b.ghiChu = (b.ghiChu || '') + ` [Admin hủy chuyến - Chuyến xe bị hủy]`;
      await b.save();

      // Gửi email cho khách hàng
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; border: 1px solid #ef5222; padding: 20px; border-radius: 10px; max-width: 600px; margin: auto;">
              <h2 style="color: #ef5222; text-align: center;">THÔNG BÁO HỦY CHUYẾN XE</h2>
              <p>Chào <b>${b.hoTen || (b.khachHangId ? b.khachHangId.hoTen : 'Quý khách')}</b>,</p>
              <p>Chúng tôi rất tiếc phải thông báo rằng chuyến xe của bạn đã bị hủy vì lý do kỹ thuật hoặc điều kiện vận hành từ nhà xe BlueBus.</p>
              <div style="background-color: #f9f9f9; padding: 15px; margin: 15px 0; border-left: 4px solid #ef5222;">
                  <p><b>Mã vé:</b> ${b.maVe}</p>
                  <p><b>Tuyến đường:</b> ${routeInfo}</p>
                  <p><b>Giờ khởi hành:</b> ${departureTime}</p>
                  <p><b>Danh sách ghế bị hủy:</b> ${b.danhSachGhe.join(', ')}</p>
              </div>
              <p>Hệ thống sẽ tiến hành hoàn tiền tự động (nếu bạn đã thanh toán) theo chính sách của BlueBus trong vòng 3-5 ngày làm việc.</p>
              <p>Mọi thắc mắc xin vui lòng liên hệ Hotline hoặc phản hồi lại email này.</p>
              <p>Thành thật xin lỗi quý khách vì sự bất tiện này!</p>
          </div>
        `;
        await sendEmail({ email: b.email, subject: '[BlueBus] Rất tiếc, chuyến xe của bạn đã bị hủy', html: emailHtml });
      } catch (mailErr) {
        console.error(`Lỗi gửi mail hủy cho vé ${b.maVe}:`, mailErr);
      }

      // ✅ EMIT socket booking_cancelled cho từng vé
      if (io) {
        const socketPayload = {
          bookingId: b._id,
          maVe: b.maVe,
          gheTraLai: b.danhSachGhe,
          chuyenXeId: trip._id
        };
        io.emit('booking_cancelled', socketPayload);
        io.to(trip._id.toString()).emit('booking_cancelled', socketPayload);
      }
    }

    // 4. Tạo thông báo và bắn socket admin_notification
    let thongBaoContent = `Chuyến xe thuộc tuyến ${routeInfo} (Khởi hành: ${departureTime}) vừa bị hủy.`;
    try {
      const thongBao = new ThongBao({
        tieuDe: 'Hủy chuyến xe',
        noiDung: thongBaoContent,
        loai: 'system',
        daDoc: false
      });
      await thongBao.save();

      if (io) {
        io.emit('admin_notification', {
           message: thongBao.noiDung,
           type: 'warning',
           title: 'Chuyến xe bị hủy'
        });
      }
    } catch (err) {
       console.error('Lỗi khi tạo thông báo hoặc gửi socket admin:', err);
    }

    res.json({
      message: 'Hủy chuyến xe và tất cả vé liên quan thành công',
      tripId: trip._id,
      trangThai: 'cancelled',
      veBiHuy: bookings.map(b => b.maVe)
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi hủy chuyến xe', error: err.message });
  }
});

router.delete('/trips/:id', adminMiddleware, async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.id);
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    // Không cho xóa chuyến đã có booking
    const hasBooking = await Ve.findOne({ chuyenXeId: trip._id, trangThai: { $nin: ['cancelled', 'refunded'] } });
    if (hasBooking) {
      return res.status(400).json({ message: 'Không thể xóa chuyến xe đã có vé đặt' });
    }

    trip.trangThai = 'inactive';
    await trip.save();
    res.json({ message: 'Đã hủy/ẩn chuyến chạy', doc: trip });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});


// Xem chi tiết 1 vé (Hỗ trợ cả ID và Mã vé)
router.get('/bookings/:id', adminMiddleware, async (req, res) => {
  try {
    const idOrMaVe = req.params.id;
    let doc;

    // Nếu là ObjectId hợp lệ thì tìm theo _id, ngược lại tìm theo maVe
    if (mongoose.Types.ObjectId.isValid(idOrMaVe)) {
      doc = await Ve.findById(idOrMaVe)
        .populate('khachHangId', 'hoTen email soDienThoai')
        .populate({
          path: 'chuyenXeId',
          populate: { path: 'tuyenXeId' }
        });
    } else {
      doc = await Ve.findOne({ maVe: idOrMaVe })
        .populate('khachHangId', 'hoTen email soDienThoai')
        .populate({
          path: 'chuyenXeId',
          populate: { path: 'tuyenXeId' }
        });
    }

    if (!doc) return res.status(404).json({ message: 'Không tìm thấy vé' });

    const bookingObj = doc.toObject();
    bookingObj.soLuongGhe = bookingObj.danhSachGhe ? bookingObj.danhSachGhe.length : 0;

    res.json(bookingObj);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy chi tiết vé', error: err.message });
  }
});

// ==========================================
// 7. QUẢN LÝ VÉ (BOOKING MANAGEMENT)
// ==========================================

// Tìm kiếm vé nâng cao (theo ngày, tháng, năm, sđt, trạng thái, tuyến, chuyến)
router.get('/bookings', adminMiddleware, async (req, res) => {
  try {
    const { day, month, year, phone, status, routeId, tripId, method, search } = req.query;
    let query = {};

    // 1. MẶC ĐỊNH: Chỉ hiện các vé có giá trị (Đã thanh toán, Đã hủy...)
    // Loại bỏ vé rác (expired, hold, pending) trừ khi Admin chủ động chọn lọc
    if (!status) {
      query.trangThai = { $nin: ['expired', 'hold', 'pending'] };
    } else if (status === 'paid') {
      // Khi lọc "Đã thanh toán", hiện cả những vé đã hoàn thành chuyến đi
      query.trangThai = { $in: ['paid', 'confirmed', 'completed'] };
    } else if (status !== 'all') {
      query.trangThai = status;
    }

    // 2. Lọc theo phương thức thanh toán
    if (method) query.phuongThucThanhToan = method;

    // 3. Lọc theo Tuyến xe (Tìm các chuyến thuộc tuyến đó)
    if (routeId) {
      const tripsInRoute = await ChuyenXe.find({ tuyenXeId: routeId }).select('_id');
      const tripIds = tripsInRoute.map(t => t._id);
      query.chuyenXeId = { $in: tripIds };
    }

    // 4. Lọc theo Chuyến xe cụ thể
    if (tripId) query.chuyenXeId = tripId;

    // 5. Lọc theo thời gian đặt vé
    if (year) {
      const y = parseInt(year);
      let startDate, endDate;
      if (month && day) {
        startDate = new Date(y, parseInt(month) - 1, parseInt(day));
        endDate = new Date(y, parseInt(month) - 1, parseInt(day) + 1);
      } else if (month) {
        startDate = new Date(y, parseInt(month) - 1, 1);
        endDate = new Date(y, parseInt(month), 1);
      } else {
        startDate = new Date(y, 0, 1);
        endDate = new Date(y + 1, 0, 1);
      }
      query.ngayDat = { $gte: startDate, $lt: endDate };
    }

    // 6. Tìm kiếm theo Tên khách, SĐT hoặc Mã vé
    if (search) {
      const searchStr = search.trim();
      query.$or = [
        { maVe: { $regex: searchStr, $options: 'i' } },
        { hoTen: { $regex: searchStr, $options: 'i' } },
        { soDienThoai: { $regex: searchStr, $options: 'i' } }
      ];
    }
    if (phone) query.soDienThoai = new RegExp(phone, 'i');

    const bookings = await Ve.find(query)
      .populate({
        path: 'chuyenXeId',
        populate: { path: 'tuyenXeId' }
      })
      .populate('khachHangId', 'hoTen soDienThoai email')
      .sort({ createdAt: -1 });

    const formattedBookings = bookings.map(b => {
      const booking = b.toObject();
      booking.soLuongGhe = booking.danhSachGhe ? booking.danhSachGhe.length : 0;
      return booking;
    });

    // Trả về mảng để FE không bị crash (Lỗi trắng màn hình)
    res.json(formattedBookings);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tìm kiếm vé', error: err.message });
  }
});

// Admin cập nhật trạng thái vé hoặc đổi vé/ghế (Hỗ trợ đổi Chuyến cùng tuyến)
router.put('/bookings/:id', adminMiddleware, async (req, res) => {
  try {
    const { trangThai, lyDoHuy, danhSachGhe, newChuyenXeId } = req.body;
    const idOrMaVe = req.params.id;
    let doc;

    if (mongoose.Types.ObjectId.isValid(idOrMaVe)) {
      doc = await Ve.findById(idOrMaVe);
    } else {
      doc = await Ve.findOne({ maVe: idOrMaVe });
    }

    if (!doc) return res.status(404).json({ message: 'Không tìm thấy vé' });

    // ✅ CHẶN HỦY VÉ ĐÃ XÁC NHẬN/HOÀN THÀNH
    if (trangThai === 'cancelled' && ['confirmed', 'completed'].includes(doc.trangThai)) {
        return res.status(400).json({ 
            message: `Vé này đã ở trạng thái "${doc.trangThai}" (Đã xác nhận/Hoàn thành), tuyệt đối không thể hủy.` 
        });
    }

    const oldTrip = await ChuyenXe.findById(doc.chuyenXeId);
    if (!oldTrip) return res.status(400).json({ message: 'Không tìm thấy thông tin chuyến xe cũ' });

    // VÁCH NGĂN: Không cho chỉnh sửa vé nếu xe sắp chạy (trong 60 phút) hoặc đã chạy
    const now = new Date();
    const departureTime = new Date(oldTrip.thoiGianKhoiHanh);
    const diffInMinutes = (departureTime - now) / (1000 * 60);

    if (diffInMinutes < 60) {
        const msg = diffInMinutes < 0 ? 'Xe đã khởi hành, không thể chỉnh sửa vé.' : 'Xe sắp khởi hành (dưới 60 phút), không thể chỉnh sửa vé để đảm bảo an toàn vận hành.';
        return res.status(400).json({ message: msg });
    }

    // 1. XỬ LÝ ĐỔI CHUYẾN XE (Nếu có truyền newChuyenXeId)
    if (newChuyenXeId && newChuyenXeId.toString() !== doc.chuyenXeId.toString()) {
      const newTrip = await ChuyenXe.findById(newChuyenXeId);
      if (!newTrip) return res.status(404).json({ message: 'Chuyến xe mới không tồn tại' });

      // KIỂM TRA: Phải cùng Tuyến xe
      if (newTrip.tuyenXeId.toString() !== oldTrip.tuyenXeId.toString()) {
        return res.status(400).json({ message: 'Chỉ được phép đổi sang chuyến xe thuộc cùng một Tuyến đường.' });
      }

      // KIỂM TRA: Chuyến mới chưa khởi hành
      if (new Date(newTrip.thoiGianKhoiHanh) < new Date()) {
        return res.status(400).json({ message: 'Không thể đổi sang chuyến xe đã khởi hành.' });
      }

      // KIỂM TRA: Chuyến cũ chưa khởi hành
      if (new Date(oldTrip.thoiGianKhoiHanh) < new Date()) {
        return res.status(400).json({ message: 'Chuyến xe cũ đã khởi hành, không thể đổi chuyến.' });
      }

      // KIỂM TRA: Chỗ trống trên chuyến mới
      const targetSeats = danhSachGhe || doc.danhSachGhe;
      const occupied = newTrip.gheDaDat.filter(s => targetSeats.includes(s));
      if (occupied.length > 0) {
        return res.status(400).json({ message: `Ghế ${occupied.join(', ')} trên chuyến mới đã có người đặt.` });
      }

      // THỰC HIỆN ĐỔI: Nhả ghế cũ, giữ ghế mới
      oldTrip.gheDaDat = oldTrip.gheDaDat.filter(s => !doc.danhSachGhe.includes(s));
      newTrip.gheDaDat.push(...targetSeats);
      
      await oldTrip.save();
      await newTrip.save();

      doc.chuyenXeId = newChuyenXeId;
      doc.danhSachGhe = targetSeats;
      doc.ghiChu = (doc.ghiChu || '') + ` [Admin đổi từ chuyến ${oldTrip._id} sang ${newTrip._id}]`;
    } 
    // 2. XỬ LÝ ĐỔI GHẾ TRONG CÙNG CHUYẾN (Nếu chỉ đổi ghế)
    else if (danhSachGhe && JSON.stringify(danhSachGhe) !== JSON.stringify(doc.danhSachGhe)) {
      if (new Date(oldTrip.thoiGianKhoiHanh) < new Date()) {
        return res.status(400).json({ message: 'Chuyến xe đã khởi hành, không thể đổi chỗ.' });
      }

      const seatsToAssign = danhSachGhe.filter(s => !doc.danhSachGhe.includes(s));
      const alreadyOccupied = oldTrip.gheDaDat.filter(s => seatsToAssign.includes(s));
      if (alreadyOccupied.length > 0) {
        return res.status(400).json({ message: `Ghế ${alreadyOccupied.join(', ')} đã có khách khác đặt.` });
      }

      // Cập nhật lại danh sách ghế của chuyến xe
      oldTrip.gheDaDat = oldTrip.gheDaDat.filter(s => !doc.danhSachGhe.includes(s));
      oldTrip.gheDaDat.push(...danhSachGhe);
      await oldTrip.save();
      
      doc.danhSachGhe = danhSachGhe;
    }

    // 3. XỬ LÝ HỦY VÉ / HOÀN TIỀN
    if (trangThai && ['cancelled', 'refunded'].includes(trangThai) && doc.trangThai !== trangThai) {
      const now = new Date();
      const departureTime = new Date(oldTrip.thoiGianKhoiHanh);
      const diffInMs = departureTime - now;
      const diffInHours = diffInMs / (1000 * 60 * 60);

      if (diffInMs < 0) {
        return res.status(400).json({ message: 'Chuyến xe đã khởi hành, không thể hủy hoặc hoàn tiền.' });
      }

      // Vách ngăn: Phải trước ít nhất 2 tiếng
      if (diffInHours < 2) {
        return res.status(400).json({ message: 'Chuyến xe sắp khởi hành (dưới 2 tiếng), không thể hủy vé theo quy định.' });
      }

      // Bắt buộc nhập lý do chi tiết
      if (!lyDoHuy || lyDoHuy.trim().length < 5) {
        return res.status(400).json({ message: 'Vui lòng nhập lý do hủy/hoàn tiền chi tiết (ít nhất 5 ký tự).' });
      }

      // Nhả ghế
      const currentTrip = await ChuyenXe.findById(doc.chuyenXeId);
      currentTrip.gheDaDat = currentTrip.gheDaDat.filter(s => !doc.danhSachGhe.includes(s));
      await currentTrip.save();

      doc.trangThai = trangThai;
      doc.ghiChu = (doc.ghiChu || '') + ` [Admin Hủy - Lý do: ${lyDoHuy}]`;
      
      // ✅ Đồng bộ hóa trạng thái Hóa Đơn (HoaDon) tương ứng sang 'cancelled' hoặc 'refunded'
      const HoaDon = require('../models/HoaDon');
      await HoaDon.findOneAndUpdate({ veId: doc._id }, { trangThai: trangThai });
    } else if (trangThai) {
      doc.trangThai = trangThai;
      
      // Nếu admin đổi trạng thái vé sang khác (như paid, confirmed, completed), cập nhật hóa đơn sang completed
      if (['paid', 'confirmed', 'completed'].includes(trangThai)) {
        const HoaDon = require('../models/HoaDon');
        await HoaDon.findOneAndUpdate({ veId: doc._id }, { trangThai: 'completed' });
      }
    }

    // 4. CẬP NHẬT CÁC THÔNG TIN KHÁC (Tên, SĐT, Email, Điểm đón/trả)
    const { hoTen, soDienThoai, email, diemDon, diemTra, ghiChu } = req.body;
    if (hoTen) doc.hoTen = hoTen;
    if (soDienThoai) doc.soDienThoai = soDienThoai;
    if (email) doc.email = email;
    if (diemDon) doc.diemDon = diemDon;
    if (diemTra) doc.diemTra = diemTra;
    if (ghiChu) doc.ghiChu = ghiChu;

    await doc.save();
    
    // Trả về duy nhất Object vé để FE không bị crash
    const updatedDoc = await Ve.findById(doc._id)
      .populate('khachHangId', 'hoTen soDienThoai email')
      .populate({
        path: 'chuyenXeId',
        populate: { path: 'tuyenXeId' }
      });
      
    res.json(updatedDoc);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật vé', error: err.message });
  }
});

// Xóa vé
router.delete('/bookings/:id', adminMiddleware, async (req, res) => {
  try {
    const doc = await Ve.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Không tìm thấy vé' });

    // Trả ghế lại cho chuyến xe
    const trip = await ChuyenXe.findById(doc.chuyenXeId);
    if (trip) {
      trip.gheDaDat = trip.gheDaDat.filter(seat => !doc.danhSachGhe.includes(seat));
      await trip.save();
    }

    res.json({ message: 'Đã xóa vé thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// ==========================================
// 8. THỐNG KÊ (STATISTICS) - DOANH THU & TỔNG QUAN
// ==========================================
// 8.1 API Dashboard Tổng quan (Khớp hoàn toàn với ảnh Dashboard mới)
router.get('/stats/dashboard', adminMiddleware, async (req, res) => {
  try {
    // Chỉ Admin mới được xem thống kê doanh thu
    if (req.admin.vaiTro !== 'admin') {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập dữ liệu doanh thu' });
    }
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Lấy dữ liệu cho 4 Cards tổng quan (Tổng số vé bán ra tính theo số lượng ghế đã đặt)
    const [totalTicketsAggr, totalRevenueAggr, totalActiveTrips, totalCapacityAggr] = await Promise.all([
      Ve.aggregate([
        { $match: { trangThai: { $in: ['paid', 'confirmed', 'completed'] } } },
        { $group: { _id: null, total: { $sum: { $size: '$danhSachGhe' } } } }
      ]),
      Ve.aggregate([
        { $match: { trangThai: { $in: ['paid', 'confirmed', 'completed'] } } },
        { $group: { _id: null, total: { $sum: '$tongTien' } } }
      ]),
      ChuyenXe.countDocuments({
        trangThai: { $in: ['active', 'completed'] },
        thoiGianKhoiHanh: { $lte: now } // Đã khởi hành hoặc đã xong
      }),
      ChuyenXe.aggregate([
        { $match: { trangThai: 'active' } },
        { $group: { _id: null, totalSeats: { $sum: '$tongSoGhe' }, bookedSeats: { $sum: { $size: '$gheDaDat' } } } }
      ])
    ]);

    const totalTickets = totalTicketsAggr.length > 0 ? (totalTicketsAggr[0].total || 0) : 0;
    const totalRevenue = totalRevenueAggr.length > 0 ? (totalRevenueAggr[0].total || 0) : 0;
    const fillRate = totalCapacityAggr.length > 0 ? ((totalCapacityAggr[0].bookedSeats / totalCapacityAggr[0].totalSeats) * 100).toFixed(1) : 0;

    // 2. Biểu đồ Doanh thu theo ngày BÁN vé (7 ngày gần nhất tính theo ngayDat/createdAt)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [dailyStats, todayRevenueAggr] = await Promise.all([
      Ve.aggregate([
        {
          $match: {
            trangThai: { $in: ['paid', 'confirmed', 'completed'] },
            ngayDat: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%d/%m", date: "$ngayDat", timezone: "Asia/Ho_Chi_Minh" } },
            revenue: { $sum: '$tongTien' },
            tickets: { $sum: { $size: '$danhSachGhe' } }
          }
        },
        { $sort: { "_id": 1 } }
      ]),
      Ve.aggregate([
        {
          $match: {
            trangThai: { $in: ['paid', 'confirmed', 'completed'] },
            ngayDat: { $gte: today }
          }
        },
        { $group: { _id: null, total: { $sum: '$tongTien' } } }
      ])
    ]);

    const todayRevenue = todayRevenueAggr.length > 0 ? (todayRevenueAggr[0].total || 0) : 0;

    // 3. Thống kê theo Tuyến đường (Dùng tongTien từ Vé để tính doanh thu cho chuẩn, tính số vé theo số lượng ghế)
    const routeStats = await Ve.aggregate([
      { $match: { trangThai: { $in: ['paid', 'confirmed', 'completed'] } } },
      {
        $lookup: {
          from: 'chuyenxes',
          localField: 'chuyenXeId',
          foreignField: '_id',
          as: 'chuyen'
        }
      },
      { $unwind: '$chuyen' },
      {
        $lookup: {
          from: 'tuyenxes',
          localField: 'chuyen.tuyenXeId',
          foreignField: '_id',
          as: 'tuyen'
        }
      },
      { $unwind: '$tuyen' },
      {
        $group: {
          _id: '$chuyen.tuyenXeId',
          tenTuyen: { $first: { $concat: ['$tuyen.diemDi', ' - ', '$tuyen.diemDen'] } },
          soChuyen: { $addToSet: '$chuyen._id' },
          soVe: { $sum: { $size: '$danhSachGhe' } },
          doanhThu: { $sum: '$tongTien' }
        }
      },
      {
        $project: {
          tenTuyen: 1,
          soChuyen: { $size: '$soChuyen' },
          soVe: 1,
          doanhThu: 1
        }
      },
      { $sort: { doanhThu: -1 } }
    ]);

    // 4. Cơ cấu Trạng thái vé
    const statusStats = await Ve.aggregate([
      {
        $group: {
          _id: '$trangThai',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      summary: {
        totalTickets,
        totalTrips: totalActiveTrips,
        totalRevenue,
        todayRevenue,
        fillRate: `${fillRate}%`
      },
      dailyStats,
      topRoutes: routeStats.slice(0, 5),
      routeDetails: routeStats,
      statusDistribution: statusStats
    });

  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy dữ liệu dashboard chi tiết', error: err.message });
  }
});

// 8.2 Danh sách vé đặt gần nhất (Table phía dưới)
router.get('/stats/recent-bookings', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    const bookings = await Ve.find()
      .populate('khachHangId', 'hoTen')
      .populate({ path: 'chuyenXeId', populate: { path: 'tuyenXeId' } })
      .sort({ createdAt: -1 })
      .limit(10);

    const formatted = bookings.map(b => ({
      maVe: b.maVe,
      khachHang: b.khachHangId?.hoTen || 'Khách vãng lai',
      tuyenDuong: `${b.chuyenXeId?.tuyenXeId?.diemDi} - ${b.chuyenXeId?.tuyenXeId?.diemDen}`,
      thoiGianDat: b.ngayDat,
      soTien: b.tongTien,
      trangThai: b.trangThai
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// Thống kê doanh thu theo ngày
router.get('/stats/daily', adminMiddleware, checkPermission(['admin']), async (req, res) => {
  try {
    const dailyRevenue = await Ve.aggregate([
      { $match: { trangThai: { $in: ['paid', 'confirmed', 'completed'] } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$ngayDat",
              timezone: "Asia/Ho_Chi_Minh" // Sửa lỗi lệch múi giờ
            }
          },
          revenue: { $sum: '$tongTien' },
          tickets: { $sum: { $size: '$danhSachGhe' } }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    res.json(dailyRevenue);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi', error: err.message });
  }
});

// ==========================================
// 9. YÊU CẦU HỖ TRỢ (SUPPORT REQUESTS)
// ==========================================

// Lấy danh sách tất cả yêu cầu hỗ trợ (có filter status)
router.get('/support-requests', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let query = {};
    if (status) query.trangThai = status;

    const tickets = await SupportTicket.find(query)
      .populate('khachHangId', 'hoTen soDienThoai email')
      .sort({ createdAt: -1 });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách yêu cầu hỗ trợ', error: err.message });
  }
});

// Cập nhật trạng thái và phản hồi yêu cầu hỗ trợ (Bản sửa lỗi triệt để)
router.patch('/support-requests/:requestId', adminMiddleware, async (req, res) => {
  try {
    const { trangThai, phanHoi, phanHoiKhachHang, ghiChuNoiBo } = req.body;
    const ticket = await SupportTicket.findById(req.params.requestId);
    if (!ticket) return res.status(404).json({ message: 'Không tìm thấy yêu cầu hỗ trợ' });

    // Hỗ trợ linh hoạt tên biến từ FE
    const finalResponse = phanHoiKhachHang || phanHoi;

    if (trangThai) ticket.trangThai = trangThai;
    if (finalResponse) ticket.phanHoi = finalResponse;

    // Chỉ lưu ghi chú nội bộ nếu giá trị không rỗng để tránh lỗi Model
    if (ghiChuNoiBo) {
      ticket.ghiChuNoiBo = ghiChuNoiBo;
    }

    await ticket.save();

    // Gửi email nếu có phản hồi cho khách
    if (finalResponse) {
      const sendEmail = require('../utils/sendEmail');
      const statusMap = {
        'open': 'Đang chờ xử lý',
        'in_progress': 'Đang xử lý',
        'resolved': 'Đã giải quyết',
        'closed': 'Đã đóng'
      };

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
          <h2 style="color: #007bff; text-align: center;">Thông báo từ Phòng vé BlueBus</h2>
          <p>Chào <strong>${ticket.hoTen}</strong>,</p>
          <p>BlueBus xin phản hồi về yêu cầu hỗ trợ của bạn (Tiêu đề: <b>${ticket.tieuDe}</b>):</p>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 5px solid #007bff;">
            <p><strong>Nội dung phản hồi:</strong></p>
            <p>${phanHoiKhachHang}</p>
            <p style="margin-top: 10px; font-size: 0.9em; color: #666;">Trạng thái yêu cầu: <b>${statusMap[ticket.trangThai] || ticket.trangThai}</b></p>
          </div>
          <p>Nếu bạn có thêm bất kỳ thắc mắc nào, vui lòng liên hệ hotline 1900 1234.</p>
          <p>Trân trọng,<br>Đội ngũ BlueBus</p>
        </div>
      `;

      try {
        await sendEmail({
          email: ticket.email,
          subject: `[BlueBus] Phản hồi yêu cầu hỗ trợ: ${ticket.tieuDe}`,
          html: htmlContent
        });
      } catch (emailErr) {
        console.error('Lỗi gửi email cho khách:', emailErr);
      }
    }

    res.json({ message: 'Cập nhật yêu cầu hỗ trợ thành công', ticket });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật yêu cầu hỗ trợ', error: err.message });
  }
});

// ==========================================
// 10. CẤU HÌNH HỆ THỐNG (SYSTEM CONFIG)
// ==========================================

// Xem danh sách các phương thức thanh toán được hỗ trợ
router.get('/payment-methods', adminMiddleware, async (req, res) => {
  const methods = [
    { id: 'momo', name: 'Ví MoMo', type: 'E-Wallet' },
    { id: 'vnpay', name: 'Cổng VNPay', type: 'Payment Gateway' },
    { id: 'zalopay', name: 'Ví ZaloPay', type: 'E-Wallet' },
    { id: 'vietqr', name: 'Chuyển khoản VietQR', type: 'Bank Transfer' }
  ];
  res.json(methods);
});

// ============================================================
// VOUCHER MANAGEMENT (QUẢN LÝ MÃ GIẢM GIÁ)
// ============================================================

// @route   GET /api/admin/vouchers
// @desc    Lấy toàn bộ danh sách Voucher cho Admin
router.get('/vouchers', adminMiddleware, async (req, res) => {
  try {
    const vouchers = await Voucher.find().sort({ createdAt: -1 });
    res.json(vouchers);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách voucher', error: err.message });
  }
});

// @route   POST /api/admin/vouchers
// @desc    Tạo mới một Voucher
router.post('/vouchers', adminMiddleware, async (req, res) => {
  try {
    // Chấp nhận cả req.admin hoặc check role admin
    const isAdmin = req.admin || (req.user && req.user.role === 'admin');
    if (!isAdmin) {
      return res.status(403).json({ message: 'Chỉ Admin hệ thống mới có quyền quản lý ưu đãi.' });
    }

    const { maVoucher, tenVoucher, tenChuongTrinh, giaTriGiam, mucGiam, loaiGiamGia } = req.body;

    if (!maVoucher) {
      return res.status(400).json({ message: 'Vui lòng nhập mã voucher' });
    }

    const code = maVoucher.toUpperCase();
    const existing = await Voucher.findOne({ maVoucher: code });
    if (existing) return res.status(400).json({ message: 'Mã giảm giá này đã tồn tại' });

    const finalTenVoucher = tenVoucher || tenChuongTrinh || code;
    const finalGiaTriGiam = giaTriGiam !== undefined ? giaTriGiam : (mucGiam !== undefined ? mucGiam : 0);

    const newVoucher = new Voucher({
      ...req.body,
      maVoucher: code,
      tenVoucher: finalTenVoucher,
      giaTriGiam: finalGiaTriGiam
    });

    await newVoucher.save();
    res.status(201).json({ message: 'Tạo mã giảm giá thành công', voucher: newVoucher });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo voucher: ' + err.message });
  }
});

// @route   PUT /api/admin/vouchers/:id
// @desc    Cập nhật Voucher (CHỈ ADMIN)
router.put('/vouchers/:id', adminMiddleware, async (req, res) => {
  try {
    const isAdmin = req.admin || (req.user && req.user.role === 'admin');
    if (!isAdmin) {
      return res.status(403).json({ message: 'Chỉ Admin mới có quyền sửa mã giảm giá.' });
    }
    if (req.body.maVoucher) req.body.maVoucher = req.body.maVoucher.toUpperCase();
    const updatedVoucher = await Voucher.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    res.json({ message: 'Cập nhật thành công', voucher: updatedVoucher });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật voucher: ' + err.message });
  }
});

// @route   DELETE /api/admin/vouchers/:id
// @desc    Xóa Voucher (CHỈ ADMIN)
router.delete('/vouchers/:id', adminMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Chỉ Admin mới có quyền xóa mã giảm giá.' });
    }
    await Voucher.findByIdAndDelete(req.params.id);
    res.json({ message: 'Đã xóa mã giảm giá thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa voucher', error: err.message });
  }
});


// @route   GET /api/admin/notifications
// @desc    Lấy thông báo cho Admin (kèm số lượng chưa đọc)
router.get('/notifications', adminMiddleware, async (req, res) => {
  try {
    const ThongBao = require('../models/ThongBao');
    const notifications = await ThongBao.find({
      $or: [
        { isAdminOnly: true },
        { 'recipients.recipientModel': 'NhanVien' }
      ]
    }).sort({ createdAt: -1 }).limit(50);

    // Đảm bảo dữ liệu luôn có nội dung để FE hiển thị rõ ràng
    const formattedNotifications = notifications.map(n => {
      const doc = n.toObject();
      if (!doc.tieuDe || doc.tieuDe === 'Thông báo mới') {
        doc.tieuDe = doc.loai === 'support' ? 'Yêu cầu hỗ trợ mới' : 'Thông báo hệ thống';
      }
      return doc;
    });

    const unreadCount = await ThongBao.countDocuments({
      $or: [
        { isAdminOnly: true, 'recipients.isRead': false },
        { 'recipients.recipientModel': 'NhanVien', 'recipients.isRead': false }
      ]
    });

    res.json({ notifications: formattedNotifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy thông báo', error: err.message });
  }
});

// @route   PATCH /api/admin/notifications/:id/read
// @desc    Đánh dấu thông báo là đã đọc
router.patch('/notifications/:id/read', adminMiddleware, async (req, res) => {
  try {
    const ThongBao = require('../models/ThongBao');
    // Đánh dấu isRead = true cho người dùng hiện tại
    await ThongBao.updateOne(
        { _id: req.params.id, 'recipients.userId': req.user._id },
        { $set: { 'recipients.$.isRead': true } }
    );
    res.json({ message: 'Đã đánh dấu thông báo là đã đọc' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật thông báo', error: err.message });
  }
});

module.exports = router;
