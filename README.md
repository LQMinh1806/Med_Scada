# Medical SCADA - Cabin Van Chuyen Mau Benh Pham

Do an mon hoc mo phong he thong dieu khien va giam sat cabin van chuyen mau benh pham. Du an gom frontend React, backend Express/Socket.IO, PostgreSQL/Prisma va firmware cho ESP8266/ESP32.

## Thanh Phan Chinh

- `frontend/`: giao dien dieu khien, giam sat, quan tri tai khoan, bieu do sensor.
- `backend/`: REST API, Socket.IO, xac thuc JWT/CSRF, dong bo du lieu, OPC UA bridge.
- `prisma/`: schema va migration PostgreSQL.
- `esp8266_fingerprint/`: module dang nhap/dang ky van tay.
- `esp32_cabin_sensor/`: module DHT11, MPU6050, encoder vi tri cabin.
- `esp32/`: firmware van tay phien ban ESP32/PlatformIO.

## Yeu Cau

- Node.js va npm.
- Docker Desktop hoac PostgreSQL local.
- Arduino IDE hoac PlatformIO neu nap firmware.
- Kepware/PLC la tuy chon. Khi chua co phan cung, giu `VITE_SIMULATION_MODE=true`.

## Cai Dat Lan Dau

Chay trong thu muc goc du an:

```powershell
Copy-Item .env.example .env
npm install
npm run db:up
npm run prisma:migrate
npm run dev
```

Frontend mac dinh: `http://localhost:5173`  
Backend mac dinh: `http://localhost:3000`

Neu database dang rong, co the dang ky tai khoan dau tien tu man hinh login. Nen tao tai khoan vai tro `tech` truoc de quan tri he thong.

Tai khoan demo trong `backend/seed.js`:

- Username: `admin`
- Password: `123456`
- Role: `TECH`

## Cau Hinh Moi Truong

File `.env.example` dang dung cac khoa demo-only de phu hop do an. Khi doi key, can doi dong bo o firmware hoac config portal cua thiet bi.

Gia tri quan trong:

- `DATABASE_URL`: ket noi PostgreSQL.
- `JWT_SECRET`: khoa ky JWT cho backend.
- `ESP32_API_KEY`: key cho module van tay.
- `SENSOR_API_KEY`: key cho module sensor cabin.
- `OPCUA_ENDPOINT`: dia chi Kepware OPC UA.
- `VITE_API_BASE_URL`: de trong khi chay qua Vite proxy; dat thanh `http://<ip-backend>:3000/api` khi frontend truy cap backend qua may khac.
- `VITE_SOCKET_URL`: de trong khi dung cung origin/proxy; dat thanh URL backend khi can.
- `VITE_SIMULATION_MODE`: `true` de demo khi chua co PLC, `false` khi dung PLC that.

## Chay Kiem Tra

```powershell
npm run lint
npm run build
npx prisma validate
```

## Import Mau Benh Pham

File Excel mau: `backend/DanhSachMau_Mau.xlsx`

Format hien tai can cac cot:

- `Barcode`
- `PatientName`
- `TestType`
- `DestinationStation`

Cot `DestinationStation` co the ghi ma tram (`ST-02`, `ST-03`, `ST-04`) hoac ten tram (`Xet Nghiem`, `Vi Sinh`, `PCR`). He thong se dung truong nay de tu tao lo trinh va giao dung mau tai dung tram.

## Firmware ESP32 Cabin Sensor

File chinh: `esp32_cabin_sensor/esp32_cabin_sensor.ino`

Ket noi demo:

- DHT11 DATA: GPIO 4.
- MPU6050 SDA/SCL: GPIO 21/GPIO 22.
- Encoder DO: GPIO 27.
- Relay thuan NC: GPIO 32.
- Relay nghich NC: GPIO 33.

Logic relay dang chot theo so do NC + `INPUT_PULLUP`:

- Relay tat: NC dong xuong GND, doc `LOW`.
- Relay hut: NC mo, chan duoc keo len, doc `HIGH`.
- `HIGH` o GPIO 32 la cabin chay tien.
- `HIGH` o GPIO 33 la cabin chay lui.

Sensor gui du lieu ve `POST /api/sensors/cabin`. `SENSOR_API_KEY` trong `.env` phai khop voi key firmware.

## Firmware ESP8266 Fingerprint

File chinh: `esp8266_fingerprint/esp8266_fingerprint.ino`

Ket noi demo:

- Fingerprint TX -> NodeMCU D1/GPIO5.
- Fingerprint RX -> NodeMCU D2/GPIO4.
- Fingerprint VCC -> 3.3V.
- Fingerprint GND -> GND.

Thiet bi goi cac API:

- `GET /api/fingerprint/status`
- `POST /api/fingerprint/match`
- `POST /api/fingerprint/enroll-step`
- `POST /api/fingerprint/enroll`

Backend va thiet bi giao tiep bang `X-API-Key`.

## Luong Demo Goi Y

1. Chay database, backend va frontend.
2. Dang ky hoac dang nhap tai khoan `tech`.
3. Vao trang quan tri de tao operator va gan tram.
4. Vao trang dieu khien, quet barcode mau benh pham.
5. Goi hoac dispatch cabin den tram dich.
6. Quan sat trang monitoring: vi tri cabin, hang doi, sensor moi truong va do on dinh.
7. Thu E-Stop/reset neu can trinh bay tinh nang an toan.

## Ghi Chu Do An

Day la mo hinh phuc vu demo mon hoc, nen mot so cau hinh dang uu tien tinh de chay va de trinh bay. Neu phat trien thanh he thong that, can bo sung rate limit, quan ly secret nghiem tuc, challenge mot lan cho dang nhap van tay, logging/audit day du va luu telemetry sensor vao database thay vi bo dem RAM.
