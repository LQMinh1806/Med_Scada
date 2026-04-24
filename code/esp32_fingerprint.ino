/*
 * ============================================================================
 *  ESP32 Fingerprint Authentication Client
 *  For: AS608/R307 Fingerprint Sensor + ESP32
 *  Protocol: HTTP POST → Node.js Backend → Socket.io → React Frontend
 * ============================================================================
 *
 *  Wiring (AS608 → ESP32):
 *    VCC   → 3.3V
 *    GND   → GND
 *    TX    → GPIO16 (RX2)
 *    RX    → GPIO17 (TX2)
 *
 *  Required Libraries (install via Arduino Library Manager):
 *    - Adafruit Fingerprint Sensor Library
 *    - ArduinoJson (v7.x)
 *    - WiFi (built-in for ESP32)
 *    - HTTPClient (built-in for ESP32)
 * ============================================================================
 */

#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>

// ── WiFi Configuration ──────────────────────────────────────────────────────
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ── Backend Server Configuration ────────────────────────────────────────────
const char *SERVER_URL = "http://192.168.1.91:3000"; // Your Node.js backend IP
const char *API_KEY =
    "esp32-fingerprint-secret-change-me"; // Must match .env ESP32_API_KEY

// ── Fingerprint Sensor (UART2) ──────────────────────────────────────────────
#define FP_RX_PIN 16
#define FP_TX_PIN 17
HardwareSerial fpSerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fpSerial);

// ── Operation Mode ──────────────────────────────────────────────────────────
enum Mode {
  MODE_MATCH,  // Normal: scan & send match request for login
  MODE_ENROLL, // Enroll: capture new fingerprint and register
};

Mode currentMode = MODE_MATCH;
int enrollUserId = -1; // userId to enroll (set via Serial command)
int enrollSlotId = -1; // fingerprint sensor memory slot to use

// ── LED Pins (optional status indicators) ───────────────────────────────────
#define LED_SUCCESS 2 // Built-in LED on most ESP32 boards
#define LED_ERROR 4

// ============================================================================
//  SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ESP32] Fingerprint Auth Client Starting...");

  // Status LEDs
  pinMode(LED_SUCCESS, OUTPUT);
  pinMode(LED_ERROR, OUTPUT);
  digitalWrite(LED_SUCCESS, LOW);
  digitalWrite(LED_ERROR, LOW);

  // Initialize fingerprint sensor
  fpSerial.begin(57600, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(57600);

  if (finger.verifyPassword()) {
    Serial.println("[FP] Fingerprint sensor found!");
    Serial.print("[FP] Capacity: ");
    Serial.println(finger.capacity);
  } else {
    Serial.println("[FP] ERROR: Fingerprint sensor not found!");
    while (1) {
      digitalWrite(LED_ERROR, !digitalRead(LED_ERROR));
      delay(300);
    }
  }

  // Connect to WiFi
  connectWiFi();

  Serial.println("\n[ESP32] Ready! Commands:");
  Serial.println("  match   - Switch to fingerprint match mode (login)");
  Serial.println("  enroll <userId> <slotId> - Enroll fingerprint for user");
  Serial.println("  status  - Show current status");
}

unsigned long lastPollTime = 0;
const unsigned long POLL_INTERVAL = 2000; // 2 seconds

// ============================================================================
//  MAIN LOOP
// ============================================================================
void loop() {
  // Check for Serial commands
  handleSerialCommands();

  // Ensure WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  } else {
    // Poll server for mode changes
    if (millis() - lastPollTime >= POLL_INTERVAL) {
      lastPollTime = millis();
      pollServerStatus();
    }
  }

  switch (currentMode) {
  case MODE_MATCH:
    handleFingerprintMatch();
    break;

  case MODE_ENROLL:
    handleFingerprintEnroll();
    break;
  }

  delay(100);
}

// ============================================================================
//  WiFi Connection
// ============================================================================
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n",
                  WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Connection failed! Retrying in 5s...");
    delay(5000);
  }
}

