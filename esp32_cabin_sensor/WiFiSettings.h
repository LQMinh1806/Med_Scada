#ifndef WiFiSettings_h
#define WiFiSettings_h

#include <Arduino.h>
#include <functional>

/*
 * ===========================================
 *  ⚙️ WiFiSettings (phiên bản tiếng Việt)
 *  Đơn giản hóa: chỉ 1 ngôn ngữ (vi)
 *  Hỗ trợ giao diện cấu hình đẹp (CSS tùy biến)
 *  Tác giả gốc: Juerd — bản chỉnh: LQMinh
 * ===========================================
 */

class WiFiSettingsClass {
  public:
    // ======== Callback Types ========
    typedef std::function<void(void)> TCallback;
    typedef std::function<int(void)> TCallbackReturnsInt;
    typedef std::function<void(String&)> TCallbackString;

    // ======== Constructor ========
    WiFiSettingsClass();

    // ======== Kết nối & Portal ========
    void begin();
    bool connect(bool portal = true, int wait_seconds = 30);
    void portal();
    void saveServerUrl(const String& url);

    // ======== Tạo biến cấu hình ========
    String string(const String& name, const String& init = "", const String& label = "");
    String string(const String& name, unsigned int max_length, const String& init = "", const String& label = "");
    String string(const String& name, unsigned int min_length, unsigned int max_length, const String& init = "", const String& label = "");
    long integer(const String& name, long init = 0, const String& label = "");
    long integer(const String& name, long min, long max, long init = 0, const String& label = "");
    bool checkbox(const String& name, bool init = false, const String& label = "");

    // ======== Tạo HTML tiện ích ========
    void html(const String& tag, const String& contents, bool escape = true);
    void heading(const String& contents, bool escape = true);
    void warning(const String& contents, bool escape = true);
    void info(const String& contents, bool escape = true);

    // ======== Các biến cấu hình mặc định ========
    String ssid;       // Tên WiFi kết nối
    String hostname;   // Tên thiết bị (hiển thị trong mạng)
    String password;   // Mật khẩu WiFi
    String server_url; // URL của backend server
    String api_key;    // API Key cho backend
    bool secure;       // Có bật WPA cho portal không
    String language = "vi";  // Mặc định: Tiếng Việt

    // ======== Callback ========
    TCallback onConnect;          // Gọi khi kết nối
    TCallbackReturnsInt onWaitLoop;
    TCallback onSuccess;          // Khi kết nối thành công
    TCallback onFailure;          // Khi thất bại
    TCallback onPortal;           // Khi mở portal
    TCallback onPortalView;       // Khi vẽ giao diện
    TCallbackString onUserAgent;  // Gửi UA trình duyệt
    TCallback onConfigSaved;      // Khi nhấn "Lưu"
    TCallback onRestart;          // Khi restart thiết bị
    TCallback onPortalWaitLoop;

  private:
    bool begun;
};

// ======== Đối tượng WiFiSettings toàn cục ========
extern WiFiSettingsClass WiFiSettings;

#endif