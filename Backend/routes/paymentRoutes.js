const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Ve = require('../models/Ve');
const HoaDon = require('../models/HoaDon');
const ChuyenXe = require('../models/ChuyenXe');
const sendEmail = require('../utils/sendEmail');

// ============================================================
// @route   GET /api/payments/methods
// @desc    Lấy danh sách phương thức thanh toán khả dụng
// ============================================================
router.get('/methods', (req, res) => {
  const methods = [
    {
      id: 'Sepay',
      name: 'Chuyển khoản (Sepay QR)',
      description: 'Thanh toán qua ngân hàng, tự động xác nhận',
      icon: 'sepay',
      available: true
    },
    {
      id: 'momo',
      name: 'MoMo',
      description: 'Thanh toán qua ví MoMo',
      icon: 'momo',
      available: true
    },
    {
      id: 'vnpay',
      name: 'VNPay',
      description: 'Thanh toán qua VNPay (ATM/Visa/Master)',
      icon: 'vnpay',
      available: true
    }
  ];

  res.json(methods);
});

// ============================================================
// @route   GET /api/payments/sepay-qr/:maVe
// @desc    Lấy thông tin QR thanh toán cho một mã vé
// ============================================================
router.get('/sepay-qr/:maVe', async (req, res) => {
    try {
        const { maVe } = req.params;
        console.log('--- Request QR for Ticket:', maVe);

        // Tìm vé (Xử lý trim khoảng trắng và không phân biệt hoa thường)
        const booking = await Ve.findOne({ maVe: maVe.trim() });
        
        if (!booking) {
            console.error('Lỗi: Không tìm thấy vé trong Database với mã:', maVe);
            return res.status(404).json({ message: 'Không tìm thấy vé trong hệ thống' });
        }

        const amount = booking.tongTien;
        const description = booking.maVe;
        const bankNumber = process.env.SEPAY_BANK_NUMBER;
        const bankName = process.env.SEPAY_BANK_NAME;
        const bankHolder = process.env.SEPAY_BANK_HOLDER;

        if (!bankNumber || !bankName) {
            console.error('Lỗi: Chưa cấu hình SEPAY_BANK_NUMBER hoặc SEPAY_BANK_NAME trong file .env');
            return res.status(500).json({ message: 'Server chưa cấu hình thông tin ngân hàng' });
        }

        const qrUrl = `https://img.vietqr.io/image/${bankName}-${bankNumber}-compact2.png?amount=${amount}&addInfo=${description}&accountName=${bankHolder}`;

        console.log('Tạo QR thành công cho vé:', maVe);
        res.json({
            qrUrl,
            bankNumber,
            bankName,
            bankHolder,
            amount,
            description,
            maVe: booking.maVe
        });
    } catch (err) {
        console.error('Lỗi Server khi tạo QR:', err.message);
        res.status(500).json({ message: 'Lỗi lấy thông tin thanh toán', error: err.message });
    }
});

