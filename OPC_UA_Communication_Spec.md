# TÀI LIỆU GIAO THỨC TRUYỀN THÔNG WEB - PLC (OPC UA)

Tài liệu này định nghĩa danh sách các biến truyền thông OPC UA, chức năng và cơ chế phối hợp (Handshake) giữa PLC (Hệ thống điều khiển) và Webserver (Giao diện giám sát). Bản cập nhật này tích hợp cơ chế "Cờ báo bận" (Busy/Ready Flag) để ngăn chặn tuyệt đối lỗi xung đột lệnh trong môi trường mạng thời gian thực.

---

## 1. Nhóm Biến Trạng Thái (PLC gửi lên Web giám sát - Read Only)

### `Current_Station` [Int] - Báo cáo vị trí thực tế của Cabin
* **Chức năng:** PLC cập nhật giá trị (`1`, `2`, `3`, `4`) ngay khi cảm biến từ tại các trạm xác nhận Cabin cập bến.
* **Tương tác UI:** Webserver đọc biến này để xác định tọa độ Cabin trên bản đồ và cập nhật giao diện (ví dụ: bật đèn xanh tại trạm).

### `Cabin_Ready` [Bool] - Cờ báo trạng thái Sẵn sàng / Bận
* **Chức năng:** PLC dùng biến này để báo hiệu cho Webserver biết hệ thống cơ khí đang rảnh rỗi hay đang bận xử lý nâng/hạ.
* **Quy ước Logic (Khóa liên động):**
  * **`0` (FALSE) - ĐANG BẬN:** Cabin đang thực hiện chu trình gắp/nhả tại trạm. Web **BỊ CẤM TẠM THỜI** việc gửi lệnh điều hướng mới.
  * **`1` (TRUE) - SẴN SÀNG:** Cabin rảnh rỗi. Web **ĐƯỢC PHÉP** gửi lệnh điều hướng (`Target_Station`) tiếp theo trong hàng chờ.

---

## 2. Nhóm Biến Điều Khiển (Web ra lệnh xuống PLC - Write)

### `Target_Station` [Int] - Điều hướng trạm đích & Xử lý hàng chờ (Queue)
* **Chức năng:** Nhận giá trị trạm đích (`1`, `2`, `3`, `4`) từ Webserver để PLC khởi động động cơ di chuyển Cabin dọc theo ray.
* **Quy tắc Đồng bộ Hàng chờ (BẮT BUỘC):** Webserver chỉ được phép đẩy (pop) số trạm tiếp theo trong hàng chờ xuống biến này khi thỏa mãn **ĐỒNG THỜI** 2 điều kiện:
  1. Hàng chờ (Queue) đang có lệnh cần đi.
  2. Webserver đọc được biến **`Cabin_Ready` đang bằng `1` (TRUE)**.

### `Confirm_CMD` [Bool] - Kích hoạt chu trình Nâng/Hạ tại trạm
* **Chức năng:** Đóng vai trò như nút bấm "Xác nhận" ảo trên Web, chạy song song với nút cứng ở tủ điện.
* **Cơ chế Auto-Reset (Handshake):** * Webserver chỉ cần **Ghi số `1` (TRUE)** vào biến này duy nhất 1 lần khi người dùng click nút. 
  * Web **KHÔNG CẦN** viết code nhả nút (Ghi số `0`). Khi PLC bắt được sườn lên, nó sẽ kích hoạt máy chạy và PLC **tự động ép biến này về `0`** ngay lập tức để dọn dẹp bộ nhớ, tránh hiện tượng lặp lệnh do trễ mạng.

### `E-Stop_CMD` [Bool] - Dừng khẩn cấp toàn hệ thống
* **Quy ước Logic (Failsafe):**
  * **Bình thường (An toàn):** Luôn duy trì mức **`1` (TRUE)**.
  * **Báo động (Dừng máy):** Khi user click nút E-Stop trên Web, Web ghi **`0` (FALSE)**.
* **Tương tác UI:** Khi biến về `0`, UI nhấp nháy đỏ cảnh báo toàn màn hình và vô hiệu hóa mọi thao tác điều khiển khác cho đến khi hệ thống được reset.

---

## 3. Kịch bản Phối hợp mượt mà (Workflow Example)

Dưới đây là luồng dữ liệu chuẩn khi Cabin hoàn thành thủ tục tại Trạm 2 và chuẩn bị di chuyển sang Trạm 3:

1. **[PLC]** Cabin đến Trạm 2 $\rightarrow$ Cập nhật `Current_Station = 2` $\rightarrow$ Tự động khóa bánh (ngắt cờ cho phép chạy), kéo theo cờ `Cabin_Ready = 0` (Báo bận).
2. **[WEB]** Đọc được `Current_Station = 2` $\rightarrow$ Bật đèn UI báo hiệu Cabin đã đến Trạm 2.
3. **[WEB]** Thuật toán kiểm tra thấy hàng chờ có lệnh đi Trạm 3. Nhưng do `Cabin_Ready == 0` $\rightarrow$ **Giữ lệnh, kiên nhẫn chờ đợi**.
4. **[WEB / TỦ ĐIỆN]** Y tá gửi/lấy mẫu xong $\rightarrow$ Bấm xác nhận (Web ghi `Confirm_CMD = 1` HOẶC y tá nhấn nút cứng tại tủ).
5. **[PLC]** Nhận tín hiệu xác nhận $\rightarrow$ Tự động xóa `Confirm_CMD = 0` $\rightarrow$ Chạy cơ cấu nâng hạ khay.
6. **[PLC]** Chu trình kết thúc, cơ cấu thu về đáy an toàn $\rightarrow$ Mở khóa bánh $\rightarrow$ PLC tự động bật lại `Cabin_Ready = 1` (Báo sẵn sàng).
7. **[WEB]** Đọc được `Cabin_Ready == 1` $\rightarrow$ Điều kiện thông quan thỏa mãn $\rightarrow$ Lập tức bốc số tiếp theo trong hàng chờ: Ghi `Target_Station = 3`.
8. **[PLC]** Nhận lệnh đích mới, Cabin lăn bánh sang Trạm 3. Vòng lặp tiếp tục.