*** Hệ thống tủ thuốc thông minh
! Quan trọng: Giữ nguyên các logic cũ để không làm hỏng dự án.
1.ESP32
-Loại bỏ LED_PIN và thay bằng logic mới.
-Khai báo 12 chân GPIO gồm: 
+VP,VN,34,35 là đầu vào, đặt tên là IN1 -> IN2.
+23,19,18,4 là chân đầu ra, đặt tên là OU1 -> OU4.
+25,26,27,14 là chân đầu ra, đặt tên là RE1 -> RE4.
-Các chân cấu hình khác
33 là chân đầu ra đặt là buzzer
Logic cập nhật mới: Trước tiên sẽ làm việc với các chân IN1, OU1,RE1 đây là các chân điều khiển của ngăn số 1. Khi đến lịch được cài đặt trên Web, sẽ bật chân OU1 trong 30p, trong 30p này nếu chân IN1 không có sự kiện (Bấm nút) ghi nhận là chưa uống và gửi đến server máy chủ Flask đong thời bật cả RE1 và Ou1. Nếu có sự kiện thì 30s sau tắt chân OUT1 và bật chân RE1. Khi máy chủ nhận diện được hành vi uống thuốc thông qua ESP32-CAM bằng mediapipe gửi tắt đèn RE1. 
2.ESP32-CAM: Giữ nguyên
3.Máy chủ Flask:
-Hiển thị các trang thái tương ứng của tủ.
-loại bỏ trang demo thay vào trang để quan sát thời gian thực
LUU Ý: Các chân in đều có trở kéo lên dương nguồn. Chỉ xác nhận tắt OU1 khi IN1 ghi nhận được trọn ven 1 sự kiện (1 xung)

