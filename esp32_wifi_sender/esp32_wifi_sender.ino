
#include <DHT.h>
#include <HTTPClient.h>
#include <LiquidCrystal_I2C.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <Wire.h>

#define RX2_PIN 16
#define TX2_PIN 17
#define RESET_CAM_PIN 13
#define DHTPIN 32
#define DHTTYPE DHT11

// GPIO — dau vao (co tro keo len ngoai)
const int IN_PINS[4] = {36, 39, 34, 35}; // VP, VN, 34, 35 -> IN1..IN4
// GPIO — dau ra mo ngan
const int OU_PINS[4] = {23, 19, 18, 4}; // OU1..OU4
// GPIO — den nhac (reminder)
const int RE_PINS[4] = {25, 26, 27, 14}; // RE1..RE4
const int BUZZER_PIN = 33;

#define OU_SESSION_MS (30UL * 60UL * 1000UL) // 30 phut — khong bam nut
#define AFTER_BTN_MS (5UL * 1000UL)       // 5 giay sau nut -> tat OU, bat RE
#define AI_WAIT_MS (10UL * 60UL * 1000UL) // 10 phut cho AI sau khi bam nut

DHT dht(DHTPIN, DHTTYPE);
HardwareSerial camSerial(2);
LiquidCrystal_I2C lcd(0x27, 16, 2);

bool isCamConnected = false;
String camIP = "";
String flaskCallbackUrl = "";
unsigned long lastWiFiTime = 0;
unsigned long lastSendTime = 0;

float temperature = 0.0;
float humidity = 0.0;
String tempStr = "--.-C";

WebServer server(80);

// ===== Trang thai 4 ngan (IN1-IN4, OU1-OU4, RE1-RE4) =====
struct DrawerState {
  bool sessionActive;
  bool buttonPressed;
  bool missedReported;    // het 30p khong bam nut (OU+RE)
  bool notDetectReported; // da bam nut nhung het 10p khong co AI (chi RE)
  bool reOn;
  unsigned long ouStartMs;
  unsigned long buttonCompleteMs;
  unsigned long waitingAiSinceMs;
};

DrawerState drawers[4] = {{false, false, false, false, false, 0, 0, 0},
                          {false, false, false, false, false, 0, 0, 0},
                          {false, false, false, false, false, 0, 0, 0},
                          {false, false, false, false, false, 0, 0, 0}};

// Công tắc IN: Trạng thái đóng ngăn = LOW (BTN_NORMAL), Trạng thái mở ngăn = HIGH (BTN_ACTIVE)
// Chu kỳ hoàn chỉnh: Đóng ngăn (0) -> Mở ngăn (1) -> Đóng ngăn lại (0)
enum BtnPhase { BTN_NORMAL, BTN_ACTIVE };
BtnPhase btnPhases[4] = {BTN_NORMAL, BTN_NORMAL, BTN_NORMAL, BTN_NORMAL};

// Reset OU thu cong: bat tat ca OU -> bam lai tat het va ve trang thai ban dau
bool ouManualAllOn = false;

// ============================================================
//  HAM TIEN ICH & LOGIC
// ============================================================

void lcdPrintRow(int row, String text) {
  while (text.length() < 16)
    text += " ";
  if (text.length() > 16)
    text = text.substring(0, 16);
  lcd.setCursor(0, row);
  lcd.print(text);
}

void lcdPrint2Rows(String row0, String row1) {
  lcdPrintRow(0, row0);
  lcdPrintRow(1, row1);
}

void lcdUpdateTemp() {
  String line =
      "T:" + String(temperature, 1) + "C H:" + String(humidity, 0) + "%";
  lcdPrintRow(1, line);
}

