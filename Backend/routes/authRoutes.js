const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const KhachHang = require('../models/KhachHang');
const TokenBlacklist = require('../models/TokenBlacklist');
const authMiddleware = require('../middleware/authMiddleware');
const sendEmail = require('../utils/sendEmail');
const router = express.Router();

// ============================================================
// @route   POST /api/auth/send-otp
// @desc    Bước 1: Nhận số điện thoại và cấp mã OTP 123456
// ============================================================
router.post('/send-otp', async (req, res) => {
    try {
        const { soDienThoai } = req.body;

        if (!soDienThoai) {
            return res.status(400).json({ message: 'Vui lòng cung cấp Số điện thoại' });
        }

        // 1. Kiểm tra tài khoản đã tồn tại và đang hoạt động chưa
        const existingUser = await KhachHang.findOne({ soDienThoai, trangThai: 'active' });
        if (existingUser) {
            return res.status(400).json({ message: 'Số điện thoại này đã được đăng ký. Vui lòng đăng nhập.' });
        }

        // 2. Thiết lập OTP mặc định 123456 cho việc test
        const otp = "123456";
        const otpExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 phút cho thoải mái

        // 3. Tạo hoặc cập nhật bản ghi tạm (inactive)
        await KhachHang.findOneAndUpdate(
            { soDienThoai },
            {
                soDienThoai,
                otp,
                otpExpires,
                trangThai: 'inactive',
                hoTen: 'Khách hàng mới', // Placeholder bắt buộc
                matKhau: 'temporary_password' // Placeholder bắt buộc
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`[AUTH] OTP 123456 prepared for ${soDienThoai}`);

        res.json({
            message: 'Mã xác thực đã được chuẩn bị.',
            note: 'Sử dụng mã 123456 để tiếp tục.'
        });
    } catch (err) {
        console.error('Lỗi send-otp:', err);
        res.status(500).json({ message: 'Lỗi hệ thống khi gửi OTP', error: err.message });
    }
});

// ============================================================
// @route   POST /api/auth/register
// @desc    Bước 2: Hoàn tất đăng ký với OTP, Họ tên, Email, Mật khẩu
// ============================================================
router.post('/register', async (req, res) => {
    try {
        const { soDienThoai, otp, hoTen, email, matKhau, xacNhanMatKhau } = req.body;

        // Validation cơ bản
        if (!soDienThoai || !otp || !hoTen || !email || !matKhau || !xacNhanMatKhau) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ tất cả các trường thông tin.' });
        }

        if (matKhau !== xacNhanMatKhau) {
            return res.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });
        }

        // 1. Tìm bản ghi tạm thời
        const user = await KhachHang.findOne({ soDienThoai, trangThai: 'inactive' });
        if (!user) {
            return res.status(400).json({ message: 'Yêu cầu đăng ký không hợp lệ hoặc đã hết hạn.' });
        }

        // 2. Kiểm tra OTP
        if (otp !== user.otp && otp !== "123456") {
            return res.status(400).json({ message: 'Mã OTP không chính xác.' });
        }

        // 3. Kiểm tra Email có bị trùng với user khác không
        const emailExists = await KhachHang.findOne({ email, trangThai: 'active' });
        if (emailExists) {
            return res.status(400).json({ message: 'Email này đã được sử dụng bởi tài khoản khác.' });
        }

        // 4. Cập nhật thông tin chính thức và kích hoạt tài khoản
        user.hoTen = hoTen;
        user.email = email;
        user.matKhau = matKhau; // Sẽ được hash bởi pre-save hook trong Model
        user.trangThai = 'active';
        user.otp = undefined;
        user.otpExpires = undefined;

        await user.save();

        res.status(201).json({ message: 'Đăng ký tài khoản thành công! Bây giờ bạn có thể đăng nhập.' });
    } catch (err) {
        console.error('Lỗi register:', err);
        res.status(500).json({ message: 'Lỗi khi hoàn tất đăng ký', error: err.message });
    }
});

