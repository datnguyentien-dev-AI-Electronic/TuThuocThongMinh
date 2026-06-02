*** Hệ thống tủ thuốc thông minh***
! Quan trọng: Giữ nguyên các logic cũ để không làm hỏng dự án.
Logic cập nhật mới: Trước tiên sẽ làm việc với các chân IN1, OU1,RE1 đây là các chân điều khiển của ngăn số 1. Khi đến lịch được cài đặt trên Web, sẽ bật chân OU1 trong 30p, trong 30p này nếu chân IN1 không có sự kiện (Bấm nút) ghi nhận là chưa uống và gửi đến server máy chủ Flask đồng thời bật cả RE1 và Ou1. Nếu có sự kiện thì 30s sau tắt chân OUT1 và bật chân RE1. Khi máy chủ nhận diện được hành vi uống thuốc thông qua ESP32-CAM bằng mediapipe gửi tắt đèn RE1. 
1.ESP32-CAM: Giữ nguyên
2.Máy chủ Flask:
-Hiển thị các trang thái tương ứng của tủ.
-loại bỏ trang demo thay vào trang để quan sát thời gian thực
LUU Ý: Các chân IN1 đều có trở kéo lên dương nguồn.Trạng thái bình thường ngăn có mức logic là 0 khi bấm nút là mức logic 1. Chỉ xác nhận tắt OU1 khi IN1 ghi nhận được trọn ven 1 sự kiện (1 xung).

***Dự án hiện tại***

Do tôi đã viết lại file của ESP32 để test các cấu hình nên đã không còn các giao tiếp HTTP qua IP nữa. Do đó hãy xây dựng lại.
Với app.py file vẫn đang giữ các logic cũ nên hãy đọc kĩ để:
Xóa các logic thừa thãi.
Cập nhật lại theo logic mới của ESP32 ở trên.
! Lưu ý 
Giữ nguyên các cấu trúc xử lí cũ của app.py.
Giữ nguyên giao diện cũ.
Giữ nguyên các phần đã xây dựng trên ESP32.
Chưa làm đến firebase.