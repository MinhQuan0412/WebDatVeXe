const express = require('express');
const ChuyenXe = require('../models/ChuyenXe');
const TuyenXe = require('../models/TuyenXe');
const Xe = require('../models/Xe');
const router = express.Router();

// Logic chung cho tìm kiếm chuyến xe
const searchTrips = async (req, res) => {
  try {
    const {
      diemDi, diemDen, ngay,
      giaVeTu, giaVeDen,
      loaiXe,
      conGhe,
      page = 1,
      limit = 20,
      sort = '-thoiGianKhoiHanh'
    } = req.query;

    // 3. Không cho phép điểm đi trùng điểm đến
    if (diemDi && diemDen && diemDi.trim().toLowerCase() === diemDen.trim().toLowerCase()) {
      return res.status(400).json({ message: 'Điểm đi và điểm đến không được trùng nhau' });
    }

    // 4. KHÔNG CHO PHÉP TÌM KIẾM NGÀY QUÁ KHỨ
    if (ngay) {
        const inputDate = new Date(`${ngay}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Đưa về 0h để so sánh ngày
        
        if (inputDate < today) {
            return res.status(400).json({ message: 'Ngày đi không được là ngày trong quá khứ' });
        }
    }

    let query = { trangThai: 'active' };

    // 1. Lọc chuyến xe có giờ khởi hành không quá 30 phút trước
    const now = new Date();
    const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
    query.thoiGianKhoiHanh = { $gte: thirtyMinsAgo };

    // 5. Lọc theo tuyến (chỉ lấy tuyến đang active)
    if (diemDi || diemDen) {
      const routeFilter = { trangThai: 'active' };
      if (diemDi) routeFilter.diemDi = { $regex: diemDi, $options: 'i' };
      if (diemDen) routeFilter.diemDen = { $regex: diemDen, $options: 'i' };
      const routes = await TuyenXe.find(routeFilter);
      const routeIds = routes.map(r => r._id);
      
      if (routeIds.length === 0) {
        return res.json({ data: [], pagination: { total: 0, page: 1, limit: 1, totalPages: 0 }});
      }
      query.tuyenXeId = { $in: routeIds };
    }

    // 4. Xử lý múi giờ khi lọc theo ngày (Asia/Ho_Chi_Minh là UTC+7)
    if (ngay) {
      const dateParts = ngay.split('-');
      if (dateParts.length === 3) {
        // Tạo chuỗi ISO đại diện cho 00:00:00 giờ VN (+07:00)
        const startOfVNDay = new Date(`${ngay}T00:00:00+07:00`);
        const endOfVNDay = new Date(`${ngay}T23:59:59.999+07:00`);

        query.thoiGianKhoiHanh = { 
          $gte: now > startOfVNDay ? now : startOfVNDay, 
          $lte: endOfVNDay 
        };
      }
    }

    if (giaVeTu || giaVeDen) {
      query.giaVe = {};
      if (giaVeTu) query.giaVe.$gte = Number(giaVeTu);
      if (giaVeDen) query.giaVe.$lte = Number(giaVeDen);
    }

    // 7. Xử lý filter typo cho loại xe
    if (loaiXe) {
      // Nếu user tìm "giường", ta match cả "giường" và "gường" (do typo trong DB)
      let regexStr = loaiXe;
      if (loaiXe.toLowerCase().includes('giường')) {
        regexStr = regexStr.replace(/giường/ig, '(giường|gường)');
      }
      query.loaiXe = { $regex: regexStr, $options: 'i' };
    }

    // Luôn ẩn các chuyến xe đã đầy (Yêu cầu của thầy)
    const alwaysHideFullCond = {
      $lt: [
        { $size: { $ifNull: ["$gheDaDat", []] } },
        { $ifNull: ["$tongSoGhe", 34] }
      ]
    };
    query.$expr = alwaysHideFullCond;

    // Bỏ qua lọc conGhe===false vì mặc định đã ẩn xe đầy
    if (conGhe === 'true') {
        // Đã bao hàm trong alwaysHideFullCond
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    let sortOption = {};
    if (sort.startsWith('-')) {
      sortOption[sort.substring(1)] = -1;
    } else {
      sortOption[sort] = 1;
    }

    const [trips, totalCount] = await Promise.all([
      ChuyenXe.find(query)
        .populate('tuyenXeId')
        .populate('xeId')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      ChuyenXe.countDocuments(query)
    ]);

    const data = trips.map(t => {
      const trip = t.toObject();
      const max = trip.xeId ? trip.xeId.tongSoGhe : 34;
      trip.tongSoGheTrong = max - (trip.gheDaDat || []).length;
      return trip;
    });

    res.json({
      data,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi tìm kiếm chuyến xe', error: err.message });
  }
};

// @route   GET /api/trips
// @desc    Lấy danh sách chuyến xe + bộ lọc + phân trang + sắp xếp
router.get('/', searchTrips);

// @route   GET /api/trips/search
// @desc    Alias — dùng chung bộ lọc với GET /api/trips
router.get('/search', searchTrips);




// @route   GET /api/trips/:tripId/seats
// @desc    Lấy sơ đồ ghế theo xe (mặc định 34 chỗ)
router.get('/:tripId/seats', async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.tripId);
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    const bookedSeats = trip.gheDaDat || [];

    // Lấy sơ đồ ghế từ Xe (thông qua SoDoGheId)
    const xe = await Xe.findOne({ bienSo: trip.xeId }).populate('soDoGheId');
    let soDoGhe = [];
    
    if (xe && xe.soDoGheId && xe.soDoGheId.danhSachGhe) {
      soDoGhe = xe.soDoGheId.danhSachGhe;
    } else {
      // Fallback 34 chỗ
      for (let i = 1; i <= 17; i++) soDoGhe.push(`A${String(i).padStart(2, '0')}`);
      for (let i = 1; i <= 17; i++) soDoGhe.push(`B${String(i).padStart(2, '0')}`);
    }

    const lowerDeck = [];
    const upperDeck = [];

    soDoGhe.forEach(seatId => {
      const isUpper = seatId.startsWith('B');
      const seatObj = {
        id: seatId,
        tang: isUpper ? 'tren' : 'duoi',
        isBooked: bookedSeats.includes(seatId)
      };
      
      if (isUpper) upperDeck.push(seatObj);
      else lowerDeck.push(seatObj);
    });

    res.json({
      totalSeats: soDoGhe.length,
      availableSeats: soDoGhe.length - bookedSeats.length,
      bookedSeats,
      lowerDeck,
      upperDeck
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy thông tin ghế', error: err.message });
  }
});

// @route   GET /api/trips/:tripId/stops
// @desc    Lấy danh sách điểm đón/trả của chuyến xe để user chọn khi đặt vé
router.get('/:tripId/stops', async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.tripId).populate('tuyenXeId');
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    let diemDon = trip.diemDon || [];
    let diemTra = trip.diemTra || [];

    // Nếu chuyến xe chưa có điểm riêng → lấy từ tuyến xe
    if (trip.tuyenXeId) {
      if (diemDon.length === 0) {
        diemDon = trip.tuyenXeId.diemDon || [];
      }
      if (diemTra.length === 0) {
        diemTra = trip.tuyenXeId.diemTra || [];
      }
    }

    res.json({
      chuyenXeId: trip._id,
      tuyenXe: trip.tuyenXeId ? `${trip.tuyenXeId.diemDi} → ${trip.tuyenXeId.diemDen}` : null,
      diemDon,
      diemTra
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy điểm đón/trả', error: err.message });
  }
});

// @route   GET /api/trips/:tripId/boarding-points
// @desc    Lấy điểm đón của chuyến xe (ưu tiên chuyến xe, fallback tuyến xe)
router.get('/:tripId/boarding-points', async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.tripId).populate('tuyenXeId');
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    let diemDon = trip.diemDon || [];

    // Nếu chuyến xe chưa có điểm đón riêng → lấy từ tuyến xe
    if (diemDon.length === 0 && trip.tuyenXeId && trip.tuyenXeId.diemDon) {
      diemDon = trip.tuyenXeId.diemDon;
    }

    res.json({
      chuyenXeId: trip._id,
      tuyenXe: trip.tuyenXeId ? `${trip.tuyenXeId.diemDi} → ${trip.tuyenXeId.diemDen}` : null,
      diemDon
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy điểm đón', error: err.message });
  }
});

// @route   GET /api/trips/:tripId/dropoff-points
// @desc    Lấy điểm trả của chuyến xe (ưu tiên chuyến xe, fallback tuyến xe)
router.get('/:tripId/dropoff-points', async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.tripId).populate('tuyenXeId');
    if (!trip) return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });

    let diemTra = trip.diemTra || [];

    // Nếu chuyến xe chưa có điểm trả riêng → lấy từ tuyến xe
    if (diemTra.length === 0 && trip.tuyenXeId && trip.tuyenXeId.diemTra) {
      diemTra = trip.tuyenXeId.diemTra;
    }

    res.json({
      chuyenXeId: trip._id,
      tuyenXe: trip.tuyenXeId ? `${trip.tuyenXeId.diemDi} → ${trip.tuyenXeId.diemDen}` : null,
      diemTra
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy điểm trả', error: err.message });
  }
});

// @route   GET /api/trips/:id
// @desc    Lấy chi tiết một chuyến xe (Kèm danh sách điểm đón/trả)
router.get('/:id', async (req, res) => {
  try {
    const trip = await ChuyenXe.findById(req.params.id)
      .populate('tuyenXeId')
      .populate('xeId');

    if (!trip) {
      return res.status(404).json({ message: 'Không tìm thấy chuyến xe' });
    }

    const tripObj = trip.toObject();
    
    // Ưu tiên lấy điểm đón/trả chi tiết từ Tuyến xe nếu Chuyến xe không có cấu hình riêng
    const rawDiemDon = (trip.diemDon && trip.diemDon.length > 0) ? trip.diemDon : (trip.tuyenXeId ? trip.tuyenXeId.diemDon : []);
    const rawDiemTra = (trip.diemTra && trip.diemTra.length > 0) ? trip.diemTra : (trip.tuyenXeId ? trip.tuyenXeId.diemTra : []);

    // Nối Tên và Địa chỉ thẳng vào trường tenDiem để FE tự động hiển thị chi tiết
    tripObj.diemDon = rawDiemDon.map(d => ({
        ...d,
        tenDiem: `${d.tenDiem} (${d.diaChi || 'Đang cập nhật'})`
    }));
    tripObj.diemTra = rawDiemTra.map(d => ({
        ...d,
        tenDiem: `${d.tenDiem} (${d.diaChi || 'Đang cập nhật'})`
    }));

    // console.log(`[TRIP-DETAIL] Chuyến ${trip.maChuyenXe}: Đã nối địa chỉ chi tiết cho ${rawDiemDon.length} điểm đón`);
    res.json(tripObj);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy thông tin ghế', error: err.message });
  }
});

// @route   GET /api/trips/vehicle-layout/:bienSo
// @desc    Lấy sơ đồ ghế tĩnh của xe theo biển số
router.get('/vehicle-layout/:bienSo', async (req, res) => {
  try {
    const xe = await Xe.findOne({ bienSo: req.params.bienSo }).populate('soDoGheId');
    if (!xe) return res.status(404).json({ message: 'Không tìm thấy xe' });
    res.json({
      bienSo: xe.bienSo,
      tongSoGhe: xe.tongSoGhe,
      soDoGhe: xe.soDoGheId ? xe.soDoGheId.danhSachGhe : []
    });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy sơ đồ xe', error: err.message });
  }
});

module.exports = router;
