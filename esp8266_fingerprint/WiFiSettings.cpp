#include "WiFiSettings.h"

#ifdef ESP32
  #define ESPFS SPIFFS
  #define ESPMAC (Sprintf("%06" PRIx64, ESP.getEfuseMac() >> 24))
  #include <SPIFFS.h>
  #include <WiFi.h>
  #include <WebServer.h>
  #include <esp_task_wdt.h>
#elif defined(ESP8266)
  #define ESPFS LittleFS
  #define ESPMAC (Sprintf("%06" PRIx32, ESP.getChipId()))
  #include <LittleFS.h>
  #include <ESP8266WiFi.h>
  #include <ESP8266WebServer.h>
  #define WebServer ESP8266WebServer
  #define esp_task_wdt_reset wdt_reset
#else
  #error "This library only supports ESP32 and ESP8266"
#endif

#include <DNSServer.h>
#include <limits.h>
#include <vector>
#include "WiFiSettings_strings.h"

#define Sprintf(f, ...) ({ char* s; asprintf(&s, f, __VA_ARGS__); String r = s; free(s); r; })

// ===== Helper functions =====
namespace {
  String slurp(const String& fn) {
    File f = ESPFS.open(fn, "r");
    if (!f) return "";
    String r = f.readString();
    f.close();
    return r;
  }

  bool spurt(const String& fn, const String& content) {
    File f = ESPFS.open(fn, "w");
    if (!f) return false;
    auto w = f.print(content);
    f.close();
    return w == content.length();
  }
}

WiFiSettingsLanguage::Texts _WSL_T;

void WiFiSettingsClass::begin() {
  if (begun) return;
  begun = true;

#ifdef ESP32
  if (!ESPFS.begin(true)) {
    Serial.println("⚠️ Lỗi mount SPIFFS, đang format...");
    ESPFS.format();
    ESPFS.begin(true);
  }
#else
  if (!ESPFS.begin()) {
    Serial.println("⚠️ Lỗi mount LittleFS, đang format...");
    ESPFS.format();
    ESPFS.begin();
  }
#endif

  String lang = "vi";
  WiFiSettingsLanguage::select(_WSL_T, lang);
  hostname = "MedSCADA_Fingerprint";
}

void WiFiSettingsClass::portal() {
  WebServer http(80);
  DNSServer dns;
  begin();

  WiFi.disconnect(true, true);
  Serial.println(F("🛜 Bắt đầu điểm truy cập cấu hình..."));
  if (secure && password.length()) WiFi.softAP(hostname.c_str(), password.c_str());
  else WiFi.softAP(hostname.c_str());
  delay(500);

  dns.setTTL(0);
  dns.start(53, "*", WiFi.softAPIP());

  if (onPortal) onPortal();
  String ip = WiFi.softAPIP().toString();
  Serial.printf("Cấu hình tại: http://%s\n", ip.c_str());

  // ===== Giao diện cấu hình Wi-Fi =====
  http.on("/", HTTP_GET, [this, &http]() {
    int n = WiFi.scanNetworks();
    String html = F(
      "<!DOCTYPE html><html lang='vi'><head><meta charset='UTF-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>Cấu hình WiFi ESP32</title>"
      "<style>"
      "body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#00c6ff,#0072ff);margin:0;padding:0;text-align:center;color:#222}"
      ".card{background:#fff;margin:3em auto;padding:25px;border-radius:20px;max-width:420px;"
      "box-shadow:0 10px 25px rgba(0,0,0,0.3);animation:fadeIn 0.8s ease-out}"
      "@keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}"
      "select,input{width:90%;padding:12px;margin:10px 0;border-radius:10px;border:1px solid #aaa;font-size:16px}"
      "button{background:linear-gradient(135deg,#0072ff,#00c6ff);border:none;border-radius:10px;color:#fff;"
      "font-size:16px;padding:12px 20px;cursor:pointer;transition:.2s;width:94%}"
      "button:hover{transform:scale(1.05);box-shadow:0 5px 12px rgba(0,0,0,0.3)}"
      "h1{color:#fff;margin-top:25px;font-weight:600;text-shadow:0 2px 5px rgba(0,0,0,0.3)}"
      ".loading{display:none;font-size:18px;margin-top:15px;color:#0072ff;font-weight:500}"
      ".logo{font-size:22px;font-weight:bold;color:#0072ff;margin-bottom:10px}"
      "</style>"
      "<script>"
      "function showLoading(){"
      "document.getElementById('loading').style.display='block';"
      "document.getElementById('saveBtn').disabled=true;"
      "document.getElementById('saveBtn').innerText='⏳ Đang lưu...';"
      "}"
      "</script>"
      "</head><body>"
      "<h1>⚙️ Cấu hình WiFi ESP32</h1>"
      "<div class='card'>"
      "<div class='logo'>🌐 Nhóm 4 - IoT Project</div>"
      "<form method='post' onsubmit='showLoading()'>"
      "<label for='ssid'>Tên mạng WiFi (SSID):</label>"
      "<select name='ssid' id='ssid'>"
      "<option value=''>-- Chọn mạng WiFi --</option>"
    );

    // Thêm các mạng Wi-Fi quét được vào danh sách
    for (int i = 0; i < n; i++) {
      String ssid = WiFi.SSID(i);
      int rssi = WiFi.RSSI(i);
#ifdef ESP32
      bool secure = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
#else
      bool secure = (WiFi.encryptionType(i) != AUTH_OPEN);
#endif
      html += "<option value='" + ssid + "'>" + ssid;
      if (secure) html += " 🔒";
      html += " (" + String(rssi) + " dBm)</option>";
    }

    html += F(
      "</select>"
      "<label for='password'>Mật khẩu WiFi:</label>"
      "<input type='password' name='password' placeholder='Nhập mật khẩu WiFi'>"
      "<label for='server'>Backend Server URL:</label>"
      "<input type='text' name='server' placeholder='http://192.168.0.123:3000' value='"
    );
    html += server_url;
    html += F("'>");
    html += F(
      "<label for='apikey'>API Key:</label>"
      "<input type='text' name='apikey' placeholder='Nhập API Key' value='"
    );
    html += api_key;
    html += F("'>");
    html += F(
      "<button id='saveBtn' type='submit'>💾 Lưu cấu hình</button>"
      "<div id='loading' class='loading'>💡 Đang lưu cấu hình, vui lòng chờ...</div>"
      "</form>"
      "</div></body></html>"
    );

    http.send(200, "text/html", html);
  });

  // ===== Lưu cấu hình Wi-Fi =====
  http.on("/", HTTP_POST, [this, &http]() {
    String ssid = http.arg("ssid");
    String pass = http.arg("password");
    String server = http.arg("server");
    String apikey = http.arg("apikey");

    if (ssid.length()) {
      // Lưu vào legacy để giữ tương thích
      spurt("/wifi-ssid", ssid);
      spurt("/wifi-password", pass);
      spurt("/server-url", server);
      spurt("/api-key", apikey);
      
      // Lưu cấu hình riêng biệt cho từng SSID (Multi-WiFi)
      spurt("/wifi-pass-" + ssid, pass);
      spurt("/server-url-" + ssid, server);
      spurt("/api-key-" + ssid, apikey);
      
      http.send(200, "text/html",
        "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta http-equiv='refresh' content='1;url=/'></head>"
        "<body style='font-family:sans-serif;text-align:center;margin-top:60px;'>"
        "<h2>💾 Đang lưu cấu hình...</h2>"
        "<p>Thiết bị sẽ khởi động lại trong giây lát ⏳</p>"
        "</body></html>");
      delay(1000);
      ESP.restart();
    } else {
      http.send(500, "text/plain", "❌ Lỗi: SSID không hợp lệ!");
    }
  });

  // ===== Redirect tất cả request khác về trang chính =====
  http.onNotFound([&http]() {
    String redirectUrl = "http://" + WiFi.softAPIP().toString() + "/";
    http.sendHeader("Location", redirectUrl);
    http.send(302, "text/plain", "Redirecting...");
  });

  http.begin();
  while (true) {
    http.handleClient();
    dns.processNextRequest();
    esp_task_wdt_reset();
    delay(1);
  }
}


