// ESP8266 Fingerprint Authentication Module — Medical SCADA System
// ═══════════════════════════════════════════════════════════════════════════════
//
// Hardware:
//   - NodeMCU ESP8266 (hoặc tương đương)
//   - R307 / R503 / AS608 Fingerprint Sensor (UART)
//   - Status LED (tùy chọn, mặc định dùng LED có sẵn trên NodeMCU)
//
// Wiring (Cách đấu dây):
//   NodeMCU D1 (GPIO5)  ──► Fingerprint TX (Dây màu Xanh Lá)
//   NodeMCU D2 (GPIO4)  ──► Fingerprint RX (Dây màu Trắng)
//   NodeMCU 3.3V        ──► Fingerprint VCC (Dây màu Đỏ)
//   NodeMCU GND         ──► Fingerprint GND (Dây màu Đen)
//
// Libraries required:
//   - Adafruit Fingerprint Sensor Library (v2.1.x+)
//   - ArduinoJson (v7.x)
//
// ═══════════════════════════════════════════════════════════════════════════════

#include <Adafruit_Fingerprint.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#include <SoftwareSerial.h>
#include <WiFiClient.h>
#include <WiFiUdp.h>
#include "WiFiSettings.h"

#ifdef ESP32
#include <SPIFFS.h>
#else
#include <LittleFS.h>
#endif

// ── Hardware Pins (ESP8266 NodeMCU) ─────────────────────────────────────────
#define FINGERPRINT_RX D1 // TX của cảm biến nối vào D1 của ESP8266
#define FINGERPRINT_TX D2 // RX của cảm biến nối vào D2 của ESP8266
#define LED_STATUS                                                             \
  LED_BUILTIN          // Đèn LED có sẵn trên NodeMCU (thường là D4/GPIO2)
#define LED_SUCCESS D6 // Chân cho đèn LED báo thành công (tuỳ chọn)
#define LED_ERROR D7   // Chân cho đèn LED báo lỗi (tuỳ chọn)
#define BUZZER_PIN D5  // Chân cho còi chip (tuỳ chọn)

// ── Timing Configuration (ms) ──────────────────────────────────────────────
#define POLL_INTERVAL_MATCH_MS 200   // Fallback poll khi ở match mode
#define POLL_INTERVAL_ENROLL_MS 2000 // Poll chậm hơn khi đang enroll
#define WIFI_RECONNECT_MS 5000 // Wait between WiFi reconnect attempts
#define SCAN_DEBOUNCE_MS 1500  // Cooldown after successful scan
#define ENROLL_STEP_TIMEOUT_MS 15000 // Max wait per enrollment step
#define HTTP_TIMEOUT_MS 5000         // HTTP request timeout
#define LED_BLINK_FAST_MS 150        // Fast blink interval
#define LED_BLINK_SLOW_MS 500        // Slow blink interval

// ── UDP Push Trigger ─────────────────────────────────────────────────────────
// Backend broadcasts MEDSCADA_LOGIN_TRIGGER → ESP8266 polls server immediately
#define UDP_TRIGGER_PORT 3031
#define UDP_TRIGGER_MSG  "MEDSCADA_LOGIN_TRIGGER"

// ── Fingerprint Sensor Setup ────────────────────────────────────────────────
SoftwareSerial fingerSerial(FINGERPRINT_RX, FINGERPRINT_TX);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fingerSerial);

// ── State Machine ───────────────────────────────────────────────────────────
enum SystemState {
  STATE_INIT,
  STATE_WIFI_CONNECTING,
  STATE_IDLE,
  STATE_MATCH_WAITING,    // Waiting for finger in match mode
  STATE_MATCH_PROCESSING, // Processing matched fingerprint
  STATE_ENROLL_STEP1,     // Enrollment: first scan
  STATE_ENROLL_STEP2,     // Enrollment: second scan (confirmation)
  STATE_ENROLL_SAVING,    // Enrollment: saving template
  STATE_ENROLL_REPORTING, // Enrollment: reporting to server
  STATE_ERROR
};

