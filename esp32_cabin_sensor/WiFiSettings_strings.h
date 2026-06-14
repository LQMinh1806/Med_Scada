#include <map>

namespace WiFiSettingsLanguage {

struct Texts {
    const __FlashStringHelper
        *title,
        *portal_wpa,
        *portal_password,
        *wait,
        *bye,
        *error_fs,
        *button_save,
        *button_restart,
        *scanning_short,
        *scanning_long,
        *rescan,
        *dot1x,
        *ssid,
        *wifi_password,
        *language
    ;
    const char
        *init
    ;
};

// ⚙️ Chỉ có tiếng Việt
std::map<const String, const String> languages = {
    { "vi", "Tiếng Việt" },
};

bool available(const String& language) {
    return language == "vi";
}

bool multiple() {
    return false;
}

bool select(Texts& T, String& language) {
    language = "vi";
    T.title = F("⚙️ Cấu hình WiFi ESP32");
    T.portal_wpa = F("Bảo vệ trang cấu hình bằng mật khẩu WiFi");
    T.portal_password = F("Mật khẩu WiFi cho trang cấu hình");
    T.init = "mặc định";
    T.wait = F("Vui lòng chờ...");
    T.bye = F("Tạm biệt!");
    T.error_fs = F("Lỗi khi ghi vào bộ nhớ flash.");
    T.button_save = F("💾 Lưu cấu hình");
    T.button_restart = F("🔄 Khởi động lại thiết bị");
    T.scanning_short = F("Đang quét...");
    T.scanning_long = F("🔍 Đang tìm mạng WiFi khả dụng...");
    T.rescan = F("🔁 Quét lại");
    T.dot1x = F("(Không hỗ trợ 802.1x)");
    T.ssid = F("Tên mạng WiFi (SSID)");
    T.wifi_password = F("Mật khẩu WiFi");
    T.language = F("Ngôn ngữ");
    return true;
}

} // namespace