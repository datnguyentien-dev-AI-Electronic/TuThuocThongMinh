# 💊 HỆ THỐNG TỦ THUỐC THÔNG MINH — SMARTMED CABINET PRO 🚀

> Hệ thống quản lý tủ thuốc thông minh hỗ trợ nhắc lịch uống thuốc tự động, điều khiển mở ngăn thuốc, nhấp nháy đèn LED nhắc nhở và tự động theo dõi, ghi nhận hành vi uống thuốc bằng trí tuệ nhân tạo (OpenCV + MediaPipe).

Dự án là sự kết hợp hoàn chỉnh giữa **Web Server Flask** (Cơ sở dữ liệu SQLite cục bộ), mô hình **AI Nhận diện hành vi uống thuốc** trên máy chủ và **Phần cứng vi điều khiển ESP32 + ESP32-CAM** giao tiếp thời gian thực qua mạng LAN.

---

## 🌟 CÁC TÍNH NĂNG NỔI BẬT

- **Quản lý đa tủ thuốc (Multi-Cabinet):** Quản lý đồng thời nhiều tủ thuốc thông qua tên và địa chỉ IP tĩnh/động trong mạng LAN.
- **Phân chia 4 ngăn thông minh (4-Drawer Session Management):** Hỗ trợ đầy đủ 4 ngăn thuốc tương ứng với lịch uống (Sáng, Trưa, Chiều, Tối). Mỗi ngăn hoạt động độc lập và song song.
- **Bảo vệ màn hình LCD diện rộng:** Tự động khóa luồng hiển thị cảm biến nhiệt độ/độ ẩm DHT11 khi có ngăn tủ đang hoạt động, ngăn chặn tình trạng ghi đè chữ hoặc nhấp nháy màn hình.
- **Cảm biến hành trình ngăn tủ thông minh (Drawer Limit Switch State Machine):** Áp dụng cơ chế theo dõi chu kỳ mở-đóng ngăn tủ trọn vẹn: Khi ngăn đóng (Switch đóng xuống GND -> đọc được mức thấp `0`), khi mở ra công tắc nhả ra và được kéo lên mức cao (`1`). ESP32 tự động nhận biết hành vi mở và đóng lại để kích hoạt quy trình chờ AI xác thực uống thuốc.
- **Trình nhận diện hành vi bằng AI (Camera Real-time Stream):** Tích hợp luồng camera từ ESP32-CAM truyền trực tiếp về Web Server Flask, xử lý thời gian thực qua MediaPipe để phát hiện chính xác 2 bước uống thuốc (Đưa thuốc lên miệng và đưa cốc nước lên uống) rồi tự động tắt đèn nhắc nhở và lưu lịch sử.
- **Hệ thống cảnh báo cảm biến:** Hiển thị cảnh báo trực quan trên màn hình LCD khi nhiệt độ > 37.5°C hoặc độ ẩm > 80% để bảo quản thuốc tốt nhất.

---

## 🔌 CẤU HÌNH PHẦN CỨNG & SƠ ĐỒ CHÂN (WIRING DIAGRAM)

Thiết bị sử dụng vi điều khiển chính **ESP32 DevKit V1** kết hợp với **ESP32-CAM**. Các chân GPIO đầu vào/đầu ra được cấu hình cụ thể như sau:

### 1. Sơ đồ kết nối ESP32 chính