bool readIn(int idx) {
  if (idx < 0 || idx > 3)
    return false;
  // Các chân IN1..IN4 kết nối với công tắc hành trình ngăn tủ.
  // Khi ngăn ĐÓNG: công tắc đóng xuống GND -> đọc được mức THẤP (LOW / 0).
  // Khi ngăn MỞ: công tắc nhả ra -> được kéo lên mức CAO (HIGH / 1) bằng trở kéo.
  // Trả về true nếu ngăn đang MỞ (HIGH), và false nếu ngăn đang ĐÓNG (LOW).
  return digitalRead(IN_PINS[idx]) == HIGH;
}

void setOu(int idx, bool on) {
  if (idx < 0 || idx > 3 || ouManualAllOn)
    return;
  digitalWrite(OU_PINS[idx], on ? HIGH : LOW);
}

void setRe(int idx, bool on) {
  if (idx < 0 || idx > 3)
    return;
  digitalWrite(RE_PINS[idx], on ? HIGH : LOW);
  drawers[idx].reOn = on;
}

void setAllOu(bool on) {
  for (int i = 0; i < 4; i++) {
    digitalWrite(OU_PINS[i], on ? HIGH : LOW);
  }
}

void setAllRe(bool on) {
  for (int i = 0; i < 4; i++) {
    digitalWrite(RE_PINS[i], on ? HIGH : LOW);
    drawers[i].reOn = on;
  }
}

void resetCabinetToIdle() {
  ouManualAllOn = false;
  for (int i = 0; i < 4; i++) {
    drawers[i].sessionActive = false;
    drawers[i].buttonPressed = false;
    drawers[i].missedReported = false;
    drawers[i].notDetectReported = false;
    drawers[i].reOn = false;
    drawers[i].ouStartMs = 0;
    drawers[i].buttonCompleteMs = 0;
    drawers[i].waitingAiSinceMs = 0;
    btnPhases[i] = readIn(i) ? BTN_ACTIVE : BTN_NORMAL;
  }
  setAllOu(false);
  setAllRe(false);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println("[RESET_OU] Ve trang thai ban dau");
}

void toggleOuReset() {
  if (!ouManualAllOn) {
    ouManualAllOn = true;
    setAllOu(true);
    lcdPrint2Rows("MO TAT CA NGAN ", "Bam lai de tat ");
    Serial.println("[RESET_OU] Bat tat ca OU");
  } else {
    resetCabinetToIdle();
    lcdPrint2Rows("IP:" + WiFi.localIP().toString(), "  San sang     ");
    Serial.println("[RESET_OU] Tat tat ca OU — idle");
  }
}

void reportEventToFlask(int idx, const char *eventStatus) {
  if (flaskCallbackUrl.length() == 0) {
    Serial.printf("[DRAWER %d] Khong co callback URL — bo qua bao %s\n",
                  idx + 1, eventStatus);
    return;
  }
  HTTPClient http;
  String url = flaskCallbackUrl;
  if (!url.endsWith("/"))
    url += "/";
  url += "api/drawer/missed";

  String payload = "{\"drawer\":" + String(idx) + ",\"cabinet_ip\":\"" +
                   WiFi.localIP().toString() + "\",\"status\":\"" +
                   eventStatus + "\"}";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  Serial.printf("[DRAWER %d] POST %s -> %d\n", idx + 1, eventStatus, code);
  http.end();
}

