# ESP32 Fingerprint Authentication Module

Module xác thực vân tay cho hệ thống Medical SCADA.

## Phần Cứng Cần Thiết

| Linh kiện | Mô tả |
|-----------|-------|
| ESP32 DevKit V1 | Vi điều khiển chính |
| R307 / R503 / AS608 | Module cảm biến vân tay (UART) |
| LED xanh lá (tuỳ chọn) | Phản hồi thành công |
| LED đỏ (tuỳ chọn) | Phản hồi lỗi |
| Buzzer (tuỳ chọn) | Phản hồi âm thanh |

## Sơ Đồ Nối Dây

```
ESP32 GPIO16 (RX2) ──► Fingerprint TX (Xanh lá)
ESP32 GPIO17 (TX2) ──► Fingerprint RX (Trắng)
ESP32 3.3V          ──► Fingerprint VCC (Đỏ)
ESP32 GND           ──► Fingerprint GND (Đen)

Tuỳ chọn:
ESP32 GPIO4          ──► LED xanh lá (qua trở 220Ω)
ESP32 GPIO5          ──► LED đỏ (qua trở 220Ω)
ESP32 GPIO18         ──► Buzzer
```

## Cài Đặt

### Cách 1: Arduino IDE

1. Cài đặt [Arduino IDE](https://www.arduino.cc/en/software)
2. Thêm ESP32 board: `File → Preferences → Additional Board Manager URLs`:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Cài thư viện qua Library Manager:
   - **Adafruit Fingerprint Sensor Library** (v2.1.x+)
   - **ArduinoJson** (v7.x)
4. Mở file `esp32_fingerprint.ino`
5. Chọn Board: **ESP32 Dev Module**
6. Upload

### Cách 2: PlatformIO (Khuyến nghị)

1. Cài [VS Code](https://code.visualstudio.com/) + Extension [PlatformIO](https://platformio.org/)
2. Mở thư mục `esp32/` trong VS Code
3. Chạy lệnh:
   ```bash
   pio run -t upload
   pio device monitor
   ```

## Cấu Hình

Chỉnh sửa các hằng số ở đầu file `esp32_fingerprint.ino`:

```cpp
const char* WIFI_SSID     = "TÊN_WIFI";
const char* WIFI_PASSWORD = "MẬT_KHẨU_WIFI";
const char* SERVER_URL    = "http://192.168.1.100:3000";  // IP của backend
const char* API_KEY       = "esp32-fingerprint-secret-change-me";  // Phải khớp với .env
```

> ⚠️ **Quan trọng**: `API_KEY` phải khớp với giá trị `ESP32_API_KEY` trong file `.env` của backend.

## Luồng Hoạt Động

### Đăng Nhập Bằng Vân Tay (Match Mode)

```
ESP32 poll GET /api/fingerprint/status → mode: "match"
    ↓
Người dùng đặt ngón tay lên cảm biến
    ↓
Cảm biến quét → tìm trong bộ nhớ nội bộ
    ↓
Nếu khớp → POST /api/fingerprint/match { fingerprintId }
    ↓
Backend → emit LOGIN_SUCCESS qua Socket.io
    ↓
Frontend nhận event → tự động đăng nhập
```

### Đăng Ký Vân Tay (Enroll Mode)

```
Admin bấm nút "Đăng ký vân tay" trên giao diện web
    ↓
ESP32 poll GET /api/fingerprint/status → mode: "enroll", userId
    ↓
Người dùng đặt ngón tay (lần 1)
    ↓
Bỏ ngón tay ra → đặt lại (lần 2)
    ↓
Cảm biến lưu mẫu vân tay vào bộ nhớ nội bộ
    ↓
POST /api/fingerprint/enroll { fingerprintId, userId }
    ↓
Backend → emit ENROLL_SUCCESS qua Socket.io
    ↓
Frontend hiển thị thông báo thành công
```

## LED Trạng Thái

| Trạng thái | LED Status (GPIO2) | LED Xanh (GPIO4) | LED Đỏ (GPIO5) |
|------------|-------------------|-------------------|-----------------|
| Đang kết nối WiFi | Nháy nhanh | Tắt | Tắt |
| Sẵn sàng (idle) | Sáng liên tục | Tắt | Tắt |
| Quét thành công | Sáng | Nháy 3 lần | Tắt |
| Quét thất bại | Sáng | Tắt | Nháy 3 lần |
| Lỗi hệ thống | Tắt | Tắt | Nháy chậm |

## API Endpoints

| Method | URL | Mô tả | Auth |
|--------|-----|--------|------|
| `GET` | `/api/fingerprint/status` | Kiểm tra chế độ (match/enroll) | X-API-Key |
| `POST` | `/api/fingerprint/match` | Báo kết quả khớp vân tay | X-API-Key |
| `POST` | `/api/fingerprint/enroll` | Đăng ký vân tay mới | X-API-Key |

## Xử Lý Sự Cố

| Vấn đề | Giải pháp |
|--------|-----------|
| Không tìm thấy cảm biến | Kiểm tra nối dây TX↔RX, nguồn 3.3V |
| WiFi không kết nối | Kiểm tra SSID, mật khẩu, khoảng cách |
| Server trả về 401 | Kiểm tra API_KEY khớp với `.env` |
| Vân tay không nhận diện | Quét lại ở góc khác, vệ sinh cảm biến |