// ============================================================
// @route   POST /api/payments/sepay-webhook
// @desc    Webhook nhận thông báo thanh toán từ Sepay
// ============================================================
router.post('/sepay-webhook', async (req, res) => {
  try {
    // 1. Kiểm tra API Key từ Header Authorization
    const authHeader = req.headers.authorization || '';
    const expectedKey = `Apikey ${process.env.SEPAY_AUTH_TOKEN}`;
    
    console.log('--- SePay Webhook Received ---');
    console.log('Authorization Header:', authHeader);

    if (authHeader.toLowerCase() !== expectedKey.toLowerCase()) {
      console.warn('Cảnh báo: Webhook SePay không hợp lệ. Nhận được:', authHeader, 'Dự kiến:', expectedKey);
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { content, amount, reference_code, reference, id, transfer_type } = req.body;
    const finalRefCode = reference_code || reference || id || 'N/A';
    console.log('Sepay Body:', JSON.stringify(req.body));
    
    // Chỉ xử lý giao dịch tiền vào (Linh hoạt hơn với chữ hoa/thường)
    if (transfer_type && transfer_type.toLowerCase() !== 'in') {
        return res.json({ success: true, message: 'Bỏ qua giao dịch không phải tiền vào' });
    }

    console.log('Sepay Webhook Received:', content, amount, reference_code);

    // 2. Tìm mã vé trong nội dung chuyển khoản (Regex tìm mã vé dạng VE-xxxxxxxxxxxxx hoặc VExxxxxxxxxxxxx)
    const maVeMatch = content.match(/VE-?\d+/i); 
    
    if (!maVeMatch) {
        console.error('Lỗi: Không tìm thấy mã vé trong nội dung chuyển khoản:', content);
        return res.json({ success: true, message: 'Không tìm thấy mã vé trong nội dung' });
    }

    let maVe = maVeMatch[0];
    // Chuẩn hóa: Nếu khách gõ thiếu dấu gạch, ta tự thêm vào để tìm trong DB
    if (!maVe.includes('-')) {
        maVe = maVe.replace(/VE/i, 'VE-');
    }

    console.log('--- Tìm thấy mã vé:', maVe);

    const booking = await Ve.findOne({ maVe: { $regex: new RegExp(maVe, 'i') } }).populate({
        path: 'chuyenXeId',
        populate: { path: 'tuyenXeId' }
    });

    if (!booking) {
      return res.status(404).json({ message: 'Không tìm thấy vé tương ứng' });
    }

    if (booking.trangThai === 'paid' || booking.trangThai === 'confirmed') {
        return res.json({ success: true, message: 'Vé này đã được thanh toán trước đó' });
    }

    // Kiểm tra số tiền (Cho phép chênh lệch nhỏ nếu cần, ở đây kiểm tra khớp hoàn toàn)
    if (amount < booking.tongTien) {
      console.warn(`Cảnh báo: Vé ${maVe} thanh toán thiếu tiền. Cần: ${booking.tongTien}, Nhận: ${amount}`);
      return res.status(400).json({ message: 'Số tiền thanh toán không đủ' });
    }

    // 3. Cập nhật trạng thái vé thành paid
    booking.trangThai = 'paid';
    booking.maGiaoDich = reference_code;
    booking.phuongThucThanhToan = 'Sepay';
    booking.holdExpires = undefined;
    await booking.save();

    // Tăng lượt sử dụng voucher nếu có
    if (booking.voucherId) {
        const Voucher = require('../models/Voucher');
        await Voucher.findByIdAndUpdate(booking.voucherId, { $inc: { daSuDung: 1 } });
    }

    // 4. Tạo hóa đơn
    const hoaDon = new HoaDon({
      veId: booking._id,
      khachHangId: booking.khachHangId,
      tongTien: booking.tongTien,
      phuongThucThanhToan: 'Sepay',
      maGiaoDich: reference_code,
      trangThai: 'completed'
    });
    await hoaDon.save();

    // 5. Gửi Email xác nhận kèm mã QR
    try {
        // Re-populate chuyenXeId để chắc chắn có tuyenXeId
        const Ve2 = require('../models/Ve');
        const bookingFull = await Ve2.findById(booking._id).populate({
            path: 'chuyenXeId',
            populate: { path: 'tuyenXeId' }
        });
        const trip = bookingFull?.chuyenXeId;
        const tuyen = trip?.tuyenXeId;

        // Lấy email: ưu tiên email trong vé, fallback lấy từ KhachHang
        let recipientEmail = booking.email || bookingFull?.email;
        if (!recipientEmail) {
            const KhachHang = require('../models/KhachHang');
            const kh = await KhachHang.findById(booking.khachHangId).select('email');
            recipientEmail = kh?.email;
        }

        console.log(`[EMAIL] Chuẩn bị gửi email xác nhận đến: ${recipientEmail}, tuyenXeId: ${JSON.stringify(tuyen?._id)}`);

        if (!recipientEmail) {
            console.warn(`[EMAIL] Vé ${booking.maVe} không có email, bỏ qua gửi thư`);
            fs.appendFileSync(path.join(__dirname, '../email_debug.log'),
                `[${new Date().toLocaleString('vi-VN')}] BỎ QUA: Vé ${booking.maVe} không có email\n`);
        }

        // Sử dụng API QR công khai để Gmail có thể hiển thị ảnh trực tiếp (Base64 bị Gmail chặn)
        const qrData = encodeURIComponent(`Mã vé: ${booking.maVe} | Khách: ${booking.hoTen} | Ghế: ${booking.danhSachGhe.join(', ')}`);
        const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrData}`;

        if (recipientEmail) await sendEmail({
            email: recipientEmail,
            subject: `Xác nhận đặt vé thành công - Mã vé: ${booking.maVe}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #ef5222; text-align: center;">VÉ ĐIỆN TỬ BLUEBUS</h2>
                    <p>Chào <b>${booking.hoTen}</b>,</p>
                    <p>Hệ thống đã nhận được thanh toán của bạn qua SePay. Chúc mừng bạn đã đặt vé thành công!</p>
                    <div style="background: #f9f9f9; padding: 15px; border-radius: 5px;">
                        <p><b>Mã vé:</b> ${booking.maVe}</p>
                        <p><b>Tuyến:</b> ${tuyen?.diemDi || '—'} ➔ ${tuyen?.diemDen || '—'}</p>
                        <p><b>Số ghế:</b> ${booking.danhSachGhe.join(', ')}</p>
                        <p><b>Tổng tiền:</b> ${booking.tongTien.toLocaleString()} đ</p>
                        <p><b>Mã giao dịch:</b> ${finalRefCode}</p>
                    </div>
                    <div style="text-align: center; margin-top: 20px;">
                        <p>Vui lòng đưa mã QR này cho nhân viên khi lên xe:</p>
                        <img src="${qrImage}" alt="QR Code" style="width: 200px; height: 200px;" />
                    </div>
                    <p style="font-size: 12px; color: #666; margin-top: 20px;">* Lưu ý: Vui lòng có mặt tại điểm đón trước 15 phút giờ khởi hành.</p>
                </div>
            `
        });
        console.log(`[EMAIL] ✅ Đã gửi email xác nhận đến ${recipientEmail}`);
        fs.appendFileSync(
            path.join(__dirname, '../email_debug.log'),
            `[${new Date().toLocaleString('vi-VN')}] THÀNH CÔNG: Gửi mail thành công cho vé ${booking.maVe} tới ${recipientEmail}\n`
        );
    } catch (emailErr) {
        console.error('Lỗi gửi email xác nhận sau webhook:', emailErr.message);
        fs.appendFileSync(
            path.join(__dirname, '../email_debug.log'),
            `[${new Date().toLocaleString('vi-VN')}] THẤT BẠI: Lỗi gửi mail cho vé ${booking?.maVe}: ${emailErr.message}\nStack: ${emailErr.stack}\n`
        );
    }

    // 6. Emit socket để FE redirect ngay
    try {
        const io = require('../server').io || global.io;
        if (io) {
            io.emit('payment_confirmed', {
                maVe: booking.maVe,
                bookingId: booking._id,
                trangThai: 'paid'
            });
            console.log(`[SOCKET] Emit payment_confirmed cho vé ${booking.maVe}`);
        }
    } catch (socketErr) {
        // socket không bắt buộc
    }

    res.json({ success: true, message: 'Xác nhận thanh toán thành công qua Sepay Webhook' });
  } catch (err) {
    console.error('Lỗi xử lý webhook Sepay:', err);
    res.status(500).json({ message: 'Lỗi xử lý webhook Sepay', error: err.message });
  }
});

module.exports = router;