SystemState currentState = STATE_INIT;
String currentMode = "match"; // "match" or "enroll"
int enrollUserId = -1;
int enrollSlotId = -1;

// ── Timing Variables ────────────────────────────────────────────────────────
unsigned long lastPollTime = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastLedToggle = 0;
unsigned long lastScanTime = 0;
unsigned long enrollStepStart = 0;
bool ledState = false;
int consecutivePollFailures = 0; // Track consecutive connection failures

// Dùng global WiFiClient để tránh bị tràn bộ nhớ/cạn kiệt socket
WiFiClient wifiClient;
#ifdef ESP8266
#include <WiFiClientSecure.h>
#endif
WiFiClientSecure wifiClientSecure;

// UDP trigger listener — backend push để ESP8266 poll ngay lập tức
WiFiUDP udpTrigger;
bool udpTriggerStarted = false;

void connectWiFi();
bool discoverServer();
void pollServerStatus();
void handleMatchMode();
void handleEnrollMode();
bool sendMatchResult(int fingerprintId);
bool sendEnrollResult(int fingerprintId, int userId);
bool sendEnrollStep(int step, int userId);
int findNextFreeSlot();
void blinkLed(int pin, int count, int delayMs);
void setLedIndicator(int pin, bool state);
void playTone(int frequency, int duration);
void feedbackSuccess();
void feedbackError();
void feedbackWaiting();

