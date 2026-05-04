# 🏗️ Báo Cáo Kiến Trúc & Luồng Nghiệp Vụ (Workflow) - Medical SCADA

Tài liệu này cung cấp cái nhìn tổng quan và chi tiết về thiết kế kiến trúc hệ thống, các thành phần chính và luồng xử lý nghiệp vụ của dự án **Medical SCADA** (Hệ thống điều khiển và quản lý cabin vận chuyển mẫu bệnh phẩm).

---

## 1. Tổng Quan Kiến Trúc (System Architecture)

Hệ thống Medical SCADA được thiết kế theo mô hình **Full-stack + IoT Hardware**, bao gồm các lớp (layer) hoạt động độc lập và giao tiếp với nhau qua các giao thức thời gian thực (WebSockets/Socket.IO, OPC UA) và HTTP REST.

### 1.1 Sơ Đồ Kiến Trúc Tổng Thể

```mermaid
graph TB
    subgraph Client["🖥️ Tầng Client (React / Giao Diện Người Dùng)"]
        UI_Login["Đăng nhập (LoginPage)"]
        UI_Control["Điều khiển Cabin (ControlPage)"]
        UI_Admin["Quản trị (AdminPage)"]
        UI_Monitor["Giám sát (MonitoringDisplay)"]
        
        subgraph Hooks["Custom Hooks (Logic Cốt Lõi)"]
            US["useScada<br/>(Quản lý trạng thái, Queue, Animations)"]
            UO["useOpcUaSocket<br/>(Giao tiếp Real-time Socket.IO)"]
        end
        UI_Control --> US
        US --> UO
    end

    subgraph Server["⚙️ Tầng API Server (Node.js/Express)"]
        REST["REST API<br/>(/api/auth, /api/specimens)"]
        SIO["Socket.IO Server<br/>(Hub giao tiếp thời gian thực)"]
        AUTH["Auth Middleware<br/>(JWT, CSRF, RBAC)"]
        FP_API["Fingerprint API<br/>(/api/fingerprint/*)"]
    end

    subgraph OPC["🏭 Tầng Giao Tiếp Công Nghiệp (OPC UA Bridge)"]
        OPCUA["opcua-service.js<br/>(Node-OPCUA Client)"]
        KEP["Kepware 6.x<br/>(OPC UA Server)"]
    end

    subgraph DB["🗄️ Tầng Cơ Sở Dữ Land"]
        PRISMA["Prisma ORM"]
        PG["PostgreSQL Database"]
    end

    subgraph Hardware["🔧 Tầng Phần Cứng (IoT & PLC)"]
        PLC["PLC Controller<br/>(Điều khiển logic máy)"]
        ROBOT["Robot Cabin<br/>(Động cơ, Cảm biến)"]
        ESP32["ESP32 Module<br/>(Xử lý vân tay)"]
        SENSOR["Cảm biến vân tay R307"]
    end

    %% Kết nối
    Client -- "HTTP/REST" --> REST
    Client -- "WebSocket/Polling" --> SIO
    REST --> AUTH --> PRISMA --> PG
    
    FP_API -- "API Key Auth" --> PRISMA
    
    SIO -- "Lệnh (callCabin, eStop)" --> OPCUA
    OPCUA -- "Giao thức OPC UA (TCP)" --> KEP
    KEP -- "Đọc/Ghi Tag" --> PLC
    PLC -- "Tín hiệu điện" --> ROBOT
    
    ESP32 -- "HTTP POST/GET (API Key)" --> FP_API
    ESP32 -- "Giao tiếp Serial (UART)" --> SENSOR
    
    %% Phản hồi
    SIO -- "Push: plc:snapshot, scada:stateSync" --> UO

    style Client fill:#E3F2FD,stroke:#1976D2,stroke-width:2px
    style Server fill:#FFF3E0,stroke:#FF9800,stroke-width:2px
    style DB fill:#E8F5E9,stroke:#4CAF50,stroke-width:2px
    style Hardware fill:#FCE4EC,stroke:#E91E63,stroke-width:2px
    style OPC fill:#F3E5F5,stroke:#9C27B0,stroke-width:2px
```

### 1.2 Vai Trò Các Thành Phần

1. **Client (React)**: 
   - Quản lý giao diện, cung cấp trải nghiệm thao tác mượt mà với mô phỏng cabin (SVG Animation). 
   - `useScada.js`: Central state hook, tích hợp *Queue Scheduler* dùng thuật toán thang máy (LOOK) và xử lý đồng bộ trạng thái (Hydration).
2. **API Server (Node.js)**:
   - Hub trung tâm điều phối mọi yêu cầu, thực hiện phân quyền (Role-Based Access Control - RBAC) và bảo mật (CSRF, JWT).
   - `Socket.IO`: Broadcast dữ liệu theo thời gian thực tới tất cả các trình duyệt đang mở.
3. **OPC UA Bridge**:
   - `opcua-service.js`: Chuyển đổi lệnh từ Node.js (Socket.IO) sang dạng Tag OPC UA để giao tiếp với Kepware, rồi từ Kepware đẩy xuống PLC.
4. **Phần cứng vân tay (ESP32)**:
   - Hoạt động độc lập, giao tiếp với Node.js bằng `ESP32_API_KEY`. Xử lý thao tác nhận dạng vân tay vật lý tại máy trạm.

---

## 2. Các Luồng Nghiệp Vụ Cốt Lõi (Workflows)

### 2.1 Luồng Xác Thực Vân Tay Qua Phần Cứng (ESP32 Fingerprint Login)

