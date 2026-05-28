
#include <WiFi.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

#define RX2_PIN       16
#define TX2_PIN       17
#define RESET_CAM_PIN 13
#define DHTPIN        32
#define DHTTYPE DHT11

// GPIO — dau vao (co tro keo len ngoai)
const int IN_PINS[4]  = {36, 39, 34, 35};  // VP, VN, 34, 35 -> IN1..IN4
// GPIO — dau ra mo ngan
const int OU_PINS[4]  = {23, 19, 18, 4};   // OU1..OU4
// GPIO — den nhac (reminder)
const int RE_PINS[4]  = {25, 26, 27, 14};  // RE1..RE4
const int BUZZER_PIN  = 33;

#define OU_SESSION_MS    (30UL * 60UL * 1000UL)  // 30 phut — khong bam nut
#define AFTER_BTN_MS     (30UL * 1000UL)         // 30 giay sau nut -> tat OU, bat RE
#define AI_WAIT_MS       (10UL * 60UL * 1000UL)  // 10 phut cho AI sau khi bam nut

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

// ===== Trang thai ngan 1 (IN1, OU1, RE1) =====
struct Drawer1State {
  bool sessionActive;
  bool buttonPressed;
  bool missedReported;      // het 30p khong bam nut (OU+RE)
  bool notDetectReported;   // da bam nut nhung het 10p khong co AI (chi RE)
  bool reOn;
  unsigned long ouStartMs;
  unsigned long buttonCompleteMs;
  unsigned long waitingAiSinceMs;
} drawer1 = {false, false, false, false, false, 0, 0, 0};

// Nut IN1: xung day du HIGH -> LOW -> HIGH (tro keo len ngoai)
enum BtnPhase { BTN_HIGH, BTN_LOW };
BtnPhase in1Phase = BTN_HIGH;

// Reset OU thu cong: bat tat ca OU -> bam lai tat het va ve trang thai ban dau
bool ouManualAllOn = false;

// ============================================================
//  HAM TIEN ICH
// ============================================================

void lcdPrintRow(int row, String text) {
  while (text.length() < 16) text += " ";
  if (text.length() > 16) text = text.substring(0, 16);
  lcd.setCursor(0, row);
  lcd.print(text);
}

void lcdPrint2Rows(String row0, String row1) {
  lcdPrintRow(0, row0);
  lcdPrintRow(1, row1);
}

void lcdUpdateTemp() {
  String line = "T:" + String(temperature, 1) + "C H:" + String(humidity, 0) + "%";
  lcdPrintRow(1, line);
}

bool readIn1() {
  return digitalRead(IN_PINS[0]) == HIGH;
}

void setOu1(bool on) {
  if (ouManualAllOn) return;
  digitalWrite(OU_PINS[0], on ? HIGH : LOW);
}

void setAllOu(bool on) {
  for (int i = 0; i < 4; i++) {
    digitalWrite(OU_PINS[i], on ? HIGH : LOW);
  }
}

void setAllRe(bool on) {
  for (int i = 0; i < 4; i++) {
    digitalWrite(RE_PINS[i], on ? HIGH : LOW);
  }
  drawer1.reOn = on && (digitalRead(RE_PINS[0]) == HIGH);
}