// ============================================================================
//  Serial Command Handler
// ============================================================================
void handleSerialCommands() {
  if (!Serial.available())
    return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();

  if (cmd == "match") {
    currentMode = MODE_MATCH;
    Serial.println("[CMD] Switched to MATCH mode (login)");
  } else if (cmd.startsWith("enroll ")) {
    // Parse: enroll <userId> <slotId>
    int spaceIdx = cmd.indexOf(' ', 7);
    if (spaceIdx > 0) {
      enrollUserId = cmd.substring(7, spaceIdx).toInt();
      enrollSlotId = cmd.substring(spaceIdx + 1).toInt();
    } else {
      enrollUserId = cmd.substring(7).toInt();
      enrollSlotId = -1; // Auto-assign
    }

    if (enrollUserId > 0) {
      currentMode = MODE_ENROLL;
      Serial.printf("[CMD] ENROLL mode: userId=%d, slotId=%d\n", enrollUserId,
                    enrollSlotId);
      Serial.println("[CMD] Place finger on sensor to begin enrollment...");
    } else {
      Serial.println("[CMD] Error: usage: enroll <userId> [slotId]");
    }
  } else if (cmd == "status") {
    Serial.printf("[STATUS] Mode: %s\n",
                  currentMode == MODE_MATCH ? "MATCH" : "ENROLL");
    Serial.printf("[STATUS] WiFi: %s\n",
                  WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
    Serial.printf("[STATUS] Server: %s\n", SERVER_URL);
  } else {
    Serial.println("[CMD] Unknown command. Available: match, enroll <userId> "
                   "[slotId], status");
  }
}

// ============================================================================
//  Fingerprint MATCH (Login)
//  Reads a fingerprint, searches the sensor's internal database,
//  and sends the matched ID to the backend.
// ============================================================================
void handleFingerprintMatch() {
  // Step 1: Wait for finger
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK)
    return; // No finger detected

  Serial.println("[FP] Finger detected! Processing...");

  // Step 2: Convert image to template
  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) {
    Serial.println("[FP] Image conversion failed");
    blinkLED(LED_ERROR, 3);
    return;
  }

  // Step 3: Search for match in sensor's database
  p = finger.fingerSearch();
  if (p != FINGERPRINT_OK) {
    Serial.println("[FP] No match found in sensor database");
    blinkLED(LED_ERROR, 2);
    delay(1500);
    return;
  }

  int matchedId = finger.fingerID;
  int confidence = finger.confidence;
  Serial.printf("[FP] Match found! ID=%d, Confidence=%d\n", matchedId,
                confidence);

  // Step 4: Send to backend
  if (sendFingerprintMatch(matchedId)) {
    blinkLED(LED_SUCCESS, 3);
  } else {
    blinkLED(LED_ERROR, 5);
  }

  delay(2000); // Cooldown before next scan
}

// ============================================================================
//  Fingerprint ENROLL
//  Captures a new fingerprint (2 scans), stores it in the sensor,
//  then notifies the backend.
// ============================================================================
void handleFingerprintEnroll() {
  Serial.println("\n[ENROLL] === Step 1: Place finger on sensor ===");

  // Wait for first image
  while (finger.getImage() != FINGERPRINT_OK) {
    delay(200);
    if (millis() - lastPollTime >= POLL_INTERVAL) {
      lastPollTime = millis();
      pollServerStatus();
      if (currentMode == MODE_MATCH)
        return; // Enrollment cancelled
    }
  }

  if (finger.image2Tz(1) != FINGERPRINT_OK) {
    Serial.println("[ENROLL] First image conversion failed");
    blinkLED(LED_ERROR, 3);
    currentMode = MODE_MATCH;
    return;
  }

  Serial.println("[ENROLL] First scan OK. Remove finger...");
  delay(1000);

  // Wait for finger removal
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    delay(200);
    if (millis() - lastPollTime >= POLL_INTERVAL) {
      lastPollTime = millis();
      pollServerStatus();
      if (currentMode == MODE_MATCH)
        return; // Enrollment cancelled
    }
  }

  Serial.println("[ENROLL] === Step 2: Place SAME finger again ===");

  // Wait for second image
  while (finger.getImage() != FINGERPRINT_OK) {
    delay(200);
    if (millis() - lastPollTime >= POLL_INTERVAL) {
      lastPollTime = millis();
      pollServerStatus();
      if (currentMode == MODE_MATCH)
        return; // Enrollment cancelled
    }
  }

  if (finger.image2Tz(2) != FINGERPRINT_OK) {
    Serial.println("[ENROLL] Second image conversion failed");
    blinkLED(LED_ERROR, 3);
    currentMode = MODE_MATCH;
    return;
  }

  // Create model from 2 images
  if (finger.createModel() != FINGERPRINT_OK) {
    Serial.println(
        "[ENROLL] Failed to create fingerprint model (prints may not match)");
    blinkLED(LED_ERROR, 5);
    currentMode = MODE_MATCH;
    return;
  }

  // Determine storage slot
  int slotId = enrollSlotId;
  if (slotId < 0) {
    // Auto-assign: use enrollUserId as slot (simple strategy)
    slotId = enrollUserId;
  }

  // Store in sensor's flash memory
  if (finger.storeModel(slotId) != FINGERPRINT_OK) {
    Serial.printf("[ENROLL] Failed to store model at slot %d\n", slotId);
    blinkLED(LED_ERROR, 5);
    currentMode = MODE_MATCH;
    return;
  }

  Serial.printf("[ENROLL] Fingerprint stored at slot %d!\n", slotId);

  // Notify backend
  if (sendFingerprintEnroll(slotId, enrollUserId)) {
    Serial.println("[ENROLL] Backend notified successfully!");
    blinkLED(LED_SUCCESS, 5);
  } else {
    Serial.println(
        "[ENROLL] WARNING: Stored in sensor but backend notification failed!");
    blinkLED(LED_ERROR, 5);
  }

  // Return to match mode
  currentMode = MODE_MATCH;
  enrollUserId = -1;
  enrollSlotId = -1;
  Serial.println("[ENROLL] Enrollment complete. Returning to MATCH mode.");
}