void startDrawerSession(int idx) {
  if (idx < 0 || idx > 3)
    return;
  drawers[idx].sessionActive = true;
  drawers[idx].buttonPressed = false;
  drawers[idx].missedReported = false;
  drawers[idx].notDetectReported = false;
  drawers[idx].reOn = false;
  drawers[idx].ouStartMs = millis();
  drawers[idx].buttonCompleteMs = 0;
  drawers[idx].waitingAiSinceMs = 0;
  btnPhases[idx] = readIn(idx) ? BTN_ACTIVE : BTN_NORMAL;

  digitalWrite(OU_PINS[idx], HIGH);
  setRe(idx, false);

  digitalWrite(BUZZER_PIN, HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.printf("[DRAWER %d] Bat dau phien — OU%d ON (30 phut)\n", idx + 1,
                idx + 1);
  lcdPrint2Rows("Ngan " + String(idx + 1) + ": MO KHOA",
                "Hay mo ngan...  ");
}

void endDrawerSession(int idx) {
  if (idx < 0 || idx > 3)
    return;
  if (ouManualAllOn) {
    resetCabinetToIdle();
    return;
  }
  drawers[idx].sessionActive = false;
  drawers[idx].buttonPressed = false;
  drawers[idx].missedReported = false;
  drawers[idx].notDetectReported = false;
  drawers[idx].waitingAiSinceMs = 0;
  digitalWrite(OU_PINS[idx], LOW);
  setRe(idx, false);
  Serial.printf("[DRAWER %d] Ket thuc phien\n", idx + 1);
}

void pollButton(int idx) {
  if (idx < 0 || idx > 3)
    return;
  if (!drawers[idx].sessionActive || drawers[idx].buttonPressed)
    return;

  bool open = readIn(idx);

  if (btnPhases[idx] == BTN_NORMAL && open) {
    btnPhases[idx] = BTN_ACTIVE;
    Serial.printf("[DRAWER] IN%d: LOW -> HIGH (Drawer Opened)\n", idx + 1);
    lcdPrint2Rows("Ngan " + String(idx + 1) + ": DA MO   ", "Hay lay thuoc!  ");
  } else if (btnPhases[idx] == BTN_ACTIVE && !open) {
    drawers[idx].buttonPressed = true;
    drawers[idx].buttonCompleteMs = millis();
    btnPhases[idx] = BTN_NORMAL;
    Serial.printf("[DRAWER] IN%d: HIGH -> LOW (Drawer Closed) — Hoan thanh chu ky mo-dong!\n",
                  idx + 1);
    lcdPrint2Rows("Da dong ngan " + String(idx + 1), "Cho 5 giay...  ");
  }
}

void processDrawers() {
  if (ouManualAllOn)
    return;

  for (int i = 0; i < 4; i++) {
    if (!drawers[i].sessionActive)
      continue;

    pollButton(i);

    unsigned long elapsed = millis() - drawers[i].ouStartMs;

    // Co nut: sau 30s tat OUi, bat REi, bat dau dem 10p cho AI
    if (drawers[i].buttonPressed && !drawers[i].reOn) {
      if (millis() - drawers[i].buttonCompleteMs >= AFTER_BTN_MS) {
        digitalWrite(OU_PINS[i], LOW);
        setRe(i, true);
        drawers[i].waitingAiSinceMs = millis();
        Serial.printf(
            "[DRAWER %d] 30s sau nut — OU%d OFF, RE%d ON, cho AI 10p\n", i + 1,
            i + 1, i + 1);
        lcdPrint2Rows("Cho xac nhan   ", "AI: toi da 10p  ");
      }
      continue;
    }

    // Da bam nut, RE bat — het 10p khong co AI -> not_detect
    if (drawers[i].buttonPressed && drawers[i].reOn &&
        !drawers[i].notDetectReported && drawers[i].waitingAiSinceMs > 0) {
      if (millis() - drawers[i].waitingAiSinceMs >= AI_WAIT_MS) {
        drawers[i].notDetectReported = true;
        digitalWrite(OU_PINS[i], LOW);
        setRe(i, true);
        reportEventToFlask(i, "not_detect");
        Serial.printf(
            "[DRAWER %d] Het 10p khong co AI — not_detect, chi RE%d ON\n",
            i + 1, i + 1);
        lcdPrint2Rows("!! KHONG XAC   ", "NHAN AI !!     ");
      }
      continue;
    }

    // Het 30 phut khong co nut -> missed (OU+RE)
    if (!drawers[i].buttonPressed && !drawers[i].missedReported &&
        elapsed >= OU_SESSION_MS) {
      drawers[i].missedReported = true;
      digitalWrite(OU_PINS[i], HIGH);
      setRe(i, true);
      reportEventToFlask(i, "missed");
      Serial.printf(
          "[DRAWER %d] Het 30p khong bam nut — missed, RE%d+OU%d ON\n", i + 1,
          i + 1, i + 1);
      lcdPrint2Rows("!! CHUA UONG !!", "Bao server...  ");
    }
  }
}

bool isAnySessionActive() {
  for (int i = 0; i < 4; i++) {
    if (drawers[i].sessionActive)
      return true;
  }
  return false;
}

// ============================================================
//  API HANDLERS
// ============================================================

String buildStatusJson() {
  String json = "{";
  json += "\"connected\":" + String(isCamConnected ? "true" : "false") + ",";
  json += "\"cam_ip\":\"" + camIP + "\",";
  json += "\"esp_ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"ssid\":\"" + WiFi.SSID() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"temperature\":" + String(temperature, 1) + ",";
  json += "\"humidity\":" + String((int)humidity) + ",";
  json += "\"drawer1\":{";
  json += "\"session_active\":" +
          String(drawers[0].sessionActive ? "true" : "false") + ",";
  json +=
      "\"ou1\":" + String(digitalRead(OU_PINS[0]) == HIGH ? "true" : "false") +
      ",";
  json += "\"re1\":" + String(drawers[0].reOn ? "true" : "false") + ",";
  json += "\"in1\":" + String(readIn(0) ? "true" : "false") + ",";
  json += "\"button_pressed\":" +
          String(drawers[0].buttonPressed ? "true" : "false") + ",";
  json += "\"missed\":" + String(drawers[0].missedReported ? "true" : "false") +
          ",";
  json += "\"not_detect\":" +
          String(drawers[0].notDetectReported ? "true" : "false") + ",";
  json += "\"ou_all_on\":" + String(ouManualAllOn ? "true" : "false");
  json += "},";
  for (int i = 1; i <= 3; i++) {
    json += "\"drawer" + String(i + 1) + "\":{";
    json += "\"session_active\":" +
            String(drawers[i].sessionActive ? "true" : "false") + ",";
    json += "\"ou" + String(i + 1) +
            "\":" + String(digitalRead(OU_PINS[i]) == HIGH ? "true" : "false") +
            ",";
    json += "\"re" + String(i + 1) +
            "\":" + String(drawers[i].reOn ? "true" : "false") + ",";
    json += "\"in" + String(i + 1) +
            "\":" + String(readIn(i) ? "true" : "false") + ",";
    json += "\"button_pressed\":" +
            String(drawers[i].buttonPressed ? "true" : "false") + ",";
    json +=
        "\"missed\":" + String(drawers[i].missedReported ? "true" : "false") +
        ",";
    json += "\"not_detect\":" +
            String(drawers[i].notDetectReported ? "true" : "false");
    json += "}";
    if (i < 3)
      json += ",";
  }
  json += "}";
  return json;
}

void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", buildStatusJson());
}

