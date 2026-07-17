// ═══════════════════════════════════════════════════════════════════════════════
// ESP32 Cabin Sensor Module — Medical SCADA System
// ═══════════════════════════════════════════════════════════════════════════════
//
// Hardware:
//   - ESP32 DevKit (thường)
//   - DHT11 Temperature & Humidity Sensor
//   - MPU6050 6-axis Accelerometer + Gyroscope (I2C)
//   - Encoder motor module (optical, 43 pulses/rev, 19 cm/rev)
//
//   Vị trí được lưu vào Flash (NVS) mỗi 2 giây
//   → Tự khôi phục sau khi mất điện / reset ESP32, không cần công tắc hành trình.
//
// Wiring:
//   DHT11  DATA → GPIO 4   (10kΩ pull-up to 3.3V)
//   DHT11  VCC  → 3.3V
//   DHT11  GND  → GND
//
//   MPU6050 SDA → GPIO 21
//   MPU6050 SCL → GPIO 22
//   MPU6050 VCC → 3.3V
//   MPU6050 GND → GND
//   MPU6050 AD0 → GND (I2C addr = 0x68)
//
//   Encoder DO  → GPIO 34  (INPUT, ngắt RISING)
//   Encoder VCC → 3.3V hoặc 5V (tuỳ module)
//   Encoder GND → GND
//
//   ── Tín hiệu hướng từ Relay (Dùng tiếp điểm Thường Đóng - NC) ──────────
//   Do bạn còn dư tiếp điểm NC, ta sẽ đấu nối cực kỳ an toàn và chống nhiễu tốt như sau:
//
//   Sơ đồ đấu dây (dùng điện trở kéo lên nội bộ INPUT_PULLUP):
//     Chân COM của cả 2 tiếp điểm phụ ──────── GND (của mạch ESP32)
//     Chân NC  của Relay Thuận        ──────── GPIO 32
//     Chân NC  của Relay Nghịch       ──────── GPIO 33
//
//   Logic hoạt động:
//     - Khi Relay TẮT (motor dừng): NC đóng -> Chập GPIO xuống GND -> Tín hiệu là LOW.
//     - Khi Relay BẬT (motor chạy): NC mở ra -> ESP32 tự kéo GPIO lên 3.3V -> Tín hiệu là HIGH.
//     => Đọc được HIGH tức là Motor đang chạy chiều đó.
//
// Libraries required:
//   - DHT11 (by Dhruba Saha)
//   - ArduinoJson (v7.x)
//   - WiFi (built-in ESP32)
//   - HTTPClient (built-in ESP32)
//   - WiFiUdp (built-in ESP32)
//   - Wire (built-in ESP32, for MPU6050 raw I2C)
//
// Server discovery: UDP broadcast trên port 3030 (cùng cơ chế ESP8266 fingerprint)
// Data upload: HTTP POST /api/sensors/cabin mỗi 2 giây
//
// Encoder position:
//   43 xung = 1 vòng bánh xe
//   1 vòng  = 19 cm di chuyển trên ray
//   → 1 xung = 19.0 / 43.0 ≈ 0.4419 cm
// ═══════════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT11.h>
#include <Wire.h>
#include <Preferences.h>      // Lưu vị trí encoder vào Flash NVS (tồn tại qua mất điện)
#include "WiFiSettings.h"

#ifdef ESP32
#include <SPIFFS.h>
#else
#include <LittleFS.h>
#endif

// ── Cấu hình phần cứng ─────────────────────────────────────────────────────
#define DHT_PIN       4
#define LED_PIN       2      // LED tích hợp trên ESP32 DevKit
#define SDA_PIN       21
#define SCL_PIN       22
#define ENCODER_PIN   27     // GPIO 27: xung encoder (hỗ trợ INPUT_PULLUP)

// ── Tín hiệu hướng Relay (để biết chiều di chuyển) ─────────────────────────
// Đọc trạng thái kích của Relay Thuận / Nghịch
#define RELAY_FWD_PIN   32     // GPIO 32: Tiếp điểm NC relay thuận (HIGH = relay đang hút)
#define RELAY_REV_PIN   33     // GPIO 33: Tiếp điểm NC relay nghịch (HIGH = relay đang hút)