Đây là quy trình bảo mật không tiếp xúc (contactless), liên kết thiết bị IoT phần cứng vào luồng đăng nhập web. Thiết kế theo mô hình "Phòng chờ" (Wait Room).

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng
    participant Web as Web (React)
    participant SIO as Socket.IO (Server)
    participant ESP as Module ESP32
    participant API as API (Node.js)
    participant DB as PostgreSQL
    participant R307 as Cảm biến R307

    User->>Web: Nhấn "Đăng nhập vân tay"
    Web->>SIO: Mở kết nối & emit `FINGERPRINT_LOGIN_WAIT`
    SIO->>SIO: Đưa Socket ID vào danh sách chờ
    
    loop Polling (mỗi 3s)
        ESP->>API: GET `/api/fingerprint/status` (Có API Key)
        API-->>ESP: Trả về trạng thái `mode: "match"`
    end

    User->>R307: Đặt ngón tay lên cảm biến
    ESP->>R307: Quét và lấy ID vân tay
    R307-->>ESP: Trả về ID (vd: 42)
    
    ESP->>API: POST `/api/fingerprint/match` { fingerprintId: 42 }
    API->>DB: Truy vấn User theo fingerprintId = 42
    DB-->>API: Trả về thông tin User
    
    API->>API: Tạo JWT Token
    API->>SIO: Bắn sự kiện `LOGIN_SUCCESS` tới Socket ID đang chờ
    SIO-->>Web: Nhận `LOGIN_SUCCESS` (Kèm Token & User Info)
    
    Web->>API: POST `/api/auth/fingerprint-session` (Gửi token để lấy HTTPOnly Cookie)
    API-->>Web: Set-Cookie: scada_access_token
    Web->>Web: Đăng nhập thành công, chuyển hướng vào Dashboard
```

### 2.2 Luồng Điều Phối Cabin (Dispatch & Queue Scheduling)

Khi điều dưỡng quét mã bệnh phẩm và yêu cầu điều cabin đến trạm của họ. Luồng này bao gồm: Xếp hàng (Queueing), Phân quyền trạm (Location-based RBAC), và Điều khiển PLC qua OPC UA.

```mermaid
sequenceDiagram
    autonumber
    actor Op as Vận Hành Viên
    participant UI as Giao diện (ControlPage)
    participant SC as useScada (Queue)
    participant API as API / Socket.IO
    participant OPC as OPC UA Service
    participant PLC as Trạm PLC
    participant Cabin as Cabin Vật Lý

    Op->>UI: Quét mã vạch mẫu xét nghiệm
    UI->>SC: Lưu mẫu vào trạng thái tạm
    Op->>UI: Nhấn "Điều Cabin Đến Trạm ST-03"
    
    UI->>UI: Frontend RBAC Check (Có đúng trạm của user không?)
    UI->>SC: `dispatchScannedSpecimen('ST-03')`
    
    SC->>SC: Đưa lệnh vào Queue (Hàng đợi)
    SC->>SC: Thuật toán LOOK tính toán task tiếp theo
    SC->>API: Bắn socket `plc:callCabin` (ST-03, Mức ưu tiên)
    
    API->>API: Backend RBAC Check (Bảo vệ bảo mật)
    API->>OPC: Gọi hàm `callCabin(3, isStat)`
    
    OPC->>OPC: Ghi Tag `Target_Station` = 3
    OPC->>OPC: Kích hoạt (Pulse) Tag `Move_Execute`
    OPC->>PLC: Chuyển gói tin TCP tới Kepware/PLC
    
    PLC->>Cabin: Ra lệnh phần cứng di chuyển động cơ tới ST-03
    
    Note over PLC, Cabin: Cabin đang di chuyển...
    
    PLC->>OPC: Tag `Arrival_Done` = TRUE (Đã đến nơi)
    OPC->>API: Phát sự kiện báo hoàn thành
    API-->>SC: Socket.IO nhận snapshot mới (Trạng thái: Sẵn sàng)
    
    SC->>SC: Ghi nhận dữ liệu chuyến đi vào DB (Transport Record)
    SC->>UI: Hiển thị thông báo hoàn thành (Phát âm thanh)
    SC->>SC: Kiểm tra Queue xem có task tiếp theo không...
```

---

## 3. Các Quyết Định Kiến Trúc Đáng Chú Ý

1. **Decoupled Hardware Authentication (Xác thực phần cứng độc lập)**:
   - ESP32 không tương tác trực tiếp với Database mà thông qua một API được bảo vệ bằng API Key. Điều này cho phép thay đổi phần cứng (ví dụ: chuyển từ ESP8266 sang ESP32 hoặc một module vân tay khác) mà không ảnh hưởng tới backend.
2. **Location-based RBAC (Kiểm soát truy cập dựa trên vị trí)**:
   - Frontend ẩn/khóa nút điều khiển nếu user không thuộc trạm đó. Tuy nhiên, Backend vẫn thẩm định lại dựa trên JWT (`stationId` trong payload), chặn triệt để mọi hành vi bypass UI qua console hay API tools.
3. **Queue Scheduler (Thuật toán Thang Máy - LOOK)**:
   - Giải quyết bài toán nhiều trạm gọi cabin cùng lúc. Hệ thống không di chuyển ngẫu nhiên hay FIFO hoàn toàn, mà ưu tiên hướng di chuyển hiện tại (giống thang máy) để tiết kiệm thời gian, trừ phi có lệnh **STAT (Khẩn cấp)** sẽ được ưu tiên tuyệt đối.
4. **State Hydration & Sync (Đồng bộ trạng thái chéo Tab/Thiết bị)**:
   - Dùng Socket.IO để push trạng thái. Khi người dùng mở thêm tab hoặc mất kết nối mạng, hệ thống tự động "hydrate" (thủy hóa) trạng thái mới nhất từ server thay vì giữ state cũ trên máy, ngăn chặn rủi ro dữ liệu sai lệch gây tai nạn vận hành.