void handleRe() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String state = server.hasArg("state") ? server.arg("state") : "";
  state.toLowerCase();
  int drawer = server.hasArg("drawer") ? server.arg("drawer").toInt() : 0;
  if (drawer < 0 || drawer > 3)
    drawer = 0;

  if (state == "off") {
    digitalWrite(RE_PINS[drawer], LOW);
    drawers[drawer].reOn = false;
    endDrawerSession(drawer);
    lcdPrint2Rows("IP:" + WiFi.localIP().toString(), "  ESP32 IP  ");
    Serial.printf("[HTTP] RE%d TAT — ket thuc phien\n", drawer + 1);
  } else if (state == "on") {
    digitalWrite(RE_PINS[drawer], HIGH);
    drawers[drawer].reOn = true;
    Serial.printf("[HTTP] RE%d bat\n", drawer + 1);
  } else {
    server.send(400, "application/json",
                "{\"error\":\"state phai la on hoac off\"}");
    return;
  }

  String json = "{\"status\":\"ok\",\"drawer\":" + String(drawer) + ",\"re\":";
  json += (digitalRead(RE_PINS[drawer]) == HIGH ? "true" : "false");
  json += "}";
  server.send(200, "application/json", json);
}

void handleLed() {
  if (!server.hasArg("state") && server.hasArg("drawer")) {
    handleRe();
    return;
  }
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String state = server.hasArg("state") ? server.arg("state") : "";
  state.toLowerCase();
  if (state == "on") {
    setRe(0, true);
  } else if (state == "off") {
    digitalWrite(RE_PINS[0], LOW);
    drawers[0].reOn = false;
    endDrawerSession(0);
  } else {
    server.send(400, "application/json",
                "{\"error\":\"state phai la on hoac off\"}");
    return;
  }
  server.send(200, "application/json",
              "{\"status\":\"ok\",\"re\":" +
                  String(drawers[0].reOn ? "true" : "false") + "}");
}

