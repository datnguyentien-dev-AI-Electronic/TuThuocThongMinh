#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"

#define RESET_TRIGGER_PIN 13 // Chân GPIO13 nhận tín hiệu Reset

String ssid = "";
String password = "";

// ==== PIN MAP cho AI Thinker ESP32-CAM ====
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

void startCameraServer();

// ==== Khởi tạo Camera ====
void setupCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;
    config.jpeg_quality = 10;              
    config.fb_count     = 2;
  } else {
    config.frame_size   = FRAMESIZE_CIF;   
    config.jpeg_quality = 12;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[LỖI] Không khởi tạo được camera: 0x%x\n", err);
    delay(1000);
    ESP.restart();
  }

  sensor_t* s = esp_camera_sensor_get();
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);      
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);      
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);     
  s->set_hmirror(s, 0);
  s->set_vflip(s, 0);         

  Serial.println("[OK] Camera đã sẵn sàng.");
}

// ==== Handler: trang chủ HTML ====
static esp_err_t index_handler(httpd_req_t* req) {
  const char* html =
    "<!DOCTYPE html><html><head>"
    "<meta charset='UTF-8'>"
    "<meta name='viewport' content='width=device-width, initial-scale=1'>"
    "<title>ESP32-CAM Stream</title>"
    "<style>"
    "  body { margin:0; background:#111; display:flex; flex-direction:column;"
    "         align-items:center; justify-content:center; min-height:100vh;"
    "         font-family:sans-serif; color:#eee; }"
    "  h2   { margin-bottom:12px; letter-spacing:2px; }"
    "  img  { max-width:100%; border:3px solid #444; border-radius:8px; }"
    "  p    { margin-top:10px; color:#888; font-size:13px; }"
    "</style></head><body>"
    "<h2>📷 ESP32-CAM Live Stream</h2>"
    "<img src='/stream' />"
    "<p>MJPEG stream · AI Thinker</p>"
    "</body></html>";
  httpd_resp_set_type(req, "text/html");
  httpd_resp_send(req, html, strlen(html));
  return ESP_OK;
}

// ==== Handler: MJPEG stream ====
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static esp_err_t stream_handler(httpd_req_t* req) {
  camera_fb_t* fb = NULL;
  esp_err_t    res = ESP_OK;
  char         part_buf[128];

  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[LỖI] Không lấy được frame.");
      res = ESP_FAIL;
      break;
    }

    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

    size_t hlen = snprintf(part_buf, sizeof(part_buf), STREAM_PART, fb->len);
    res = httpd_resp_send_chunk(req, part_buf, hlen);
    if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

    res = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
  }
  return res;
}

// ==== Khởi động HTTP Server ====
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;

  httpd_uri_t index_uri = {
    .uri      = "/",
    .method   = HTTP_GET,
    .handler  = index_handler,
    .user_ctx = NULL
  };
  httpd_uri_t stream_uri = {
    .uri      = "/stream",
    .method   = HTTP_GET,
    .handler  = stream_handler,
    .user_ctx = NULL
  };
  httpd_handle_t server = NULL;
  if (httpd_start(&server, &config) == ESP_OK) {
    httpd_register_uri_handler(server, &index_uri);
    httpd_register_uri_handler(server, &stream_uri);
    Serial.println("[OK] HTTP Server đã khởi động.");
  } else {
    Serial.println("[LỖI] Không thể khởi động HTTP Server.");
  }
}

// ==== Lắng nghe UART từ ESP32 ====
bool getWiFiConfigFromSerial() {
  if (Serial.available()) {
    String data = Serial.readStringUntil('\n');
    data.trim(); // Xóa khoảng trắng và ký tự \r thừa
    
    // In ra màn hình để biết ESP32-CAM có đang bị "điếc" hay không
    if (data.length() > 0) {
      Serial.println("[CAM DEBUG] Vừa nhận được: " + data);
    }

    // Dùng indexOf thay vì startsWith để tránh bị lỗi do dính ký tự rác ở đầu
    int wifiIdx = data.indexOf("WIFI:");
    if (wifiIdx != -1) {
      data.remove(0, wifiIdx + 5); // Cắt bỏ phần đầu
      
      int commaIndex = data.indexOf(',');
      if (commaIndex > 0) {
        ssid = data.substring(0, commaIndex);
        password = data.substring(commaIndex + 1);
        return true;
      }
    }
  }
  return false;
}

// ==== Setup ====
// ==== Setup cho ESP32-CAM ====
void setup() {
  Serial.begin(9600);
  pinMode(RESET_TRIGGER_PIN, INPUT_PULLUP);
  while (Serial.available()) { 
    Serial.read(); 
  }
  Serial.setDebugOutput(false);
  Serial.println("\n=== ESP32-CAM Video Stream ===");

  setupCamera();

  // Đợi nhận cấu hình WiFi từ ESP8266
  bool configured = false;
  while (!configured) {
    configured = getWiFiConfigFromSerial();
    delay(10);
  }
  
  // Bắt đầu kết nối WiFi với thông số vừa nhận
  WiFi.begin(ssid.c_str(), password.c_str());
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  
  // ---> GỬI IP VỀ CHO ESP8266 <---
  // Gửi chuỗi theo định dạng "IP:192.168.x.x"
  Serial.print("IP:");
  Serial.println(WiFi.localIP().toString());

  // (Các log dưới đây vẫn được in ra, ESP8266 sẽ tự bỏ qua vì không có tiền tố "IP:")
  Serial.println("\n[OK] WiFi đã kết nối!");
  Serial.print("[INFO] Địa chỉ IP stream: http://");
  Serial.println(WiFi.localIP());

  startCameraServer();
}

// ==== Loop ====
void loop() {
  if (digitalRead(RESET_TRIGGER_PIN) == LOW) {
    Serial.println("\n[LỆNH] Nhận tín hiệu LOW. Đang chờ nhả chốt...");
    Serial.flush(); // Ép mạch in hết chữ trước khi làm việc khác

    // Vòng lặp kẹt ở đây cho đến khi ESP8266 kéo chân lên HIGH (sau 200ms)
    while (digitalRead(RESET_TRIGGER_PIN) == LOW) {
      delay(10); 
    }

    Serial.println("[OK] Đã nhả chốt. Đang khởi động lại mạch!");
    Serial.flush();
    ESP.restart(); // Lúc này Reset mới thực sự an toàn
  }
  
  delay(100); 
}