bool WiFiSettingsClass::connect(bool portal, int wait_seconds) {
  begin();
  
  String best_ssid = "";
  String best_pw = "";
  
  // 1. Cố gắng tìm các mạng đã lưu xung quanh (Multi-WiFi support)
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    String current_ssid = WiFi.SSID(i);
    String saved_pw = slurp("/wifi-pass-" + current_ssid);
    if (saved_pw.length() > 0) {
      best_ssid = current_ssid;
      best_pw = saved_pw;
      Serial.printf("🔍 Tìm thấy mạng đã lưu: %s\n", best_ssid.c_str());
      break;
    }
  }

  // 2. Fallback về cấu hình cũ nếu không tìm thấy mạng đã lưu nào xung quanh
  if (best_ssid.isEmpty()) {
    best_ssid = slurp("/wifi-ssid");
    best_pw = slurp("/wifi-password");
  }

  ssid = best_ssid;
  String pw = best_pw;
  
  // 3. Tải thông số Backend tương ứng với SSID
  server_url = slurp("/server-url-" + ssid);
  if (server_url.isEmpty()) server_url = slurp("/server-url");
  if (server_url.isEmpty()) server_url = "http://192.168.0.123:3000"; // IP tĩnh qua TP-Link router
  
  api_key = slurp("/api-key-" + ssid);
  if (api_key.isEmpty()) api_key = slurp("/api-key");
  
  ssid.trim();
  pw.trim();
  server_url.trim();
  api_key.trim();

  // Xoá dấu '/' ở cuối URL nếu có
  if (server_url.endsWith("/")) {
    server_url = server_url.substring(0, server_url.length() - 1);
  }

  if (api_key.isEmpty()) {
    api_key = "esp32-fingerprint-secret-change-me"; // Gán cứng API key mặc định
  }

  if (ssid.isEmpty()) {
    this->portal();
  }

  Serial.printf("🔗 Kết nối WiFi: %s\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pw.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < (unsigned long)wait_seconds * 1000) {
    Serial.print(".");
    delay(300);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n❌ Kết nối thất bại!");
    if (portal) this->portal();
    return false;
  }

  Serial.printf("\n✅ Đã kết nối! IP: %s\n", WiFi.localIP().toString().c_str());
  return true;
}

WiFiSettingsClass::WiFiSettingsClass() {
  language = "vi";
  secure = false;
  begun = false;
}

void WiFiSettingsClass::saveServerUrl(const String& url) {
  if (url.isEmpty() || ssid.isEmpty()) return;
  // Lưu cho riêng SSID này
  spurt("/server-url-" + ssid, url);
  // Cập nhật biến RAM
  server_url = url;
}

WiFiSettingsClass WiFiSettings;
