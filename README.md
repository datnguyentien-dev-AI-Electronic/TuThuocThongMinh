# Tủ Thuốc Thông Minh

Tủ Thuốc Thông Minh là hệ thống hỗ trợ quản lý lịch uống thuốc, điều khiển ngăn thuốc và theo dõi quá trình uống thuốc bằng camera. Dự án kết hợp web server Flask, cơ sở dữ liệu SQLite, ESP32/ESP8266, ESP32-CAM và mô hình nhận diện cử chỉ bằng OpenCV + MediaPipe.

## Chức Năng Chính

- Quản lý nhiều tủ thuốc theo tên và địa chỉ IP.
- Cấu hình lịch nhắc uống thuốc cho từng ngăn.
- Lưu thông tin thuốc: tên thuốc, liều dùng, số lượng, loại thuốc và ghi chú.
- Điều khiển ngăn thuốc, đèn hoặc tín hiệu nhắc thông qua API của ESP.
- Theo dõi camera ESP32-CAM theo thời gian thực.
- Nhận diện hành động uống thuốc theo 2 bước: đưa thuốc lên miệng và uống nước.
- Ghi lại lịch sử uống thuốc để theo dõi sau này.

## Công Nghệ Sử Dụng

- Backend: Flask, Flask-SQLAlchemy
- Database: SQLite
- Xử lý ảnh: OpenCV, MediaPipe, NumPy
- Giao diện: HTML, CSS, JavaScript
- Phần cứng: ESP32, ESP32-CAM

## Cấu Trúc Dự Án

```text
.
|-- app.py                         # Web server Flask và các API chính
|-- database.py                    # Khai báo database model bằng SQLAlchemy
|-- medicine_detector.py           # Xử lý nhận diện hành động uống thuốc
|-- cabinets.json                  # Dữ liệu tủ thuốc cũ, dùng để migrate nếu cần
|-- requirements.txt               # Danh sách thư viện Python cần cài
|-- templates/                     # Các trang HTML của Flask
|-- static/                        # CSS và JavaScript của giao diện web
|-- firebase_app/                  # Giao diện Firebase riêng
|-- esp32_wifi_sender/             # Mã Arduino cho ESP điều khiển tủ thuốc
|-- esp32cam_wifi_receiver/        # Mã Arduino cho ESP32-CAM/receiver
`-- instance/                      # Chứa database SQLite khi chạy app, không đưa lên Git
```

## Yêu Cầu Trước Khi Chạy

- Python 3.10 hoặc 3.11 được khuyến nghị.
- Máy tính chạy server và ESP/camera nên cùng một mạng LAN.
- Arduino IDE hoặc công cụ tương đương để nạp firmware cho ESP.
- Camera ESP32-CAM đã được cấu hình để cung cấp luồng video.

Lưu ý: MediaPipe có thể chưa hỗ trợ tốt một số phiên bản Python mới. Nếu cài đặt lỗi trên Python 3.12 hoặc 3.13, hãy dùng Python 3.10 hoặc 3.11.

## Cài Đặt

Tạo môi trường ảo:

```powershell
python -m venv .venv
```

Kích hoạt môi trường ảo trên Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Cài đặt các thư viện cần thiết:

```powershell
pip install -r requirements.txt
```

## Chạy Ứng Dụng

Chạy Flask server:

```powershell
python app.py
```

Sau khi chạy thành công, mở trình duyệt tại:

```text
http://localhost:5000
```

Server mặc định chạy ở địa chỉ `0.0.0.0:5000`, vì vậy các thiết bị trong cùng mạng LAN có thể truy cập bằng IP của máy tính chạy server.

## Các Trang Chính

- `/` - trang tổng quan.
- `/cabinets` - quản lý danh sách tủ thuốc.
- `/config` - cấu hình kết nối ESP.
- `/cabinet` - điều khiển tủ thuốc.
- `/observe` - theo dõi camera và nhận diện hành động uống thuốc.
- `/history` - xem lịch sử uống thuốc.

## Cách Hoạt Động Tổng Quát

1. Người dùng thêm tủ thuốc bằng tên và địa chỉ IP của ESP.
2. Người dùng cấu hình lịch uống thuốc cho từng ngăn.
3. Khi đến giờ, hệ thống gửi tín hiệu đến ESP để nhắc uống thuốc.
4. Camera ESP32-CAM truyền hình ảnh về server.
5. `medicine_detector.py` xử lý hình ảnh bằng MediaPipe để kiểm tra thao tác uống thuốc.
6. Khi phát hiện hoàn thành, hệ thống ghi log vào SQLite và cập nhật trạng thái.

## Database

Ứng dụng sử dụng SQLite thông qua Flask-SQLAlchemy. Khi chạy `python app.py`, database sẽ được tạo tự động trong thư mục `instance/`.

File `instance/pillbox.db` là dữ liệu runtime, không nên commit lên Git. Nếu `cabinets.json` tồn tại và database đang trống, ứng dụng sẽ tự động migrate dữ liệu tủ thuốc từ JSON sang SQLite.

## Firmware ESP

Mã nguồn cho phần cứng nằm trong:

- `esp32_wifi_sender/`
- `esp32cam_wifi_receiver/`

Trước khi nạp firmware, cần kiểm tra và cập nhật:

- Tên WiFi và mật khẩu WiFi.
- Địa chỉ IP hoặc endpoint của server Flask.
- Chân kết nối relay, LED, cảm biến hoặc module phần cứng.
- Luồng camera nếu dùng ESP32-CAM.

## Lưu Ý Bảo Mật

- Không commit file `.env`, token, mật khẩu WiFi hoặc khóa bí mật.
- Không commit database SQLite trong thư mục `instance/`.
- Nếu dùng Firebase, cần cấu hình Firebase Realtime Database Rules phù hợp. Firebase web `apiKey` thường là cấu hình client, nhưng quyền đọc/ghi dữ liệu phải được kiểm soát bằng rules.
- Khi triển khai thật, không nên chạy Flask ở chế độ `debug=True`.

## Xử Lý Lỗi Thường Gặp

Nếu không cài được MediaPipe:

```powershell
python --version
```

Kiểm tra phiên bản Python và chuyển sang Python 3.10 hoặc 3.11 nếu cần.

Nếu không truy cập được ESP:

- Kiểm tra máy tính và ESP có cùng mạng LAN không.
- Kiểm tra địa chỉ IP của ESP trong trang cấu hình.
- Thử truy cập API của ESP trực tiếp bằng trình duyệt.

Nếu camera không hiển thị:

- Kiểm tra URL stream của ESP32-CAM.
- Kiểm tra nguồn cấp cho ESP32-CAM.
- Kiểm tra server Flask có nhận được `cam_ip` từ ESP hay không.