| Tên chân (Logic) | Chân GPIO (ESP32) | Loại Chân | Chức năng | Trạng thái vật lý |
| :--- | :---: | :---: | :--- | :--- |
| **IN1** | `36` (VP) | Input | Cảm biến hành trình Ngăn 1 | Mặc định khi đóng ngăn = `LOW` (0), khi mở ngăn = `HIGH` (1) |
| **IN2** | `39` (VN) | Input | Cảm biến hành trình Ngăn 2 | Mặc định khi đóng ngăn = `LOW` (0), khi mở ngăn = `HIGH` (1) |
| **IN3** | `34` | Input | Cảm biến hành trình Ngăn 3 | Mặc định khi đóng ngăn = `LOW` (0), khi mở ngăn = `HIGH` (1) |
| **IN4** | `35` | Input | Cảm biến hành trình Ngăn 4 | Mặc định khi đóng ngăn = `LOW` (0), khi mở ngăn = `HIGH` (1) |
| **OU1** | `23` | Output | Kích mở khóa chốt Ngăn 1 | Mức cao (`HIGH`) = Mở ngăn, mức thấp (`LOW`) = Khóa |
| **OU2** | `19` | Output | Kích mở khóa chốt Ngăn 2 | Mức cao (`HIGH`) = Mở ngăn, mức thấp (`LOW`) = Khóa |
| **OU3** | `18` | Output | Kích mở khóa chốt Ngăn 3 | Mức cao (`HIGH`) = Mở ngăn, mức thấp (`LOW`) = Khóa |
| **OU4** | `4` | Output | Kích mở khóa chốt Ngăn 4 | Mức cao (`HIGH`) = Mở ngăn, mức thấp (`LOW`) = Khóa |
| **RE1** | `25` | Output | Đèn LED nhắc nhở Ngăn 1 | Mức cao (`HIGH`) = Sáng đèn nhấp nháy, `LOW` = Tắt |
| **RE2** | `26` | Output | Đèn LED nhắc nhở Ngăn 2 | Mức cao (`HIGH`) = Sáng đèn nhấp nháy, `LOW` = Tắt |
| **RE3** | `27` | Output | Đèn LED nhắc nhở Ngăn 3 | Mức cao (`HIGH`) = Sáng đèn nhấp nháy, `LOW` = Tắt |
| **RE4** | `14` | Output | Đèn LED nhắc nhở Ngăn 4 | Mức cao (`HIGH`) = Sáng đèn nhấp nháy, `LOW` = Tắt |
| **Buzzer** | `33` | Output | Còi báo động | Kêu bíp 150ms khi bắt đầu mở ngăn |
| **Reset CAM**| `13` | Output | Reset ESP32-CAM | Mức thấp (`LOW`) kích hoạt Reset camera |
| **DHT11** | `32` | Data Pin | Cảm biến nhiệt độ/độ ẩm | Đọc dữ liệu môi trường bảo quản thuốc |
| **SDA/SCL** | `21` / `22` | I2C Bus | Giao tiếp LCD 16x2 | Hiển thị trạng thái hoạt động và IP |

---

## 🛠️ CẤU TRÚC THƯ MỤC DỰ ÁN

```text
.
├── app.py                         # Web Server Flask, API Routes và Xử lý AI Stream
├── database.py                    # Khai báo các mô hình dữ liệu (SQLite + SQLAlchemy)
├── medicine_detector.py           # Bộ nhận diện cử chỉ uống thuốc (MediaPipe + OpenCV)
├── cabinets.json                  # Tệp lưu trữ tủ thuốc cũ (dùng để di trú dữ liệu)
├── requirements.txt               # Danh sách thư viện Python cần thiết
├── templates/                     # Các trang giao diện HTML (index, cabinets, observe,...)
├── static/                        
│   ├── css/                       # Tệp định dạng giao diện CSS (vibrant glassmorphism)
│   └── js/app.js                  # Logic điều khiển, đồng bộ đồng hồ, gọi APIs
├── esp32_wifi_sender/             
│   └── esp32_wifi_sender.ino      # Firmware chính cho ESP32 điều khiển tủ và cảm biến
├── esp32cam_wifi_receiver/        
│   └── esp32cam_wifi_receiver.ino # Firmware phụ cho ESP32-CAM truyền luồng MJPEG
└── instance/                      
    └── pillbox.db                 # Cơ sở dữ liệu SQLite cục bộ (Tự động tạo)
```

---

## 🔌 CHI TIẾT CÁC HTTP APIs GIAO TIẾP (WEB ⇆ ESP32)