// ── Encoder — thông số vật lý (hiệu chỉnh thực tế) ──────────────────────────
// Đo thực tế: cabin đi từ đầu đến cuối ray 369cm mất 34.5 giây
// Serial log: ~45 xung/giây → tổng ray = 45 × 34.5 = ~1553 xung
// CM/xung = 369cm / 1553 = 0.2376cm  →  PULSES_PER_REV = 19.0 / 0.2376 ≈ 80
#define ENCODER_PULSES_PER_REV  42
#define ENCODER_CM_PER_REV      9.81f
#define CM_PER_PULSE            (ENCODER_CM_PER_REV / ENCODER_PULSES_PER_REV)  // ≈ 0.2375 cm

// ── Chiều dài đường ray ──────────────────────────────────────────────
// Tổng chiều dài ray từ ST-01 đến ST-04 = 3.69 m = 369 cm
#define RAIL_LENGTH_CM    369.0f
#define RAIL_TOTAL_PULSES ((long)(RAIL_LENGTH_CM / CM_PER_PULSE))  // ≈ 1553 xung

// ── Cấu hình timing (ms) ───────────────────────────────────────────────────
#define SEND_INTERVAL_MS      2000   // Gửi dữ liệu đầy đủ mỗi 2 giây
#define FAST_POS_INTERVAL_MS   200   // Gửi vị trí nhanh mỗi 200ms (chỉ khi xung thay đổi)
#define WIFI_RECONNECT_MS     5000   // Thử lại WiFi sau 5 giây
#define HTTP_TIMEOUT_MS       8000   // Timeout HTTP request
#define UDP_DISCOVER_MS      10000   // Tìm lại server sau 10 giây nếu mất
#define UDP_LISTEN_TIMEOUT_MS 3000   // Chờ phản hồi UDP tối đa 3 giây

// ── UDP Auto-Discovery (cùng cơ chế ESP8266 fingerprint) ───────────────────
#define UDP_DISCOVER_PORT  3030
#define DISCOVER_MSG       "MEDSCADA_DISCOVER"
#define SERVER_PREFIX      "MEDSCADA_SERVER:"

// ── API ─────────────────────────────────────────────────────────────────────
#define DEVICE_ID         "ESP32-SENSOR-01"
#define SENSOR_API_PATH   "/api/sensors/cabin"
#define SENSOR_API_KEY    "esp32-sensor-secret-change-me"  // ← key cứng, không dùng SPIFFS

// ── Khởi tạo cảm biến ──────────────────────────────────────────────────────
DHT11 dht(DHT_PIN);

// ── MPU6050 raw I2C (bypass WHO_AM_I check - works with clones) ────────────
#define MPU_ADDR   0x68
#define PWR_MGMT_1 0x6B
#define ACCEL_XOUT 0x3B
#define GYRO_XOUT  0x43

void mpuWriteReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool mpuReadRaw(int16_t& ax, int16_t& ay, int16_t& az,
                int16_t& gx, int16_t& gy, int16_t& gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(ACCEL_XOUT);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)14);
  if (Wire.available() < 14) return false;
  ax = Wire.read() << 8 | Wire.read();
  ay = Wire.read() << 8 | Wire.read();
  az = Wire.read() << 8 | Wire.read();
  Wire.read(); Wire.read(); // temp (skip)
  gx = Wire.read() << 8 | Wire.read();
  gy = Wire.read() << 8 | Wire.read();
  gz = Wire.read() << 8 | Wire.read();
  return true;
}

WiFiUDP udp;
Preferences prefs;   // NVS namespace "cabin" — lưu encoderPulseCount qua mất điện

// ── Biến trạng thái ─────────────────────────────────────────────────────────
String serverUrl = "";            // Ví dụ: "http://192.168.0.123:3000"
bool serverFound = false;
bool mpuOk       = false;
bool dhtOk       = false;

unsigned long lastSendTime    = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastDiscoverTime= 0;
unsigned long lastLedToggle   = 0;
unsigned long lastMpuRead     = 0;
unsigned long lastRelayDebug  = 0;   // Thêm: debug relay mỗi 500ms
bool ledState = false;

float max_vibration_deviation = 0.0f; // Lưu rung lắc lớn nhất trong chu kỳ 2s

// ── Encoder — biến đếm xung & vị trí ───────────────────────────────────────
// positionCm = encoderPulseCount × CM_PER_PULSE
//   Giá trị dương  = cabin đã đi TIẾN khỏi điểm home
//   Giá trị âm    = cabin đã đi LÙI qua điểm home (hiếm, dùng để debug)
volatile long encoderPulseCount = 0;   // Xung có dấu: +1 tiến, -1 lùi
long  lastPulseSnapshot = 0;           // Snapshot xung ở lần gửi trước → tính tốc độ
long  lastFastPulse     = 0;           // Xung ở lần gửi nhanh trước (phát hiện thay đổi)
unsigned long lastFastSendTime = 0;    // Thời điểm gửi vị trí nhanh lần cuối
float positionCm        = 0.0f;        // Vị trí trên ray (cm)
float speedCmPerSec     = 0.0f;        // Tốc độ: >0 tiến, <0 lùi
volatile bool encoderMovingFwd = true; // Hướng đọc được từ ISR (Relay signal)