void resetCabinetToIdle() {
  ouManualAllOn = false;
  drawer1.sessionActive = false;
  drawer1.buttonPressed = false;
  drawer1.missedReported = false;
  drawer1.notDetectReported = false;
  drawer1.reOn = false;
  drawer1.ouStartMs = 0;
  drawer1.buttonCompleteMs = 0;
  drawer1.waitingAiSinceMs = 0;
  in1Phase = readIn1() ? BTN_HIGH : BTN_LOW;
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

void setRe1(bool on) {
  digitalWrite(RE_PINS[0], on ? HIGH : LOW);
  drawer1.reOn = on;
}

void reportEventToFlask(const char* eventStatus) {
  if (flaskCallbackUrl.length() == 0) {
    Serial.printf("[DRAWER1] Khong co callback URL — bo qua bao %s\n", eventStatus);
    return;
  }
  HTTPClient http;
  String url = flaskCallbackUrl;
  if (!url.endsWith("/")) url += "/";
  url += "api/drawer/missed";

  String payload = "{\"drawer\":0,\"cabinet_ip\":\"" + WiFi.localIP().toString()
    + "\",\"status\":\"" + eventStatus + "\"}";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  Serial.printf("[DRAWER1] POST %s -> %d\n", eventStatus, code);
  http.end();
}

void startDrawer1Session() {
  drawer1.sessionActive = true;
  drawer1.buttonPressed = false;
  drawer1.missedReported = false;
  drawer1.notDetectReported = false;
  drawer1.reOn = false;
  drawer1.ouStartMs = millis();
  drawer1.buttonCompleteMs = 0;
  drawer1.waitingAiSinceMs = 0;
  in1Phase = readIn1() ? BTN_HIGH : BTN_LOW;

  setOu1(true);
  setRe1(false);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("[DRAWER1] Bat dau phien — OU1 ON (30 phut)");
  lcdPrint2Rows("Ngan 1: MO     ", "Cho nut IN1... ");
}

void endDrawer1Session() {
  if (ouManualAllOn) {
    resetCabinetToIdle();
    return;
  }
  drawer1.sessionActive = false;
  drawer1.buttonPressed = false;
  drawer1.missedReported = false;
  drawer1.notDetectReported = false;
  drawer1.waitingAiSinceMs = 0;
  digitalWrite(OU_PINS[0], LOW);
  setRe1(false);
  Serial.println("[DRAWER1] Ket thuc phien");
}

// Doc xung day du tren IN1; chi xac nhan khi HIGH->LOW->HIGH
void pollIn1Button() {
  if (!drawer1.sessionActive || drawer1.buttonPressed) return;

  bool level = readIn1();

  if (in1Phase == BTN_HIGH && !level) {
    in1Phase = BTN_LOW;
  } else if (in1Phase == BTN_LOW && level) {
    drawer1.buttonPressed = true;
    drawer1.buttonCompleteMs = millis();
    in1Phase = BTN_HIGH;
    Serial.println("[DRAWER1] IN1: xung day du — cho 30s tat OU1, bat RE1");
    lcdPrint2Rows("Da bam nut!    ", "Cho 30 giay... ");
  }
}

void processDrawer1() {
  if (ouManualAllOn || !drawer1.sessionActive) return;

  pollIn1Button();

  unsigned long elapsed = millis() - drawer1.ouStartMs;

  // Co nut: sau 30s tat OU1, bat RE1, bat dau dem 10p cho AI
  if (drawer1.buttonPressed && !drawer1.reOn) {
    if (millis() - drawer1.buttonCompleteMs >= AFTER_BTN_MS) {
      setOu1(false);
      setRe1(true);
      drawer1.waitingAiSinceMs = millis();
      Serial.println("[DRAWER1] 30s sau nut — OU1 OFF, RE1 ON, cho AI 10p");
      lcdPrint2Rows("Cho xac nhan   ", "AI: toi da 10p  ");
    }
    return;
  }

  // Da bam nut, RE bat — het 10p khong co AI -> not_detect (chi RE, khong bat OU)
  if (drawer1.buttonPressed && drawer1.reOn && !drawer1.notDetectReported
      && drawer1.waitingAiSinceMs > 0) {
    if (millis() - drawer1.waitingAiSinceMs >= AI_WAIT_MS) {
      drawer1.notDetectReported = true;
      setOu1(false);
      setRe1(true);
      reportEventToFlask("not_detect");
      Serial.println("[DRAWER1] Het 10p khong co AI — not_detect, chi RE1 ON");
      lcdPrint2Rows("!! KHONG XAC   ", "NHAN AI !!     ");
    }
    return;
  }

  // Het 30 phut khong co nut -> missed (OU+RE)
  if (!drawer1.buttonPressed && !drawer1.missedReported && elapsed >= OU_SESSION_MS) {
    drawer1.missedReported = true;
    setOu1(true);
    setRe1(true);
    reportEventToFlask("missed");
    Serial.println("[DRAWER1] Het 30p khong bam nut — missed, RE1+OU1 ON");
    lcdPrint2Rows("!! CHUA UONG !!", "Bao server...  ");
  }
}

void resetCamera() {
  Serial.println("[ESP32] Reset ESP32-CAM...");
  lcdPrint2Rows("Resetting CAM...", "Hay doi...");
  digitalWrite(RESET_CAM_PIN, LOW);
  delay(1000);
  digitalWrite(RESET_CAM_PIN, HIGH);
  delay(2000);
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
  json += "\"session_active\":" + String(drawer1.sessionActive ? "true" : "false") + ",";
  json += "\"ou1\":" + String(digitalRead(OU_PINS[0]) == HIGH ? "true" : "false") + ",";
  json += "\"re1\":" + String(drawer1.reOn ? "true" : "false") + ",";
  json += "\"in1\":" + String(readIn1() ? "true" : "false") + ",";
  json += "\"button_pressed\":" + String(drawer1.buttonPressed ? "true" : "false") + ",";
  json += "\"missed\":" + String(drawer1.missedReported ? "true" : "false") + ",";
  json += "\"not_detect\":" + String(drawer1.notDetectReported ? "true" : "false") + ",";
  json += "\"ou_all_on\":" + String(ouManualAllOn ? "true" : "false");
  json += "}}";
  return json;
}

void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", buildStatusJson());
}