Các yêu cầu HTTP được truyền nhận trực tiếp thông qua địa chỉ IP của thiết bị trong mạng LAN:

### 1. APIs Web gọi đến ESP32
* **`GET /status`**: Lấy trạng thái thời gian thực của cảm biến DHT11 và 4 ngăn tủ.
  * *Response JSON Schema:*
    ```json
    {
      "connected": true,
      "cam_ip": "192.168.1.100",
      "esp_ip": "192.168.1.101",
      "ssid": "MyWiFi",
      "rssi": -65,
      "temperature": 28.5,
      "humidity": 65,
      "drawer1": {
        "session_active": false,
        "ou1": false,
        "re1": false,
        "in1": false,
        "button_pressed": false,
        "missed": false,
        "not_detect": false,
        "ou_all_on": false
      },
      "drawer2": { ... },
      "drawer3": { ... },
      "drawer4": { ... }
    }
    ```
* **`GET /open_drawer?idx=<0..3>&callback=<server_url>`**: Khởi động phiên uống thuốc tại ngăn thuốc chỉ định (Ngăn 1 đến 4).
* **`GET /re?drawer=<0..3>&state=<on|off>`**: Điều khiển bật/tắt thủ công đèn LED nhắc nhở.
* **`GET /toggle`**: Đảo trạng thái đèn LED nhắc nhở ngăn 1.
* **`GET /reset_ou`**: Mở chốt đồng thời cả 4 ngăn (dùng khi bảo trì/nạp thuốc) hoặc đóng lại toàn bộ và đưa tủ về trạng thái chờ.

### 2. APIs ESP32 báo cáo ngược về Flask
* **`POST /api/drawer/missed`**: Báo cáo sự kiện khi đến giờ hẹn:
  * **missed**: Quá 30 phút mà người dùng không mở ngăn tủ lấy thuốc (ESP32 sẽ bật cả còi, chốt khóa và đèn để gây chú ý).
  * **not_detect**: Người dùng đã mở/đóng tủ lấy thuốc nhưng quá 10 phút trôi qua mà camera AI không xác thực được hành động uống thuốc thành công.

---

## 🤖 QUY TRÌNH HOẠT ĐỘNG CỦA MÁY TRẠNG THÁI (STATE MACHINE)

- **Trạng thái rảnh (Idle):** Hệ thống hiển thị IP của ESP32 và cảm biến DHT11 lên LCD 16x2. Chờ lệnh từ Flask Server.
- **Bắt đầu phiên (Drawer Active):** Khi có lệnh hẹn giờ gửi từ Web, còi kêu 150ms, mở khóa `OU` tương ứng trong 30 phút.
- **Nếu quá 30 phút không nhấn nút (Missed):** Mạch tự động bật cả khóa chốt `OU` và đèn `RE` nhấp nháy liên tục để cảnh báo người dùng, đồng thời gọi Flask API báo cáo `missed`.
- **Nếu mở và đóng ngăn tủ lại (Chu kỳ LOW -> HIGH -> LOW):** Khi người dùng mở ngăn tủ (mức `HIGH`) rồi đóng lại (mức `LOW`), ESP32 sẽ ghi nhận chu kỳ hoàn tất. Sau 30 giây kể từ khi đóng tủ, khóa chốt `OU` sẽ đóng lại để bảo vệ, đồng thời đèn nhắc nhở `RE` bật sáng và bắt đầu đếm ngược 10 phút chờ camera AI quét cử chỉ uống thuốc.
- **Trí tuệ nhân tạo xác nhận thành công (Completed):** OpenCV + MediaPipe quét thấy cử chỉ uống thuốc thành công, Web gửi tín hiệu tắt đèn `RE`, kết thúc phiên hoạt động và lưu lịch sử.
- **Quá 10 phút không thấy cử chỉ (Not Detect):** Đèn `RE` giữ nguyên trạng thái sáng nhắc nhở, đồng thời gọi Flask API báo cáo `not_detect`.