// ═══════════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("╔═══════════════════════════════════════════════════════╗");
  Serial.println("║  ESP8266 Fingerprint Module — Medical SCADA System   ║");
  Serial.println("╚═══════════════════════════════════════════════════════╝");
  Serial.println();

  // Initialize LED pins
  pinMode(LED_STATUS, OUTPUT);
  pinMode(LED_SUCCESS, OUTPUT);
  pinMode(LED_ERROR, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // ESP8266 built-in LED is usually active LOW
  digitalWrite(LED_STATUS, HIGH); // Tắt LED
  digitalWrite(LED_SUCCESS, LOW);
  digitalWrite(LED_ERROR, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // Initialize fingerprint sensor with SoftwareSerial
  finger.begin(57600);

  if (finger.verifyPassword()) {
    Serial.println("[FP] ✓ Fingerprint sensor detected!");
    Serial.print("[FP]   Capacity: ");
    Serial.println(finger.capacity);
  } else {
    Serial.println("[FP] ✗ Fingerprint sensor NOT found! Check wiring.");
    currentState = STATE_ERROR;
    return;
  }

  // Check if we should force config portal (Hold Flash button D3/GPIO0 during boot)
  pinMode(D3, INPUT_PULLUP);
  delay(100);
  if (digitalRead(D3) == LOW) {
    Serial.println("[Config] Flash button detected. Forcing config portal...");
    WiFiSettings.portal();
  }

  // Start WiFi connection (using WiFiSettings)
  currentState = STATE_WIFI_CONNECTING;
  connectWiFi();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  // ── Ensure WiFi is connected ────────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED) {
    if (currentState != STATE_WIFI_CONNECTING) {
      Serial.println("[WiFi] Connection lost! Reconnecting...");
      currentState = STATE_WIFI_CONNECTING;
    }
    if (now - lastWifiAttempt >= WIFI_RECONNECT_MS) {
      lastWifiAttempt = now;
      connectWiFi();
    }
    // Blink status LED fast while connecting
    if (now - lastLedToggle >= LED_BLINK_FAST_MS) {
      lastLedToggle = now;
      ledState = !ledState;
      // ESP8266 builtin LED is inverted (LOW = ON, HIGH = OFF)
      digitalWrite(LED_STATUS, ledState ? LOW : HIGH);
    }
    return;
  }

  // ── WiFi connected — proceed with normal operation ──────────────────────
  if (currentState == STATE_WIFI_CONNECTING) {
    currentState = STATE_IDLE;
    Serial.println("[WiFi] ✓ Connected!");
    Serial.print("[WiFi]   IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi]   RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    digitalWrite(LED_STATUS,
                 LOW); // Solid ON = connected (Active LOW on NodeMCU)
                 
    // Try to auto-discover server
    discoverServer();
    
    // Nếu vẫn không có server_url (bị bỏ trống lúc cài đặt) thì ép mở lại web config
    if (WiFiSettings.server_url.isEmpty()) {
      Serial.println("[WiFi] ⚠️ Backend URL is EMPTY. Forcing Config Portal...");
      delay(2000);
      WiFiSettings.portal();
    }

    // Bắt đầu lắng nghe UDP trigger từ backend
    if (!udpTriggerStarted) {
      if (udpTrigger.begin(UDP_TRIGGER_PORT)) {
        udpTriggerStarted = true;
        Serial.print("[UDP] Listening for push triggers on port ");
        Serial.println(UDP_TRIGGER_PORT);
      } else {
        Serial.println("[UDP] ⚠️ Failed to start trigger listener.");
      }
    }
  }

  // ── UDP Push Trigger — backend có thể kích hoạt poll ngay lập tức ────────
  // Khi frontend nhấn nút đăng nhập, backend broadcast UDP → ESP8266 nhận
  // và poll server ngay, không cần chờ vòng poll tiếp theo (< 5ms trên LAN).
  if (udpTriggerStarted) {
    int triggerSize = udpTrigger.parsePacket();
    if (triggerSize > 0) {
      char triggerBuf[32];
      int len = udpTrigger.read(triggerBuf, sizeof(triggerBuf) - 1);
      if (len > 0) {
        triggerBuf[len] = 0;
        if (strcmp(triggerBuf, UDP_TRIGGER_MSG) == 0) {
          Serial.println("[UDP] ⚡ Login trigger received! Polling immediately...");
          lastPollTime = 0; // Reset để poll ngay trong vòng lặp này
        }
      }
    }
  }

  // ── Poll server for mode (match vs enroll) ──────────────────────────────
  // Adaptive polling (fallback khi không có UDP trigger):
  // match mode = 200ms, enroll mode = 2000ms.
  unsigned long pollInterval = (currentMode == "match") ? POLL_INTERVAL_MATCH_MS : POLL_INTERVAL_ENROLL_MS;
  if (now - lastPollTime >= pollInterval) {
    lastPollTime = now;
    pollServerStatus();
  }

  // ── State machine ──────────────────────────────────────────────────────
  switch (currentState) {
  case STATE_IDLE:
  case STATE_MATCH_WAITING:
    if (currentMode == "match") {
      handleMatchMode();
    } else if (currentMode == "enroll") {
      currentState = STATE_ENROLL_STEP1;
      enrollStepStart = now;
      Serial.println("[Enroll] Starting enrollment process...");
      Serial.println("[Enroll] Place finger on sensor (step 1/2)...");
      feedbackWaiting();
    }
    break;

  case STATE_ENROLL_STEP1:
  case STATE_ENROLL_STEP2:
  case STATE_ENROLL_SAVING:
  case STATE_ENROLL_REPORTING:
    handleEnrollMode();
    break;

  case STATE_ERROR:
    // Blink error LED
    if (now - lastLedToggle >= LED_BLINK_SLOW_MS) {
      lastLedToggle = now;
      ledState = !ledState;
      digitalWrite(LED_ERROR, ledState);
    }
    break;

  default:
    break;
  }

  delay(10); // Nhỏ hơn để phản hồi UDP trigger nhanh hơn
}

