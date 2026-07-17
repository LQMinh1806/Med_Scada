# Hướng Dẫn Hiệu Chuẩn Cảm Biến & Đo Độ Trễ Truyền Thông SCADA

Tài liệu này tổng hợp chi tiết về cách thức hiệu chuẩn thông số vật lý của cảm biến cabin và hướng dẫn sử dụng công cụ đo độ trễ truyền thông phục vụ cho báo cáo dự án **Medical SCADA**.

---

## 1. Hiệu Chuẩn Thông Số Vật Lý Cabin

Hệ thống sử dụng đĩa encoder quang học và bánh xe ma sát lăn trên đường ray để đo vị trí cabin. Dưới đây là công thức và số liệu hiệu chuẩn dựa trên phép đo thực tế mới nhất:

### Thông số thực tế đo được
* **Chiều dài ray tịnh tiến:** $369 \text{ cm}$ (từ trạm Cấp Cứu ST-01 đến Xét Nghiệm ST-04).
* **Thời gian di chuyển hết ray:** $34.5 \text{ giây}$.
* **Số xung encoder đo được trên mỗi vòng quay:** $80 \text{ xung}$ (cấu hình `#define ENCODER_PULSES_PER_REV`).
* **Chu vi bánh xe tiếp xúc ray:** $19.0 \text{ cm}$ (cấu hình `#define ENCODER_CM_PER_REV`).

### Công thức tính toán
1. **Độ phân giải di chuyển của mỗi xung encoder ($CM\_PER\_PULSE$):**
   $$CM\_PER\_PULSE = \frac{\text{Chu vi bánh xe}}{\text{Số xung mỗi vòng}} = \frac{19.0 \text{ cm}}{80} = 0.2375 \text{ cm/xung}$$

2. **Tổng số xung lý thuyết khi chạy hết chiều dài ray ($RAIL\_TOTAL\_PULSES$):**
   $$RAIL\_TOTAL\_PULSES = \frac{\text{Chiều dài ray}}{CM\_PER\_PULSE} = \frac{369.0 \text{ cm}}{0.2375 \text{ cm/xung}} \approx 1553.68 \text{ xung}$$

3. **Vận tốc trung bình của cabin:**
   $$v = \frac{369.0 \text{ cm}}{34.5 \text{ s}} \approx 10.70 \text{ cm/s}$$

4. **Tần số xung trung bình sinh ra khi cabin di chuyển:**
   $$f = \frac{1553.68 \text{ xung}}{34.5 \text{ s}} \approx 45 \text{ xung/giây (Hz)}$$

---

## 2. Giới Thiệu Công Cụ Đo Độ Trễ Truyền Thông

Để có số liệu làm biểu đồ báo cáo khoa học, một công cụ đo đạc độc lập đã được xây dựng tại:
👉 `backend/latency_bench.mjs`

Công cụ này đo đạc và phân tích độ trễ của **3 kênh truyền thông độc lập** trong hệ thống:

```
                                  ĐƯỜNG TRUYỀN ĐIỀU KHIỂN (Web -> PLC)
   [React Frontend] ──(Socket.IO)──> [Node.js Backend] ──(OPC UA Write)──> [Kepware 6.x] ──(Modbus/IP)──> [PLC S7-1200]
                                                        |◄────────── Đo RTT ở đây ──────────►|

                                  ĐƯỜNG TRUYỀN GIÁM SÁT (PLC -> Web)
   [PLC S7-1200] ──(Tag Change)──> [Kepware 6.x] ──(OPC UA Subscription)──> [Node.js Backend] ──(Socket.IO)──> [React Frontend]
                                           |◄─────────────── Đo trễ từ SourceTS đến Arrival ───────────────►|

                                  ĐƯỜNG TRUYỀN CẢM BIẾN (ESP32 -> Web)
   [ESP32 Cabin Sensor] ──────────────────(HTTP POST)──────────────────> [Node.js Backend] ──(Socket.IO)──> [React]
                                           |◄─────────── Đo HTTP RTT ở đây ───────────►|
```

---

## 3. Hướng Dẫn Thực Hiện Đo Đạc

### Phương án A: Chạy giả lập để kiểm tra (Mock Mode)
Nếu không có thiết bị phần cứng kết nối tại chỗ (PLC, Kepware offline), bạn vẫn có thể sinh báo cáo mẫu với dữ liệu mô phỏng chuẩn để hoàn thiện khung báo cáo:

```bash
# Di chuyển đến thư mục dự án và chạy
node backend/latency_bench.mjs --mock
```

### Phương án B: Thực hiện đo thực tế (Live Mode)
Để lấy số liệu thật từ hệ thống phần cứng đang vận hành:

1. **Khởi động các dịch vụ nền:**
   * Đảm bảo PLC và phần cứng đã bật.
   * Khởi động server Kepware (đảm bảo cổng `49320` khả dụng).
   * Khởi động backend Node.js SCADA (`npm run dev` hoặc `npm start` để mở cổng `3000`).

2. **Chạy script benchmark thực tế:**
   Mở một cửa sổ dòng lệnh mới và chạy:
   ```bash
   # Đo mặc định (50 mẫu ghi, 50 mẫu HTTP, 30 giây giám sát)
   node backend/latency_bench.mjs
   
   # Hoặc tùy biến số mẫu đo lớn hơn để biểu đồ chi tiết hơn
   node backend/latency_bench.mjs --samples 100 --duration 60 --http 100
   ```

---

## 4. Báo Cáo Kết Quả & Trực Quan Hóa

Sau khi chạy xong, kết quả đo sẽ tự động xuất ra file báo cáo HTML tĩnh tại:
👉 `scripts/latency_report.html`

### Các thông tin trong báo cáo:
1. **KPI chính:** Hiển thị độ trễ trung bình (Mean Latency) và phân vị 95% (P95 Latency) cho từng kênh bằng thẻ màu trực quan.
2. **Đồ thị chuỗi thời gian (Time-series Line Charts):** Biểu diễn sự biến động độ trễ của từng lượt gửi tín hiệu, giúp phát hiện các điểm đột biến (spikes) do nghẽn mạng.
3. **Đồ thị so sánh phân vị (Comparison Bar Chart):** So sánh các chỉ số tối thiểu (Min), trung bình (Mean), trung vị (Median), P95 và tối đa (Max) giữa 3 kênh.
4. **Đồ thị phân phối tần suất (Histogram):** Thể hiện mật độ phân bố của các khoảng độ trễ, phục vụ phân tích độ ổn định (Jitter).
5. **Bảng số liệu chi tiết:** Xuất đầy đủ các chỉ số thống kê (bao gồm cả độ lệch chuẩn - Std Dev) để copy trực tiếp vào bảng số liệu luận văn/báo cáo.

### Cách xuất file PDF làm báo cáo:
1. Kích đúp vào file `scripts/latency_report.html` để mở bằng Google Chrome, Microsoft Edge hoặc Firefox.
2. Nhấn tổ hợp phím `Ctrl + P` (hoặc `Cmd + P` trên macOS).
3. Chọn mục **Destination (Máy in):** `Save as PDF` (Lưu dưới dạng PDF).
4. Ở phần cài đặt nâng cao (More settings), tích chọn **Background graphics** để giữ nguyên màu sắc giao diện và biểu đồ.
5. Nhấn **Save** để tải về file PDF báo cáo chuyên nghiệp.
