# BÁO CÁO DỰ ÁN: MEDICAL SCADA
## Hệ Thống Điều Khiển Và Giám Sát Cabin Vận Chuyển Mẫu Bệnh Phẩm

---

> **Phân loại:** Đồ án môn học — Hệ thống nhúng & IoT  
> **Tên dự án:** Medical SCADA — Cabin Van Chuyen Mau Benh Pham  
> **Repository:** LQMinh1806/Med_Scada  
> **Ngày cập nhật:** 2026-07-13  

---

## MỤC LỤC

1. [Tổng Quan Dự Án](#1-tổng-quan-dự-án)
2. [Mục Tiêu & Phạm Vi](#2-mục-tiêu--phạm-vi)
3. [Kiến Trúc Hệ Thống](#3-kiến-trúc-hệ-thống)
4. [Thành Phần Phần Cứng](#4-thành-phần-phần-cứng)
5. [Thành Phần Phần Mềm](#5-thành-phần-phần-mềm)
6. [Cơ Sở Dữ Liệu](#6-cơ-sở-dữ-liệu)
7. [Giao Thức Truyền Thông](#7-giao-thức-truyền-thông)
8. [Luồng Kết Nối Tổng Thể](#8-luồng-kết-nối-tổng-thể)
9. [Các Luồng Nghiệp Vụ Chính](#9-các-luồng-nghiệp-vụ-chính)
10. [Bảo Mật Hệ Thống](#10-bảo-mật-hệ-thống)
11. [Thuật Toán Điều Phối — LOOK Scheduler](#11-thuật-toán-điều-phối--look-scheduler)
12. [Cấu Hình Môi Trường](#12-cấu-hình-môi-trường)
13. [Hướng Dẫn Cài Đặt & Vận Hành](#13-hướng-dẫn-cài-đặt--vận-hành)
14. [Kiểm Thử & Xác Thực](#14-kiểm-thử--xác-thực)
15. [Quyết Định Kiến Trúc Quan Trọng](#15-quyết-định-kiến-trúc-quan-trọng)
16. [Hạn Chế & Hướng Phát Triển](#16-hạn-chế--hướng-phát-triển)
17. [Tổng Hợp Toàn Bộ Phương Thức Kết Nối](#17-tổng-hợp-toàn-bộ-phương-thức-kết-nối)

---

## 1. TỔNG QUAN DỰ ÁN

**Medical SCADA** là hệ thống SCADA (Supervisory Control And Data Acquisition) quy mô nhỏ, được xây dựng phục vụ mô phỏng và thực nghiệm điều khiển cabin vận chuyển mẫu bệnh phẩm trong môi trường bệnh viện. Hệ thống tích hợp đầy đủ các lớp từ phần cứng IoT, PLC công nghiệp đến giao diện web thời gian thực.

### 1.1 Bối Cảnh

Trong các bệnh viện hiện đại, mẫu bệnh phẩm (máu, nước tiểu, mô...) cần được vận chuyển nhanh chóng và an toàn từ phòng lấy mẫu đến các khoa xét nghiệm khác nhau. Hệ thống cabin tự động trên đường ray giúp loại bỏ rủi ro vận chuyển thủ công, giảm thời gian xử lý và đảm bảo truy xuất nguồn gốc mẫu.

### 1.2 Điểm Nổi Bật

| Đặc điểm | Mô tả |
|---|---|
| **Thời gian thực** | Dữ liệu PLC cập nhật qua OPC UA mỗi 500ms, push qua WebSocket |
| **Xác thực vân tay** | Đăng nhập không tiếp xúc qua cảm biến R307 + ESP8266/ESP32 |
| **Giám sát cảm biến** | DHT11 (nhiệt độ/độ ẩm) + MPU6050 (gia tốc/con quay hồi chuyển) + Encoder vị trí |
| **Điều phối thông minh** | Thuật toán LOOK (elevator algorithm) xử lý đa yêu cầu đồng thời |
| **Simulation mode** | Chạy đầy đủ không cần PLC thật (`VITE_SIMULATION_MODE=true`) |
| **UDP Auto-Discovery** | IoT device tự tìm server, không cần cấu hình IP cứng |

---

## 2. MỤC TIÊU & PHẠM VI

### 2.1 Mục Tiêu

1. **Điều khiển thời gian thực:** Gửi lệnh di chuyển cabin đến 4 trạm qua OPC UA → Kepware → PLC.
2. **Giám sát liên tục:** Hiển thị vị trí cabin, trạng thái hệ thống, dữ liệu cảm biến môi trường trên bản đồ SVG.
3. **Quản lý mẫu bệnh phẩm:** Quét barcode, theo dõi lịch sử vận chuyển, import danh sách từ Excel.
4. **Xác thực an toàn:** Đăng nhập vân tay vật lý kết hợp JWT/CSRF trên web.
5. **Phân quyền vị trí:** Vận hành viên chỉ được thao tác trạm của mình (Location-based RBAC).

### 2.2 Phạm Vi Hệ Thống

```
┌─────────────────────────────────────────────┐
│            PHẠM VI HỆ THỐNG                 │
│                                             │
│  ✅ Giao diện web giám sát & điều khiển     │
│  ✅ Backend API + Socket.IO                 │
│  ✅ Kết nối OPC UA → Kepware → PLC         │
│  ✅ Module vân tay ESP8266/ESP32            │
│  ✅ Module cảm biến cabin ESP32             │
│  ✅ Cơ sở dữ liệu PostgreSQL               │
│  ✅ Firmware nhúng Arduino/PlatformIO       │
│                                             │
│  ❌ Thiết kế cơ khí đường ray              │
│  ❌ Tủ điện, đấu nối điện công nghiệp      │
└─────────────────────────────────────────────┘
```

---

## 3. KIẾN TRÚC HỆ THỐNG

### 3.1 Sơ Đồ Tổng Thể

![Sơ Đồ Kết Nối Hệ Thống Medical SCADA](docs/so_do_kien_truc.png)

*Hình 1: Sơ đồ kết nối tổng thể hệ thống Medical SCADA — Dự án vận chuyển mẫu bệnh phẩm tự động. Hệ thống gồm 3 tầng chính: Tầng Client (Frontend), Tầng Server & Quản lý mạng, và Tầng IoT & Phần cứng.*

---

### 3.2 Sơ Đồ Kết Nối Chi Tiết Theo Giao Thức

![Chi Tiết Kết Nối Các Thành Phần](docs/ket_noi_chi_tiet.png)

*Hình 2: Sơ đồ chi tiết kết nối từng thành phần với nhau, hiển thị rõ giao thức và endpoint của từng kết nối. Từ trái sang phải: Phần cứng vật lý → Module IoT → Webserver → OPC UA Bridge → PLC & Cabin.*

---

### 3.3 Luồng Dữ Liệu & Giao Thức Giữa Các Thành Phần

![Luồng Dữ Liệu và Giao Thức](docs/luong_giao_thuc.png)

*Hình 3: Luồng dữ liệu thời gian thực giữa 6 thành phần chính. Mỗi mũi tên thể hiện giao thức, tần suất cập nhật và nội dung payload trao đổi.*

| Kết Nối | Giao Thức | Endpoint / Chi Tiết |
|---|---|---|
| React → Node.js | HTTP REST | JWT Cookie + CSRF / Port 3000 |
| React ↔ Node.js | WebSocket | Socket.IO v4 / Bidirectional |
| ESP8266 → Node.js | HTTP GET | `/api/fingerprint/status` (X-API-Key) |
| ESP8266 → Node.js | HTTP POST | `/api/fingerprint/match` (X-API-Key) |
| ESP8266 ↔ Node.js | UDP | Port 3030 Discovery + Port 3031 Push Trigger |
| ESP32 → Node.js | HTTP POST | `/api/sensors/cabin` (X-API-Key) mỗi 2s |
| Node.js ↔ Kepware | OPC UA TCP | `opc.tcp://127.0.0.1:49320` / node-opcua v2 |
| Kepware ↔ PLC | Industrial | OPC UA / Tag: `ns=2;s=PLC1.Cabin.*` |
| PLC → Cabin | Digital I/O | 24VDC / Motor relay / Sensor từ trường |
| Node.js ↔ PostgreSQL | Prisma ORM | TCP Port 5432 |

---

### 3.4 Sơ Đồ Đấu Nối Phần Cứng IoT — ESP32 Cabin Sensor

![Sơ Đồ Đấu Dây Đầy đủ ESP32](docs/esp32_dau_day_day_du.png)

*Hình 4: Sơ đồ đấu dây đầy đủ module ESP32 Cabin Sensor với 5 ngoại vi: **DHT11**, MPU6050, Encoder quang học, Relay hướng và kết nối WiFi → Backend.*

**Chi tiết kết nối từng cảm biến:**

| Cảm biến | GPIO | Giao tiếp | Mô tả |
|---|---|---|---|
| **DHT11** DATA | GPIO **4** | 1-Wire Digital | 10kΩ pull-up to 3.3V. Đọc nhiệt độ (°C) + độ ẩm (%RH) |
| **MPU6050** SDA | GPIO **21** | I2C | Địa chỉ 0x68 (AD0 → GND). Gia tốc + con quay hồi chuyển |
| **MPU6050** SCL | GPIO **22** | I2C | Clock I2C |
| **Encoder** DO | GPIO **27** | Digital Interrupt RISING | INPUT\_PULLUP. ISR: `encoderISR()` — đếm 80 xung/vòng |
| **Relay Thuận** NC | GPIO **32** | Digital Input | INPUT\_PULLDOWN. HIGH = cabin đang chạy tiến |
| **Relay Nghịch** NC | GPIO **33** | Digital Input | INPUT\_PULLDOWN. HIGH = cabin đang chạy lùi |

> **Lưu ý DHT11:** Firmware kiểm tra giá trị lỗi (-1, 255, NaN). Nếu lỗi → gửi `null` trong JSON thay vì giá trị sai. Tần suất đọc tối đa ~1 lần/giây.

> **NVS Flash:** `encoderPulseCount` được lưu vào Flash mỗi 2 giây qua `Preferences` (`namespace: "cabin"`, key: `"pulse"`). Cabin tự khôi phục vị trí sau mất điện, không cần về home.

---

#### Mô tả sơ đồ

```
┌─────────────────────────────────────────────────────────────────────┐
│  TẦNG CLIENT (React + Vite + Material-UI)                          │
│  LoginPage | ControlPage | MonitoringDisplay | AdminPage           │
│  ───────────────────────────────────────────────────────────────── │
│  useScada.js (Queue, State)    useOpcUaSocket.js (Real-time)       │
└──────────────────────────┬──────────────────────────┬──────────────┘
                           │ HTTP REST (JWT + CSRF)    │ WebSocket
                           │                           │ Socket.IO
┌──────────────────────────▼──────────────────────────▼──────────────┐
│  TẦNG API SERVER (Node.js + Express 5 + Socket.IO 4)               │
│                                                                     │
│  REST Routes:          Socket.IO Handlers:    UDP Discovery:       │
│  /api/auth             plc:callCabin          Port 3030            │
│  /api/fingerprint      plc:eStop              MEDSCADA_DISCOVER    │
│  /api/specimens        plc:confirmStation                          │
│  /api/sensors          plc:maintenance        Auth Middleware:     │
│  /api/users            scada:stateSync        JWT / CSRF / RBAC   │
│  /api/data             FINGERPRINT_*                               │
└──────────────┬──────────────────────────────────────┬─────────────┘
               │ Prisma ORM                            │ opcua-service.js
               │                                       │ (node-opcua client)
┌──────────────▼──────────┐      ┌─────────────────────▼─────────────┐
│  PostgreSQL Database    │      │  Kepware 6.x (OPC UA Server)       │
│  ─────────────────────  │      │  ─────────────────────────────────  │
│  Users                  │      │  OPC UA TCP: port 49320            │
│  Stations               │      │  Tag prefix: PLC1.Cabin.*          │
│  Specimens              │      │  Polling: 500ms                    │
│  TransportRecords       │      └──────────────────────┬─────────────┘
│  SystemLogs             │                             │ Tag R/W
└─────────────────────────┘      ┌──────────────────────▼─────────────┐
                                  │  PLC Controller                     │
                                  │  ────────────────────────────────── │
                                  │  Điều khiển động cơ cabin           │
                                  │  Cảm biến vị trí (từ trường)        │
                                  │  Cơ cấu nâng/hạ khay               │
                                  └──────────────────────┬─────────────┘
                                                         │ Tín hiệu điện
                                  ┌──────────────────────▼─────────────┐
                                  │  Cabin Robot                        │
                                  │  ────────────────────────────────── │
                                  │  Động cơ DC + Relay thuận/nghịch   │
                                  │  Encoder quang học (80 xung/vòng)  │
                                  │  Đường ray: 369.0 cm               │
                                  └─────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  IoT DEVICES (kết nối song song qua WiFi)                       │
  │                                                                  │
  │  ESP8266 Fingerprint Module:      ESP32 Cabin Sensor Module:    │
  │  ─────────────────────────────    ─────────────────────────     │
  │  • R307 sensor (UART 57600 baud)  • DHT11 (Nhiệt/Độ ẩm)       │
  │  • UDP Discovery port 3030        • MPU6050 (IMU - I2C)         │
  │  • UDP Push trigger port 3031     • Encoder + Relay signal       │
  │  • HTTP GET/POST (API Key)        • UDP Discovery port 3030      │
  │  • WiFi multi-SSID support        • HTTP POST /api/sensors       │
  │  • Captive portal config          • NVS Flash (vị trí tồn tại)  │
  └──────────────────────────────────────────────────────────────────┘
```

### 3.2 Stack Công Nghệ

| Lớp | Công nghệ | Version |
|---|---|---|
| **Frontend** | React + Vite | React 18+ |
| **UI Framework** | Material-UI (MUI) | v5+ |
| **Backend** | Node.js + Express | Express 5.2.1 |
| **Real-time** | Socket.IO | 4.8.3 |
| **OPC UA Client** | node-opcua | 2.169.0 |
| **ORM** | Prisma | 6.17.1 |
| **Database** | PostgreSQL | 14+ |
| **Auth** | JWT + bcryptjs | jsonwebtoken 9.0.3 |
| **Firmware** | Arduino IDE / PlatformIO | C++ / ESP-IDF |
| **Microcontroller** | ESP8266 + ESP32 | — |
| **Fingerprint** | Cảm biến R307 | UART protocol |
| **IMU** | MPU6050 | I2C / raw mode |
| **OPC UA Server** | Kepware 6.x | Industrial |

---

## 4. THÀNH PHẦN PHẦN CỨNG

### 4.1 Module Vân Tay — ESP8266 (NodeMCU)

**File firmware:** `esp8266_fingerprint/esp8266_fingerprint.ino`

#### Sơ Đồ Kết Nối

| Chân ESP8266 | Kết nối | Ghi chú |
|---|---|---|
| D1 / GPIO5 | Fingerprint TX → | UART RX nhận từ R307 |
| D2 / GPIO4 | Fingerprint RX ← | UART TX gửi lệnh R307 |
| 3.3V | Fingerprint VCC | Nguồn cảm biến |
| GND | Fingerprint GND | Mass chung |

#### Chức Năng

- **Đăng nhập vân tay:** Poll server mỗi 3s, khi nhận `mode: "match"` → quét vân tay → POST ID lên `/api/fingerprint/match`.
- **Đăng ký vân tay:** Thực hiện quy trình 2 bước (enroll-step) theo lệnh từ Admin.
- **UDP Auto-Discovery:** Broadcast `MEDSCADA_DISCOVER` trên port 3030 để tự tìm server IP.
- **UDP Push Trigger:** Lắng nghe port 3031, nhận `MEDSCADA_LOGIN_TRIGGER` → poll ngay lập tức (<5ms).
- **Multi-WiFi:** Hỗ trợ nhiều SSID, lưu cấu hình riêng theo từng mạng vào LittleFS.
- **Captive Portal:** Khi không có SSID, mở AP mode + web UI để cấu hình.

### 4.2 Module Cảm Biến Cabin — ESP32 DevKit

**File firmware:** `esp32_cabin_sensor/esp32_cabin_sensor.ino`

#### Sơ Đồ Kết Nối

| GPIO | Thiết bị | Giao tiếp | Ghi chú |
|---|---|---|---|
| GPIO 4 | DHT11 DATA | Digital 1-Wire | 10kΩ pull-up to 3.3V |
| GPIO 21 | MPU6050 SDA | I2C | Địa chỉ 0x68 |
| GPIO 22 | MPU6050 SCL | I2C | |
| GPIO 27 | Encoder DO | Digital Interrupt | INPUT_PULLUP, RISING |
| GPIO 32 | Relay Thuận NC | Digital Input | INPUT_PULLDOWN |
| GPIO 33 | Relay Nghịch NC | Digital Input | INPUT_PULLDOWN |
| GPIO 2 | LED tích hợp | Digital Output | Báo trạng thái |
| 3.3V | DHT11 VCC, MPU6050 VCC | — | Nguồn cảm biến |

#### Thông Số Encoder

| Thông số | Giá trị |
|---|---|
| Số xung / vòng | 80 xung |
| Khoảng di chuyển / vòng | 19.0 cm |
| Độ phân giải | 0.2375 cm/xung |
| Chiều dài đường ray | 369.0 cm (3.690 m) |
| Tổng xung hết đường | ~1553 xung |
| Lưu vị trí | Flash NVS (tồn tại qua mất điện) |

#### Dữ Liệu Gửi Lên Backend

**Gói đầy đủ (mỗi 2 giây) — POST `/api/sensors/cabin`:**
```json
{
  "deviceId": "ESP32-SENSOR-01",
  "temperature": 28.5,
  "humidity": 65.0,
  "accelX": 0.012, "accelY": 0.003, "accelZ": 9.810,
  "gyroX": 0.001, "gyroY": 0.000, "gyroZ": -0.002,
  "stabilityScore": 97.5,
  "positionCm": 184.5,
  "positionPct": 50.0,
  "railLengthCm": 369.0,
  "speedCmPerSec": 15.3,
  "encoderPulses": 776,
  "direction": "TIEN",
  "outOfBounds": false,
  "timestamp": 1234567890
}
```

**Gói nhanh (khi cabin đang di chuyển, mỗi khi có xung mới) — cùng endpoint:**
```json
{
  "deviceId": "ESP32-SENSOR-01",
  "positionCm": 184.8,
  "positionPct": 50.1,
  "railLengthCm": 369.0,
  "speedCmPerSec": 16.0,
  "encoderPulses": 777,
  "direction": "TIEN",
  "outOfBounds": false,
  "fastUpdate": true,
  "timestamp": 1234567891
}
```

#### Thuật Toán Tính Stability Score (Điểm Ổn Định Mẫu)

```
stabilityScore (%) = 100 - (max_vibration_deviation / 5.0) × 100

Trong đó:
  - max_vibration_deviation = |accelY| lớn nhất trong chu kỳ 2 giây (m/s²)
  - Ngưỡng tối đa: 5.0 m/s² (~0.5G) → 0 điểm
  - Rung ≤ 0.5 m/s²: bỏ qua (nhiễu sensor)
  - Đo trục Y (lắc ngang), bỏ qua X (tiến/lùi) và Z (trọng lực)
```

### 4.3 PLC Controller

Hệ thống PLC nhận lệnh từ Kepware qua OPC UA và điều khiển cabin qua tín hiệu điện số (I/O Digital). PLC cũng đọc trạng thái từ các cảm biến vị trí từ trường tại mỗi trạm và gửi ngược lên web qua các Tag OPC UA.

---

## 5. THÀNH PHẦN PHẦN MỀM

### 5.1 Frontend — React Application

**Thư mục:** `frontend/src/`

#### Cấu Trúc Pages

| Page | File | Chức năng |
|---|---|---|
| **LoginPage** | `LoginPage.jsx` | Đăng nhập mật khẩu hoặc vân tay (phòng chờ WebSocket) |
| **HubPage** | `HubPage.jsx` | Trang hub chọn chức năng sau đăng nhập |
| **MonitoringDisplay** | `MonitoringDisplay.jsx` | Giám sát: bản đồ SVG, KPI cards, trạng thái trạm, cảm biến |
| **ControlPage** | `ControlPage.jsx` | Điều khiển: quét barcode, gọi cabin, xác nhận lấy/giao hàng |
| **AdminPage** | `AdminPage.jsx` | Quản trị: CRUD users, import Excel, phân trạm, gán vân tay |

#### Danh Sách Components

| Component | Chức năng |
|---|---|
| `ScadaSVGMap` | Bản đồ SVG động, animation cabin di chuyển theo encoder data |
| `CabinSensorPanel` | Panel hiển thị sensor real-time: nhiệt độ, độ ẩm, ổn định |
| `EStopButton` | Nút dừng khẩn cấp, nhấp nháy đỏ khi E-Stop active |
| `StationControlCard` | Card điều khiển từng trạm: gọi cabin, xác nhận |
| `SpecimenScanPanel` | Panel quét barcode mẫu bệnh phẩm |
| `ExcelImportPanel` | Upload và import danh sách mẫu từ file Excel |
| `SensorChartDialog` | Đồ thị lịch sử cảm biến (nhiệt độ, rung, tốc độ) |
| `TransportHistoryDialog` | Lịch sử vận chuyển có thể lọc và xuất |
| `ControlAuthDialog` | Xác nhận quyền truy cập trang điều khiển |
| `ErrorBoundary` | Bẫy lỗi React, hiển thị fallback UI |
| `PrioritySelector` | Chọn ưu tiên ROUTINE / STAT cho mẫu |

#### Custom Hooks

**`useScada.js`** (92KB — Core State Manager):
- Quản lý toàn bộ state: stations, queue, specimens, cabin position, sensor data.
- Implement thuật toán LOOK Scheduler cho hàng đợi cabin.
- Xử lý animation path cabin trên SVG (Bezier curve interpolation).
- Đồng bộ dữ liệu với backend qua HTTP REST.

**`useOpcUaSocket.js`** (16KB — Real-time Bridge):
- Kết nối và duy trì WebSocket với Socket.IO server.
- Xử lý các sự kiện: `plc:snapshot`, `plc:currentStation`, `plc:cabinReady`, `plc:eStopStatus`, `sensor:cabinData`.
- Phát lại sự kiện lên `useScada` để cập nhật UI.

**`useAudioAlerts.js`** (5KB — Sound Notifications):
- Phát âm thanh thông báo khi cabin đến trạm.
- Cảnh báo âm thanh khi E-Stop kích hoạt.

#### Topology Trạm (Rail Points)

```
[ST-01 Trung Tâm]──────────────[Nút chuyển]
                                        |
                              [ST-02 Xét Nghiệm]──────────[ST-03 Vi Sinh]
                                                                   |
                                                         [Nút chuyển]──────[ST-04 PCR]
```

**Tọa độ SVG (px):**
| Point | X | Y | Trạm |
|---|---|---|---|
| 0 | 150 | 100 | ST-01 Trung Tâm |
| 1 | 350 | 100 | Nút chuyển 1 |
| 2 | 550 | 210 | ST-02 Xét Nghiệm |
| 3 | 1050 | 210 | ST-03 Vi Sinh |
| 4 | 1250 | 320 | Nút chuyển 2 |
| 5 | 1450 | 320 | ST-04 PCR |

### 5.2 Backend — Node.js API Server

**File chính:** `backend/server.js`

#### REST API Endpoints

| Method | Endpoint | Chức năng | Auth |
|---|---|---|---|
| POST | `/api/auth/login` | Đăng nhập mật khẩu | Public |
| POST | `/api/auth/fingerprint-session` | Đổi token → HTTPOnly Cookie | Public |
| POST | `/api/auth/logout` | Xóa cookie | JWT |
| GET | `/api/auth/me` | Lấy thông tin user hiện tại | JWT |
| GET | `/api/users` | Danh sách users | JWT + TECH |
| POST | `/api/users` | Tạo user mới | JWT + TECH |
| PUT | `/api/users/:id` | Cập nhật user | JWT + TECH |
| DELETE | `/api/users/:id` | Xóa (soft-delete) user | JWT + TECH |
| GET | `/api/fingerprint/status` | Trạng thái chế độ vân tay | API Key |
| POST | `/api/fingerprint/match` | Xác thực vân tay → phát JWT | API Key |
| POST | `/api/fingerprint/enroll-step` | Từng bước đăng ký vân tay | API Key |
| POST | `/api/fingerprint/enroll` | Hoàn tất đăng ký | API Key |
| GET | `/api/specimens` | Danh sách mẫu bệnh phẩm | JWT |
| POST | `/api/specimens` | Tạo mẫu mới | JWT |
| GET | `/api/specimens/:id` | Chi tiết mẫu | JWT |
| POST | `/api/sensors/cabin` | Nhận dữ liệu ESP32 sensor | API Key |
| GET | `/api/data/bootstrap` | Dữ liệu khởi động app | JWT |
| GET | `/api/data/events` | Lịch sử sự kiện hệ thống | JWT |
| GET | `/api/health` | Kiểm tra sức khỏe server | Public |

#### Socket.IO Events

**Client → Server:**
| Event | RBAC | Mô tả |
|---|---|---|
| `plc:callCabin` | Authenticated | Điều cabin đến trạm, kèm RBAC check vị trí |
| `plc:eStop` | Authenticated | Kích hoạt/nhả E-Stop |
| `plc:reset` | TECH only | Reset lỗi PLC |
| `plc:confirmStation` | Authenticated | Xác nhận tạo lộ trình (Confirm_CMD1) |
| `plc:confirmStop` | Authenticated | Xác nhận nhận/giao hàng (Confirm_CMD) |
| `plc:confirmPickup` | Authenticated | Lấy hàng (Confirm_CMD2) |
| `plc:maintenance` | TECH only | Bật/tắt chế độ bảo trì |
| `scada:stateSync` | Authenticated | Broadcast state sang tab khác |
| `FINGERPRINT_LOGIN_WAIT` | Public | Đăng ký phòng chờ đăng nhập vân tay |
| `FINGERPRINT_LOGIN_CANCEL` | Public | Hủy chờ vân tay |
| `FINGERPRINT_ENROLL_START` | TECH only | Bắt đầu đăng ký vân tay |
| `FINGERPRINT_ENROLL_CANCEL` | TECH only | Hủy đăng ký |

**Server → Client:**
| Event | Mô tả |
|---|---|
| `plc:snapshot` | Snapshot tổng hợp tất cả Tag PLC |
| `plc:currentStation` | Cập nhật vị trí cabin (station ID + raw int) |
| `plc:cabinReady` | Cabin ready/busy flag |
| `plc:robotStatus` | Nhãn trạng thái: "Sẵn sàng", "Đang di chuyển", "Dừng khẩn cấp" |
| `plc:eStopStatus` | Trạng thái E-Stop từ PLC |
| `plc:connectionStatus` | OPC UA connected/disconnected |
| `scada:stateSync` | State broadcast từ tab khác |
| `sensor:cabinData` | Dữ liệu cảm biến cabin real-time |
| `LOGIN_SUCCESS` | Đăng nhập vân tay thành công (kèm JWT) |
| `LOGIN_ERROR` | Lỗi đăng nhập vân tay |

### 5.3 OPC UA Service — `opcua-service.js`

**Thư viện:** `node-opcua` v2.169.0

#### Tag OPC UA (Prefix: `ns=2;s=PLC1.Cabin.`)

**READ Tags (PLC → Web, được monitor subscription):**
| Tag | Kiểu | Mô tả |
|---|---|---|
| `Current_Station` | Int (1-4) | Vị trí thực tế cabin |
| `Robot_Status` | Int (0/1/2) | 0=Sẵn sàng, 1=Di chuyển, 2=Lỗi |
| `Cabin_Ready` | Bool | TRUE=Sẵn sàng nhận lệnh mới |
| `E-Stop_CMD` | Bool | TRUE=E-Stop đang kích hoạt |

**WRITE Tags (Web → PLC):**
| Tag | Kiểu | Mô tả |
|---|---|---|
| `Target_Station` | UInt16 | Trạm đích (1-4) |
| `Confirm_CMD` | Bool | Xác nhận nhận/giao hàng tại trạm |
| `Confirm_CMD1` | Bool | Kích hoạt tạo lộ trình |
| `Confirm_CMD2` | Bool | Lấy hàng tại trạm |
| `Maintenance_Mode` | Bool | Chế độ bảo trì (maintained signal) |

#### Cơ Chế Handshake Confirm

Các lệnh `Confirm_CMD`, `Confirm_CMD1`, `Confirm_CMD2` hoạt động theo cơ chế auto-reset:
1. Web ghi `TRUE` vào tag.
2. Sau 300ms, web tự ghi lại `FALSE`.
3. PLC bắt sườn lên → thực thi → tự reset nếu cần.

> **Lý do:** Tránh kẹt lệnh khi mạng có độ trễ cao, PLC không cần logic nhả nút phức tạp.

#### Cấu Hình Kết Nối OPC UA

| Tham số | Giá trị |
|---|---|
| Endpoint | `opc.tcp://127.0.0.1:49320` (configurable) |
| Security Mode | None (không mã hóa, LAN nội bộ) |
| Sampling Interval | 500ms |
| Reconnect initial delay | 2000ms |
| Reconnect max delay | 30000ms |
| Backoff factor | 1.5× |
| Session timeout | 60s |
| Max publish requests | 3 (tránh warning Kepware) |

---

## 6. CƠ SỞ DỮ LIỆU

### 6.1 Schema (Prisma / PostgreSQL)

#### Bảng `User`
| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | Int (PK) | ID tự tăng |
| `username` | String (unique) | Tên đăng nhập |
| `passwordHash` | String | Mật khẩu bcrypt |
| `fullname` | String | Họ tên đầy đủ |
| `role` | Enum: TECH/OPERATOR | Vai trò |
| `active` | Boolean | Tài khoản hoạt động |
| `fingerprintId` | Int? (unique) | ID vân tay trong R307 |
| `stationId` | String? | Trạm được phân công |
| `createdAt` | DateTime | Thời gian tạo |

#### Bảng `Station`
| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | String (PK) | Ví dụ: "ST-01" |
| `name` | String | Tên hiển thị |
| `locationIndex` | Int (unique) | Vị trí trên rail (0,2,3,5) |

**Dữ liệu mặc định:**
| ID | Tên | locationIndex |
|---|---|---|
| ST-01 | Trung Tâm | 0 |
| ST-02 | Xét Nghiệm | 2 |
| ST-03 | Vi Sinh | 3 |
| ST-04 | PCR | 5 |

#### Bảng `Specimen` (Mẫu bệnh phẩm)
| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | Int (PK) | ID tự tăng |
| `barcode` | String (unique) | Mã vạch mẫu |
| `patientName` | String | Tên bệnh nhân |
| `testType` | String | Loại xét nghiệm (CBC, PCR, v.v.) |
| `priority` | Enum: STAT/ROUTINE | Độ ưu tiên |
| `status` | Enum: PENDING/SCANNED/IN_TRANSIT/COMPLETED | Trạng thái |
| `scanTime` | DateTime? | Thời gian quét |
| `scannedById` | Int? (FK→User) | Người quét |
| `destinationStationId` | String? (FK→Station) | Trạm đích |

#### Bảng `TransportRecord` (Lịch sử vận chuyển)
| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | Int (PK) | ID tự tăng |
| `cabinId` | String | ID cabin (hiện tại: "CABIN-01") |
| `status` | Enum: RUNNING/ARRIVED/ERROR | Trạng thái chuyến |
| `dispatchTime` | DateTime | Thời điểm xuất phát |
| `arrivalTime` | DateTime? | Thời điểm đến nơi |
| `specimenId` | Int (FK→Specimen) | Mẫu được vận chuyển |
| `fromStationId` | String (FK→Station) | Trạm xuất phát |
| `toStationId` | String (FK→Station) | Trạm đích |

#### Bảng `SystemLog`
| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | Int (PK) | ID tự tăng |
| `event` | String | Nội dung sự kiện |
| `type` | String | Loại: info/warning/error |
| `userId` | Int? (FK→User) | Người thực hiện |
| `createdAt` | DateTime | Thời gian ghi log |

### 6.2 Quan Hệ Dữ Liệu

```
User ─────────── scannedSpecimens ──────────── Specimen
User ─────────── systemLogs ─────────────────── SystemLog
Station ─────── fromTransports ──────────────── TransportRecord
Station ─────── toTransports ────────────────── TransportRecord
Station ─────── destinationSpecimens ─────────── Specimen
Specimen ───── transportRecords ──────────────── TransportRecord
```

---

## 7. GIAO THỨC TRUYỀN THÔNG

### 7.1 Bảng Tổng Hợp

| Từ | Đến | Giao thức | Port | Xác thực | Tần suất |
|---|---|---|---|---|---|
| React Client | Node.js Backend | HTTP/HTTPS REST | 3000 | JWT Cookie + CSRF Token | On-demand |
| React Client | Socket.IO Server | WebSocket / Long-polling | 3000 | Cookie Session | Persistent |
| ESP8266 | Node.js Backend | HTTP REST | 3000 | `X-API-Key` (ESP32_API_KEY) | Poll 3s |
| ESP8266 | UDP Discovery | UDP Broadcast | 3030 | Payload matching | On-demand |
| ESP8266 | UDP Push Trigger | UDP Unicast/BC | 3031 | Payload matching | On event |
| ESP32 Cabin | Node.js Backend | HTTP REST POST | 3000 | `X-API-Key` (SENSOR_API_KEY) | 2s + fast |
| ESP32 Cabin | UDP Discovery | UDP Broadcast | 3030 | Payload matching | On-demand |
| opcua-service | Kepware 6.x | OPC UA TCP | 49320 | Endpoint (no security) | Persistent |
| Kepware | PLC Controller | OPC UA + Industrial | — | Industrial protocol | Real-time |
| PLC | Cabin Robot | Tín hiệu điện I/O | — | Hardware | Real-time |
| ESP32 | R307 Sensor | UART Serial | — | None | Polling |

### 7.2 UDP Auto-Discovery Protocol

**Bước 1 — Device broadcast:**
```
Device → 255.255.255.255:3030 → "MEDSCADA_DISCOVER"
```

**Bước 2 — Server reply (2 cơ chế):**
```
a) Unicast: Server → Device_IP:Device_port → "MEDSCADA_SERVER:3000"
b) Broadcast: Server → Subnet_broadcast:3030 → "MEDSCADA_SERVER:3000" (mỗi 2s)
```

**Bước 3 — Device lưu cấu hình:**
```
Device lưu URL = "http://{server_ip}:3000" vào Flash theo SSID
```

**Cơ chế dự phòng:** Server chủ động broadcast mỗi 2 giây để bypass Windows Firewall, tránh device phải chờ broadcast tiếp theo.

### 7.3 UDP Login Push Trigger (port 3031)

Khi user nhấn nút đăng nhập vân tay trên web:
```
Server → 255.255.255.255:3031 → "MEDSCADA_LOGIN_TRIGGER"
```
ESP8266 nghe port 3031, nhận trigger → poll server ngay lập tức (thay vì chờ 3s).
Kết quả: Giảm latency đăng nhập từ ~3s xuống <5ms (trên LAN).

---

## 8. LUỒNG KẾT NỐI TỔNG THỂ

```
👆 Cảm biến R307 (vân tay)
    │
    │ UART 57600 baud
    │
📟 ESP8266 NodeMCU (Fingerprint Module)
    │                    ↑
    │ UDP:3030           │ UDP:3031 (Login Trigger)
    │ UDP:3031           │
    │                    │
    │ HTTP GET  /api/fingerprint/status  (X-API-Key)
    │ HTTP POST /api/fingerprint/match   (X-API-Key)
    │ HTTP POST /api/fingerprint/enroll* (X-API-Key)
    │
📟 ESP32 DevKit (Cabin Sensor Module)
    │
    │ HTTP POST /api/sensors/cabin (X-API-Key)
    │ [every 2s full + fast updates on encoder change]
    │
    ▼
⚙️  Node.js + Express Backend (Port 3000)
    │
    ├── 🔌 Socket.IO Server
    │       │ plc:snapshot, sensor:cabinData, LOGIN_SUCCESS
    │       │ (→ push to React clients)
    │
    ├── 🛣️  REST API Routes
    │       │
    │       ▼
    │   🔷 Prisma ORM
    │       │
    │       ▼
    │   🐘 PostgreSQL (Port 5432)
    │
    ├── 📦 opcua-service.js
    │       │ OPC UA TCP opc.tcp://127.0.0.1:49320
    │       │ Subscription: poll tags 500ms
    │       ▼
    │   ⚙️  Kepware 6.x (OPC UA Server)
    │       │ Tag: PLC1.Cabin.*
    │       ▼
    │   🟦 PLC Controller
    │       │ Digital I/O
    │       ▼
    │   🚃 Cabin Robot (Motor + Encoder + Relay)
    │
    └── 📡 UDP Discovery (Port 3030)
            └── Broadcast mỗi 2s: "MEDSCADA_SERVER:3000"

🖥️  React Frontend (Port 5173 dev / 3000 prod)
    │
    ├── HTTP REST (JWT Cookie + CSRF)
    │   └── Nhận/gửi dữ liệu on-demand
    │
    └── WebSocket (Socket.IO)
        └── Nhận real-time updates:
            ├── plc:snapshot → cập nhật bản đồ SVG
            ├── sensor:cabinData → cập nhật panel sensor
            ├── scada:stateSync → đồng bộ multi-tab
            └── LOGIN_SUCCESS → đăng nhập tự động
```

---

## 9. CÁC LUỒNG NGHIỆP VỤ CHÍNH

### 9.1 Luồng Đăng Nhập Mật Khẩu

```
1. User nhập username/password → POST /api/auth/login
2. Backend verify bcrypt hash → tạo JWT (8h expiry)
3. POST /api/auth/fingerprint-session để đổi token lấy HTTPOnly Cookie
4. Frontend lưu cookie, chuyển đến HubPage
```

### 9.2 Luồng Đăng Nhập Vân Tay

```
1. User nhấn "Đăng nhập vân tay" trên web
2. Frontend emit socket: FINGERPRINT_LOGIN_WAIT
3. Server join socket vào "fingerprint-login-waiters" room
4. Server broadcast UDP "MEDSCADA_LOGIN_TRIGGER" → port 3031
5. ESP8266 nhận trigger → poll GET /api/fingerprint/status ngay lập tức
6. API trả về {mode: "match"} → ESP8266 ở chế độ chờ vân tay
7. User đặt ngón tay → R307 trả về ID (vd: 42)
8. ESP8266 POST /api/fingerprint/match {fingerprintId: 42}
9. Backend tìm User theo fingerprintId=42 → tạo JWT
10. Backend emit socket LOGIN_SUCCESS {token, user} → room "fingerprint-login-waiters"
11. Frontend nhận → POST /api/auth/fingerprint-session → set Cookie
12. Chuyển hướng vào Dashboard
```

### 9.3 Luồng Điều Phối Cabin

```
1. Vận hành viên quét barcode mẫu bệnh phẩm (camera hoặc máy quét)
2. Frontend POST /api/specimens để tạo/cập nhật mẫu
3. Vận hành viên chọn trạm đích → nhấn "Gọi cabin"
4. Frontend RBAC check: operator có đúng stationId không?
5. Frontend emit: plc:callCabin {stationNumber, stationId, isStat}
6. Backend RBAC check lần 2 (JWT payload)
7. opcua-service.js: writeTag Target_Station = N
8. Kepware nhận write → forward xuống PLC
9. PLC kích motor → cabin bắt đầu di chuyển
10. PLC cập nhật Current_Station khi đến nơi → Cabin_Ready=FALSE
11. opcua-service subscription nhận change → emit plc:snapshot
12. Frontend cập nhật bản đồ SVG
13. Vận hành viên bấm Xác Nhận → emit plc:confirmStop
14. Backend write Confirm_CMD=TRUE → 300ms → FALSE
15. PLC nhận sườn lên → chạy cơ cấu nâng hạ → set Cabin_Ready=TRUE
16. Web nhận Cabin_Ready=TRUE → lấy task tiếp theo từ queue
```

### 9.4 Luồng Cảm Biến Cabin

```
1. ESP32 khởi động → kết nối WiFi → UDP discovery tìm server
2. Vị trí được khôi phục từ Flash NVS (encoder pulses)
3. Encoder ISR đếm xung RISING, xác định hướng từ Relay signal
4. Mỗi khi xung thay đổi → sendFastPosition() (gói ~80 byte)
5. Mỗi 2 giây → sendSensorData() (gói đầy đủ DHT11 + MPU6050 + encoder)
6. MPU6050 đọc mỗi 20ms → tính max_vibration_deviation trong 2s
7. calcStabilityScore() → gửi kèm gói 2s
8. Backend /api/sensors/cabin nhận → emit sensor:cabinData qua Socket.IO
9. Frontend CabinSensorPanel cập nhật real-time
10. ScadaSVGMap dùng positionPct để vẽ vị trí cabin trên rail
```

### 9.5 Luồng Import Mẫu Từ Excel

```
1. TECH user upload file Excel (DanhSachMau.xlsx)
2. Frontend ExcelImportPanel parse file (XLSX library)
3. Hiển thị preview, user xác nhận
4. POST /api/specimens/batch với danh sách mẫu
5. Backend validate + upsert từng mẫu (theo barcode)
6. Trả về kết quả: thành công/thất bại từng dòng
```

---

## 10. BẢO MẬT HỆ THỐNG

### 10.1 Xác Thực

| Cơ chế | Mô tả |
|---|---|
| **JWT (JSON Web Token)** | Payload chứa: `sub`, `username`, `role`, `stationId`. Hết hạn sau 8h. |
| **HTTPOnly Cookie** | Token lưu trong cookie `scada_access_token`, không truy cập được từ JavaScript. |
| **CSRF Token** | Cookie `scada_csrf_token` + header `x-csrf-token`. Mỗi request modifying phải có header khớp. |
| **bcryptjs** | Mật khẩu hash với salt rounds mặc định. |
| **API Key** | ESP32/ESP8266 dùng `X-API-Key` header, tách biệt khỏi JWT. |

### 10.2 Phân Quyền (RBAC)

| Role | Quyền |
|---|---|
| **TECH** | Toàn quyền: CRUD users, gán vân tay/trạm, reset PLC, bật bảo trì, xem admin |
| **OPERATOR** | Giám sát + điều khiển trạm của mình. Không thể gọi cabin trạm khác. |

**Double RBAC:**
- **Frontend:** Ẩn/khóa nút theo `stationId` trong state.
- **Backend:** Socket handler kiểm tra lại `stationId` trong JWT payload → từ chối nếu không khớp.

### 10.3 Security Headers & CORS

- **CORS:** Chỉ cho phép origin trong `FRONTEND_ORIGINS` (production). Dev mode: mở.
- **E-Stop failsafe:** Tag `E-Stop_CMD` chỉ được đọc từ PLC, web không ghi đè.
- **Production check:** Nếu `NODE_ENV=production` mà không có `JWT_SECRET` hoặc dùng API key mặc định → server từ chối khởi động.

---

## 11. THUẬT TOÁN ĐIỀU PHỐI — LOOK SCHEDULER

### 11.1 Bài Toán

Khi nhiều trạm gọi cabin cùng lúc, cần quyết định thứ tự phục vụ tối ưu.

### 11.2 Nguyên Lý

Thuật toán LOOK (biến thể của thuật toán thang máy):
1. Cabin di chuyển theo một hướng, phục vụ tất cả yêu cầu trên đường đi.
2. Khi không còn yêu cầu phía trước, đổi chiều.
3. Lệnh **STAT (khẩn cấp)** được ưu tiên tuyệt đối, chen vào đầu queue.

### 11.3 Ví Dụ

```
Cabin đang ở: ST-02 (locationIndex=2), hướng tăng
Queue: [ST-04, ST-01, ST-03]

LOOK sẽ phục vụ: ST-03 → ST-04 → đổi chiều → ST-01

STAT override:
Queue: [ST-04, ST-01]  →  STAT ST-02 đến  →  Queue: [ST-02(STAT), ST-04, ST-01]
```

### 11.4 Cabin Ready Gate

Hệ thống chỉ pop task tiếp theo từ queue khi **ĐỒNG THỜI**:
- Queue có phần tử.
- `Cabin_Ready == TRUE` (PLC xác nhận cabin rảnh).

---

## 12. CẤU HÌNH MÔI TRƯỜNG

### 12.1 Biến Môi Trường Backend (`.env`)

| Biến | Giá trị mặc định | Mô tả |
|---|---|---|
| `PORT` | `3000` | Port backend |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/robot_ui` | Kết nối PostgreSQL |
| `JWT_SECRET` | *(required)* | Khóa ký JWT |
| `JWT_EXPIRES_IN` | `8h` | Thời gian sống JWT |
| `ESP32_API_KEY` | `esp32-fingerprint-secret-change-me` | API key vân tay |
| `SENSOR_API_KEY` | `esp32-sensor-secret-change-me` | API key sensor cabin |
| `OPCUA_ENDPOINT` | `opc.tcp://127.0.0.1:49320` | Địa chỉ Kepware |
| `FRONTEND_ORIGINS` | `http://localhost:5173,...` | CORS whitelist |

### 12.2 Biến Môi Trường Frontend (Vite)

| Biến | Giá trị | Mô tả |
|---|---|---|
| `VITE_API_BASE_URL` | *(rỗng = dùng proxy)* | URL backend API |
| `VITE_SOCKET_URL` | *(rỗng = same origin)* | URL Socket.IO |
| `VITE_SIMULATION_MODE` | `true` | Bật simulation khi không có PLC |

---

## 13. HƯỚNG DẪN CÀI ĐẶT & VẬN HÀNH

### 13.1 Yêu Cầu Hệ Thống

- **Node.js** ≥ 18
- **npm** ≥ 9
- **Docker Desktop** (cho PostgreSQL) hoặc PostgreSQL local
- **Arduino IDE** hoặc **PlatformIO** (để nạp firmware)
- **Kepware 6.x** (tuỳ chọn — cần khi kết nối PLC thật)

### 13.2 Cài Đặt Lần Đầu

```powershell
# 1. Sao chép file cấu hình
Copy-Item .env.example .env

# 2. Cài đặt dependencies
npm install

# 3. Khởi động PostgreSQL (Docker)
npm run db:up

# 4. Chạy migration database
npm run prisma:migrate

# 5. Khởi động development server (frontend + backend song song)
npm run dev
```

**Frontend:** http://localhost:5173  
**Backend:** http://localhost:3000  
**Prisma Studio:** `npm run prisma:studio` → http://localhost:5555

### 13.3 Tài Khoản Demo

Tạo tài khoản đầu tiên từ màn hình login (nếu DB rỗng), hoặc chạy seed:

```bash
node backend/seed.js
```

| Username | Password | Role |
|---|---|---|
| `admin` | `123456` | TECH |

### 13.4 Nạp Firmware

**ESP8266 Fingerprint:**
```
File: esp8266_fingerprint/esp8266_fingerprint.ino
Board: NodeMCU 1.0 (ESP-12E Module)
Libraries: Adafruit Fingerprint Sensor, WiFiSettings, ArduinoJson
```

**ESP32 Cabin Sensor:**
```
File: esp32_cabin_sensor/esp32_cabin_sensor.ino
Board: ESP32 Dev Module  
Libraries: DHT11 (by Dhruba Saha), ArduinoJson v7, WiFiSettings
```

**Cấu hình sau khi nạp:**
1. Thiết bị khởi động → mở AP "MedSCADA_Fingerprint" hoặc "MedSCADA_Cabin_Sensor".
2. Kết nối WiFi vào AP → truy cập `http://192.168.4.1`.
3. Chọn mạng WiFi, nhập mật khẩu, Backend URL và API Key.
4. Lưu → thiết bị tự khởi động lại, kết nối và tự động tìm server.

### 13.5 Khởi Động Production

```powershell
# Script khởi động đầy đủ (ẩn cửa sổ)
start-full-program-hidden.vbs

# Script dừng
stop-full-program.bat
```

---

## 14. KIỂM THỬ & XÁC THỰC

### 14.1 Lệnh Kiểm Tra

```bash
# Lint frontend
npm run lint

# Build production
npm run build

# Validate Prisma schema
npx prisma validate

# Test OPC UA write (khi có Kepware)
node backend/test_write.js

# Check server status
node backend/check_status.js

# Discover OPC UA tags
node backend/discover_tags.js
```

### 14.2 Luồng Demo Kiểm Thử

1. Khởi động database, backend, frontend.
2. Đăng ký/đăng nhập tài khoản `tech`.
3. Vào Admin → tạo operator và gán trạm.
4. Vào ControlPage → quét barcode mẫu bệnh phẩm.
5. Gọi/dispatch cabin đến trạm đích.
6. Quan sát MonitoringDisplay: vị trí cabin, hàng đợi, sensor, độ ổn định.
7. Thử E-Stop / reset.
8. Kiểm tra lịch sử vận chuyển (TransportHistoryDialog).

### 14.3 Simulation Mode

Khi `VITE_SIMULATION_MODE=true`:
- Cabin di chuyển mô phỏng trên SVG mà không cần PLC thật.
- Thời gian di chuyển tính theo khoảng cách và tốc độ `SPEED_PX_PER_SEC = 200`.
- Dữ liệu sensor có thể gửi từ ESP32 thật hoặc dùng dữ liệu giả.

---

## 15. QUYẾT ĐỊNH KIẾN TRÚC QUAN TRỌNG

### ADR-01: Decoupled Hardware Authentication

**Quyết định:** ESP8266/ESP32 không tương tác trực tiếp với Database mà thông qua API được bảo vệ bằng API Key riêng.

**Lý do:** Cho phép thay thế phần cứng (ESP8266 → ESP32, R307 → cảm biến khác) mà không ảnh hưởng đến backend. API Key có thể xoay (rotate) độc lập với JWT.

### ADR-02: Double RBAC (Frontend + Backend)

**Quyết định:** Frontend ẩn/khóa nút, Backend kiểm tra lại độc lập trong JWT.

**Lý do:** Frontend RBAC là UX (tránh hiển thị nút vô ích), không phải security. Backend mới là điểm kiểm soát thực sự, chặn bypass qua console/API tools.

### ADR-03: LOOK Scheduler thay vì FIFO đơn giản

**Quyết định:** Implement thuật toán elevator LOOK thay vì xử lý lần lượt.

**Lý do:** Giảm quãng đường di chuyển tổng thể khi có nhiều yêu cầu. STAT override đảm bảo không có mẫu khẩn cấp bị trì hoãn.

### ADR-04: State Hydration qua Socket.IO

**Quyết định:** Khi tab mới mở hoặc mất kết nối, server push toàn bộ snapshot state hiện tại.

**Lý do:** Tránh tình trạng nhiều tab có state khác nhau dẫn đến quyết định điều khiển sai. Đặc biệt quan trọng trong môi trường y tế.

### ADR-05: E-Stop Failsafe — PLC làm chủ

**Quyết định:** Tag `E-Stop_CMD` chỉ được đọc từ PLC. Web không ghi đè giá trị này.

**Lý do:** E-Stop phần cứng tại tủ điện luôn có quyền cao nhất. Web không được phép "giả" trạng thái E-Stop hoặc can thiệp vào cơ chế an toàn cứng.

### ADR-06: UDP Auto-Discovery thay vì IP cứng

**Quyết định:** Cả hai IoT device dùng UDP broadcast để tìm server.

**Lý do:** IP server có thể thay đổi theo mạng. UDP discovery giúp deploy ở nhiều môi trường khác nhau mà không cần reflash firmware.

### ADR-07: NVS Flash cho vị trí Encoder

**Quyết định:** ESP32 lưu `encoderPulseCount` vào Flash NVS mỗi 2 giây.

**Lý do:** Khi mất điện hoặc reset, cabin không cần về home để calibrate lại. Vị trí được khôi phục chính xác từ lần hoạt động trước. NVS có độ bền ~100,000 lần ghi/cell, đủ dùng >13 năm ở tần suất 2s/lần.

---

## 16. HẠN CHẾ & HƯỚNG PHÁT TRIỂN

### 16.1 Hạn Chế Hiện Tại (Phiên Bản Demo)

| Hạn chế | Mô tả |
|---|---|
| **Rate limiting** | Chưa có giới hạn request — dễ bị DoS |
| **Challenge đăng nhập vân tay** | Không có one-time challenge → có thể replay tấn công |
| **Sensor telemetry** | Dữ liệu sensor lưu trong RAM buffer, mất khi restart |
| **Audit log** | Log cơ bản, chưa đủ cho môi trường y tế thực tế |
| **TLS/HTTPS** | Chưa có SSL trong cấu hình demo |
| **Secret management** | API key hardcode trong firmware (nên dùng secrets vault) |
| **Multi-cabin** | Hệ thống thiết kế cho 1 cabin (CABIN-01) |

### 16.2 Hướng Phát Triển

1. **Bảo mật nâng cao:** TLS end-to-end, rate limiting (express-rate-limit), one-time challenge cho vân tay.
2. **Telemetry database:** Lưu dữ liệu cảm biến vào InfluxDB/TimescaleDB để phân tích lịch sử.
3. **Đa cabin:** Mở rộng schema và logic để hỗ trợ nhiều cabin trên cùng hệ thống ray.
4. **Alerting:** Gửi email/SMS khi E-Stop, sensor bất thường, hoặc cabin bị kẹt.
5. **Dashboard analytics:** Biểu đồ thống kê năng suất, uptime, phân bổ tải theo trạm.
6. **Mobile app:** React Native cho vận hành viên di động.
7. **OPC UA Security:** Bật MessageSecurityMode.SignAndEncrypt cho môi trường production.

---

## PHỤ LỤC

### A. Cấu Trúc Thư Mục Dự Án

```
robot-ui/
├── frontend/                    # React + Vite application
│   └── src/
│       ├── components/          # 18 React components
│       ├── hooks/               # useScada, useOpcUaSocket, useAudioAlerts
│       ├── contexts/            # React contexts
│       ├── utils/               # Helper functions
│       ├── constants.js         # Centralized constants
│       └── theme.js             # MUI theme configuration
├── backend/                     # Node.js Express API
│   ├── routes/                  # 6 route modules
│   ├── services/                # fingerprint-session, sync
│   ├── socket/                  # handlers.js (Socket.IO)
│   ├── middleware/              # auth.js (JWT, CSRF)
│   ├── opcua-service.js         # OPC UA client
│   ├── config.js                # Central config
│   └── server.js                # Entry point
├── prisma/
│   ├── schema.prisma            # Database schema (5 models)
│   └── migrations/             # Migration history
├── esp8266_fingerprint/         # ESP8266 firmware (Arduino)
│   └── esp8266_fingerprint.ino
├── esp32_cabin_sensor/          # ESP32 sensor firmware (Arduino)
│   └── esp32_cabin_sensor.ino
├── esp32/                       # ESP32 fingerprint (PlatformIO)
├── scripts/                     # Setup scripts (PowerShell)
├── ARCHITECTURE.md              # Architecture documentation
├── OPC_UA_Communication_Spec.md # OPC UA tag specification
└── docker-compose.yml           # PostgreSQL container
```

### B. Dependencies Chính

**Backend (`backend/package.json`):**
- `express` ^5.2.1 — HTTP framework
- `socket.io` ^4.8.3 — WebSocket
- `node-opcua` ^2.169.0 — OPC UA client
- `@prisma/client` ^6.17.1 — ORM
- `jsonwebtoken` ^9.0.3 — JWT
- `bcryptjs` ^3.0.3 — Password hashing
- `xlsx` ^0.18.5 — Excel parsing
- `multer` ^2.1.1 — File upload

**Root (`package.json`):**
- `prisma` ^6.17.1 — Schema + migrations
- `concurrently` ^9.2.1 — Run FE+BE parallel

### C. OPC UA Workflow Example (từ spec)

```
1. [PLC] Cabin đến Trạm 2 → Current_Station=2 → Cabin_Ready=FALSE (báo bận)
2. [WEB] Đọc Current_Station=2 → bật đèn UI Trạm 2
3. [WEB] Queue có lệnh đi Trạm 3, nhưng Cabin_Ready==FALSE → giữ lệnh, chờ
4. [TỦ ĐIỆN / WEB] Y tá bấm xác nhận → Web ghi Confirm_CMD=TRUE
5. [PLC] Nhận sườn lên → xóa Confirm_CMD=0 → chạy cơ cấu nâng hạ khay
6. [PLC] Chu trình kết thúc → Cabin_Ready=TRUE (báo sẵn sàng)
7. [WEB] Đọc Cabin_Ready==TRUE → ghi Target_Station=3
8. [PLC] Nhận lệnh → Cabin di chuyển sang Trạm 3
```

---

## 17. TỔNG HỢP TOÀN BỘ PHƯƠNG THỨC KẾT NỐI

> Liệt kê **đầy đủ và lần lượt** phương thức giao tiếp của mọi thành phần trong hệ thống, từ phần cứng vật lý đến web client. Mỗi kết nối ghi rõ: giao thức, hướng dữ liệu, endpoint/địa chỉ, xác thực và tần suất.

---

### 17.1 Nhóm A — Phần Cứng Vật Lý (Cảm biến → Vi điều khiển)

#### A1. Cảm biến vân tay R307 ↔ ESP8266 NodeMCU

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | UART Serial (TTL 3.3V) |
| **Tốc độ baud** | 57,600 bps |
| **Chân kết nối** | ESP8266 `D1/GPIO5` → R307 `RX` (TX từ ESP) |
| | ESP8266 `D2/GPIO4` ← R307 `TX` (RX vào ESP) |
| **Nguồn** | 3.3V VCC — GND chung |
| **Hướng** | Bidirectional (ESP ra lệnh, R307 trả kết quả) |
| **Thư viện** | `Adafruit_Fingerprint` (Arduino) |
| **Lệnh chính** | `finger.getImage()` → `finger.image2Tz()` → `finger.fingerFastSearch()` |
| **Output** | Fingerprint ID (0–127) hoặc mã lỗi |

#### A2. DHT11 ↔ ESP32 DevKit

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | 1-Wire Digital (single-bus) |
| **Chân kết nối** | ESP32 `GPIO 4` ← DHT11 `DATA` |
| **Điện trở** | 10kΩ pull-up từ DATA lên 3.3V (bắt buộc) |
| **Nguồn** | 3.3V VCC — GND chung |
| **Hướng** | DHT11 → ESP32 (output only) |
| **Thư viện** | `DHT11` by Dhruba Saha |
| **Tần suất đọc** | Tối đa 1 lần/giây (giới hạn của DHT11) |
| **Output** | Nhiệt độ (°C), Độ ẩm (%RH) |
| **Xử lý lỗi** | Giá trị -1, 255, NaN → gửi `null` trong JSON |

#### A3. MPU6050 ↔ ESP32 DevKit

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | I2C (Inter-Integrated Circuit) |
| **Chân SDA** | ESP32 `GPIO 21` ↔ MPU6050 `SDA` |
| **Chân SCL** | ESP32 `GPIO 22` → MPU6050 `SCL` |
| **Địa chỉ I2C** | `0x68` (AD0 nối GND) hoặc `0x69` (AD0 nối VCC) |
| **Nguồn** | 3.3V VCC — GND chung |
| **Mode** | Raw I2C (bypass WHO_AM_I check — tương thích clone) |
| **Register đọc** | `PWR_MGMT_1 (0x6B)` để wake, `ACCEL_XOUT (0x3B)` lấy 14 byte |
| **Tần suất đọc** | Mỗi 20ms (50Hz) trong loop() để bắt rung lắc |
| **Output** | accelX/Y/Z (±2g, 16384 LSB/g), gyroX/Y/Z (±250°/s, 131 LSB/°/s) |
| **Dẫn xuất** | `stabilityScore` = 100 - (max\|accelY\| / 5.0) × 100 |

#### A4. Encoder Quang Học ↔ ESP32 DevKit

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | Digital Interrupt (phần cứng) |
| **Chân kết nối** | ESP32 `GPIO 27` ← Encoder `DO` |
| **Cấu hình** | `INPUT_PULLUP` (chống nhiễu) |
| **Trigger** | `RISING` edge (sườn lên) |
| **ISR** | `encoderISR()` chạy trong `IRAM_ATTR` (RAM nhanh) |
| **Thông số vật lý** | 80 xung/vòng bánh xe, 19.0 cm/vòng → 0.2375 cm/xung |
| **Chiều dài ray** | 369.0 cm ≈ 1553 xung hết đường |
| **Persistence** | `Preferences NVS` (namespace `"cabin"`, key `"pulse"`) — ghi mỗi 2s |
| **Output** | `encoderPulseCount` (có dấu: +tiến, -lùi) → `positionCm`, `positionPct` |

#### A5. Relay Thuận / Nghịch ↔ ESP32 DevKit

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | Digital Input (đọc trạng thái tiếp điểm NC) |
| **Chân Relay Thuận** | ESP32 `GPIO 32` ← Tiếp điểm NC Relay Thuận |
| **Chân Relay Nghịch** | ESP32 `GPIO 33` ← Tiếp điểm NC Relay Nghịch |
| **Cấu hình** | `INPUT_PULLDOWN` (nội bộ ESP32, chống nhiễu khi relay hở) |
| **Đấu dây** | Chân COM relay → GND (mass chung) |
| **Logic** | Relay TẮT: NC đóng → chập GPIO xuống GND → đọc `LOW` |
| | Relay BẬT (hút): NC mở → GPIO kéo lên 3.3V → đọc `HIGH` |
| **Ý nghĩa** | `GPIO32=HIGH, GPIO33=LOW` → cabin chạy **TIẾN** |
| | `GPIO32=LOW, GPIO33=HIGH` → cabin chạy **LÙI** |
| | `GPIO32=LOW, GPIO33=LOW` → cabin **ĐỨNG** |
| | `GPIO32=HIGH, GPIO33=HIGH` → **LỖI** phần cứng |
| **Đọc trong ISR** | `digitalRead()` trong `encoderISR()` để xác định hướng ngay khi có xung |

---

### 17.2 Nhóm B — Module IoT ↔ Node.js Backend (Qua WiFi LAN)

#### B1. ESP8266 → Backend: HTTP REST (Fingerprint)

| # | Method | Endpoint | Auth | Body / Query | Response | Tần suất |
|---|---|---|---|---|---|---|
| 1 | `GET` | `/api/fingerprint/status` | `X-API-Key` | — | `{mode: "match"\|"enroll"}` | Polling 3s |
| 2 | `POST` | `/api/fingerprint/match` | `X-API-Key` | `{fingerprintId: N}` | `{message, user}` → emit `LOGIN_SUCCESS` | Khi có vân tay |
| 3 | `POST` | `/api/fingerprint/enroll-step` | `X-API-Key` | `{userId, step}` | `{success}` → emit `ENROLL_STEP_DONE` | Trong enroll |
| 4 | `POST` | `/api/fingerprint/enroll` | `X-API-Key` | `{fingerprintId, userId}` | `{message, user}` → emit `ENROLL_SUCCESS` | Hoàn tất enroll |

**Header xác thực:** `X-API-Key: <ESP32_API_KEY>` (timing-safe SHA256 compare)

#### B2. ESP8266 ↔ Backend: UDP Auto-Discovery

| Hướng | Port | Payload | Mô tả |
|---|---|---|---|
| ESP8266 → Broadcast | `:3030` | `"MEDSCADA_DISCOVER"` | ESP8266 broadcast tìm server |
| Server → ESP8266 | `:rinfo.port` | `"MEDSCADA_SERVER:3000"` | Server unicast reply |
| Server → Broadcast | `:3030` | `"MEDSCADA_SERVER:3000"` | Server chủ động broadcast mỗi 2s |

#### B3. ESP8266 ← Backend: UDP Push Trigger (Login)

| Hướng | Port | Payload | Thời điểm |
|---|---|---|---|
| Server → Broadcast | `:3031` | `"MEDSCADA_LOGIN_TRIGGER"` | Khi user nhấn nút đăng nhập vân tay trên web |
| Mục đích | — | — | ESP8266 nhận → poll `/api/fingerprint/status` **ngay lập tức** (giảm latency từ ~3s xuống <5ms) |

#### B4. ESP32 Cabin Sensor → Backend: HTTP REST (Sensor Data)

| # | Method | Endpoint | Auth | Tần suất | Nội dung |
|---|---|---|---|---|---|
| 1 | `POST` | `/api/sensors/cabin` | `X-API-Key` | **Mỗi 2 giây** (gói đầy đủ) | temp, humidity, accelXYZ, gyroXYZ, stabilityScore, positionCm, positionPct, speed, direction |
| 2 | `POST` | `/api/sensors/cabin` | `X-API-Key` | **Mỗi khi encoder có xung mới** (gói nhanh, `fastUpdate:true`) | positionCm, positionPct, speed, direction, encoderPulses (không có DHT11/MPU6050) |
| 3 | `GET` | `/api/sensors/cabin/latest` | Không cần | On-demand | Bản ghi sensor mới nhất |
| 4 | `GET` | `/api/sensors/cabin/history` | Không cần | On-demand | 100 bản ghi gần nhất (ring buffer RAM) |

#### B5. ESP32 ↔ Backend: UDP Auto-Discovery

Tương tự B2 — cùng cơ chế, cùng port 3030, payload `"MEDSCADA_DISCOVER"`.

---

### 17.3 Nhóm C — React Frontend ↔ Node.js Backend

#### C1. HTTP REST API (JWT Cookie + CSRF)

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Đăng nhập mật khẩu → JWT |
| `POST` | `/api/auth/fingerprint-session` | Public | Đổi JWT token → HTTPOnly Cookie |
| `POST` | `/api/auth/logout` | Cookie | Xóa cookie |
| `GET` | `/api/auth/me` | Cookie+JWT | Lấy thông tin user hiện tại |
| `GET` | `/api/users` | TECH | Danh sách users |
| `POST` | `/api/users` | TECH | Tạo user |
| `PUT` | `/api/users/:id` | TECH | Cập nhật user |
| `DELETE` | `/api/users/:id` | TECH | Soft-delete user |
| `DELETE` | `/api/fingerprint/:userId` | TECH | Xóa vân tay user |
| `GET` | `/api/specimens` | Cookie | Danh sách mẫu bệnh phẩm |
| `POST` | `/api/specimens` | Cookie | Tạo/scan mẫu |
| `GET` | `/api/specimens/:id` | Cookie | Chi tiết mẫu |
| `GET` | `/api/data/bootstrap` | Cookie | Dữ liệu khởi động app (stations, users, records) |
| `GET` | `/api/data/events` | Cookie | Lịch sử sự kiện hệ thống |
| `GET` | `/api/health` | Public | Health check server |

**Cookie:** `scada_access_token` (HTTPOnly, SameSite=Strict)  
**CSRF:** Header `x-csrf-token` khớp với cookie `scada_csrf_token` (bắt buộc với mọi `POST/PUT/DELETE`)

#### C2. WebSocket — Socket.IO v4 (Bidirectional)

**Frontend → Server (emit):**

| Event | RBAC | Payload | Mô tả |
|---|---|---|---|
| `plc:callCabin` | Authenticated | `{stationNumber, stationId, isStat, withConfirm, action}` | Gọi cabin đến trạm |
| `plc:eStop` | Authenticated | `{active: bool}` | Kích hoạt/nhả E-Stop |
| `plc:reset` | TECH | — | Reset lỗi PLC |
| `plc:confirmStation` | Authenticated | — | Xác nhận tạo lộ trình (Confirm_CMD1) |
| `plc:confirmStop` | Authenticated | — | Xác nhận nhận/giao hàng (Confirm_CMD) |
| `plc:confirmPickup` | Authenticated | — | Lấy hàng (Confirm_CMD2) |
| `plc:maintenance` | TECH | `{active: bool}` | Bật/tắt chế độ bảo trì |
| `scada:stateSync` | Authenticated | `{...state}` | Broadcast state sang tất cả tab khác |
| `scada:dataSync` | Authenticated | `{...data}` | Đồng bộ dữ liệu phụ |
| `FINGERPRINT_LOGIN_WAIT` | Public | — | Đăng ký chờ đăng nhập vân tay |
| `FINGERPRINT_LOGIN_CANCEL` | Public | — | Hủy chờ |
| `FINGERPRINT_ENROLL_START` | TECH | `{userId, username}` | Bắt đầu đăng ký vân tay |
| `FINGERPRINT_ENROLL_CANCEL` | TECH | — | Hủy đăng ký |

**Server → Frontend (emit):**

| Event | Nguồn | Payload | Mô tả |
|---|---|---|---|
| `plc:snapshot` | opcua-service | `{currentStation, stationId, robotStatus, cabinReady, eStopActive, stationSensors, ts}` | Snapshot tổng hợp mọi Tag PLC |
| `plc:currentStation` | opcua-service | `{raw: int, stationId: "ST-0X"}` | Cabin đến trạm mới |
| `plc:robotStatus` | opcua-service | `{raw: int, label: string}` | Trạng thái robot |
| `plc:cabinReady` | opcua-service | `{ready: bool, ts}` | Cabin sẵn sàng/bận |
| `plc:eStopStatus` | opcua-service | `{active: bool, raw: bool, ts}` | E-Stop từ PLC |
| `plc:connectionStatus` | opcua-service | `{connected: bool, ts}` | OPC UA online/offline |
| `sensor:cabinData` | sensors route | `{temp, humidity, accelXYZ, positionCm, stability...}` | Dữ liệu ESP32 sensor |
| `sensor:cabinAlert` | sensors route | `{type: "OUT_OF_BOUNDS", message, reading}` | Cảnh báo cabin vượt biên |
| `scada:stateSync` | handlers.js | `{...state, _sourceSocketId, _ts}` | State broadcast từ tab khác |
| `scada:dataSync` | handlers.js | `{...data, _sourceSocketId, _ts}` | Data sync từ tab khác |
| `LOGIN_SUCCESS` | fingerprint route | `{token, user}` | Đăng nhập vân tay thành công |
| `LOGIN_ERROR` | handlers.js | `{message}` | Lỗi đăng nhập vân tay |
| `ENROLL_STEP_DONE` | fingerprint route | `{userId, step}` | Bước enroll hoàn tất |
| `ENROLL_SUCCESS` | fingerprint route | `{userId, username, fingerprintId}` | Đăng ký vân tay thành công |
| `ENROLL_ERROR` | handlers.js | `{message}` | Lỗi đăng ký |

---

### 17.4 Nhóm D — Node.js Backend ↔ Kepware (OPC UA)

#### D1. Kết nối OPC UA TCP

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | OPC UA over TCP |
| **Thư viện** | `node-opcua` v2.169.0 (`OPCUAClient`) |
| **Endpoint** | `opc.tcp://127.0.0.1:49320` (cấu hình qua `OPCUA_ENDPOINT`) |
| **Security** | `MessageSecurityMode.None` / `SecurityPolicy.None` |
| **Session timeout** | 60,000ms (60 giây) |
| **Keep-alive** | `keepSessionAlive: true` |
| **Reconnect** | Exponential backoff: 2s → 3s → ... → 30s (factor 1.5) |
| **Publish requests** | Giới hạn 3 (tránh `"too many publish requests"` warning Kepware) |

#### D2. OPC UA Subscription (Read Tags — PLC → Web)

| Tag NodeId | Kiểu | Mô tả | Socket.IO event |
|---|---|---|---|
| `ns=2;s=PLC1.Cabin.Current_Station` | `Int` | Vị trí cabin (1–4) | `plc:currentStation`, `plc:snapshot` |
| `ns=2;s=PLC1.Cabin.Robot_Status` | `Int` | 0=Sẵn sàng, 1=Di chuyển, 2=Lỗi | `plc:robotStatus`, `plc:snapshot` |
| `ns=2;s=PLC1.Cabin.Cabin_Ready` | `Bool` | TRUE=cabin rảnh, FALSE=bận | `plc:cabinReady`, `plc:snapshot` |
| `ns=2;s=PLC1.Cabin.E-Stop_CMD` | `Bool` | TRUE=E-Stop kích hoạt | `plc:eStopStatus`, `plc:snapshot` |

**Thông số Subscription:**
- Publishing interval: 500ms
- Lifetime count: 120
- Max keep-alive: 20
- Max notifications per publish: 50

#### D3. OPC UA Write (Web → PLC, on-demand)

| Tag NodeId | Kiểu | Hàm gọi | Mô tả |
|---|---|---|---|
| `ns=2;s=PLC1.Cabin.Target_Station` | `UInt16` | `callCabin(N)` | Trạm đích (1–4). PLC bắt đầu chạy ngay |
| `ns=2;s=PLC1.Cabin.Confirm_CMD` | `Bool` | `confirmStop()` | Xác nhận nhận/giao hàng. Auto-reset sau 300ms |
| `ns=2;s=PLC1.Cabin.Confirm_CMD1` | `Bool` | `confirmRoute()` | Tạo lộ trình. Auto-reset sau 300ms |
| `ns=2;s=PLC1.Cabin.Confirm_CMD2` | `Bool` | `confirmPickup()` | Lấy hàng. Auto-reset sau 300ms |
| `ns=2;s=PLC1.Cabin.Maintenance_Mode` | `Bool` | `setMaintenanceMode(bool)` | Chế độ bảo trì (maintained, không auto-reset) |

**Cơ chế Mutex Queue:** Tất cả lệnh write được xếp hàng tuần tự qua `commandQueue` (Promise chain) để tránh xung đột ghi đồng thời.

---

### 17.5 Nhóm E — Kepware ↔ PLC

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | OPC UA (Kepware đóng vai OPC UA Server, PLC đóng vai client/device) |
| **Driver Kepware** | Modbus TCP, EtherNet/IP, hoặc driver PLC chuyên dụng (tuỳ loại PLC) |
| **Tag namespace** | `PLC1.Cabin.*` (cấu hình trong Kepware Tag Browser) |
| **Hướng Read** | Kepware đọc thanh ghi/coil PLC → expose thành OPC UA node → node-opcua subscribe |
| **Hướng Write** | node-opcua ghi OPC UA node → Kepware forward xuống thanh ghi PLC |
| **Tần suất** | 500ms subscription (Kepware scan rate cấu hình tương đương) |

---

### 17.6 Nhóm F — PLC ↔ Cabin Robot

| Kết nối | Giao thức | Chi tiết |
|---|---|---|
| PLC → Motor Drive | Digital Output (DO) | Relay điều khiển chiều quay motor DC cabin |
| PLC → Relay Thuận | Digital Output | 24VDC — kích motor chạy tiến |
| PLC → Relay Nghịch | Digital Output | 24VDC — kích motor chạy lùi |
| Cảm biến từ trường → PLC | Digital Input (DI) | Cảm biến vị trí tại mỗi trạm báo cabin đã cập bến |
| Nút nhấn cứng → PLC | Digital Input | Nút Xác Nhận tại tủ điện (song song với `Confirm_CMD` Web) |
| Nút E-Stop cứng → PLC | Digital Input NC | Nút dừng khẩn cấp vật lý |
| PLC → Cơ cấu nâng hạ | Digital Output | Kích khớp nối/cơ cấu nâng hạ khay mẫu tại trạm |
| PLC ← Encoder Cabin | — | *(Không trực tiếp — ESP32 đọc encoder độc lập qua Relay signal)* |

---

### 17.7 Nhóm G — Node.js ↔ PostgreSQL

| Thuộc tính | Chi tiết |
|---|---|
| **Giao thức** | TCP/IP (PostgreSQL wire protocol) |
| **Port** | 5432 |
| **ORM** | Prisma Client v6.17.1 |
| **Connection string** | `DATABASE_URL` env var: `postgresql://user:pass@host:5432/dbname` |
| **Kết nối** | Connection pool (Prisma tự quản lý) |
| **Khởi động** | `prisma.$connect()` khi server start, `prisma.$disconnect()` khi shutdown |
| **Seed** | `seedDefaultStations()` chạy mỗi lần start (idempotent upsert) |
| **Migration** | `prisma migrate dev` / `prisma migrate deploy` |

---

### 17.8 Nhóm H — Nội Bộ Frontend (Cross-Tab / Cross-Device Sync)

| Kết nối | Cơ chế | Mô tả |
|---|---|---|
| Tab A → Tất cả Tab khác | `socket.broadcast.emit('scada:stateSync')` | Tab nào thay đổi state → server broadcast sang tất cả tab còn lại |
| Tab mới mở | `emitSnapshotToSocket(socket)` | Server push snapshot PLC ngay khi socket kết nối → không chờ lần poll tiếp theo |
| Tab mất kết nối | Reconnect tự động (Socket.IO built-in) | State hydration lại từ `latestScadaStatePayload` server cache |
| Multi-device | Cùng cơ chế Socket.IO | Máy tính, tablet, điện thoại cùng xem bản đồ — state luôn đồng nhất |

---

### 17.9 Tóm Tắt Nhanh — Bảng Toàn Bộ Kết Nối

| # | Từ | Đến | Giao thức | Port/Chân | Xác thực | Tần suất |
|---|---|---|---|---|---|---|
| 1 | R307 Sensor | ESP8266 | UART Serial | D1↔D2 / 57600 | None | On-demand |
| 2 | DHT11 | ESP32 | 1-Wire Digital | GPIO 4 | None | 1/s (max) |
| 3 | MPU6050 | ESP32 | I2C 0x68 | GPIO 21,22 | None | 50Hz (20ms) |
| 4 | Encoder | ESP32 | Digital ISR RISING | GPIO 27 | None | Per pulse |
| 5 | Relay Thuận | ESP32 | Digital Input NC | GPIO 32 | None | Realtime |
| 6 | Relay Nghịch | ESP32 | Digital Input NC | GPIO 33 | None | Realtime |
| 7 | ESP32 Flash | ESP32 | NVS Preferences | Internal | None | Mỗi 2s |
| 8 | ESP8266 | Backend | HTTP GET | :3000 | X-API-Key | Poll 3s |
| 9 | ESP8266 | Backend | HTTP POST | :3000 | X-API-Key | On-demand |
| 10 | ESP8266 | Backend | UDP Broadcast | :3030 | Payload | On-demand |
| 11 | Backend | ESP8266 | UDP Unicast/BC | :3030/:rinfo | Payload | Reply / 2s |
| 12 | Backend | ESP8266 | UDP Broadcast | :3031 | Payload | On-event |
| 13 | ESP32 Sensor | Backend | HTTP POST (full) | :3000 | X-API-Key | Mỗi 2s |
| 14 | ESP32 Sensor | Backend | HTTP POST (fast) | :3000 | X-API-Key | Per pulse |
| 15 | ESP32 Sensor | Backend | UDP Broadcast | :3030 | Payload | On-demand |
| 16 | React | Backend | HTTP REST | :3000 | JWT Cookie + CSRF | On-demand |
| 17 | React | Backend | WebSocket (emit) | :3000 | Cookie Session | On-event |
| 18 | Backend | React | WebSocket (push) | :3000 | — | On-change |
| 19 | Backend | Kepware | OPC UA TCP | :49320 | None (LAN) | Subscribe 500ms |
| 20 | Kepware | PLC | Industrial | — | Hardware | Realtime |
| 21 | PLC | Motor/Relay | Digital Output 24VDC | I/O module | Hardware | On-command |
| 22 | Cảm biến vị trí | PLC | Digital Input 24VDC | I/O module | Hardware | Realtime |
| 23 | Nút cứng / E-Stop | PLC | Digital Input NC | I/O module | Hardware | On-press |
| 24 | Backend | PostgreSQL | Prisma ORM / TCP | :5432 | DB credentials | On-demand |
| 25 | Tab A | Tab B,C... | Socket.IO broadcast | :3000 | Authenticated | On-state-change |

---

*Tài liệu này được tổng hợp từ toàn bộ source code, architecture documentation, và OPC UA specification của dự án Medical SCADA.*