// ═══════════════════════════════════════════════════════════════════════════════
// WiFi Connection (WiFiSettings)
// ═══════════════════════════════════════════════════════════════════════════════
void connectWiFi() {
  WiFiSettings.hostname = "MedSCADA_Fingerprint";
  
  // Try to connect, start portal if fails
  if (!WiFiSettings.connect(true, 30)) {
    Serial.println("[WiFi] Connection failed. Restarting...");
    delay(3000);
    ESP.restart();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Discover Backend Server (UDP Broadcast)
// ═══════════════════════════════════════════════════════════════════════════════
bool discoverServer() {
  WiFiUDP udp;
  if (!udp.begin(3030)) {
    Serial.println("[Discovery] UDP failed to bind");
    return false;
  }
  
  // Calculate subnet broadcast address (e.g. 192.168.1.255)
  uint32_t ip = WiFi.localIP();
  uint32_t mask = WiFi.subnetMask();
  IPAddress broadcastIp(ip | ~mask);
  Serial.print("[Discovery] Broadcasting to ");
  Serial.print(broadcastIp);
  Serial.println(":3030 ...");
  
  // Send broadcast multiple times to ensure delivery
  for (int i=0; i<3; i++) {
    udp.beginPacket(broadcastIp, 3030);
    udp.write("MEDSCADA_DISCOVER");
    udp.endPacket();
    delay(50);
  }
  
  unsigned long start = millis();
  while (millis() - start < 4000) {
    int packetSize = udp.parsePacket();
    if (packetSize) {
      char packetBuffer[255];
      int len = udp.read(packetBuffer, 255);
      if (len > 0) packetBuffer[len] = 0;
      
      String msg = String(packetBuffer);
      if (msg.startsWith("MEDSCADA_SERVER:")) {
        String port = msg.substring(16);
        IPAddress remote = udp.remoteIP();
        
        String newUrl = "http://" + remote.toString() + ":" + port;
        Serial.println("[Discovery] ✓ Server found at: " + newUrl);
        
        // Cập nhật lại URL vào RAM và lưu vào Flash theo SSID
        if (WiFiSettings.server_url != newUrl) {
          WiFiSettings.saveServerUrl(newUrl);
        }
        return true;
      }
    }
    delay(50);
  }
  
  Serial.println("[Discovery] ✗ Server not found via UDP. Using saved URL.");
  Serial.print("[Discovery] Saved URL is: '");
  Serial.print(WiFiSettings.server_url);
  Serial.println("'");
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Poll Server Status — GET /api/fingerprint/status
// ═══════════════════════════════════════════════════════════════════════════════
void pollServerStatus() {
  if (WiFiSettings.server_url.isEmpty()) return;

  HTTPClient http;
  String url = WiFiSettings.server_url + "/api/fingerprint/status";

  if (url.startsWith("https://")) {
    wifiClientSecure.setInsecure();
    http.begin(wifiClientSecure, url);
  } else {
    http.begin(wifiClient, url);
  }
  
  http.setReuse(true); // Enable HTTP Keep-Alive
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("X-API-Key", WiFiSettings.api_key);

  int httpCode = http.GET();

  if (httpCode == 200) {
    consecutivePollFailures = 0; // Reset counter on success
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);

    if (!err) {
      String newMode = doc["mode"].as<String>();

      if (newMode != currentMode) {
        Serial.print("[Poll] Mode changed: ");
        Serial.print(currentMode);
        Serial.print(" → ");
        Serial.println(newMode);

        currentMode = newMode;

        if (currentMode == "enroll") {
          enrollUserId = doc["userId"].as<int>();
          enrollSlotId = doc["slotId"].as<int>();
          Serial.print("[Poll] Enroll target userId=");
          Serial.print(enrollUserId);
          Serial.print(", slotId=");
          Serial.println(enrollSlotId);
        }
      }
    } else {
      Serial.print("[Poll] JSON parse error: ");
      Serial.println(err.c_str());
    }
  } else if (httpCode > 0) {
    consecutivePollFailures = 0; // Reset counter (server reachable, just returned error code)
    Serial.print("[Poll] Server error: HTTP ");
    Serial.println(httpCode);
  } else {
    consecutivePollFailures++;
    Serial.print("[Poll] Connection failed: ");
    Serial.println(http.errorToString(httpCode));
    
    if (consecutivePollFailures >= 10) {
      Serial.println("[Poll] ⚠️ Too many connection failures. Clearing saved URL and restarting...");
      
      // Attempt to clear saved URL file to force portal on next boot
      String urlFile = "/server-url-" + WiFiSettings.ssid;
      #ifdef ESP32
        SPIFFS.remove(urlFile);
        SPIFFS.remove("/server-url");
      #else
        LittleFS.remove(urlFile);
        LittleFS.remove("/server-url");
      #endif
      
      WiFiSettings.server_url = "";
      delay(2000);
      ESP.restart();
    }
  }

  http.end();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Match Mode — Scan fingerprint and report match to server
// ═══════════════════════════════════════════════════════════════════════════════
void handleMatchMode() {
  // Don't scan too quickly after a successful match
  if (millis() - lastScanTime < SCAN_DEBOUNCE_MS && lastScanTime != 0) {
    return;
  }

  currentState = STATE_MATCH_WAITING;

  // Try to detect a finger
  uint8_t result = finger.getImage();
  if (result != FINGERPRINT_OK) {
    return; // No finger detected, keep waiting
  }

  Serial.println("[Match] Finger detected! Processing...");
  currentState = STATE_MATCH_PROCESSING;

  // Convert image to feature template (stored in CharBuffer1)
  result = finger.image2Tz();
  if (result != FINGERPRINT_OK) {
    Serial.println("[Match] ✗ Image conversion failed.");
    feedbackError();
    currentState = STATE_MATCH_WAITING;
    return;
  }

  // Search the sensor's internal database for a match
  result = finger.fingerSearch();
  if (result != FINGERPRINT_OK) {
    Serial.println("[Match] ✗ No match found in sensor database.");
    feedbackError();
    currentState = STATE_MATCH_WAITING;
    lastScanTime = millis();
    return;
  }

  // Match found!
  int fingerprintId = finger.fingerID;
  int confidence = finger.confidence;

  Serial.print("[Match] ✓ Match found! ID=");
  Serial.print(fingerprintId);
  Serial.print(", confidence=");
  Serial.println(confidence);

  // Report to backend
  if (sendMatchResult(fingerprintId)) {
    Serial.println("[Match] ✓ Login event sent to server.");
    feedbackSuccess();
  } else {
    Serial.println("[Match] ✗ Failed to notify server.");
    feedbackError();
  }

  lastScanTime = millis();
  currentState = STATE_MATCH_WAITING;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Enroll Mode — Two-step enrollment of a new fingerprint
// ═══════════════════════════════════════════════════════════════════════════════
void handleEnrollMode() {
  unsigned long now = millis();
  uint8_t result;

  switch (currentState) {
  // ── Step 1: First scan ────────────────────────────────────────────────
  case STATE_ENROLL_STEP1: {
    // Timeout check
    if (now - enrollStepStart > ENROLL_STEP_TIMEOUT_MS) {
      Serial.println("[Enroll] ✗ Step 1 timed out.");
      feedbackError();
      currentState = STATE_IDLE;
      currentMode = "match";
      return;
    }

    result = finger.getImage();
    if (result != FINGERPRINT_OK)
      return; // No finger yet

    Serial.println("[Enroll] Step 1: Finger detected!");

    result = finger.image2Tz(1); // Store in CharBuffer1
    if (result != FINGERPRINT_OK) {
      Serial.println("[Enroll] ✗ Step 1: Image conversion failed. Try again.");
      feedbackError();
      return;
    }

    Serial.println("[Enroll] ✓ Step 1 complete. Remove finger...");
    blinkLed(LED_SUCCESS, 2, 200);

    // Wait until finger is removed
    while (finger.getImage() == FINGERPRINT_OK) {
      delay(100);
    }

    Serial.println("[Enroll] Place same finger again (step 2/2)...");
    feedbackWaiting();

    // Notify server that step 1 is done
    sendEnrollStep(1, enrollUserId);

    currentState = STATE_ENROLL_STEP2;
    enrollStepStart = now;
    break;
  }

  // ── Step 2: Second scan (confirmation) ────────────────────────────────
  case STATE_ENROLL_STEP2: {
    if (now - enrollStepStart > ENROLL_STEP_TIMEOUT_MS) {
      Serial.println("[Enroll] ✗ Step 2 timed out.");
      feedbackError();
      currentState = STATE_IDLE;
      currentMode = "match";
      return;
    }

    result = finger.getImage();
    if (result != FINGERPRINT_OK)
      return;

    Serial.println("[Enroll] Step 2: Finger detected!");

    result = finger.image2Tz(2); // Store in CharBuffer2
    if (result != FINGERPRINT_OK) {
      Serial.println("[Enroll] ✗ Step 2: Image conversion failed. Try again.");
      feedbackError();
      return;
    }

    // Create model from the two samples
    Serial.println("[Enroll] Creating fingerprint model...");
    currentState = STATE_ENROLL_SAVING;
    break;
  }

  // ── Save template to sensor's internal storage ────────────────────────
  case STATE_ENROLL_SAVING: {
    result = finger.createModel();
    if (result != FINGERPRINT_OK) {
      Serial.println("[Enroll] ✗ Fingerprints did not match! Start over.");
      feedbackError();
      currentState = STATE_IDLE;
      currentMode = "match";
      return;
    }

    Serial.println("[Enroll] ✓ Fingerprint model created.");

    // Find the slot ID to store in
    int storeId = enrollSlotId;
    if (storeId <= 0) {
      // If server didn't provide a slotId, find next free slot
      storeId = findNextFreeSlot();
      if (storeId < 0) {
        Serial.println("[Enroll] ✗ Sensor memory full! Cannot store.");
        feedbackError();
        currentState = STATE_IDLE;
        currentMode = "match";
        return;
      }
    }

    result = finger.storeModel(storeId);
    if (result != FINGERPRINT_OK) {
      Serial.print("[Enroll] ✗ Failed to store model at slot ");
      Serial.println(storeId);
      feedbackError();
      currentState = STATE_IDLE;
      currentMode = "match";
      return;
    }

    Serial.print("[Enroll] ✓ Template stored at slot #");
    Serial.println(storeId);

    // Now report to server
    enrollSlotId = storeId;
    currentState = STATE_ENROLL_REPORTING;
    break;
  }

  // ── Report enrollment result to backend ───────────────────────────────
  case STATE_ENROLL_REPORTING: {
    if (sendEnrollResult(enrollSlotId, enrollUserId)) {
      Serial.println("[Enroll] ✓ Enrollment reported to server successfully!");
      feedbackSuccess();
    } else {
      Serial.println("[Enroll] ✗ Failed to report enrollment to server.");
      // Template is already stored locally — server can retry later
      feedbackError();
    }

    // Return to match mode
    currentState = STATE_IDLE;
    currentMode = "match";
    enrollUserId = -1;
    enrollSlotId = -1;
    lastScanTime = millis();
    break;
  }

  default:
    break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP: POST /api/fingerprint/match
// ═══════════════════════════════════════════════════════════════════════════════
bool sendMatchResult(int fingerprintId) {
  if (WiFiSettings.server_url.isEmpty()) return false;

  HTTPClient http;
  String url = WiFiSettings.server_url + "/api/fingerprint/match";

  if (url.startsWith("https://")) {
    wifiClientSecure.setInsecure();
    http.begin(wifiClientSecure, url);
  } else {
    http.begin(wifiClient, url);
  }
  
  http.setReuse(true); // Enable HTTP Keep-Alive
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", WiFiSettings.api_key);

  JsonDocument doc;
  doc["fingerprintId"] = fingerprintId;

  String body;
  serializeJson(doc, body);

  Serial.print("[HTTP] POST /api/fingerprint/match → ");
  int httpCode = http.POST(body);

  bool success = false;

  if (httpCode == 200) {
    String response = http.getString();
    Serial.print("200 OK — ");
    Serial.println(response);
    success = true;
  } else if (httpCode == 404) {
    Serial.println("404 — No user mapped to this fingerprint ID.");
  } else if (httpCode == 403) {
    Serial.println("403 — User account deactivated.");
  } else if (httpCode > 0) {
    Serial.print(httpCode);
    Serial.print(" — ");
    Serial.println(http.getString());
  } else {
    Serial.print("FAILED — ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
  return success;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP: POST /api/fingerprint/enroll-step
// ═══════════════════════════════════════════════════════════════════════════════
bool sendEnrollStep(int step, int userId) {
  if (WiFiSettings.server_url.isEmpty()) return false;

  HTTPClient http;
  String url = WiFiSettings.server_url + "/api/fingerprint/enroll-step";

  if (url.startsWith("https://")) {
    wifiClientSecure.setInsecure();
    http.begin(wifiClientSecure, url);
  } else {
    http.begin(wifiClient, url);
  }
  
  http.setReuse(true); // Enable HTTP Keep-Alive
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", WiFiSettings.api_key);

  JsonDocument doc;
  doc["step"] = step;
  doc["userId"] = userId;

  String body;
  serializeJson(doc, body);

  Serial.print("[HTTP] POST /api/fingerprint/enroll-step → ");
  int httpCode = http.POST(body);

  if (httpCode == 200) {
    Serial.println("200 OK");
    http.end();
    return true;
  }

  Serial.println("FAILED");
  http.end();
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP: POST /api/fingerprint/enroll
// ═══════════════════════════════════════════════════════════════════════════════
bool sendEnrollResult(int fingerprintId, int userId) {
  if (WiFiSettings.server_url.isEmpty()) return false;

  HTTPClient http;
  String url = WiFiSettings.server_url + "/api/fingerprint/enroll";

  if (url.startsWith("https://")) {
    wifiClientSecure.setInsecure();
    http.begin(wifiClientSecure, url);
  } else {
    http.begin(wifiClient, url);
  }
  
  http.setReuse(true); // Enable HTTP Keep-Alive
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", WiFiSettings.api_key);

  JsonDocument doc;
  doc["fingerprintId"] = fingerprintId;
  doc["userId"] = userId;

  String body;
  serializeJson(doc, body);

  Serial.print("[HTTP] POST /api/fingerprint/enroll → ");
  int httpCode = http.POST(body);

  bool success = false;

  if (httpCode == 200) {
    String response = http.getString();
    Serial.print("200 OK — ");
    Serial.println(response);
    success = true;
  } else if (httpCode > 0) {
    Serial.print(httpCode);
    Serial.print(" — ");
    Serial.println(http.getString());
  } else {
    Serial.print("FAILED — ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
  return success;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Find next free slot in fingerprint sensor's memory
// ═══════════════════════════════════════════════════════════════════════════════
int findNextFreeSlot() {
  // Check slots 1 to capacity
  for (int i = 1; i < finger.capacity; i++) {
    uint8_t result = finger.loadModel(i);
    if (result != FINGERPRINT_OK) {
      // Slot is empty
      return i;
    }
  }
  return -1; // All slots occupied
}

// ═══════════════════════════════════════════════════════════════════════════════
// LED & Audio Feedback
// ═══════════════════════════════════════════════════════════════════════════════
void blinkLed(int pin, int count, int delayMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(pin, pin == LED_STATUS ? LOW : HIGH); // LED NodeMCU Active LOW
    delay(delayMs);
    digitalWrite(pin, pin == LED_STATUS ? HIGH : LOW);
    delay(delayMs);
  }
}

void setLedIndicator(int pin, bool state) {
  if (pin == LED_STATUS) {
    digitalWrite(pin, state ? LOW : HIGH); // NodeMCU LED is Active LOW
  } else {
    digitalWrite(pin, state ? HIGH : LOW);
  }
}

void playTone(int frequency, int duration) {
  // Simple tone generation using buzzer
  if (BUZZER_PIN > 0) {
    tone(BUZZER_PIN, frequency, duration);
    delay(duration);
    noTone(BUZZER_PIN);
  }
}

void feedbackSuccess() {
  blinkLed(LED_SUCCESS, 3, 150);
  playTone(1500, 100);
  delay(50);
  playTone(2000, 100);
  delay(50);
  playTone(2500, 200);
}

void feedbackError() {
  blinkLed(LED_ERROR, 3, 200);
  playTone(400, 300);
  delay(100);
  playTone(300, 500);
}

void feedbackWaiting() {
  blinkLed(LED_STATUS, 2, 100);
  playTone(1000, 100);
}
