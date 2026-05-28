# Tu Thuoc Thong Minh

He thong tu thuoc thong minh ket hop Flask, SQLite, ESP32/ESP8266 va camera ESP32-CAM de quan ly lich uong thuoc, dieu khien ngan thuoc va nhan dien thao tac uong thuoc bang MediaPipe.

## Tinh nang chinh

- Quan ly nhieu tu thuoc theo ten va dia chi IP.
- Cau hinh lich nhac theo tung ngan thuoc.
- Luu thong tin thuoc, lieu dung, so luong va ghi chu.
- Dieu khien ngan/den nhac qua API cua ESP.
- Theo doi camera realtime tu ESP32-CAM.
- Nhan dien 2 buoc: dua thuoc len mieng va uong nuoc.
- Ghi log lich su hoan thanh/huy lich uong thuoc.

## Cau truc du an

```text
.
|-- app.py                         # Flask server va API chinh
|-- database.py                    # SQLAlchemy models
|-- medicine_detector.py           # Xu ly nhan dien bang OpenCV + MediaPipe
|-- cabinets.json                  # Du lieu tu thuoc cu, duoc migrate neu DB rong
|-- requirements.txt               # Python dependencies
|-- templates/                     # Giao dien Flask
|-- static/                        # CSS/JS cho web app
|-- firebase_app/                  # Giao dien Firebase rieng
|-- esp32_wifi_sender/             # Firmware dieu khien ESP WiFi
|-- esp32cam_wifi_receiver/        # Firmware ESP32-CAM/receiver
`-- instance/                      # SQLite runtime database, khong commit len Git
```

## Yeu cau

- Python 3.10 den 3.12 khuyen dung.
- Camera/ESP hoat dong trong cung mang LAN voi may chay server.
- Arduino IDE hoac cong cu tuong duong neu nap firmware ESP.

Luu y: MediaPipe co the chua ho tro tat ca phien ban Python moi. Neu cai dat loi tren Python 3.13, hay dung Python 3.10 hoac 3.11.

## Cai dat backend

Tao moi truong ao:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Cai dependencies:

```powershell
pip install -r requirements.txt
```

Chay server:

```powershell
python app.py
```

Mac dinh ung dung chay tai:

```text
http://localhost:5000
```

## Cac man hinh chinh

- `/` - trang tong quan.
- `/cabinets` - quan ly danh sach tu thuoc.
- `/config` - cau hinh ket noi ESP.
- `/cabinet` - dieu khien tu thuoc.
- `/observe` - theo doi camera va nhan dien uong thuoc.
- `/history` - xem lich su uong thuoc.

## Database

Ung dung dung SQLite thong qua Flask-SQLAlchemy. Khi chay `python app.py`, database se duoc tao tu dong trong thu muc `instance/`.

Neu `cabinets.json` ton tai va database chua co du lieu tu thuoc, ung dung se migrate danh sach tu thuoc tu file JSON sang SQLite.

## Firmware ESP

Thu muc `esp32_wifi_sender/` va `esp32cam_wifi_receiver/` chua sketch Arduino cho phan cung.

Can cap nhat thong tin WiFi, dia chi server hoac tham so phan cung trong file `.ino` theo mach thuc te truoc khi nap.

## Ghi chu bao mat

- Khong commit file `.env`, database SQLite trong `instance/`, token hoac mat khau WiFi that.
- Neu dung Firebase, hay cau hinh Firebase Realtime Database Rules phu hop. Web `apiKey` cua Firebase la client config, nhung rules moi la lop bao ve du lieu quan trong.