// ISR: gọi mỗi khi encoder phát ra xung RISING edge
// Đọc 2 tín hiệu Relay (FWD/REV) ngay trong ISR để biết chiều tại đúng thời điểm xung
// Có điện trở kéo xuống ngoài: HIGH (1) = Relay đang kích chạy, LOW (0) = Tắt
void IRAM_ATTR encoderISR() {
  bool fwd = digitalRead(RELAY_FWD_PIN);   // HIGH = kích 1 = chạy thuận
  bool rev = digitalRead(RELAY_REV_PIN);   // HIGH = kích 1 = chạy nghịch

  // Xác định hướng: nếu 1 trong 2 relay đang hút, cập nhật hướng
  if (fwd && !rev) {
    encoderMovingFwd = true;
  } else if (rev && !fwd) {
    encoderMovingFwd = false;
  }
  // Nếu cả 2 relay tắt (kéo tay thử), sẽ giữ nguyên hướng trước đó (encoderMovingFwd)

  // Đếm xung theo hướng đã xác định
  if (encoderMovingFwd) {
    encoderPulseCount++;     // Cabin đi TIẾN
  } else {
    encoderPulseCount--;     // Cabin đi LÙI
  }

  // Giới hạn tuyệt đối quãng đường từ 0 đến 3.69m (0 đến RAIL_TOTAL_PULSES)
  if (encoderPulseCount < 0) {
    encoderPulseCount = 0;
  } else if (encoderPulseCount > RAIL_TOTAL_PULSES) {
    encoderPulseCount = RAIL_TOTAL_PULSES;
  }
}

