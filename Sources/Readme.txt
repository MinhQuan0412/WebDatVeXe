===================================================
  HƯỚNG DẪN CÀI ĐẶT VÀ CHẠY DỰ ÁN BLUEBUS
===================================================

1. YÊU CẦU HỆ THỐNG
---------------------
- Node.js >= 18
- MongoDB Atlas (hoặc MongoDB local)
- Tài khoản SePay (cổng thanh toán)
- Tài khoản Gmail có bật App Password

2. CÀI ĐẶT BACKEND
---------------------
Bước 1: Vào thư mục Backend
  cd Backend

Bước 2: Cài thư viện
  npm install

Bước 3: Cấu hình file .env (đã có sẵn kèm theo)
  Nếu cần chỉnh sửa, mở file Backend/.env và cập nhật:

  PORT=5001
  MONGO_URI=<chuỗi kết nối MongoDB của bạn>
  JWT_SECRET=<chuỗi bí mật tùy ý>

  SEPAY_BANK_NUMBER=<số tài khoản ngân hàng>
  SEPAY_BANK_NAME=<tên ngân hàng, ví dụ: TPBank>
  SEPAY_BANK_HOLDER=<tên chủ tài khoản>
  SEPAY_AUTH_TOKEN=<token xác thực SePay>

  EMAIL_USER=<địa chỉ Gmail>
  EMAIL_PASS=<App Password của Gmail>

Bước 4: Chạy server
  npm run dev
  → Server chạy tại http://localhost:5001

3. CÀI ĐẶT FRONTEND
---------------------
Bước 1: Vào thư mục Frontend
  cd Frontend

Bước 2: Cài thư viện
  npm install

Bước 3: Cấu hình URL Backend
  Mở file Frontend/src/config.js
  Sửa API_BASE_URL thành URL của Backend đang chạy:

  export const API_BASE_URL = "http://localhost:5001";

  Lưu ý: Nếu BE chạy qua ngrok thì dán URL ngrok vào đây.

Bước 4: Chạy Frontend
  npm run dev
  → Website chạy tại http://localhost:5173

4. GHI CHÚ
---------------------
- Frontend không dùng file .env, URL backend được cấu hình tại: Frontend/src/config.js
- Database dùng MongoDB Atlas, không có file script SQL
- Để tạo tài khoản Admin lần đầu, chạy: node Backend/setupAdmin.js
- Để tạo dữ liệu demo chuyến xe, chạy: node Backend/seed_demo_trips.js
- Để tạo voucher mẫu, chạy: node Backend/seedVouchers.js

5. LINK GITHUB
---------------------
https://github.com/MinhQuan0412/DACS_DATVEXE

===================================================
