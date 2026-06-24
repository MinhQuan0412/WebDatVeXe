const express = require('express');
const mongoose = require('mongoose');
const Ve = require('../models/Ve');
const HoaDon = require('../models/HoaDon');
const ChuyenXe = require('../models/ChuyenXe');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const sendEmail = require('../utils/sendEmail');
const generateQR = require('../utils/generateQR');
const ThongBao = require('../models/ThongBao');
const Voucher = require('../models/Voucher');
const router = express.Router();

// ✅ Helper: tìm booking bằng ObjectId hoặc maVe (VE-20260508-016)
const findBooking = (id) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return Ve.findById(id);
  }
  // Fallback: tìm theo maVe
  return Ve.findOne({ maVe: id });
};

// ============================================================
// @route   POST /api/bookings/hold-seats
// @desc    Giữ ghế tạm trước thanh toán (15 phút)
// ============================================================
router.post('/hold-seats', authMiddleware, async (req, res) => {
  try {
    const { chuyenXeId, danhSachGhe, hoTen, soDienThoai, email, diemDon, diemTra } = req.body;

    // 1. Kiểm tra đầu vào cơ bản
    if (!chuyenXeId || !danhSachGhe || danhSachGhe.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn chuyến xe và ít nhất 1 ghế' });
    }

    // 2. QUY TẮC: Tối đa 5 ghế
    if (danhSachGhe.length > 5) {
      return res.status(400).json({ message: 'Mỗi lần đặt vé bạn chỉ được chọn tối đa 5 ghế' });
    }

    // 3. QUY TẮC: Bắt buộc đầy đủ thông tin khách hàng và điểm đón/trả
    if (!hoTen || !soDienThoai || !email || !diemDon || !diemTra) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ: Họ tên, SĐT, Email và chọn Điểm đón/trả' });
    }

    if (!mongoose.Types.ObjectId.isValid(chuyenXeId)) {
      return res.status(400).json({ message: 'ID chuyến xe không hợp lệ' });
    }

    const trip = await ChuyenXe.findById(chuyenXeId).populate('tuyenXeId');
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    // Không cho đặt vé chuyến đã khởi hành
    if (trip.trangThai !== 'active' || new Date(trip.thoiGianKhoiHanh) < new Date()) {
      return res.status(400).json({ message: 'Chuyến xe đã khởi hành hoặc không còn hoạt động' });
    }

    // Dọn ghế hold đã hết hạn để giải phóng chỗ trống
    const now = new Date();
    const expiredHolds = await Ve.find({
      chuyenXeId,
      trangThai: 'hold',
      holdExpires: { $lt: now }
    });

    if (expiredHolds.length > 0) {
      const expiredSeats = expiredHolds.flatMap(h => h.danhSachGhe);
      await ChuyenXe.findByIdAndUpdate(chuyenXeId, {
        $pull: { gheDaDat: { $in: expiredSeats } }
      });
      await Ve.updateMany(
        { _id: { $in: expiredHolds.map(h => h._id) } },
        { trangThai: 'cancelled', ghiChu: '[Hệ thống: Tự động hủy do hết hạn 10 phút]' }
      );
      const io = req.app.get('io');
      if (io) {
        // Lấy lại trip để lấy ghế mới nhất, hoặc tự trừ mảng
        const currentTrip = await ChuyenXe.findById(chuyenXeId);
        io.to(chuyenXeId).emit('seatsUpdated', {
          chuyenXeId,
          bookedSeats: currentTrip ? currentTrip.gheDaDat : []
        });
      }
    }

    // THUẬT TOÁN CHỐNG TRANH CHẤP GHẾ (ATOMIC UPDATE):
    // Cố gắng thêm ghế vào danh sách gheDaDat chỉ khi toàn bộ ghế đó chưa tồn tại
    const updatedTrip = await ChuyenXe.findOneAndUpdate(
      {
        _id: chuyenXeId,
        gheDaDat: { $nin: danhSachGhe }, // Điều kiện: Không ghế nào trong danh sách bị trùng
        trangThai: 'active'
      },
      { $push: { gheDaDat: { $each: danhSachGhe } } },
      { new: true }
    );

    if (!updatedTrip) {
      return res.status(400).json({
        message: 'Ghế bạn chọn vừa có người khác đặt hoặc đang được giữ chỗ. Vui lòng chọn ghế khác!'
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(chuyenXeId).emit('seatsUpdated', {
        chuyenXeId: chuyenXeId,
        bookedSeats: updatedTrip.gheDaDat
      });
    }

    // Lấy giá vé từ Tuyến xe và tính tổng tiền
    const giaVeStr = trip.tuyenXeId.giaVe || "0";
    const giaVeNum = parseInt(giaVeStr.replace(/\D/g, '')) || 0;
    const tongTien = giaVeNum * danhSachGhe.length;

    // QUY TẮC: Giữ ghế trong 10 phút
    const holdExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Xử lý Voucher (nếu có) - ĐỒNG BỘ LOGIC CHẶT CHẼ
    let soTienGiam = 0;
    let maVoucherApplied = '';
    let voucherIdApplied = null;

    if (req.body.maVoucher) {
      console.log(`[BOOKING] Đang áp dụng Voucher: ${req.body.maVoucher} cho đơn hàng ${tongTien}đ`);
      const v = await Voucher.findOne({ maVoucher: req.body.maVoucher.toUpperCase(), trangThai: 'active' });

      if (v) {
        const now = new Date();
        let isValid = true;

        // Kiểm tra ngày & số lượng
        if (v.ngayBatDau && v.ngayBatDau > now) isValid = false;
        if (v.ngayHetHan && v.ngayHetHan < now) isValid = false;
        if (v.daSuDung >= v.soLuong) isValid = false;
        if (tongTien < v.giaTriToiThieu) isValid = false;

        // Kiểm tra khách mới
        if (isValid && v.choKhachHangMoi) {
          const count = await Ve.countDocuments({ khachHangId: req.user._id, trangThai: { $in: ['paid', 'confirmed', 'completed'] } });
          if (count > 0) isValid = false;
        }

        if (isValid) {
          if (v.loaiGiamGia === 'fixed') {
            soTienGiam = v.giaTriGiam;
          } else {
            soTienGiam = (tongTien * v.giaTriGiam) / 100;
            if (v.giamToiDa && soTienGiam > v.giamToiDa) soTienGiam = v.giamToiDa;
          }
          maVoucherApplied = v.maVoucher;
          voucherIdApplied = v._id;
          console.log(`[BOOKING] Áp dụng thành công! Giảm: ${soTienGiam}đ. Tiền cuối: ${tongTien - soTienGiam}đ`);
        } else {
          console.log(`[BOOKING] Voucher ${req.body.maVoucher} không đủ điều kiện áp dụng lúc này.`);
        }
      } else {
        console.log(`[BOOKING] Không tìm thấy Voucher: ${req.body.maVoucher}`);
      }
    }

    const generateMaVe = () => 'VE-' + Date.now();
    const maVe = await generateMaVe();
    // ✅ Tự động tìm địa chỉ chi tiết cho điểm đón/trả (Thông minh hơn)
    const findStopDetails = (name, stops) => {
      if (!name || !stops) return { tenDiem: name || 'Chưa xác định' };
      const nameStr = (typeof name === 'string' ? name : name.tenDiem)?.toLowerCase();

      // Tìm chính xác hoặc tìm gần đúng (chứa trong tên)
      const stop = stops.find(s =>
        s.tenDiem?.toLowerCase() === nameStr ||
        s.tenDiem?.toLowerCase().includes(nameStr) ||
        nameStr?.includes(s.tenDiem?.toLowerCase())
      );
      return stop ? { tenDiem: stop.tenDiem, diaChi: stop.diaChi, thoiGian: stop.thoiGian } : { tenDiem: name };
    };

    const stopsDon = trip.diemDon?.length ? trip.diemDon : (trip.tuyenXeId?.diemDon || []);
    const stopsTra = trip.diemTra?.length ? trip.diemTra : (trip.tuyenXeId?.diemTra || []);

    const finalDiemDon = findStopDetails(diemDon, stopsDon);
    const finalDiemTra = findStopDetails(diemTra, stopsTra);

    const booking = new Ve({
      khachHangId: req.user._id,
      chuyenXeId,
      danhSachGhe,
      tongTien: tongTien - soTienGiam,
      soTienGiam,
      maVoucher: maVoucherApplied,
      voucherId: voucherIdApplied,
      maVe,
      hoTen,
      soDienThoai,
      email,
      diemDon: finalDiemDon,
      diemTra: finalDiemTra,
      trangThai: 'hold',
      holdExpires
    });
    await booking.save();

    res.status(201).json({
      message: 'Đã giữ ghế thành công! Vui lòng hoàn tất thanh toán trong 10 phút.',
      bookingId: booking._id,
      maVe: booking.maVe,
      tongTien: booking.tongTien,
      holdExpires: holdExpires,
      booking: booking // ✅ Trả về đối tượng booking đầy đủ cho Frontend!
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi trong quá trình giữ ghế', error: err.message });
  }
});

// ============================================================
// @route   GET /api/bookings/search-by-code
// @desc    Đường dẫn phụ hỗ trợ FE tra cứu vé nhanh (qua query ?code=)
// ============================================================
router.get('/search-by-code', async (req, res) => {
  try {
    const maVe = req.query.code;
    if (!maVe) return res.status(400).json({ message: 'Thiếu mã vé' });

    console.log(`[SEARCH-BY-CODE] Đang tra cứu mã: "${maVe}"`);

    const booking = await Ve.findOne({
      maVe: { $regex: new RegExp(`^${maVe}$`, 'i') }
    })
      .populate({
        path: 'chuyenXeId',
        populate: [
          { path: 'tuyenXeId' },
          { path: 'xeId' }
        ]
      })
      .populate('khachHangId', 'hoTen soDienThoai email');

    if (!booking) {
      return res.status(404).json({ message: 'Không tìm thấy vé' });
    }

    res.json(booking);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tra cứu vé', error: err.message });
  }
});

// Alias cũ vẫn giữ để không lỗi các chỗ khác
router.get('/detail/:maVe', async (req, res) => {
  try {
    const rawCode = req.params.maVe;
    console.log(`[LOOKUP] Đang tìm kiếm mã vé: "${rawCode}"`);

    // Tìm kiếm không phân biệt hoa thường và linh hoạt hơn
    const booking = await Ve.findOne({
      maVe: { $regex: new RegExp(`^${rawCode.trim()}$`, 'i') }
    })
      .populate({
        path: 'chuyenXeId',
        populate: [
          { path: 'tuyenXeId' },
          { path: 'xeId' }
        ]
      })
      .populate('khachHangId', 'hoTen soDienThoai email');

    if (!booking) {
      console.log(`[LOOKUP] Không tìm thấy vé với mã: "${rawCode}"`);
      return res.status(404).json({ message: 'Không tìm thấy vé. Vui lòng kiểm tra lại mã vé.' });
    }

    console.log(`[LOOKUP] Tìm thấy vé: ${booking.maVe}, trạng thái: ${booking.trangThai}`);
    res.json(booking);
  } catch (err) {
    console.error('[LOOKUP] Lỗi:', err.message);
    res.status(500).json({ message: 'Lỗi lấy chi tiết vé', error: err.message });
  }
});

// ============================================================
// @route   GET /api/bookings/status/:maVe
// @desc    Kiểm tra trạng thái thanh toán (Public - không cần đăng nhập)
//          FE dùng để check sau khi chuyển khoản SePay xong
// ============================================================
router.get('/status/:maVe', async (req, res) => {
  try {
    const booking = await Ve.findOne({
      maVe: { $regex: new RegExp(`^${req.params.maVe.trim()}$`, 'i') }
    }).select('maVe trangThai phuongThucThanhToan tongTien');

    if (!booking) {
      return res.status(404).json({ message: 'Không tìm thấy vé' });
    }

    res.json({
      maVe: booking.maVe,
      trangThai: booking.trangThai,
      daDuocThanhToan: ['paid', 'confirmed'].includes(booking.trangThai)
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi kiểm tra trạng thái vé', error: err.message });
  }
});

// ============================================================
// @route   GET /api/bookings/lookup
// @desc    Tra cứu vé (không cần login)
// ============================================================
router.get('/lookup', async (req, res) => {
  try {
    const { bookingCode, phone } = req.query;

    if (!bookingCode || !phone) {
      return res.status(400).json({ message: 'Vui lòng nhập mã vé và số điện thoại' });
    }

    const booking = await Ve.findOne({ maVe: bookingCode })
      .populate({
        path: 'chuyenXeId',
        populate: { path: 'tuyenXeId' }
      })
      .populate('khachHangId', 'hoTen soDienThoai');

    if (!booking) {
      return res.status(404).json({ message: 'Không tìm thấy vé với mã này' });
    }

    // Kiểm tra số điện thoại khớp
    if (booking.khachHangId.soDienThoai !== phone) {
      return res.status(403).json({ message: 'Số điện thoại không khớp với vé' });
    }

    res.json(booking);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tra cứu vé', error: err.message });
  }
});

// ============================================================
// @route   GET /api/bookings/my-invoices
// @desc    Lấy danh sách HÓA ĐƠN của tôi
// ============================================================
router.get('/my-invoices', authMiddleware, async (req, res) => {
  try {
    const invoices = await HoaDon.find({ khachHangId: req.user._id })
      .populate({
        path: 'veId',
        populate: { path: 'chuyenXeId', populate: { path: 'tuyenXeId' } }
      })
      .sort({ createdAt: -1 });

    res.json(invoices);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy danh sách hóa đơn', error: err.message });
  }
});

// ============================================================
// @route   GET /api/bookings/my-bookings
// @desc    Lấy danh sách vé CỦA TÔI
// ============================================================
router.get('/my-bookings', authMiddleware, async (req, res) => {
  try {
    const bookings = await Ve.find({ khachHangId: req.user._id })
      .populate({
        path: 'chuyenXeId',
        populate: { path: 'tuyenXeId' }
      })
      .sort({ createdAt: -1 });
    const formattedBookings = bookings.map(b => {
      const booking = b.toObject();
      booking.soLuongGhe = booking.danhSachGhe ? booking.danhSachGhe.length : 0;
      return booking;
    });
    res.json(formattedBookings);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy lịch sử đặt vé', error: err.message });
  }
});

// ============================================================
// @route   POST /api/bookings
// @desc    Đặt vé mới
// ============================================================
// BƯỚC 2: Tạo đơn đặt vé (tất cả trong 1 request)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      chuyenXeId, danhSachGhe,
      hoTen, soDienThoai, email,
      diemDon, diemTra          // có thể truyền string hoặc object
    } = req.body;
    if (!chuyenXeId || !danhSachGhe || danhSachGhe.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn chuyến xe và ghế' });
    }

    // VALIDATE THÔNG TIN LIÊN HỆ
    if (!soDienThoai && !req.user.soDienThoai) {
      return res.status(400).json({ message: 'Vui lòng cung cấp số điện thoại liên hệ' });
    }

    if (soDienThoai && !/^(0[3|5|7|8|9])+([0-9]{8})$/.test(soDienThoai)) {
      return res.status(400).json({ message: 'Số điện thoại không hợp lệ (Phải là số ĐT Việt Nam)' });
    }
    if (!mongoose.Types.ObjectId.isValid(chuyenXeId)) {
      return res.status(400).json({ message: 'ID chuyến xe không hợp lệ' });
    }
    const trip = await ChuyenXe.findById(chuyenXeId).populate('tuyenXeId');
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    if (trip.trangThai !== 'active') {
      return res.status(400).json({ message: 'Chuyến xe không còn hoạt động' });
    }
    if (new Date(trip.thoiGianKhoiHanh) < new Date()) {
      return res.status(400).json({ message: 'Không thể đặt vé chuyến đã khởi hành' });
    }

    // ✅ Validate diemDon/diemTra phải nằm trong danh sách stops của chuyến/tuyến
    const stopsDon = trip.diemDon?.length ? trip.diemDon : (trip.tuyenXeId?.diemDon || []);
    const stopsTra = trip.diemTra?.length ? trip.diemTra : (trip.tuyenXeId?.diemTra || []);

    if (diemDon && stopsDon.length > 0) {
      const tenDon = typeof diemDon === 'string' ? diemDon : diemDon.tenDiem;
      const valid = stopsDon.some(s => s.tenDiem?.toLowerCase() === tenDon?.toLowerCase());
      if (!valid) {
        return res.status(400).json({
          message: `Điểm đón "${tenDon}" không hợp lệ`,
          diemDonHopLe: stopsDon.map(s => s.tenDiem)
        });
      }
    }

    if (diemTra && stopsTra.length > 0) {
      const tenTra = typeof diemTra === 'string' ? diemTra : diemTra.tenDiem;
      const valid = stopsTra.some(s => s.tenDiem?.toLowerCase() === tenTra?.toLowerCase());
      if (!valid) {
        return res.status(400).json({
          message: `Điểm trả "${tenTra}" không hợp lệ`,
          diemTraHopLe: stopsTra.map(s => s.tenDiem)
        });
      }
    }

    // ✅ Kiểm tra user đã hold ghế này chưa → nếu có thì upgrade hold → pending

    const existingHold = await Ve.findOne({
      khachHangId: req.user._id,
      chuyenXeId,
      trangThai: 'hold',
      holdExpires: { $gt: new Date() } // còn hạn
    });

    if (existingHold) {
      // Kiểm tra ghế trong hold có khớp không
      const holdSeats = existingHold.danhSachGhe;
      const sameSeat = danhSachGhe.every(s => holdSeats.includes(s)) && danhSachGhe.length === holdSeats.length;

      if (sameSeat) {
        // Upgrade hold → pending + cập nhật thêm thông tin
        existingHold.trangThai = 'pending';
        existingHold.holdExpires = undefined;
        if (hoTen) existingHold.hoTen = hoTen;
        if (soDienThoai) existingHold.soDienThoai = soDienThoai;
        if (email) existingHold.email = email;
        if (diemDon) existingHold.diemDon = typeof diemDon === 'string' ? { tenDiem: diemDon } : diemDon;
        if (diemTra) existingHold.diemTra = typeof diemTra === 'string' ? { tenDiem: diemTra } : diemTra;
        await existingHold.save();

        return res.status(201).json({
          message: 'Đã chuyển đặt giữ chỗ thành đơn đặt vé',
          bookingId: existingHold._id,
          maVe: existingHold.maVe,
          tongTien: existingHold.tongTien,
          soLuongVe: existingHold.danhSachGhe.length,
          danhSachGhe: existingHold.danhSachGhe,
          tongSoGhe: existingHold.danhSachGhe.length,
          diemDon: existingHold.diemDon,
          diemTra: existingHold.diemTra,
          trangThai: existingHold.trangThai
        });
      }
    }

    // Case 2: Đặt vé trực tiếp không qua hold
    // THUẬT TOÁN CHỐNG TRANH CHẤP GHẾ (ATOMIC UPDATE)
    const updatedTrip = await ChuyenXe.findOneAndUpdate(
      {
        _id: chuyenXeId,
        gheDaDat: { $nin: danhSachGhe }, // Điều kiện: Không ghế nào trong danh sách bị trùng
        trangThai: 'active'
      },
      { $push: { gheDaDat: { $each: danhSachGhe } } },
      { new: true }
    );

    if (!updatedTrip) {
      return res.status(400).json({
        message: 'Ghế bạn chọn vừa có người khác đặt hoặc đang được giữ chỗ. Vui lòng chọn ghế khác!'
      });
    }

    // Bắn sự kiện socket cập nhật lại toàn bộ ghế
    const io = req.app.get('io');
    if (io) {
      io.to(chuyenXeId).emit('seatsUpdated', {
        chuyenXeId: chuyenXeId,
        bookedSeats: updatedTrip.gheDaDat
      });
    }

    const tongTien = updatedTrip.giaVe * danhSachGhe.length;

    // Parse diemDon/diemTra: hỗ trợ string hoặc object
    const parsedDiemDon = diemDon
      ? (typeof diemDon === 'string' ? { tenDiem: diemDon } : diemDon)
      : undefined;
    const parsedDiemTra = diemTra
      ? (typeof diemTra === 'string' ? { tenDiem: diemTra } : diemTra)
      : undefined;

    const booking = new Ve({
      khachHangId: req.user._id,
      chuyenXeId,
      danhSachGhe,
      tongTien,
      hoTen: hoTen || req.user.hoTen,
      soDienThoai: soDienThoai || req.user.soDienThoai,
      ...(parsedDiemDon && { diemDon: parsedDiemDon }),
      ...(parsedDiemTra && { diemTra: parsedDiemTra }),
      trangThai: 'pending'
    });

    await booking.save();

    res.status(201).json({
      message: 'Tạo đơn đặt vé thành công',
      bookingId: booking._id,
      maVe: booking.maVe,
      tongTien: booking.tongTien,
      soLuongVe: booking.danhSachGhe.length,
      danhSachGhe: booking.danhSachGhe,
      tongSoGhe: booking.danhSachGhe.length,
      diemDon: booking.diemDon,
      diemTra: booking.diemTra,
      trangThai: booking.trangThai
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi đặt vé', error: err.message });
  }
});

// ============================================================
// @route   GET /api/bookings/:bookingId
// @desc    Xem chi tiết một vé cụ thể
// ============================================================
router.get('/:bookingId', authMiddleware, async (req, res) => {
  try {
    let query;
    if (mongoose.Types.ObjectId.isValid(req.params.bookingId)) {
      query = Ve.findById(req.params.bookingId);
    } else {
      query = Ve.findOne({ maVe: req.params.bookingId });
    }

    const booking = await query
      .populate({
        path: 'chuyenXeId',
        populate: { path: 'tuyenXeId' }
      });

    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });

    if (booking.khachHangId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền xem vé này' });
    }

    const bookingObj = booking.toObject();
    bookingObj.soLuongGhe = bookingObj.danhSachGhe ? bookingObj.danhSachGhe.length : 0;

    res.json(bookingObj);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy chi tiết vé', error: err.message });
  }
});

// ============================================================
// @route   PUT /api/bookings/:bookingId/pickup-dropoff
// @desc    Chọn/đổi điểm đón trả
// ============================================================
// BƯỚC 3: Chọn điểm đón/trả
router.put('/:bookingId/pickup-dropoff', authMiddleware, async (req, res) => {
  try {
    const { diemDon, diemTra } = req.body;
    const booking = await findBooking(req.params.bookingId);

    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });
    if (booking.khachHangId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền cập nhật vé này' });
    }
    if (['cancelled', 'refunded'].includes(booking.trangThai)) {
      return res.status(400).json({ message: 'Không thể cập nhật vé đã hủy' });
    }
    if (['paid', 'confirmed', 'completed'].includes(booking.trangThai)) {
      return res.status(400).json({ message: 'Không thể thay đổi điểm đón/trả sau khi đã thanh toán' });
    }

    // ✅ Tự động tìm địa chỉ chi tiết từ danh sách trạm của chuyến/tuyến
    const trip = await ChuyenXe.findById(booking.chuyenXeId).populate('tuyenXeId');
    const stopsDon = trip.diemDon?.length ? trip.diemDon : (trip.tuyenXeId?.diemDon || []);
    const stopsTra = trip.diemTra?.length ? trip.diemTra : (trip.tuyenXeId?.diemTra || []);

    const findStopDetails = (name, stops) => {
      if (!name || !stops) return { tenDiem: name };
      const nameStr = typeof name === 'string' ? name : name.tenDiem;
      const stop = stops.find(s => s.tenDiem?.toLowerCase() === nameStr?.toLowerCase());
      return stop ? { tenDiem: stop.tenDiem, diaChi: stop.diaChi, thoiGian: stop.thoiGian } : { tenDiem: nameStr };
    };

    if (diemDon) {
      booking.diemDon = findStopDetails(diemDon, stopsDon);
    }
    if (diemTra) {
      booking.diemTra = findStopDetails(diemTra, stopsTra);
    }
    await booking.save();

    res.json({
      message: 'Cập nhật điểm đón/trả thành công',
      bookingId: booking._id,
      diemDon: booking.diemDon,
      diemTra: booking.diemTra
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật điểm đón/trả', error: err.message });
  }
});

// ============================================================
// @route   POST /api/bookings/:bookingId/pay
// @desc    Thanh toán vé theo phương thức đã chọn
// ============================================================
// BƯỚC 4: Thanh toán
router.post('/:bookingId/pay', authMiddleware, async (req, res) => {
  try {
    const { phuongThucThanhToan, maGiaoDich } = req.body;
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });

    if (booking.khachHangId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền thanh toán vé này' });
    }
    if (!['hold', 'pending'].includes(booking.trangThai)) {
      return res.status(400).json({ message: 'Vé đã thanh toán hoặc đã hủy' });
    }
    if (booking.trangThai === 'hold' && booking.holdExpires < new Date()) {
      booking.trangThai = 'cancelled';
      await booking.save();
      return res.status(400).json({ message: 'Thời gian giữ ghế đã hết hạn, vui lòng đặt lại' });
    }

    const allowedMethods = ['Sepay', 'Paypal', 'Momo', 'VnPay', 'Chuyển khoản'];
    if (!allowedMethods.includes(phuongThucThanhToan)) {
      return res.status(400).json({ message: 'Phương thức thanh toán không hợp lệ' });
    }

    booking.trangThai = 'paid';
    booking.phuongThucThanhToan = phuongThucThanhToan;
    if (maGiaoDich) booking.maGiaoDich = maGiaoDich;
    booking.holdExpires = undefined;
    await booking.save();

    // Tăng lượt sử dụng voucher nếu có
    if (booking.voucherId) {
      await Voucher.findByIdAndUpdate(booking.voucherId, { $inc: { daSuDung: 1 } });
    }

    // Tạo hóa đơn
    const hoaDon = new HoaDon({
      veId: booking._id,
      khachHangId: req.user._id,
      tongTien: booking.tongTien,
      phuongThucThanhToan,
      trangThai: 'completed'
    });
    await hoaDon.save();

    // ✅ TẠO FILE PDF VÉ XE VÀ GỬI EMAIL XÁC NHẬN
    try {
      const trip = await ChuyenXe.findById(booking.chuyenXeId).populate('tuyenXeId');
      const PDFDocument = require('pdfkit');

      // Tạo buffer để chứa PDF
      const chunks = [];
      const doc = new PDFDocument({ margin: 50 });

      doc.on('data', chunk => chunks.push(chunk));

      // Nội dung PDF (Sử dụng font chuẩn, lưu ý tiếng Việt có thể cần font riêng nếu muốn đẹp hơn)
      doc.fontSize(25).text('VE XE KHACH BLUEBUS', { align: 'center' });
      doc.moveDown();
      doc.fontSize(16).text(`Ma ve: ${booking.maVe}`);
      doc.text(`Ho ten: ${booking.hoTen}`);
      doc.text(`So dien thoai: ${booking.soDienThoai}`);
      doc.text(`Tuyen duong: ${trip.tuyenXeId.diemDi} - ${trip.tuyenXeId.diemDen}`);
      doc.text(`Ngay khoi hanh: ${new Date(trip.thoiGianKhoiHanh).toLocaleString('vi-VN')}`);
      doc.text(`So ghe: ${booking.danhSachGhe.join(', ')}`);
      doc.text(`Tong tien: ${booking.tongTien.toLocaleString()} VND`);
      doc.moveDown();
      doc.fontSize(12).text('Cam on quy khach da su dung dich vu cua BlueBus!', { align: 'center', italic: true });

      doc.end();

      // Đợi PDF tạo xong
      const pdfBuffer = await new Promise((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
      });

      await sendEmail({
        email: booking.email || req.user.email,
        subject: `[BlueBus] Xác nhận đặt vé thành công - Mã vé: ${booking.maVe}`,
        html: `
                <div style="font-family: Arial, sans-serif; border: 1px solid #ef5222; padding: 20px; border-radius: 10px; max-width: 600px; margin: auto;">
                    <h2 style="color: #ef5222;">BLUE BUS - XÁC NHẬN ĐẶT VÉ</h2>
                    <p>Chào <b>${booking.hoTen}</b>,</p>
                    <p>Cảm ơn bạn đã đặt vé tại BlueBus. Chúng tôi xin gửi kèm vé điện tử (file PDF) trong email này.</p>
                    <p><b>Mã vé của bạn:</b> <span style="font-size: 20px; color: #ef5222;">${booking.maVe}</span></p>
                    <p>Vui lòng xuất trình mã vé hoặc file PDF đính kèm khi lên xe.</p>
                    <hr/>
                    <p style="font-size: 12px; color: #666;">Đây là email tự động, vui lòng không phản hồi.</p>
                </div>
            `,
        attachments: [
          {
            filename: `VeXe_BlueBus_${booking.maVe}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      });
    } catch (emailErr) {
      console.error('Lỗi tạo PDF hoặc gửi email xác nhận:', emailErr);
    }

    // ✅ EMIT SOCKET payment_confirmed để FE redirect ngay lập tức
    const io = req.app.get('io');
    if (io) {
      io.emit('payment_confirmed', {
        maVe: booking.maVe,
        bookingId: booking._id,
        trangThai: 'paid'
      });
      console.log(`[SOCKET] Đã emit payment_confirmed cho vé ${booking.maVe}`);
    }

    res.json({
      message: 'Thanh toán thành công',
      bookingId: booking._id,
      maVe: booking.maVe,
      tongTien: booking.tongTien,
      phuongThucThanhToan,
      maGiaoDich: booking.maGiaoDich,
      trangThai: booking.trangThai,
      invoiceId: hoaDon._id,
      invoiceNo: hoaDon.maHoaDon
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi thanh toán vé', error: err.message });
  }
});

// ============================================================
// @route   POST /api/bookings/:bookingId/confirm
// @desc    Xác nhận thanh toán (Admin/Webhook) — vé chính thức có hiệu lực
// ============================================================
// BƯỚC 5:// ✅ Xác nhận thanh toán (Admin/Webhook) — vé chính thức có hiệu lực
const confirmMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Cần đăng nhập hoặc quyền admin' });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Kiểm tra role admin từ token hoặc kiểm tra xem có phải NhanVien không
    const NhanVien = require('../models/NhanVien');
    const isAdmin = await NhanVien.exists({ _id: decoded.id });
    req.isAdmin = !!isAdmin || decoded.role === 'admin';

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

router.post('/:bookingId/confirm', confirmMiddleware, async (req, res) => {
  try {
    const { maGiaoDich, ghiChu, trangThaiMoi } = req.body;

    const booking = await findBooking(req.params.bookingId)
      .populate({ path: 'chuyenXeId', populate: { path: 'tuyenXeId' } });

    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });
    const oldStatus = booking.trangThai;

    // Admin confirm bất kỳ vé; user chỉ confirm vé của mình
    if (!req.isAdmin && booking.khachHangId.toString() !== req.user._id?.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền xác nhận vé này' });
    }

    if (booking.trangThai !== 'paid') {
      return res.status(400).json({
        message: `Không thể xác nhận vé đang ở trạng thái "${booking.trangThai}". Vé phải ở trạng thái "paid".`
      });
    }

    // Chỉ cho phép chuyển sang confirmed hoặc completed
    const validNextStatus = ['confirmed', 'completed'];
    const nextStatus = trangThaiMoi && validNextStatus.includes(trangThaiMoi)
      ? trangThaiMoi
      : 'confirmed'; // mặc định nếu không truyền

    if (maGiaoDich) booking.maGiaoDich = maGiaoDich;
    if (ghiChu) booking.ghiChu = ghiChu;
    booking.trangThai = nextStatus;
    await booking.save();

    // Tăng lượt sử dụng voucher nếu có (nếu chưa tăng ở bước pay)
    if (booking.voucherId) {
      const v = await Voucher.findById(booking.voucherId);
      if (v) {
        // Kiểm tra xem vé này đã được tính vào daSuDung chưa? 
        // Ở đây ta đơn giản là tăng nếu chuyển từ trạng thái chưa thanh toán sang đã thanh toán.
        // Tuy nhiên, logic chuẩn hơn là kiểm tra xem status cũ là gì.
        // Trong project này, confirm thường gọi sau khi đã paid, nhưng cũng có thể gọi trực tiếp từ pending.
        if (['pending', 'hold'].includes(oldStatus)) {
          v.daSuDung += 1;
          await v.save();
        }
      }
    }

    // Cập nhật hóa đơn liên quan
    await HoaDon.findOneAndUpdate({ veId: booking._id }, { trangThai: 'completed' });

    // ✅ GỬI EMAIL XÁC NHẬN (Ngay sau khi Admin hoặc Webhook xác nhận)
    try {
      await sendEmail({
        email: booking.email,
        subject: `[BlueBus] Xác nhận vé xe thành công - Mã vé: ${booking.maVe}`,
        html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid #ef5222; padding: 0; border-radius: 15px; max-width: 500px; margin: auto; overflow: hidden; background-color: #fff;">
                    <div style="background-color: #ef5222; color: white; padding: 20px; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">BLUE BUS</h1>
                    </div>
                    <div style="padding: 25px; color: #333;">
                        <p>Chào <b>${booking.hoTen}</b>,</p>
                        <p>Giao dịch của bạn đã được xác nhận thành công. Đây là vé điện tử của bạn:</p>
                        
                        <div style="background-color: #f9f9f9; border-left: 4px solid #ef5222; padding: 15px; margin: 20px 0;">
                            <p style="margin: 5px 0;"><b>Mã vé:</b> <span style="color: #ef5222; font-weight: bold;">${booking.maVe}</span></p>
                            <p style="margin: 5px 0;"><b>Tuyến:</b> ${booking.chuyenXeId?.tuyenXeId?.diemDi} -> ${booking.chuyenXeId?.tuyenXeId?.diemDen}</p>
                            <p style="margin: 5px 0;"><b>Giờ khởi hành:</b> ${new Date(booking.chuyenXeId?.thoiGianKhoiHanh).toLocaleString('vi-VN')}</p>
                            <p style="margin: 5px 0;"><b>Số ghế:</b> ${booking.danhSachGhe.join(', ')}</p>
                        </div>

                        <div style="text-align: center; margin: 30px 0;">
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent((process.env.FRONTEND_URL || 'http://localhost:5173') + '/hoa-don?code=' + booking.maVe)}" 
                                 alt="QR Code" style="width: 200px; height: 200px; border-radius: 10px;" />
                        </div>
                    </div>
                </div>
            `
      });
    } catch (err) {
      console.error('Lỗi gửi mail xác nhận sau confirm:', err);
    }

    res.json({
      message: nextStatus === 'completed'
        ? 'Vé đã hoàn thành — ghế chính thức bị khóa vĩnh viễn'
        : 'Xác nhận thanh toán thành công',
      maVe: booking.maVe,
      bookingId: booking._id,
      trangThai: booking.trangThai,
      maGiaoDich: booking.maGiaoDich,
      ghiChu: booking.ghiChu,
      chuyenXe: booking.chuyenXeId
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xác nhận vé', error: err.message });
  }
});

// ============================================================
// ============================================================
// @route   POST /api/bookings/:bookingId/payment-intent
// @desc    Gia hạn thêm 10 phút khi khách bắt đầu bấm thanh toán
// ============================================================
router.post('/:bookingId/payment-intent', authMiddleware, async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });

    if (booking.khachHangId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện trên vé này' });
    }
    if (booking.trangThai !== 'pending') {
      return res.status(400).json({ message: 'Vé không ở trạng thái pending' });
    }

    // Gia hạn thêm 10 phút từ hiện tại
    booking.holdExpires = new Date(Date.now() + 10 * 60 * 1000);
    await booking.save();

    res.json({
      message: 'Đã gia hạn thời gian thanh toán thêm 10 phút',
      holdExpires: booking.holdExpires
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tạo payment intent', error: err.message });
  }
});

// ============================================================
// @route   POST /api/bookings/:id/cancel
// @desc    Hủy vé (Chủ động hủy bởi khách hàng - Cần lý do + trước giờ chạy ít nhất 2 tiếng)
// ============================================================
router.post('/:id/cancel', authMiddleware, async (req, res) => {
  let booking;
  const sendFailureEmail = async (b, reason) => {
    if (!b || !b.email) return;
    try {
      await sendEmail({
        email: b.email,
        subject: `[BlueBus] Thông báo hủy vé không thành công - Mã vé: ${b.maVe}`,
        html: `
          <div style="font-family: Arial, sans-serif; border: 1px solid #d9534f; padding: 20px; border-radius: 10px; max-width: 600px; margin: auto;">
              <h2 style="color: #d9534f; text-align: center;">HỦY VÉ KHÔNG THÀNH CÔNG</h2>
              <p>Chào <b>${b.hoTen}</b>,</p>
              <p>Hệ thống ghi nhận bạn vừa gửi yêu cầu hủy vé xe mã: <b>${b.maVe}</b> nhưng không thành công.</p>
              <div style="background-color: #fcf8e3; border: 1px solid #faebcc; color: #8a6d3b; padding: 15px; margin: 15px 0; border-radius: 4px;">
                  <p><b>Lý do từ chối hủy:</b> ${reason}</p>
              </div>
              <p>Theo chính sách của BlueBus, quý khách chỉ có thể tự hủy vé trực tuyến trước giờ khởi hành ít nhất 2 tiếng và phải cung cấp lý do hợp lệ (tối thiểu 5 ký tự).</p>
              <p>Nếu quý khách cần hỗ trợ gấp hoặc cho rằng có sự nhầm lẫn, vui lòng liên hệ ngay với Hotline của chúng tôi.</p>
              <p>Trân trọng,<br/>Đội ngũ hỗ trợ BlueBus</p>
          </div>
        `
      });
    } catch (mailErr) {
      console.error('Lỗi gửi mail hủy thất bại:', mailErr);
    }
  };

  try {
    const rawLyDo = req.body.lyDoHuy || req.body.reason || req.body.lyDo || req.body.cancelReason || req.body.ghiChu;
    const lyDoHuy = (rawLyDo && typeof rawLyDo === 'string' && rawLyDo.trim().length >= 5)
      ? rawLyDo.trim()
      : 'Khách hàng chủ động hủy';
    booking = await findBooking(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });

    if (booking.khachHangId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Bạn không có quyền hủy vé này' });
    }

    // 1. Không thể hủy vé đã hoàn thành (đã đi) hoặc đã hoàn tiền hoặc đã hủy trước đó
    if (booking.trangThai === 'completed') {
      const errMsg = 'Vé đã được sử dụng (Hoàn thành), không thể hủy.';
      await sendFailureEmail(booking, errMsg);
      return res.status(400).json({ message: errMsg });
    }
    if (booking.trangThai === 'refunded') {
      const errMsg = 'Vé đã được hoàn tiền trước đó.';
      await sendFailureEmail(booking, errMsg);
      return res.status(400).json({ message: errMsg });
    }
    if (booking.trangThai === 'cancelled') {
      const errMsg = 'Vé này đã được hủy rồi.';
      await sendFailureEmail(booking, errMsg);
      return res.status(400).json({ message: errMsg });
    }

    const trip = await ChuyenXe.findById(booking.chuyenXeId);
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy thông tin chuyến xe.' });

    const now = new Date();
    const departureTime = new Date(trip.thoiGianKhoiHanh);

    // 2. Không thể hủy vé nếu chuyến xe đã khởi hành
    if (now >= departureTime) {
      const errMsg = 'Chuyến xe đã khởi hành, không thể hủy vé.';
      await sendFailureEmail(booking, errMsg);
      return res.status(400).json({ message: errMsg });
    }

    // 3. Quy tắc 2 tiếng: Phải hủy trước giờ khởi hành ít nhất 120 phút
    const diffInMinutes = (departureTime - now) / (1000 * 60);
    if (diffInMinutes < 120) {
      const errMsg = 'Phải thực hiện hủy vé trước ít nhất 2 tiếng trước giờ khởi hành. Vui lòng liên hệ hotline để được hỗ trợ.';
      await sendFailureEmail(booking, errMsg);
      return res.status(400).json({ message: errMsg });
    }

    // 4. Bắt buộc cung cấp lý do hủy vé hợp lệ
    // Đã tự động gán mặc định 'Khách hàng chủ động hủy' nếu không cung cấp hoặc quá ngắn, đảm bảo vé đủ điều kiện được hủy thành công.

    // ✅ Nếu thỏa mãn các điều kiện trên -> Thực hiện hủy và giải phóng ghế
    const updatedTrip = await ChuyenXe.findByIdAndUpdate(
      booking.chuyenXeId,
      { $pull: { gheDaDat: { $in: booking.danhSachGhe } } },
      { new: true }
    );

    booking.trangThai = 'cancelled';
    booking.holdExpires = undefined;
    booking.ghiChu = (booking.ghiChu || '') + ` [Khách hàng tự hủy - Lý do: ${lyDoHuy}]`;
    await booking.save();

    // ✅ Đồng bộ hóa trạng thái Hóa Đơn (HoaDon) tương ứng sang 'cancelled'
    await HoaDon.findOneAndUpdate({ veId: booking._id }, { trangThai: 'cancelled' });

    // ✅ GỬI EMAIL THÔNG BÁO HỦY THÀNH CÔNG VỚI TEMPLATE CHUYÊN NGHIỆP
    try {
      await sendEmail({
        email: booking.email,
        subject: `[BlueBus] Thông báo hủy vé thành công - Mã vé: ${booking.maVe}`,
        html: `
                <div style="font-family: Arial, sans-serif; border: 1px solid #ef5222; padding: 20px; border-radius: 10px; max-width: 600px; margin: auto;">
                    <h2 style="color: #ef5222; text-align: center;">HỦY VÉ THÀNH CÔNG</h2>
                    <p>Chào <b>${booking.hoTen}</b>,</p>
                    <p>Hệ thống xác nhận bạn đã hủy thành công vé xe mã: <b>${booking.maVe}</b>.</p>
                    <div style="background-color: #f9f9f9; padding: 15px; margin: 15px 0; border-left: 4px solid #ef5222;">
                        <p><b>Mã vé:</b> ${booking.maVe}</p>
                        <p><b>Lý do hủy:</b> ${lyDoHuy}</p>
                        <p><b>Danh sách ghế trả lại:</b> ${booking.danhSachGhe.join(', ')}</p>
                    </div>
                    <p>Nếu bạn đã thanh toán, hệ thống sẽ tiến hành hoàn tiền tự động theo chính sách của BlueBus trong vòng 3-5 ngày làm việc.</p>
                    <p>Cảm ơn bạn đã đồng hành cùng BlueBus. Rất mong được phục vụ quý khách trong những hành trình tiếp theo!</p>
                </div>
            `
      });
    } catch (err) {
      console.error('Lỗi gửi mail hủy thành công:', err);
    }

    // ✅ TẠO THÔNG BÁO CHO ADMIN khi khách hủy vé thành công
    try {
      const thongBao = new ThongBao({
        tieuDe: `Khách hủy vé ${booking.maVe}`,
        noiDung: `${booking.hoTen} vừa hủy vé ${booking.maVe}. Lý do: ${lyDoHuy}. Ghế trả lại: ${booking.danhSachGhe.join(', ')}.`,
        loai: 'cancel',
        sender: booking.hoTen,
        isAdminOnly: true,
        metadata: {
          maVe: booking.maVe,
          bookingId: booking._id,
          lyDoHuy,
          gheTraLai: booking.danhSachGhe,
          link: '/admin/ve'
        }
      });
      await thongBao.save();
      console.log(`[NOTIFY] Đã tạo thông báo admin cho vé hủy: ${booking.maVe}`);
    } catch (notifyErr) {
      console.error('Lỗi tạo thông báo admin khi hủy vé:', notifyErr);
    }

    // ✅ EMIT EVENT booking_cancelled VIA SOCKET (kèm đầy đủ thông tin để FE hiển thị toast)
    const io = req.app.get('io');
    if (io) {
      const socketPayload = {
        bookingId: booking._id,
        maVe: booking.maVe,
        lyDo: lyDoHuy,
        gheTraLai: booking.danhSachGhe,
        chuyenXeId: booking.chuyenXeId
      };
      // Broadcast tới toàn bộ hệ thống (admin nhận real-time)
      io.emit('booking_cancelled', socketPayload);
      // Gửi riêng vào room của chuyến xe
      io.to(booking.chuyenXeId.toString()).emit('booking_cancelled', socketPayload);
      console.log(`[SOCKET] Đã emit booking_cancelled cho vé ${booking.maVe}`);
    }

    res.json({
      message: 'Đã hủy vé thành công',
      bookingId: booking._id,
      maVe: booking.maVe,
      gheTraLai: booking.danhSachGhe,
      trangThai: 'cancelled'
    });
  } catch (err) {
    if (booking) {
      await sendFailureEmail(booking, `Lỗi máy chủ khi xử lý hủy vé: ${err.message}`);
    }
    res.status(500).json({ message: 'Lỗi hủy vé', error: err.message });
  }
});