// ── Forward declarations ─────────────────────────────────────────────────────
void connectWiFi();
bool discoverServer();
void sendSensorData();
void sendFastPosition();      // Gửi vị trí nhanh (nhẹ, chỉ encoder data)
void updateEncoderPosition();
void savePositionToNVS();
float calcStabilityScore();

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("╔═══════════════════════════════════════════════════════╗");
  Serial.println("║  ESP32 Cabin Sensor — Medical SCADA System           ║");
  Serial.println("║  Sensors: DHT11 (Temp/Humidity) + MPU6050 (IMU)     ║");
  Serial.println("╚═══════════════════════════════════════════════════════╝");
  Serial.println();


  // ── Encoder + tín hiệu hướng Relay ─────────────────────────
  pinMode(ENCODER_PIN,   INPUT_PULLUP);   // Đổi sang PULLUP để chống nhiễu (GPIO 27)
  pinMode(RELAY_FWD_PIN, INPUT_PULLDOWN); // GPIO 32: Bật sẵn trở kéo xuống nội bộ ESP32 (chống nhiễu)
  pinMode(RELAY_REV_PIN, INPUT_PULLDOWN); // GPIO 33: Bật sẵn trở kéo xuống nội bộ ESP32 (chống nhiễu)
  attachInterrupt(digitalPinToInterrupt(ENCODER_PIN), encoderISR, RISING);

  // ── Khôi phục vị trí từ NVS Flash (tồn tại sau khi mất điện) ────────────
  prefs.begin("cabin", false);            // Namespace "cabin", read-write
  long savedPulse = prefs.getLong("pulse", 0);  // Mặc định 0 nếu chưa có giá trị
  noInterrupts();
  encoderPulseCount = savedPulse;
  interrupts();
  lastPulseSnapshot = savedPulse;
  positionCm        = savedPulse * CM_PER_PULSE;
  Serial.printf("[NVS]     ✓ Vị trí khôi phục: %ld xung ≈ %.1f cm\n", savedPulse, positionCm);

  Serial.println("[Encoder]  ✓ Interrupt GPIO " + String(ENCODER_PIN));
  Serial.println("[Relay DIR] ✓ FWD → GPIO " + String(RELAY_FWD_PIN) + " | REV → GPIO " + String(RELAY_REV_PIN));
  Serial.printf("[Encoder]   Thông số: %d xung/vòng | %.1f cm/vòng | %.4f cm/xung\n",
                ENCODER_PULSES_PER_REV, ENCODER_CM_PER_REV, CM_PER_PULSE);
  Serial.printf("[Encoder]   Tổng ray: %.1f cm (%.3f m) | ~%ld xung hết đường\n",
                RAIL_LENGTH_CM, RAIL_LENGTH_CM / 100.0f, RAIL_TOTAL_PULSES);

  // LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // DHT11
  // Thư viện DHT11 (như của Dhruba Saha) thường không cần dht.begin()
  delay(500);
  float testTemp = dht.readTemperature();
  dhtOk = (testTemp != -1 && testTemp != 255); // Giả sử thư viện trả về -1 hoặc 255 khi lỗi
  Serial.print("[DHT11] ");
  Serial.println(dhtOk ? "✓ Sensor detected!" : "⚠ Sensor not responding (check wiring)");

  // MPU6050 (raw I2C - works with all clones)
  Wire.begin(SDA_PIN, SCL_PIN);
  delay(100);

  // Scan I2C để debug
  Serial.print("[I2C] Scanning... ");
  bool i2cFound = false;
  for (uint8_t addr = 0x08; addr < 0x78; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("Found device at 0x%02X\n", addr);
      i2cFound = true;
    }
  }
  if (!i2cFound) Serial.println("No I2C devices found!");

  // Wake MPU6050 (clear SLEEP bit)
  mpuWriteReg(PWR_MGMT_1, 0x00);
  delay(100);

  // Verify bằng cách đọc thử
  int16_t ax, ay, az, gx, gy, gz;
  if (mpuReadRaw(ax, ay, az, gx, gy, gz)) {
    mpuOk = true;
    Serial.println("[MPU6050] ✓ Sensor ready (raw I2C mode)!");
  } else {
    mpuOk = false;
    Serial.println("[MPU6050] ✗ Cannot read data. Check wiring.");
  }

  // WiFi
  connectWiFi();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  // ── Duy trì kết nối WiFi ─────────────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiAttempt >= WIFI_RECONNECT_MS) {
      lastWifiAttempt = now;
      Serial.println("[WiFi] Connection lost. Reconnecting...");
      connectWiFi();
      serverFound = false; // Cần khám phá lại server sau khi kết nối lại
    }
    // Nháy LED nhanh khi chưa kết nối
    if (now - lastLedToggle >= 150) {
      lastLedToggle = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState);
    }
    return;
  }

  // ── Khám phá server (UDP broadcast) ──────────────────────────────────────
  if (!serverFound || (now - lastDiscoverTime >= UDP_DISCOVER_MS && serverUrl.isEmpty())) {
    lastDiscoverTime = now;
    if (discoverServer()) {
      Serial.print("[Discovery] ✓ Server found: ");
      Serial.println(serverUrl);
      digitalWrite(LED_PIN, HIGH); // LED sáng liên tục = đã kết nối server
    } else {
      Serial.println("[Discovery] Server not found, retrying...");
    }
  }

  if (!serverFound) return;

  // ── Đọc MPU6050 liên tục (mỗi 20ms) để bắt được xóc nảy ─────────────────
  if (mpuOk && now - lastMpuRead >= 20) {
    lastMpuRead = now;
    int16_t ax, ay, az, gx, gy, gz;
    if (mpuReadRaw(ax, ay, az, gx, gy, gz)) {
      float f_ax = ax / 16384.0f * 9.81f;
      float f_ay = ay / 16384.0f * 9.81f;
      float f_az = az / 16384.0f * 9.81f;

      // Chỉ giám sát lực lắc ngang (Trục Y)
      // Bỏ qua việc đẩy tới lui (X) và trọng lực/xóc nảy (Z)
      float deviation = abs(f_ay);
      
      // Bỏ qua các rung động cực nhỏ do nhiễu sensor (< 0.5 m/s²)
      if (deviation < 0.5f) deviation = 0;
      
      // Ghi nhận mức xóc nảy mạnh nhất
      if (deviation > max_vibration_deviation) {
        max_vibration_deviation = deviation;
      }
    }
  }

  // ── Cập nhật vị trí encoder ──────────────────────────────────────────────
  updateEncoderPosition();

  // ── Gửi vị trí NGAY LẬP TỨC khi xung encoder thay đổi (không delay) ─────
  // Gói nhẹ ~80 byte chỉ chứa vị trí encoder, gửi liên tục khi cabin di chuyển
  {
    noInterrupts();
    long currentPulse = encoderPulseCount;
    interrupts();
    // Chỉ gửi khi số xung thay đổi (cabin đang di chuyển)
    if (currentPulse != lastFastPulse) {
      lastFastPulse = currentPulse;
      sendFastPosition();
    }
  }

  // ── DEBUG: In trạng thái raw của 2 chân relay mỗi 500ms ──────────────────
  // Giúp xác minh đấu dây: HIGH = kích 1 (đang chạy), LOW = tắt (nhờ trở kéo xuống)
  if (now - lastRelayDebug >= 500) {
    lastRelayDebug = now;
    bool rFwd = digitalRead(RELAY_FWD_PIN);  // GPIO 32
    bool rRev = digitalRead(RELAY_REV_PIN);  // GPIO 33
    noInterrupts();
    long pulse = encoderPulseCount;
    interrupts();
    Serial.printf("[Relay-DBG] GPIO32(FWD)=%s  GPIO33(REV)=%s  | Xung=%ld Pos=%.1fcm\n",
                  rFwd ? "HIGH" : "LOW",
                  rRev ? "HIGH" : "LOW",
                  pulse,
                  pulse * CM_PER_PULSE);
  }

  // ── Gửi dữ liệu cảm biến đầy đủ định kỳ (mỗi 2 giây) ────────────────────
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    sendSensorData();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WiFi Connection (WiFiSettings)
// ═══════════════════════════════════════════════════════════════════════════════
void connectWiFi() {
  WiFiSettings.hostname = "MedSCADA_Cabin_Sensor";
  
  // Xóa bỏ key cũ trong bộ nhớ (nếu có từ mạch vân tay) và ép dùng key mới
  WiFiSettings.api_key = "esp32-sensor-secret-change-me";

  // Try to connect, start portal if fails
  if (!WiFiSettings.connect(true, 30)) {
    Serial.println("[WiFi] Connection failed. Restarting...");
    delay(3000);
    ESP.restart();
  }

  Serial.println("[WiFi] ✓ Connected!");
  Serial.print("[WiFi]   IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("[WiFi]   RSSI: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
  
  // If no server URL is configured, force config portal
  if (WiFiSettings.server_url.isEmpty()) {
    Serial.println("[WiFi] ⚠️ Backend URL is EMPTY. Forcing Config Portal...");
    delay(2000);
    WiFiSettings.portal();
  }

  serverUrl = WiFiSettings.server_url;
  serverFound = !serverUrl.isEmpty();
  lastWifiAttempt = 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UDP Auto-Discovery — Broadcast "MEDSCADA_DISCOVER" → nhận "MEDSCADA_SERVER:<port>"
// Cùng cơ chế với ESP8266 fingerprint (server lắng nghe trên port 3030)
// ═══════════════════════════════════════════════════════════════════════════════
bool discoverServer() {
  Serial.println("[Discovery] Broadcasting MEDSCADA_DISCOVER...");

  udp.begin(0); // Bind to any available local port

  // Gửi broadcast
  udp.beginPacket("255.255.255.255", UDP_DISCOVER_PORT);
  udp.print(DISCOVER_MSG);
  udp.endPacket();

  // Chờ phản hồi
  unsigned long start = millis();
  while (millis() - start < UDP_LISTEN_TIMEOUT_MS) {
    int packetSize = udp.parsePacket();
    if (packetSize > 0) {
      char buf[128] = {0};
      int len = udp.read(buf, sizeof(buf) - 1);
      buf[len] = '\0';
      String reply = String(buf);

      Serial.print("[Discovery] Received: ");
      Serial.println(reply);

      if (reply.startsWith(SERVER_PREFIX)) {
        // Format: "MEDSCADA_SERVER:3000"
        String port = reply.substring(strlen(SERVER_PREFIX));
        String ip = udp.remoteIP().toString();
        String newUrl = "http://" + ip + ":" + port;
        
        Serial.print("[Discovery] ✓ Server found at: ");
        Serial.println(newUrl);

        serverUrl = newUrl;
        serverFound = true;
        
        // Cập nhật lại URL vào RAM và lưu vào Flash theo SSID
        if (WiFiSettings.server_url != newUrl) {
          WiFiSettings.saveServerUrl(newUrl);
        }

        udp.stop();
        return true;
      }
    }
    delay(50);
  }

  udp.stop();
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tính Stability Score (0–100%) dựa trên gia tốc lắc ngang (Trục Y)
// Cách này bỏ qua hoàn toàn việc tiến/lùi (Trục X) và nhún nhảy (Trục Z).
// ═══════════════════════════════════════════════════════════════════════════════
float calcStabilityScore() {
  // Threshold: Nếu xóc nảy tổng cộng >= 5.0 m/s² thì cho 0 điểm (xóc nửa G)
  float score = 100.0f - (max_vibration_deviation / 5.0f) * 100.0f;
  if (score < 0.0f) score = 0.0f;
  if (score > 100.0f) score = 100.0f;

  // Reset cửa sổ sau khi đã lấy điểm
  max_vibration_deviation = 0.0f;
  
  return score;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cập nhật vị trí & tốc độ từ encoder — gọi trong loop() mỗi chu kỳ
// ═══════════════════════════════════════════════════════════════════════════════
void updateEncoderPosition() {
  noInterrupts();
  long currentPulse = encoderPulseCount;
  interrupts();
  positionCm = currentPulse * CM_PER_PULSE;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Gửi vị trí encoder NHANH (gói nhẹ ~80 byte) — mỗi khi xung thay đổi
// Chỉ gửi: positionCm, positionPct, speedCmPerSec, direction, encoderPulses
// Không gửi: DHT11, MPU6050, stability (tiết kiệm băng thông)
// ═══════════════════════════════════════════════════════════════════════════════
void sendFastPosition() {
  if (serverUrl.isEmpty()) return;

  noInterrupts();
  long currentPulse = encoderPulseCount;
  bool isFwd = encoderMovingFwd;
  interrupts();

  float posCm = currentPulse * CM_PER_PULSE;
  float posPct = (posCm / RAIL_LENGTH_CM) * 100.0f;
  if (posPct < 0.0f) posPct = 0.0f;
  if (posPct > 100.0f) posPct = 100.0f;

  // Tính tốc độ chính xác dựa trên thời gian thực tế
  unsigned long now = millis();
  unsigned long deltaTimeMs = now - lastFastSendTime;
  if (deltaTimeMs == 0) deltaTimeMs = 1; // Tránh chia cho 0
  
  // Tốc độ = (Quãng đường di chuyển) / (Thời gian)
  long deltaPulse = currentPulse - lastPulseSnapshot; // Sử dụng biến tạm để tính
  float fastSpeed = (deltaPulse * CM_PER_PULSE) / (deltaTimeMs / 1000.0f);
  
  // Cập nhật lại snapshot cho lần tính tốc độ tiếp theo
  lastPulseSnapshot = currentPulse;
  lastFastSendTime = now;

  // Đọc relay để xác định hướng
  bool relayFwd = digitalRead(RELAY_FWD_PIN);
  bool relayRev = digitalRead(RELAY_REV_PIN);
  const char* dirStr;
  if (relayFwd && !relayRev)       dirStr = "TIEN";
  else if (relayRev && !relayFwd)  dirStr = "LUI";
  else if (!relayFwd && !relayRev) dirStr = "DUNG";
  else                             dirStr = "LOI";

  bool outOfBounds = (posCm < -5.0f || posCm > RAIL_LENGTH_CM + 5.0f);

  // Build gói nhẹ
  JsonDocument doc;
  doc["deviceId"]       = DEVICE_ID;
  doc["positionCm"]     = round(posCm * 10.0f) / 10.0f;
  doc["positionPct"]    = round(posPct * 10.0f) / 10.0f;
  doc["railLengthCm"]   = RAIL_LENGTH_CM;
  doc["speedCmPerSec"]  = round(fastSpeed * 10.0f) / 10.0f;
  doc["encoderPulses"]  = (long)currentPulse;
  doc["direction"]      = dirStr;
  doc["outOfBounds"]    = outOfBounds;
  doc["fastUpdate"]     = true;     // Đánh dấu đây là gói nhanh (không có DHT11/MPU6050)
  doc["timestamp"]      = (unsigned long)millis();

  String body;
  serializeJson(doc, body);

  // HTTP POST (dùng timeout ngắn 3s thay vì 8s)
  HTTPClient http;
  http.begin(serverUrl + SENSOR_API_PATH);
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", SENSOR_API_KEY);

  int httpCode = http.POST(body);
  if (httpCode == 200) {
    Serial.printf("[FastPos] ✓ Xung=%ld Pos=%.1fcm (%.1f%%) Speed=%.1fcm/s %s\n",
                  currentPulse, posCm, posPct, fastSpeed, dirStr);
  }
  // Không log lỗi để tránh spam Serial khi mất kết nối
  http.end();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lưu vị trí (encoderPulseCount) vào Flash NVS — gọi sau mỗi lần gửi dữ liệu
// NVS có độ bền ~100,000 lần ghi mỗi cell, đủ dùng > 13 năm nếu ghi mỗi 2 giây
// ═══════════════════════════════════════════════════════════════════════════════
void savePositionToNVS() {
  noInterrupts();
  long pulse = encoderPulseCount;
  interrupts();
  prefs.putLong("pulse", pulse);   // Ghi ngay vào Flash (wear-leveled bởi esp-idf)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Đọc cảm biến và gửi HTTP POST
// ═══════════════════════════════════════════════════════════════════════════════
void sendSensorData() {
  if (serverUrl.isEmpty()) {
    Serial.println("[Sensor] No server URL, skip send.");
    serverFound = false;
    return;
  }

  // ── Đọc DHT11 ──────────────────────────────────────────────────────────
  float temperature = dht.readTemperature();
  float humidity    = dht.readHumidity();
  
  // Với thư viện DHT11, lỗi có thể trả về giá trị đặc biệt như -1, 255 hoặc biến dhtValid
  bool dhtValid = (temperature != -1 && temperature != 255 && humidity != -1 && humidity != 255 && !isnan(temperature));

  if (!dhtValid) {
    // DHT11 đọc chậm (~1 lần/giây), đôi khi trả về NaN — bỏ qua lần này
    temperature = -1.0f;
    humidity    = -1.0f;
    Serial.println("[DHT11] ⚠ Read failed (NaN), using last valid or -1");
  }

  // ── Đọc MPU6050 ────────────────────────────────────────────────────────────────
  float accelX = 0, accelY = 0, accelZ = 9.81f;
  float gyroX = 0, gyroY = 0, gyroZ = 0;
  float stabilityScore = 100.0f;

  if (mpuOk) {
    int16_t ax, ay, az, gx, gy, gz;
    if (mpuReadRaw(ax, ay, az, gx, gy, gz)) {
      // Scale: ±2g range = 16384 LSB/g, g = 9.81 m/s²
      accelX = ax / 16384.0f * 9.81f;
      accelY = ay / 16384.0f * 9.81f;
      accelZ = az / 16384.0f * 9.81f;
      // Scale: ±250°/s range = 131 LSB/(°/s), convert to rad/s
      gyroX  = gx / 131.0f * (PI / 180.0f);
      gyroY  = gy / 131.0f * (PI / 180.0f);
      gyroZ  = gz / 131.0f * (PI / 180.0f);
    }
    // Lấy điểm số ổn định tính từ vòng lặp 2s vừa qua
    stabilityScore = calcStabilityScore();
  }

  // ── Tính tốc độ encoder (delta xung / delta thời gian) ────────────────────
  noInterrupts();
  long currentPulse = encoderPulseCount;
  interrupts();

  long deltaPulse  = currentPulse - lastPulseSnapshot;
  float deltaTimeSec = SEND_INTERVAL_MS / 1000.0f;          // = 2.0 giây
  speedCmPerSec    = (deltaPulse * CM_PER_PULSE) / deltaTimeSec;
  positionCm       = currentPulse * CM_PER_PULSE;
  lastPulseSnapshot = currentPulse;

  // Lưu vị trí vào Flash NVS mỗi chu kỳ 2s (tồn tại sau mất điện)
  savePositionToNVS();

  // ── Xác định hướng di chuyển ─────────────────────────────────────────────
  // Đọc relay trực tiếp để xác định hướng tại thời điểm gửi
  // Có trở kéo xuống ngoài: HIGH = kích 1 (chạy), LOW = tắt
  bool relayFwd = digitalRead(RELAY_FWD_PIN);  // GPIO 32
  bool relayRev = digitalRead(RELAY_REV_PIN);  // GPIO 33

  const char* dirStr;
  if (relayFwd && !relayRev) {
    dirStr = "TIEN";           // Chỉ relay thuận hút → cabin đang tiến
  } else if (relayRev && !relayFwd) {
    dirStr = "LUI";            // Chỉ relay nghịch hút → cabin đang lùi
  } else if (!relayFwd && !relayRev) {
    // Cả 2 relay đều tắt → cabin đứng yên
    // Nhưng vẫn giữ hướng cuối từ ISR để báo cáo chiều vừa dừng
    dirStr = "DUNG";
  } else {
    // Cả 2 relay cùng hút — lỗi phần cứng bất thường
    dirStr = "LOI";
  }

  // Debug relay state mỗi lần gửi
  Serial.printf("[Relay]   GPIO32(FWD)=%s  GPIO33(REV)=%s → Hướng: %s\n",
                relayFwd ? "HIGH" : "LOW",
                relayRev ? "HIGH" : "LOW",
                dirStr);

  // Tính phần trăm vị trí trên ray (0–100%)
  float positionPercent = (positionCm / RAIL_LENGTH_CM) * 100.0f;
  if (positionPercent < 0.0f)    positionPercent = 0.0f;
  if (positionPercent > 100.0f)  positionPercent = 100.0f;

  // Kiểm tra vượt biên (encoder đếm sai hoặc bánh xe trượt)
  bool outOfBounds = (positionCm < -5.0f || positionCm > RAIL_LENGTH_CM + 5.0f);
  if (outOfBounds) {
    Serial.printf("[Encoder] ⚠ Vượt biên! positionCm=%.1f (giới hạn: 0 – %.1f cm)\n",
                  positionCm, RAIL_LENGTH_CM);
  }

  Serial.printf("[Encoder] Xung: %ld | Pos: %.1f cm (%.1f%%) | Speed: %.1f cm/s | Dir: %s\n",
                currentPulse, positionCm, positionPercent, speedCmPerSec, dirStr);

  // ── Build JSON payload ──────────────────────────────────────────────────
  JsonDocument doc;
  doc["deviceId"]        = DEVICE_ID;
  if (dhtValid) {
    doc["temperature"]   = round(temperature * 10.0f) / 10.0f;
    doc["humidity"]      = round(humidity * 10.0f) / 10.0f;
  } else {
    doc["temperature"]   = nullptr;
    doc["humidity"]      = nullptr;
  }
  doc["accelX"]          = round(accelX * 1000.0f) / 1000.0f;
  doc["accelY"]          = round(accelY * 1000.0f) / 1000.0f;
  doc["accelZ"]          = round(accelZ * 1000.0f) / 1000.0f;
  doc["gyroX"]           = round(gyroX * 1000.0f) / 1000.0f;
  doc["gyroY"]           = round(gyroY * 1000.0f) / 1000.0f;
  doc["gyroZ"]           = round(gyroZ * 1000.0f) / 1000.0f;
  doc["stabilityScore"]  = round(stabilityScore * 10.0f) / 10.0f;
  // ── Vị trí encoder + hướng PLC ─────────────────────────────────────────
  doc["positionCm"]      = round(positionCm * 10.0f) / 10.0f;      // Vị trí trên ray (cm)
  doc["positionPct"]     = round(positionPercent * 10.0f) / 10.0f;  // Vị trí theo % (0–100)
  doc["railLengthCm"]    = RAIL_LENGTH_CM;                          // Tổng chiều dài ray (cm)
  doc["speedCmPerSec"]   = round(speedCmPerSec * 10.0f) / 10.0f;   // Tốc độ có dấu (cm/s)
  doc["encoderPulses"]   = (long)currentPulse;                      // Tổng xung thô (có dấu)
  doc["outOfBounds"]     = outOfBounds;                             // true nếu vượt biên ray
  // Hướng cabin theo tín hiệu Relay: "TIEN" | "LUI" | "DUNG" | "LOI"
  if (relayFwd && !relayRev)       doc["direction"] = "TIEN";
  else if (relayRev && !relayFwd)  doc["direction"] = "LUI";
  else if (!relayFwd && !relayRev) doc["direction"] = "DUNG";
  else                             doc["direction"] = "LOI";   // Cả 2 cùng HIGH = lỗi
  doc["timestamp"]       = (unsigned long)millis();

  String body;
  serializeJson(doc, body);

  // ── HTTP POST ───────────────────────────────────────────────────────────
  HTTPClient http;
  String url = serverUrl + SENSOR_API_PATH;

  http.begin(url);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", SENSOR_API_KEY);  // Dùng key cứng, bỏ qua giá trị SPIFFS cũ

  int httpCode = http.POST(body);

  if (httpCode == 200) {
    // In thông tin tóm tắt
    Serial.printf("[Sensor] ✓ POST OK | T=%.1f°C H=%.1f%% | Accel=(%.2f,%.2f,%.2f) Stability=%.1f%% | Pos=%.1fcm Speed=%.1fcm/s\n",
      temperature, humidity, accelX, accelY, accelZ, stabilityScore, positionCm, speedCmPerSec);
  } else if (httpCode == 401) {
    Serial.println("[Sensor] ✗ 401 Unauthorized — check SENSOR_API_KEY in secrets.h");
  } else if (httpCode > 0) {
    Serial.printf("[Sensor] ✗ HTTP %d — %s\n", httpCode, http.getString().c_str());
  } else {
    // Kết nối server thất bại → reset để tìm lại server
    Serial.printf("[Sensor] ✗ Connection failed: %s\n", http.errorToString(httpCode).c_str());
    serverFound = false;
    serverUrl = "";
  }

  http.end();
}