void handleOpenDrawer() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int idx = server.hasArg("idx") ? server.arg("idx").toInt() : -1;

  if (server.hasArg("callback")) {
    flaskCallbackUrl = server.arg("callback");
    Serial.println("[HTTP] Flask callback: " + flaskCallbackUrl);
  }

  if (idx >= 0 && idx <= 3) {
    startDrawerSession(idx);
  } else {
    Serial.println("[HTTP] open_drawer idx=" + String(idx) + " — khong hop le");
  }

  String json = "{\"status\":\"ok\",\"drawer\":" + String(idx) + "}";
  server.send(200, "application/json", json);
}

void handleToggle() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  bool cur = digitalRead(RE_PINS[0]) == HIGH;
  setRe(0, !cur);
  server.send(200, "application/json",
              "{\"status\":\"ok\",\"re\":" +
                  String(drawers[0].reOn ? "true" : "false") + "}");
}

void handleResetOu() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  toggleOuReset();
  String json = "{\"status\":\"ok\",\"ou_all_on\":";
  json += (ouManualAllOn ? "true" : "false");
  json += "}";
  server.send(200, "application/json", json);
}

void handleNotFound() {
  server.send(404, "application/json", "{\"error\":\"Not found\"}");
}

void setTemperature(float temp, float hum) {
  temperature = temp;
  humidity = hum;
  tempStr = String(temp, 1) + "C";
  if (!isAnySessionActive() && !ouManualAllOn) {
    lcdUpdateTemp();
    if (temp > 37.5 || hum > 80) {
      Serial.println("[CANH BAO] Nhiet do hoac do am qua cao!");
      lcdPrint2Rows("!! CANH BAO !!  ",
                    "T:" + String(temp, 1) + "C H:" + String(hum, 0) + "%");
      delay(2000);
      lcdUpdateTemp();
    }
  }
}

void resetCamera() {
  Serial.println("[ESP32] Reset ESP32-CAM...");
  lcdPrint2Rows("Resetting CAM..", "Hay doi...     ");
  digitalWrite(RESET_CAM_PIN, LOW);
  delay(1000);
  digitalWrite(RESET_CAM_PIN, HIGH);
  delay(2000);
}

void setupGpio() {
  for (int i = 0; i < 4; i++) {
    pinMode(IN_PINS[i], INPUT);
    pinMode(OU_PINS[i], OUTPUT);
    pinMode(RE_PINS[i], OUTPUT);
    digitalWrite(OU_PINS[i], LOW);
    digitalWrite(RE_PINS[i], LOW);
  }
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(RESET_CAM_PIN, OUTPUT);
  digitalWrite(RESET_CAM_PIN, HIGH);
}