// ============================================================
// @route   GET /api/bookings/:bookingId/pdf
// @desc    Tải vé điện tử (PDF) - PHIÊN BẢN PREMIUM CÓ QR
// ============================================================
router.get('/:bookingId/pdf', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const QRCode = require('qrcode');

    const booking = await findBooking(req.params.bookingId).populate({
      path: 'chuyenXeId',
      populate: [
        { path: 'tuyenXeId' },
        { path: 'xeId' }
      ]
    }).populate('diemDon diemTra');

    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });

    const doc = new PDFDocument({ size: 'A4', margin: 40 }); // Đổi sang A4 cho rộng rãi, đẹp

    res.setHeader('Content-Disposition', `attachment; filename=Ve_BlueBus_${booking.maVe}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    // Font Tiếng Việt
    const fontPath = 'C:\\Windows\\Fonts\\arial.ttf';
    const fontBoldPath = 'C:\\Windows\\Fonts\\arialbd.ttf';
    doc.font(fontPath);

    // --- BACKGROUND & BORDER ---
    doc.rect(20, 20, 555, 700).lineWidth(1).strokeColor('#eee').stroke();

    // --- HEADER ---
    doc.fillColor('#ef5222').font(fontBoldPath).fontSize(30).text('BLUE BUS', { align: 'center' });
    doc.fillColor('#666').font(fontPath).fontSize(10).text('HỆ THỐNG ĐẶT VÉ XE KHÁCH CHẤT LƯỢNG CAO', { align: 'center' });
    doc.moveDown();

    doc.strokeColor('#ef5222').lineWidth(2).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown();

    // --- THÔNG TIN MUA VÉ ---
    doc.fillColor('#333').font(fontBoldPath).fontSize(16).text('THÔNG TIN VÉ XE', { align: 'center' });
    doc.moveDown();

    // Vẽ khung bo góc cho phần mã QR (giả lập Card)
    const startY = doc.y;
    doc.roundedRect(150, startY, 300, 320, 10).lineWidth(0.5).strokeColor('#ddd').stroke();

    // Tạo QR Code
    const qrData = `VE:${booking.maVe}|GHE:${booking.danhSachGhe?.join(',')}`;
    const qrImageBuffer = await QRCode.toBuffer(qrData, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 150,
      color: { dark: '#000000', light: '#ffffff' }
    });

    doc.image(qrImageBuffer, 225, startY + 20, { width: 150 });

    doc.fillColor('#000').fontSize(14).text(`Mã vé: ${booking.maVe}`, 200, startY + 180, { align: 'center', width: 200 });
    doc.fillColor('#ef5222').fontSize(16).text(`Số ghế: ${booking.danhSachGhe?.join(', ')}`, 200, startY + 210, { align: 'center', width: 200 });

    // --- CHI TIẾT LỘ TRÌNH ---
    doc.fillColor('#444').font(fontPath).fontSize(11);
    let currentY = startY + 250;

    doc.font(fontBoldPath).text('Hành khách:', 170, currentY);
    doc.font(fontPath).text(booking.hoTen, 250, currentY);

    currentY += 20;
    doc.font(fontBoldPath).text('Tuyến xe:', 170, currentY);
    doc.font(fontPath).text(`${booking.chuyenXeId?.tuyenXeId?.diemDi} -> ${booking.chuyenXeId?.tuyenXeId?.diemDen}`, 250, currentY);

    currentY += 20;
    doc.font(fontBoldPath).text('Thời gian:', 170, currentY);
    doc.font(fontPath).text(new Date(booking.chuyenXeId?.thoiGianKhoiHanh).toLocaleString('vi-VN'), 250, currentY);

    currentY += 20;
    doc.font(fontBoldPath).text('Điểm lên:', 170, currentY);
    const pickupStr = `${booking.diemDon?.tenDiem || 'Tại bến'} ${booking.diemDon?.diaChi ? '(' + booking.diemDon.diaChi + ')' : ''}`;
    doc.font(fontPath).text(pickupStr, 250, currentY, { width: 250 });

    currentY += 30;
    doc.font(fontBoldPath).text('Điểm xuống:', 170, currentY);
    const dropoffStr = `${booking.diemTra?.tenDiem || 'Tại bến'} ${booking.diemTra?.diaChi ? '(' + booking.diemTra.diaChi + ')' : ''}`;
    doc.font(fontPath).text(dropoffStr, 250, currentY, { width: 250 });

    // --- PHẦN LƯU Ý ---
    doc.moveDown(12);
    doc.strokeColor('#eee').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown();

    doc.fillColor('#f00').font(fontBoldPath).fontSize(10).text('LƯU Ý QUAN TRỌNG:', { align: 'left' });
    doc.fillColor('#666').font(fontPath).fontSize(9);
    doc.text('- Vui lòng mang mã vé đến văn phòng để đổi vé lên xe trước ít nhất 60 phút.');
    doc.text('- Thông tin hành khách phải chính xác, nếu không sẽ không thể lên xe.');
    doc.text('- Vé đã thanh toán không được hoàn trả sau giờ khởi hành.');

    // Footer
    doc.moveDown(2);
    doc.moveDown(2);
    doc.fillColor('#999').fontSize(8).text('CÔNG TY CỔ PHẦN XE KHÁCH BLUEBUS - HÂN HẠNH PHỤC VỤ QUÝ KHÁCH', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Lỗi tạo PDF Premium:', err);
    res.status(500).json({ message: 'Lỗi khi tạo file PDF', error: err.message });
  }
});

// ============================================================
// @route   POST /api/bookings/verify-invoice
// @desc    Xác thực hóa đơn (Dành cho trang Kiểm tra hóa đơn)
// ============================================================
router.post('/verify-invoice', async (req, res) => {
  try {
    const { maVe, captchaInput, captchaToken } = req.query; // Hoặc req.body tùy FE

    // 1. Kiểm tra Captcha
    const jwt = require('jsonwebtoken');
    try {
      const decoded = jwt.verify(captchaToken, process.env.JWT_SECRET);
      if (decoded.code !== captchaInput?.toUpperCase()) {
        return res.status(400).json({ valid: false, message: 'Mã Captcha không chính xác!' });
      }
    } catch (err) {
      return res.status(400).json({ valid: false, message: 'Mã Captcha đã hết hạn, vui lòng làm mới!' });
    }

    // 2. Kiểm tra Vé trong Database
    const booking = await Ve.findOne({ maVe: maVe })
      .populate({
        path: 'chuyenXeId',
        populate: { path: 'tuyenXeId' }
      });

    if (!booking) {
      return res.status(404).json({ valid: false, message: 'Không tìm thấy hóa đơn này trên hệ thống!' });
    }

    if (booking.trangThai !== 'paid' && booking.trangThai !== 'confirmed') {
      return res.status(400).json({ valid: false, message: 'Hóa đơn này chưa được thanh toán hoặc không hợp lệ!' });
    }

    // 3. Trả về kết quả Xanh
    res.json({
      valid: true,
      message: 'XÁC THỰC THÀNH CÔNG: Hóa đơn này là thật và đã được thanh toán.',
      details: {
        hoTen: booking.hoTen,
        tuyen: `${booking.chuyenXeId?.tuyenXeId?.diemDi} ➔ ${booking.chuyenXeId?.tuyenXeId?.diemDen}`,
        ngayDi: booking.chuyenXeId?.thoiGianKhoiHanh,
        tongTien: booking.tongTien
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi hệ thống xác thực', error: err.message });
  }
});

// @route   PATCH /api/bookings/:id/apply-voucher
// @desc    Cập nhật mã giảm giá cho một vé đang chờ thanh toán
router.patch('/:id/apply-voucher', async (req, res) => {
  try {
    const { maVoucher } = req.body;
    const booking = await Ve.findById(req.params.id);

    if (!booking) return res.status(404).json({ message: 'Không tìm thấy vé' });
    if (booking.trangThai !== 'hold') return res.status(400).json({ message: 'Vé đã được thanh toán hoặc đã hủy, không thể áp mã' });

    const voucher = await Voucher.findOne({ maVoucher: maVoucher.toUpperCase(), trangThai: 'active' });
    if (!voucher) return res.status(404).json({ message: 'Mã giảm giá không tồn tại hoặc đã hết hạn' });

    // Logic tính toán lại (Đồng bộ với logic hold-seats)
    const trip = await ChuyenXe.findById(booking.chuyenXeId).populate('tuyenXeId');
    const giaVeNum = parseInt(trip.tuyenXeId.giaVe.replace(/\D/g, '')) || 0;
    const tongTienGoc = giaVeNum * booking.danhSachGhe.length;

    let soTienGiam = 0;
    if (voucher.loaiGiamGia === 'fixed') {
      soTienGiam = voucher.giaTriGiam;
    } else {
      soTienGiam = (tongTienGoc * voucher.giaTriGiam) / 100;
      if (voucher.giamToiDa && soTienGiam > voucher.giamToiDa) soTienGiam = voucher.giamToiDa;
    }

    booking.soTienGiam = soTienGiam;
    booking.tongTien = tongTienGoc - soTienGiam;
    booking.maVoucher = voucher.maVoucher;
    booking.voucherId = voucher._id;

    await booking.save();

    res.json({
      message: 'Áp dụng mã giảm giá thành công',
      tongTien: booking.tongTien,
      soTienGiam: booking.soTienGiam
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi khi áp dụng mã giảm giá', error: err.message });
  }
});

// ============================================================
// @route   POST /api/bookings/:id/cancel-hold
// @desc    Hủy giữ chỗ ngay lập tức (khi khách bấm quay lại hoặc thoát trang)
// ============================================================
router.post('/:id/cancel-hold', authMiddleware, async (req, res) => {
  try {
    const booking = await Ve.findOne({ _id: req.params.id, khachHangId: req.user._id });

    if (!booking) {
      return res.status(404).json({ message: 'Không tìm thấy vé' });
    }

    if (booking.trangThai !== 'hold') {
      return res.status(400).json({ message: 'Chỉ có thể hủy giữ chỗ cho vé đang ở trạng thái chờ thanh toán' });
    }

    // Chuyển trạng thái sang expired và giải phóng ghế
    booking.trangThai = 'expired';
    booking.holdExpires = undefined;
    await booking.save();

    await ChuyenXe.findByIdAndUpdate(booking.chuyenXeId, {
      $pull: { gheDaDat: { $in: booking.danhSachGhe } }
    });

    console.log(`[CANCEL-HOLD] Đã giải phóng ghế cho vé: ${booking.maVe} theo yêu cầu từ FE`);
    res.json({ success: true, message: 'Đã hủy giữ chỗ và giải phóng ghế thành công' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi hủy giữ chỗ', error: err.message });
  }
});

module.exports = router;