// ============================================================================
//  HTTP: Poll Server Status
// ============================================================================
void pollServerStatus() {
  if (WiFi.status() != WL_CONNECTED)
    return;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/fingerprint/status";
  http.begin(url);
  http.addHeader("X-API-Key", API_KEY);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    JsonDocument doc;
    deserializeJson(doc, payload);
    const char *mode = doc["mode"];

    if (mode && strcmp(mode, "enroll") == 0) {
      if (currentMode != MODE_ENROLL) {
        currentMode = MODE_ENROLL;
        enrollUserId = doc["userId"] | -1;
        enrollSlotId = doc["slotId"] | enrollUserId;
        Serial.printf("[POLL] Switched to ENROLL mode (userId=%d, slotId=%d)\n",
                      enrollUserId, enrollSlotId);
      }
    } else {
      if (currentMode != MODE_MATCH) {
        currentMode = MODE_MATCH;
        Serial.println("[POLL] Switched to MATCH mode");
      }
    }
  }
  http.end();
}

// ============================================================================
//  HTTP: Send Fingerprint Match (Login)
// ============================================================================
bool sendFingerprintMatch(int fingerprintId) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi not connected!");
    return false;
  }

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/fingerprint/match";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

  // Build JSON payload
  JsonDocument doc;
  doc["fingerprintId"] = fingerprintId;
  String payload;
  serializeJson(doc, payload);

  Serial.printf("[HTTP] POST %s\n", url.c_str());
  Serial.printf("[HTTP] Payload: %s\n", payload.c_str());

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("[HTTP] Response (%d): %s\n", httpCode, response.c_str());
    http.end();
    return (httpCode == 200);
  } else {
    Serial.printf("[HTTP] Error: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }
}

// ============================================================================
//  HTTP: Send Fingerprint Enroll
// ============================================================================
bool sendFingerprintEnroll(int fingerprintId, int userId) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi not connected!");
    return false;
  }

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/fingerprint/enroll";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

  // Build JSON payload
  JsonDocument doc;
  doc["fingerprintId"] = fingerprintId;
  doc["userId"] = userId;
  String payload;
  serializeJson(doc, payload);

  Serial.printf("[HTTP] POST %s\n", url.c_str());
  Serial.printf("[HTTP] Payload: %s\n", payload.c_str());

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("[HTTP] Response (%d): %s\n", httpCode, response.c_str());
    http.end();
    return (httpCode == 200);
  } else {
    Serial.printf("[HTTP] Error: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }
}

// ============================================================================
//  Utility: Blink LED
// ============================================================================
void blinkLED(int pin, int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH);
    delay(150);
    digitalWrite(pin, LOW);
    delay(150);
  }
}