// GET /re?state=on|off&drawer=0
void handleRe() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String state = server.hasArg("state") ? server.arg("state") : "";
  state.toLowerCase();
  int drawer = server.hasArg("drawer") ? server.arg("drawer").toInt() : 0;
  if (drawer < 0 || drawer > 3) drawer = 0;

  if (state == "off") {
    digitalWrite(RE_PINS[drawer], LOW);
    if (drawer == 0) {
      drawer1.reOn = false;
      endDrawer1Session();
      lcdPrint2Rows("IP:" + WiFi.localIP().toString(), "  ESP32 IP  ");
      Serial.println("[HTTP] RE1 TAT — ket thuc phien (xac nhan uong thuoc)");
    }
  } else if (state == "on") {
    digitalWrite(RE_PINS[drawer], HIGH);
    if (drawer == 0) drawer1.reOn = true;
    Serial.println("[HTTP] RE bat — drawer " + String(drawer));
  } else {
    server.send(400, "application/json", "{\"error\":\"state phai la on hoac off\"}");
    return;
  }

  String json = "{\"status\":\"ok\",\"drawer\":" + String(drawer) + ",\"re\":";
  json += (digitalRead(RE_PINS[drawer]) == HIGH ? "true" : "false") + "}";
  server.send(200, "application/json", json);
}

// Tuong thich code cu: /led -> RE1
void handleLed() {
  if (!server.hasArg("state") && server.hasArg("drawer")) {
    handleRe();
    return;
  }
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String state = server.hasArg("state") ? server.arg("state") : "";
  state.toLowerCase();
  if (state == "on") {
    setRe1(true);
  } else if (state == "off") {
    digitalWrite(RE_PINS[0], LOW);
    drawer1.reOn = false;
    endDrawer1Session();
  } else {
    server.send(400, "application/json", "{\"error\":\"state phai la on hoac off\"}");
    return;
  }
  server.send(200, "application/json",
    "{\"status\":\"ok\",\"re\":" + String(drawer1.reOn ? "true" : "false") + "}");
}

void handleOpenDrawer() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int idx = server.hasArg("idx") ? server.arg("idx").toInt() : -1;

  if (server.hasArg("callback")) {
    flaskCallbackUrl = server.arg("callback");
    Serial.println("[HTTP] Flask callback: " + flaskCallbackUrl);
  }

  if (idx == 0) {
    startDrawer1Session();
  } else {
    Serial.println("[HTTP] open_drawer idx=" + String(idx) + " — chua ho tro");
  }

  String json = "{\"status\":\"ok\",\"drawer\":" + String(idx) + "}";
  server.send(200, "application/json", json);
}

void handleToggle() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  bool cur = digitalRead(RE_PINS[0]) == HIGH;
  setRe1(!cur);
  server.send(200, "application/json",
    "{\"status\":\"ok\",\"re\":" + String(drawer1.reOn ? "true" : "false") + "}");
}