// ============================================================
//  SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  dht.begin();

  camSerial.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  delay(500);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcdPrint2Rows("  ESP32  Boot   ", " Dang cai dat! ");
  delay(1000);

  Serial.println("\n\n--- KHOI DONG HE THONG (ESP32) ---");
  setupGpio();

  // ----- WiFiManager -----
  WiFiManager wm;
  lcdPrint2Rows(" Dang ket noi ! ", "SSID:Setup_Cam  ");
  wm.setConfigPortalTimeout(180);
  wm.setAPCallback([](WiFiManager *wm) {
    lcdPrint2Rows(" Che do Config ", "AP:Setup_Camera ");
  });

  bool res = wm.autoConnect("Setup_Camera", "12345678");
  if (!res) {
    lcdPrint2Rows("Ket noi that bai", "Khoi dong lai..");
    delay(3000);
    ESP.restart();
  }

  String ipStr = WiFi.localIP().toString();
  Serial.println("[OK] ESP32 IP: " + ipStr);
  lcdPrint2Rows("IP:" + ipStr, "Temp: " + tempStr);

  // ----- Reset & cho CAM -----
  resetCamera();
  lcdPrint2Rows("IP:" + ipStr, "Dang cho CAM...");
  while (camSerial.available()) {
    camSerial.read();
  }

  // ----- WebServer Routes -----
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/re", HTTP_GET, handleRe);
  server.on("/led", HTTP_GET, handleLed);
  server.on("/open_drawer", HTTP_GET, handleOpenDrawer);
  server.on("/toggle", HTTP_GET, handleToggle);
  server.on("/reset_ou", HTTP_GET, handleResetOu);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("[OK] WebServer started");

  lastWiFiTime = millis();
}

// ============================================================
//  LOOP
// ============================================================

void loop() {
  server.handleClient();
  processDrawers();

  // Doc nhiet do / do am moi 5 giay
  static unsigned long lastTempTime = 0;
  if (millis() - lastTempTime > 3000) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    // In thẳng ra Serial Monitor để kiểm tra thông số gốc
    Serial.print("[TEST DHT] T: ");
    Serial.print(t);
    Serial.print(" - H: ");
    Serial.println(h);

    if (isnan(t) || isnan(h)) {
      // Nếu không đọc được, bắt buộc LCD phải hiện cảnh báo
      if (!isAnySessionActive() && !ouManualAllOn) {
        lcdPrintRow(1, "Loi DHT: NaN    ");
      }
    } else {
      // Nếu đọc được bình thường, hiển thị nhiệt độ
      setTemperature(t, h);
    }
    lastTempTime = millis();
  }

  // Kiem tra WiFi — restart neu mat ket noi qua 15 giay
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWiFiTime > 15000) {
      lcdPrint2Rows("! Mat WIFI !   ", "Khoi dong lai...");
      delay(1000);
      ESP.restart();
    }
    lcdPrintRow(0, "! Mat WIFI...  ");
  } else {
    lastWiFiTime = millis();
  }

  // Gui SSID/pass cho CAM qua UART cho den khi CAM ket noi
  if (!isCamConnected && WiFi.status() == WL_CONNECTED) {
    if (millis() - lastSendTime > 4000) {
      String payload = "WIFI:" + WiFi.SSID() + "," + WiFi.psk();
      camSerial.println(payload);
      lastSendTime = millis();
    }
  }

  // Doc phan hoi tu CAM qua UART
  while (camSerial.available()) {
    String data = camSerial.readStringUntil('\n');
    data.trim();
    if (data.length() > 0)
      Serial.println("[CAM]: " + data);

    if (data.startsWith("IP:")) {
      camIP = data.substring(3);
      camIP.trim();
      isCamConnected = true;
      Serial.println("[THANH CONG] IP Camera: " + camIP);
      if (!isAnySessionActive() && !ouManualAllOn) {
        lcdPrint2Rows(camIP, "IP Cua ESP32-CAM");
        delay(3000);
        lcdPrint2Rows(WiFi.localIP().toString(), "  ESP32 IP  ");
      }
    }
  }
}
