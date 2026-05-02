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

// ── Configuration ───────────────────────────────────────────────────────────
// WiFi credentials
const char *WIFI_SSID = "Quang Sang";
const char *WIFI_PASSWORD = "0907771191";

// Backend server address (e.g., "http://192.168.1.91:3000" - dùng IP máy tính
// đang chạy server)
const char *SERVER_URL =
    "http://192.168.1.91:3000"; // Thay 192.168.1.91 bằng IP thực tế của bạn

// API key — must match ESP32_API_KEY in backend .env
const char *API_KEY = "esp32-fingerprint-secret-change-me";

// ── Hardware Pins (ESP8266 NodeMCU) ─────────────────────────────────────────
#define FINGERPRINT_RX D1 // TX của cảm biến nối vào D1 của ESP8266
#define FINGERPRINT_TX D2 // RX của cảm biến nối vào D2 của ESP8266
#define LED_STATUS                                                             \
  LED_BUILTIN          // Đèn LED có sẵn trên NodeMCU (thường là D4/GPIO2)
#define LED_SUCCESS D6 // Chân cho đèn LED báo thành công (tuỳ chọn)
#define LED_ERROR D7   // Chân cho đèn LED báo lỗi (tuỳ chọn)
#define BUZZER_PIN D5  // Chân cho còi chip (tuỳ chọn)

// ── Timing Configuration (ms) ──────────────────────────────────────────────
#define POLL_INTERVAL_MS 2000  // How often to poll /api/fingerprint/status
#define WIFI_RECONNECT_MS 5000 // Wait between WiFi reconnect attempts
#define SCAN_DEBOUNCE_MS 3000  // Cooldown after successful scan
#define ENROLL_STEP_TIMEOUT_MS 15000 // Max wait per enrollment step
#define HTTP_TIMEOUT_MS 10000        // HTTP request timeout
#define LED_BLINK_FAST_MS 150        // Fast blink interval
#define LED_BLINK_SLOW_MS 500        // Slow blink interval

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

// ── Function Prototypes ─────────────────────────────────────────────────────
void connectWiFi();
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
    Serial.print("[FP]   Security level: ");
    Serial.println(finger.security_level);

    // Read sensor parameters
    finger.getParameters();
    Serial.print("[FP]   Stored templates: ");
    finger.getTemplateCount();
    Serial.println(finger.templateCount);
  } else {
    Serial.println("[FP] ✗ Fingerprint sensor NOT found! Check wiring.");
    currentState = STATE_ERROR;
    return;
  }

  // Start WiFi connection
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
  }

  // ── Poll server for mode (match vs enroll) ──────────────────────────────
  if (now - lastPollTime >= POLL_INTERVAL_MS) {
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

  delay(50); // Small yield to prevent WDT reset
}

// ═══════════════════════════════════════════════════════════════════════════════
// WiFi Connection
// ═══════════════════════════════════════════════════════════════════════════════
void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.print(WIFI_SSID);
  Serial.println("...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" OK!");
  } else {
    Serial.println(" FAILED (will retry)");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Poll Server Status — GET /api/fingerprint/status
// ═══════════════════════════════════════════════════════════════════════════════
void pollServerStatus() {
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/fingerprint/status";

  http.begin(client, url);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("X-API-Key", API_KEY);

  int httpCode = http.GET();

  if (httpCode == 200) {
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
    Serial.print("[Poll] Server error: HTTP ");
    Serial.println(httpCode);
  } else {
    Serial.print("[Poll] Connection failed: ");
    Serial.println(http.errorToString(httpCode));
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
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/fingerprint/match";

  http.begin(client, url);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

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
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/fingerprint/enroll-step";

  http.begin(client, url);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

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
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/fingerprint/enroll";

  http.begin(client, url);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

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