void handleResetCam() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  isCamConnected = false;
  camIP = "";
  resetCamera();
  lcdPrint2Rows("IP:" + WiFi.localIP().toString(), "Waiting CAM...");
  server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Camera reset\"}");
}

// GET /reset_ou — bat tat ca OU; bam lai -> tat OU + ve idle
void handleResetOu() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  toggleOuReset();
  String json = "{\"status\":\"ok\",\"ou_all_on\":";
  json += (ouManualAllOn ? "true" : "false") + "}";
  server.send(200, "application/json", json);
}

void handleNotFound() {
  server.send(404, "application/json", "{\"error\":\"Not found\"}");
}

void setTemperature(float temp, float hum) {
  temperature = temp;
  humidity = hum;
  tempStr = String(temp, 1) + "C";
  lcdUpdateTemp();
  if (temp > 37.5 || hum > 80) {
    Serial.println("[CANH BAO] Nhiet do hoac do am qua cao!");
    lcdPrint2Rows("!! CANH BAO !!  ", "T:" + String(temp, 1) + "C H:" + String(hum, 0) + "%");
    delay(2000);
    lcdUpdateTemp();
  }
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

void setup() {
  WiFiManager wm;
  dht.begin();
  Serial.begin(115200);

  camSerial.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  delay(500);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcdPrint2Rows("  ESP32  Boot   ", " Dang cai dat! ");
  delay(1000);

  Serial.println("\n\n--- KHOI DONG HE THONG (ESP32) ---");
  setupGpio();

  lcdPrint2Rows(" Dang ket noi ! ", "SSID:Setup_Cam  ");
  wm.setConfigPortalTimeout(180);
  wm.setAPCallback([](WiFiManager* wm) {
    lcdPrint2Rows(" Che do Config ", "AP:Setup_Camera ");
  });

  bool res = wm.autoConnect("Setup_Camera", "12345678");
  if (!res) {
    lcdPrint2Rows("! Ket noi that bai!", "Khoi dong lai..");
    delay(3000);
    ESP.restart();
  }

  String ipStr = WiFi.localIP().toString();
  Serial.println("[OK] ESP32 IP: " + ipStr);
  lcdPrint2Rows("IP:" + ipStr, "Temp: " + tempStr);

  server.on("/status",      HTTP_GET, handleStatus);
  server.on("/re",          HTTP_GET, handleRe);
  server.on("/led",         HTTP_GET, handleLed);
  server.on("/open_drawer", HTTP_GET, handleOpenDrawer);
  server.on("/toggle",      HTTP_GET, handleToggle);
  server.on("/reset_cam",   HTTP_GET, handleResetCam);
  server.on("/reset_ou",    HTTP_GET, handleResetOu);
  server.onNotFound(handleNotFound);
  server.begin();

  resetCamera();
  lcdPrint2Rows("IP:" + WiFi.localIP().toString(), "Dang cho CAM...");
  while (camSerial.available()) { camSerial.read(); }
  lastWiFiTime = millis();
}

void loop() {
  server.handleClient();
  processDrawer1();

  static unsigned long lastTempTime = 0;
  if (millis() - lastTempTime > 5000) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) setTemperature(t, h);
    lastTempTime = millis();
  }

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

  if (!isCamConnected && WiFi.status() == WL_CONNECTED) {
    if (millis() - lastSendTime > 4000) {
      String payload = "WIFI:" + WiFi.SSID() + "," + WiFi.psk();
      camSerial.println(payload);
      lastSendTime = millis();
    }
  }

  while (camSerial.available()) {
    String data = camSerial.readStringUntil('\n');
    data.trim();
    if (data.length() > 0) Serial.println("[CAM]: " + data);

    if (data.startsWith("IP:")) {
      camIP = data.substring(3);
      isCamConnected = true;
      Serial.println("[THANH CONG] IP Camera: " + camIP);
      lcdPrint2Rows(camIP, "IP Cua ESP32-CAM");
      delay(3000);
      lcdPrint2Rows(WiFi.localIP().toString(), "  ESP32 IP  ");
    }
  }
}