// ============================================================
// @route   POST /api/auth/login
// @desc    Đăng nhập hệ thống (Gộp chung Khách hàng & Nhân viên)
// ============================================================
router.post('/login', async (req, res) => {
    try {
        const { soDienThoai, matKhau } = req.body;

        if (!soDienThoai || !matKhau) {
            return res.status(400).json({ message: 'Vui lòng nhập Số điện thoại và Mật khẩu' });
        }

        // 1. Thử tìm trong bảng Khách hàng trước
        let user = await KhachHang.findOne({ soDienThoai, trangThai: 'active' });
        let userType = 'user';

        // 2. Nếu không thấy khách hàng, thử tìm trong bảng Nhân viên
        if (!user) {
            const NhanVien = require('../models/NhanVien');
            user = await NhanVien.findOne({ soDienThoai, trangThai: 'active' });
            if (user) userType = user.vaiTro || 'staff'; // admin hoặc staff
        }

        // 3. Nếu vẫn không thấy ai
        if (!user) {
            return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không đúng.' });
        }

        // 4. Kiểm tra mật khẩu (Cả 2 model đều có method comparePassword)
        const isMatch = await user.comparePassword(matKhau);
        if (!isMatch) {
            return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không đúng.' });
        }

        // 5. Tạo Token kèm Role
        const token = jwt.sign(
            { id: user._id, role: userType },
            process.env.JWT_SECRET || 'secret_key',
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Đăng nhập thành công',
            token,
            user: {
                id: user._id,
                hoTen: user.hoTen,
                soDienThoai: user.soDienThoai,
                email: user.email,
                role: userType // Trả về role để FE biết đường chuyển hướng
            }
        });
    } catch (err) {
        console.error('Lỗi Login:', err);
        res.status(500).json({ message: 'Lỗi đăng nhập', error: err.message });
    }
});

// ============================================================
// @route   POST /api/auth/forgot-password
// @desc    Yêu cầu đặt lại mật khẩu (Gửi OTP)
// ============================================================
router.post('/forgot-password', async (req, res) => {
    try {
        const { soDienThoai } = req.body;
        const user = await KhachHang.findOne({ soDienThoai, trangThai: 'active' });

        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản với số điện thoại này.' });
        }

        user.otp = "123456";
        user.otpExpires = new Date(Date.now() + 15 * 60 * 1000);
        await user.save({ validateBeforeSave: false });

        res.json({ message: 'Mã xác thực đã được chuẩn bị. Vui lòng dùng mã 123456.' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi yêu cầu reset mật khẩu', error: err.message });
    }
});

// ============================================================
// @route   POST /api/auth/reset-password
// @desc    Hoàn tất đặt lại mật khẩu
// ============================================================
router.post('/reset-password', async (req, res) => {
    try {
        const { soDienThoai, otp, matKhauMoi, xacNhanMatKhauMoi } = req.body;

        if (!soDienThoai || !otp || !matKhauMoi) {
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin.' });
        }

        if (matKhauMoi !== xacNhanMatKhauMoi) {
            return res.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });
        }

        const user = await KhachHang.findOne({ soDienThoai, trangThai: 'active' });
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
        }

        // Chấp nhận mã trong DB hoặc mã mặc định 123456
        if (otp !== user.otp && otp !== "123456") {
            return res.status(400).json({ message: 'Mã OTP không chính xác.' });
        }

        user.matKhau = matKhauMoi;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        res.json({ message: 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi đặt lại mật khẩu', error: err.message });
    }
});

// ============================================================
// @route   GET /api/auth/profile OR /api/auth/me
// @desc    Lấy thông tin cá nhân người dùng hiện tại (Hỗ trợ cả User & Admin)
// ============================================================
router.get(['/profile', '/me'], authMiddleware, async (req, res) => {
    try {
        let user;
        if (req.user.role === 'admin' || req.user.role === 'staff') {
            const NhanVien = require('../models/NhanVien');
            user = await NhanVien.findById(req.user.id).select('-matKhau');
        } else {
            user = await KhachHang.findById(req.user.id).select('-matKhau -otp -otpExpires');
        }

        if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi lấy thông tin profile', error: err.message });
    }
});

// ============================================================
// @route   GET /api/auth/captcha
// @desc    Tạo mã Captcha bảo mật cho xác thực hóa đơn
// ============================================================
router.get('/captcha', (req, res) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let captcha = '';
    for (let i = 0; i < 6; i++) {
        captcha += chars[Math.floor(Math.random() * chars.length)];
    }

    // Trong thực tế sẽ dùng Session hoặc Redis, ở đây tui trả về kèm token mã hóa đơn giản
    const jwt = require('jsonwebtoken');
    const captchaToken = jwt.sign({ code: captcha }, process.env.JWT_SECRET, { expiresIn: '5m' });

    res.json({
        captcha, // FE dùng mã này để vẽ lên Canvas
        captchaToken // FE gửi lại token này khi verify
    });
});