---

## ⚙️ CÀI ĐẶT & VẬN HÀNH DỰ ÁN

### 1. Chuẩn bị Môi trường Python
Khuyến nghị sử dụng **Python 3.10** hoặc **3.11** để tương thích tốt nhất với thư viện OpenCV và MediaPipe.

Tạo môi trường ảo và cài đặt thư viện phụ thuộc:
```powershell
# Tạo môi trường ảo
python -m venv .venv

# Kích hoạt trên Windows PowerShell
.\.venv\Scripts\Activate.ps1

# Cài đặt thư viện
pip install -r requirements.txt
```

### 2. Cấu hình và nạp code cho ESP32
1. Mở tệp [esp32_wifi_sender.ino](file:///e:/PillBox/Source/esp32_wifi_sender/esp32_wifi_sender.ino) bằng Arduino IDE.
2. Cài đặt các thư viện cần thiết: `DHT sensor library`, `LiquidCrystal_I2C`, `WiFiManager`.
3. Biên dịch và nạp code vào mạch ESP32.
4. Khi chạy lần đầu, ESP32 sẽ phát một Wi-Fi Access Point tên là **`Setup_Camera`** (mật khẩu `12345678`). Bạn dùng điện thoại kết nối vào Wi-Fi này, trình duyệt sẽ tự động mở trang Portal cấu hình. Bạn chọn mạng Wi-Fi nhà mình, nhập mật khẩu và nhấn Save. ESP32 sẽ ghi nhớ cấu hình và tự động kết nối trong những lần sau.

### 3. Khởi động Web Server
Khởi chạy Server Flask trên máy tính:
```powershell
python app.py
```
Sau đó, truy cập trình duyệt tại địa chỉ mặc định: [http://localhost:5000](http://localhost:5000).

---

## ⚡ HƯỚNG DẪN XỬ LÝ LỖI NHANH (TROUBLESHOOTING)

- **Trạng thái hiển thị "Mất kết nối" (Offline) mặc dù ESP32 đang chạy:**
  * **Nguyên nhân:** Địa chỉ IP của tủ lưu trong Database bị lệch so với địa chỉ IP thực tế mà Router cấp cho ESP32 qua Wi-Fi.
  * **Giải pháp:** Xem địa chỉ IP hiển thị trên màn hình LCD của ESP32 (ví dụ: `192.168.1.13`). Sau đó, truy cập giao diện Web -> Trang **Quản lý tủ thuốc** -> Nhấn biểu tượng **Sửa (✏️)** -> Thay đổi IP thành đúng địa chỉ hiển thị trên LCD và nhấn **Lưu** -> Chọn sử dụng tủ thuốc này.
  * **Tối ưu hóa:** Hệ thống đã tăng giá trị `timeout` gọi HTTP kiểm tra trạng thái từ `1.0s` lên **`2.5s`** để đảm bảo Flask không báo mất kết nối ảo khi mạch ESP32 bận đọc cảm biến DHT11.

- **Lỗi IP Camera của ESP32-CAM bị hiển thị sai ký tự hoặc không kết nối được:**
  * **Nguyên nhân:** Tệp cấu hình cũ so khớp `data.startsWith("")` (luôn đúng đối với mọi log debug truyền qua Serial), dẫn đến việc camera gửi tin nhắn debug ngẫu nhiên nào cũng bị ngộ nhận là IP.
  * **Đã sửa đổi:** Cú pháp đã được sửa thành `data.startsWith("IP:")` và tích hợp bộ cắt khoảng trắng `.trim()` giúp lọc chính xác tuyệt đối địa chỉ IP camera truyền qua cổng Serial UART.

---
💡 *Dự án được xây dựng và tối ưu hóa bởi sinh viên Nguyễn Tiến Đạt. Mọi thắc mắc và đóng góp ý kiến vui lòng gửi yêu cầu hỗ trợ qua số điện thoại: 0974363010.*