// ============================================================
// @route   PATCH /api/auth/profile
// @desc    Cập nhật thông tin cá nhân (PATCH)
// ============================================================
router.patch('/profile', authMiddleware, async (req, res) => {
    try {
        console.log('[AUTH] Yêu cầu cập nhật Profile cho ID:', req.user.id);

        const hoTen = req.body.hoTen || req.body.name || req.body.fullName;
        const email = req.body.email;
        const diaChi = req.body.diaChi || req.body.address;
        const gioiTinh = req.body.gioiTinh || req.body.gender || req.body.sex;
        const ngaySinh = req.body.ngaySinh || req.body.birthday || req.body.dob;
        const ngheNghiep = req.body.ngheNghiep || req.body.job || req.body.occupation;

        let user = await KhachHang.findById(req.user.id);

        if (!user) return res.status(404).json({ message: 'Không tìm thấy tài khoản khách hàng' });

        // Kiểm tra email trùng
        if (email && email !== user.email) {
            const existingKH = await KhachHang.findOne({ email });
            if (existingKH) return res.status(400).json({ message: 'Email này đã được đăng ký bởi khách hàng khác.' });
            user.email = email;
        }

        if (hoTen) user.hoTen = hoTen;
        if (diaChi) user.diaChi = diaChi;
        if (gioiTinh) user.gioiTinh = gioiTinh.toLowerCase();

        // Xử lý ngày sinh (Tránh lỗi định dạng ngày)
        if (ngaySinh) {
            const date = new Date(ngaySinh);
            if (!isNaN(date.getTime())) {
                user.ngaySinh = date;
            }
        }

        if (ngheNghiep) user.ngheNghiep = ngheNghiep;

        await user.save();
        console.log('[AUTH] Cập nhật Profile thành công cho:', user.email || user.soDienThoai);

        res.json({ message: 'Cập nhật thông tin thành công', user });
    } catch (err) {
        console.error('[AUTH] Lỗi cập nhật Profile:', err);
        res.status(500).json({ message: 'Lỗi hệ thống khi cập nhật hồ sơ', error: err.message });
    }
});

// ============================================================
// @route   PATCH /api/auth/change-password
// @desc    Đổi mật khẩu (PATCH)
// ============================================================
router.patch('/change-password', authMiddleware, async (req, res) => {
    try {
        console.log('[AUTH] Yêu cầu đổi mật khẩu:', JSON.stringify(req.body));

        const oldPassword = req.body.oldPassword || req.body.matKhauCu || req.body.currentPassword || req.body.password;
        const newPassword = req.body.newPassword || req.body.matKhauMoi || req.body.new_password;
        const confirmNewPassword = req.body.confirmNewPassword || req.body.xacNhanMatKhauMoi || req.body.xacNhanMatKhau || req.body.confirmPassword;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ mật khẩu cũ và mới.' });
        }

        if (newPassword !== confirmNewPassword && confirmNewPassword !== undefined) {
            return res.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });
        }

        let user;
        if (req.user.role === 'admin' || req.user.role === 'staff') {
            const NhanVien = require('../models/NhanVien');
            user = await NhanVien.findById(req.user.id);
        } else {
            user = await KhachHang.findById(req.user.id);
        }

        if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) return res.status(400).json({ message: 'Mật khẩu cũ không chính xác.' });

        user.matKhau = newPassword;
        await user.save();

        res.json({ message: 'Đổi mật khẩu thành công!' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi đổi mật khẩu', error: err.message });
    }
});

// ============================================================
// @route   POST /api/auth/support-requests
// @desc    Gửi yêu cầu hỗ trợ (Cổng dự phòng cho FE + Tạo thông báo Admin)
// ============================================================
router.post('/support-requests', async (req, res) => {
    try {
        const { hoTen, email, soDienThoai, tieuDe, noiDung } = req.body;

        const SupportTicket = require('../models/SupportTicket');
        const newTicket = new SupportTicket({
            hoTen,
            email,
            soDienThoai: soDienThoai || 'N/A',
            tieuDe: tieuDe || 'Yêu cầu hỗ trợ',
            noiDung: noiDung || 'Không có nội dung',
            trangThai: 'open'
        });
        await newTicket.save();

        // TẠO THÔNG BÁO CHO ADMIN
        try {
            const ThongBao = require('../models/ThongBao');
            const notification = new ThongBao({
                tieuDe: 'Yêu cầu hỗ trợ mới',
                noiDung: `Khách hàng ${hoTen} vừa gửi yêu cầu: "${tieuDe || 'Chưa có tiêu đề'}"`,
                loai: 'support',
                sender: hoTen,
                isAdminOnly: true,
                metadata: {
                    requestId: newTicket._id,
                    link: '/admin/ho-tro' // Đường dẫn chính xác cho FE
                }
            });
            await notification.save();
        } catch (notifyErr) {
            console.error('Lỗi tạo thông báo Admin:', notifyErr);
        }

        res.status(201).json({ message: 'Yêu cầu của bạn đã được gửi thành công!' });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi gửi yêu cầu hỗ trợ', error: err.message });
    }
});

module.exports = router;
