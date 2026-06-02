from flask import Flask, render_template, request, redirect, url_for, session, jsonify, Response
import requests
import os
import cv2
import threading
import time
import logging
import json
import uuid

# Import medicine detector module
from medicine_detector import MedicineFrameProcessor, DetectionConfig

# Import database
from database import db, Cabinet, MedicineLog, Drawer, Medication

logging.basicConfig(level=logging.INFO)

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Database Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///pillbox.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'connect_args': {
        'timeout': 15
    }
}
db.init_app(app)

# ===== Global detector state (one shared instance) =====
_processor: MedicineFrameProcessor = None
_processor_lock = threading.Lock()
_re_triggered = {}   # Dict luu trang thai RE triggered theo (cabinet_id, drawer_idx)
_current_esp_ip = ''     # Luu IP ESP32 de dung trong background thread

# ===== Cabinet storage =====
CABINETS_FILE = os.path.join(os.path.dirname(__file__), 'cabinets.json')


def load_cabinets():
    """Load danh sach tu thuoc tu database."""
    try:
        return [cab.to_dict() for cab in Cabinet.query.all()]
    except Exception:
        return []


def get_active_cabinet():
    """Lay tu thuoc dang duoc chon tu session."""
    cabinet_uuid = session.get('active_cabinet_id')
    if not cabinet_uuid:
        return None
    cab = Cabinet.query.filter_by(uuid=cabinet_uuid).first()
    return cab.to_dict() if cab else None


def get_cabinet_by_ip(ip: str):
    """Tim tu thuoc theo dia chi IP."""
    if not ip:
        return None
    ip_clean = ip.replace('http://', '').replace('/', '').strip()
    return Cabinet.query.filter_by(ip=ip_clean).first()


def resolve_cabinet(data: dict = None):
    """
    Xac dinh tu thuoc dang lam viec:
    1. Neu data co 'cabinet_ip' -> tim theo IP (uu tien)
    2. Nguoc lai -> lay tu session
    Tra ve doi tuong Cabinet (ORM) hoac None.
    """
    if data:
        ip = (data.get('cabinet_ip') or '').strip()
        if ip:
            cab = get_cabinet_by_ip(ip)
            if cab:
                return cab
    # Fallback: dung session
    cabinet_uuid = session.get('active_cabinet_id')
    if not cabinet_uuid:
        return None
    return Cabinet.query.filter_by(uuid=cabinet_uuid).first()


def get_active_esp_ip():
    """Lay IP cua tu thuoc dang active."""
    cab = get_active_cabinet()
    if cab:
        return cab['ip']
    return session.get('esp_ip', '')


def processor() -> MedicineFrameProcessor:
    """Get or create the shared frame processor."""
    global _processor
    with _processor_lock:
        if _processor is None:
            _processor = MedicineFrameProcessor(DetectionConfig())
    return _processor


def esp_re(state: str, esp_ip: str = '', drawer: int = 0):
    """
    Goi API /re tren ESP32 de bat/tat den nhac RE.
    state: 'on' hoac 'off'
    """
    ip = esp_ip or _current_esp_ip
    if not ip:
        logging.warning("[RE] Khong co ESP IP de goi RE API")
        return
    try:
        resp = requests.get(
            f"http://{ip}/re?state={state}&drawer={drawer}", timeout=2
        )
        logging.info(f"[RE] /re?state={state}&drawer={drawer} -> {resp.status_code} {resp.text}")
    except Exception as e:
        logging.warning(f"[RE] Khong the goi RE API: {e}")


def _flask_callback_url():
    """URL Flask de ESP32 gui su kien missed."""
    host = request.host if request else '127.0.0.1:5000'
    return f"http://{host}"


# ===== CABINET MANAGEMENT ROUTES =====

@app.route('/cabinets')
def cabinets():
    """Trang quan ly danh sach tu thuoc."""
    cab_list = load_cabinets()
    active_id = session.get('active_cabinet_id', '')
    return render_template('cabinets.html', cabinets=cab_list, active_id=active_id)


@app.route('/api/cabinets/add', methods=['POST'])
def api_cabinet_add():
    """Them tu thuoc moi."""
    data = request.get_json()
    name = (data.get('name') or '').strip()
    ip = (data.get('ip') or '').strip().replace('http://', '').replace('/', '')
    if not name or not ip:
        return jsonify({'status': 'error', 'message': 'Thiếu tên hoặc IP'}), 400

    new_cab = Cabinet(
        uuid=str(uuid.uuid4())[:8],
        name=name,
        ip=ip
    )
    db.session.add(new_cab)
    db.session.commit()
    ensure_drawers(new_cab)

    # Auto-select neu day la tu dau tien
    if Cabinet.query.count() == 1:
        session['active_cabinet_id'] = new_cab.uuid
        session['esp_ip'] = new_cab.ip

    return jsonify({'status': 'ok', 'cabinet': new_cab.to_dict()})


@app.route('/api/cabinets/edit/<cab_uuid>', methods=['POST'])
def api_cabinet_edit(cab_uuid):
    """Sua thong tin tu thuoc."""
    data = request.get_json()
    name = (data.get('name') or '').strip()
    ip = (data.get('ip') or '').strip().replace('http://', '').replace('/', '')
    if not name or not ip:
        return jsonify({'status': 'error', 'message': 'Thiếu tên hoặc IP'}), 400

    cab = Cabinet.query.filter_by(uuid=cab_uuid).first()
    if cab:
        cab.name = name
        cab.ip = ip
        db.session.commit()
        # Cap nhat session neu dang la tu active
        if session.get('active_cabinet_id') == cab_uuid:
            session['esp_ip'] = ip
        return jsonify({'status': 'ok', 'cabinet': cab.to_dict()})

    return jsonify({'status': 'error', 'message': 'Không tìm thấy tủ'}), 404


@app.route('/api/cabinets/delete/<cab_uuid>', methods=['DELETE'])
def api_cabinet_delete(cab_uuid):
    """Xoa tu thuoc."""
    cab = Cabinet.query.filter_by(uuid=cab_uuid).first()
    if cab:
        db.session.delete(cab)
        db.session.commit()

    # Neu xoa tu dang active -> reset session
    if session.get('active_cabinet_id') == cab_uuid:
        session.pop('active_cabinet_id', None)
        session.pop('esp_ip', None)
        # Auto-select tu dau tien neu con
        first_cab = Cabinet.query.first()
        if first_cab:
            session['active_cabinet_id'] = first_cab.uuid
            session['esp_ip'] = first_cab.ip

    return jsonify({'status': 'ok'})


@app.route('/api/cabinets/select/<cab_id>', methods=['POST'])
def api_cabinet_select(cab_id):
    """Chon tu thuoc active."""
    cab = Cabinet.query.filter_by(uuid=cab_id).first()
    if cab:
        session['active_cabinet_id'] = cab_id
        session['esp_ip'] = cab.ip
        
        # Đảm bảo cabinet có đủ 4 ngăn trong DB
        ensure_drawers(cab)
        
        return jsonify({'status': 'ok', 'cabinet': cab.to_dict()})
    return jsonify({'status': 'error', 'message': 'Không tìm thấy tủ'}), 404


def ensure_drawers(cab):
    """Đảm bảo 1 tủ luôn có đủ 4 ngăn trong DB."""
    if Drawer.query.filter_by(cabinet_id=cab.id).count() < 4:
        drawer_names = ["Ngăn 01 — Buổi Sáng", "Ngăn 02 — Buổi Trưa", "Ngăn 03 — Buổi Chiều", "Ngăn 04 — Buổi Tối"]
        drawer_times = ["07:00", "12:00", "17:00", "21:00"]
        for i in range(4):
            existing = Drawer.query.filter_by(cabinet_id=cab.id, index=i).first()
            if not existing:
                new_drawer = Drawer(
                    cabinet_id=cab.id,
                    index=i,
                    name=drawer_names[i],
                    time=drawer_times[i]
                )
                db.session.add(new_drawer)
        db.session.commit()


@app.route('/api/drawers/list')
def api_drawers_list():
    """Lấy danh sách ngăn và thuốc của tủ hiện tại."""
    cab_uuid = session.get('active_cabinet_id')
    if not cab_uuid:
        return jsonify({'status': 'error', 'message': 'Chưa chọn tủ'}), 400
    
    cab = Cabinet.query.filter_by(uuid=cab_uuid).first()
    if not cab:
        return jsonify({'status': 'error', 'message': 'Tủ không tồn tại'}), 404
        
    ensure_drawers(cab)
    
    drawers_list = []
    for d in Drawer.query.filter_by(cabinet_id=cab.id).order_by(Drawer.index).all():
        d_dict = d.to_dict()
        # check relationship name in database.py. It was backref='medications'.
        d_dict['meds'] = [m.to_dict() for m in d.medications]
        drawers_list.append(d_dict)
        
    return jsonify({'status': 'ok', 'drawers': drawers_list})


@app.route('/api/drawers/save_schedule', methods=['POST'])
def api_drawers_save_schedule():
    """Luu cau hinh lich cua 1 ngan — xac dinh tu theo IP neu client truyen len."""
    data = request.get_json()
    idx = data.get('index')

    cab = resolve_cabinet(data)
    if not cab:
        return jsonify({'status': 'error', 'message': 'Không tìm thấy tủ'}), 404

    drawer = Drawer.query.filter_by(cabinet_id=cab.id, index=idx).first()
    if drawer:
        drawer.time = data.get('time', drawer.time)
        drawer.reminder_before = data.get('reminderBefore', drawer.reminder_before)
        drawer.days = ','.join(map(str, data.get('days', [])))
        db.session.commit()
        logging.info(f"[DB] Da luu lich ngan {idx} cho tu IP={cab.ip}")
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'error', 'message': 'Không tìm thấy ngăn'}), 404


@app.route('/api/meds/save', methods=['POST'])
def api_meds_save():
    """Luu hoac cap nhat thuoc — xac dinh tu theo IP neu client truyen len."""
    data = request.get_json()

    cab = resolve_cabinet(data)
    if not cab:
        return jsonify({'status': 'error', 'message': 'Không tìm thấy tủ'}), 404

    drawer_idx = data.get('drawer_idx')
    med_idx = data.get('med_idx')  # -1 if new
    med_data = data.get('med')

    drawer = Drawer.query.filter_by(cabinet_id=cab.id, index=drawer_idx).first()
    if not drawer: return jsonify({'status': 'error'}), 404

    if med_idx == -1:
        new_med = Medication(
            drawer_id=drawer.id,
            name=med_data['name'],
            dose=med_data['dose'],
            icon=med_data['icon'],
            qty=med_data.get('qty', 0),
            type=med_data.get('type', 'Viên uống'),
            note=med_data['note']
        )
        db.session.add(new_med)
    else:
        meds = Medication.query.filter_by(drawer_id=drawer.id).all()
        if 0 <= med_idx < len(meds):
            m = meds[med_idx]
            m.name = med_data['name']
            m.dose = med_data['dose']
            m.icon = med_data['icon']
            m.qty = med_data.get('qty', m.qty)
            m.type = med_data.get('type', m.type)
            m.note = med_data['note']

            new_drawer_idx = data.get('new_drawer_idx')
            if new_drawer_idx is not None and new_drawer_idx != drawer_idx:
                new_drawer = Drawer.query.filter_by(cabinet_id=cab.id, index=new_drawer_idx).first()
                if new_drawer:
                    m.drawer_id = new_drawer.id
        else:
            return jsonify({'status': 'error', 'message': 'Med not found'}), 404

    db.session.commit()
    logging.info(f"[DB] Da luu thuoc cho tu IP={cab.ip}")
    return jsonify({'status': 'ok'})


@app.route('/api/meds/delete', methods=['POST'])
def api_meds_delete():
    """Xoa thuoc — xac dinh tu theo IP neu client truyen len."""
    data = request.get_json()

    cab = resolve_cabinet(data)
    if not cab:
        return jsonify({'status': 'error', 'message': 'Không tìm thấy tủ'}), 404

    drawer_idx = data.get('drawer_idx')
    med_idx = data.get('med_idx')

    drawer = Drawer.query.filter_by(cabinet_id=cab.id, index=drawer_idx).first()
    if not drawer:
        return jsonify({'status': 'error', 'message': 'Không tìm thấy ngăn'}), 404
    meds = Medication.query.filter_by(drawer_id=drawer.id).all()
    if 0 <= med_idx < len(meds):
        db.session.delete(meds[med_idx])
        db.session.commit()
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'error', 'message': 'Méd not found'}), 404


@app.route('/api/stats')
def api_stats():
    """Lấy số liệu thống kê cho trang chủ."""
    cab_uuid = session.get('active_cabinet_id')
    cab = Cabinet.query.filter_by(uuid=cab_uuid).first()
    if not cab: return jsonify({'status': 'error'}), 404
    
    # Tổng loại thuốc
    total_meds = Medication.query.join(Drawer).filter(Drawer.cabinet_id == cab.id).count()
    
    # Sắp hết
    low_stock = Medication.query.join(Drawer).filter(Drawer.cabinet_id == cab.id, Medication.qty <= 5).count()
    
    # Đã uống hôm nay (đếm số log thành công hôm nay)
    from datetime import datetime, time as dtime
    today_start = datetime.combine(datetime.now().date(), dtime.min)
    logs_today = MedicineLog.query.filter(
        MedicineLog.cabinet_id == cab.id,
        MedicineLog.timestamp >= today_start,
        MedicineLog.status == 'completed'
    ).count()
    
    # Đếm số ngăn có thuốc
    total_active_drawers = Drawer.query.join(Medication).filter(Drawer.cabinet_id == cab.id).group_by(Drawer.id).count()
    
    # Kiểm tra trạng thái kết nối (Ping ESP)
    online = False
    try:
        resp = requests.get(f"http://{cab.ip}/status", timeout=2.5)
        online = (resp.status_code == 200)
    except:
        online = False
    
    return jsonify({
        'total_meds': total_meds,
        'low_stock': low_stock,
        'taken_today': logs_today,
        'total_today': total_active_drawers or 4,
        'online': online
    })


@app.route('/api/time')
def api_time():
    """Tra ve timestamp chuẩn của server để đồng bộ."""
    import time
    return jsonify({
        'timestamp': int(time.time() * 1000)
    })


@app.route('/api/cabinets/ping_all')
def api_cabinets_ping_all():
    """Ping tat ca tu thuoc de check online/offline song song."""
    from concurrent.futures import ThreadPoolExecutor
    cabinets = load_cabinets()
    results = {}
    
    def ping_cab(cab):
        try:
            resp = requests.get(f"http://{cab['ip']}/status", timeout=1.5)
            return cab['id'], (resp.status_code == 200)
        except Exception:
            return cab['id'], False

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures_results = executor.map(ping_cab, cabinets)
        for cab_id, online in futures_results:
            results[cab_id] = {'online': online}
            
    return jsonify(results)


@app.route('/api/cabinets/list')
def api_cabinets_list():
    """Lay danh sach tat ca tu thuoc (cho switcher dropdown)."""
    cabinets = load_cabinets()
    active_id = session.get('active_cabinet_id', '')
    return jsonify({'cabinets': cabinets, 'active_id': active_id})


# ===== EXISTING ROUTES (updated to use active cabinet) =====

@app.route('/')
def index():
    """Redirect to cabinets list if no cabinet, otherwise to the main cabinet."""
    cabinets = load_cabinets()
    if not cabinets:
        return redirect(url_for('cabinets'))
    if not session.get('active_cabinet_id'):
        # Auto-select first cabinet
        session['active_cabinet_id'] = cabinets[0]['id']
        session['esp_ip'] = cabinets[0]['ip']
    return redirect(url_for('cabinet'))


@app.route('/config')
def config():
    """Legacy: redirect to cabinets page."""
    return redirect(url_for('cabinets'))


@app.route('/save_config', methods=['POST'])
def save_config():
    """Save ESP IP as a new cabinet directly to SQLite database."""
    esp_ip = request.form.get('esp_ip')
    if esp_ip:
        esp_ip = esp_ip.replace('http://', '').replace('/', '').strip()
        count = Cabinet.query.count()
        new_cab = Cabinet(
            uuid=str(uuid.uuid4())[:8],
            name=f'Tủ thuốc {count + 1}',
            ip=esp_ip
        )
        db.session.add(new_cab)
        db.session.commit()
        session['active_cabinet_id'] = new_cab.uuid
        session['esp_ip'] = esp_ip
        return redirect(url_for('cabinet'))
    return redirect(url_for('cabinets'))


@app.route('/cabinet')
def cabinet():
    """Main medicine cabinet dashboard."""
    cab = get_active_cabinet()
    if not cab:
        return redirect(url_for('cabinets'))
    return render_template('index.html', cabinet=cab)


@app.route('/api/trigger_drawer/<int:idx>')
def trigger_drawer(idx):
    """Kich hoat ngan tren ESP32 (OU/RE logic)."""
    esp_ip = get_active_esp_ip()
    if not esp_ip:
        return jsonify({"status": "error", "message": "No cabinet selected"}), 400

    callback = _flask_callback_url()
    try:
        response = requests.get(
            f"http://{esp_ip}/open_drawer?idx={idx}&callback={callback}",
            timeout=2,
        )
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/drawer/missed', methods=['POST'])
def api_drawer_missed():
    """
    ESP32 bao su kien ngan:
    - missed: het 30p khong bam IN1
    - not_detect: da bam IN1 nhung het 10p khong xac nhan AI
    """
    data = request.get_json() or {}
    drawer_idx = data.get('drawer', 0)
    event_status = (data.get('status') or 'missed').strip()
    if event_status not in ('missed', 'not_detect'):
        event_status = 'missed'

    cab = get_cabinet_by_ip(data.get('cabinet_ip', ''))
    if not cab:
        cab = resolve_cabinet(data)
    if cab:
        log = MedicineLog(cabinet_id=cab.id, status=event_status)
        db.session.add(log)
        db.session.commit()
        logging.info(f"[DB] {event_status} ngan {drawer_idx} tu IP={cab.ip}")
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'error', 'message': 'Không tìm thấy tủ'}), 404


@app.route('/api/reset_ou', methods=['POST'])
def api_reset_ou():
    """Toggle mo/tat tat ca OU; lan tat dua tu ve trang thai ban dau."""
    esp_ip = get_active_esp_ip()
    if not esp_ip:
        return jsonify({'status': 'error', 'message': 'Chưa chọn tủ'}), 400
    try:
        resp = requests.get(f"http://{esp_ip}/reset_ou", timeout=2)
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/hardware_status')
def api_hardware_status():
    """Trang thai phan cung tu ESP32 (OU, RE, session ngan 1)."""
    esp_ip = get_active_esp_ip()
    if not esp_ip:
        return jsonify({'status': 'error', 'message': 'Chưa chọn tủ'}), 400
    try:
        resp = requests.get(f"http://{esp_ip}/status", timeout=2)
        data = resp.json()
        data['online'] = True
        return jsonify(data)
    except Exception as e:
        return jsonify({
            'online': False,
            'error': str(e),
            'drawer1': {
                'session_active': False,
                'ou1': False,
                're1': False,
                'missed': False,
                'not_detect': False,
                'ou_all_on': False,
            },
        })


@app.route('/toggle_led')
def toggle_led():
    """Legacy: toggle RE1."""
    esp_ip = get_active_esp_ip()
    if not esp_ip:
        return jsonify({"status": "error", "message": "No cabinet selected"}), 400

    try:
        response = requests.get(f"http://{esp_ip}/toggle", timeout=2)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ===== QUAN SAT THOI GIAN THUC =====

@app.route('/observe')
def observe():
    """Trang quan sat camera + phan tich MediaPipe thoi gian thuc."""
    cab = get_active_cabinet()
    if not cab:
        return redirect(url_for('cabinets'))

    esp_ip = cab['ip']
    cam_ip = None
    stream_url = None
    error_msg = None
    try:
        resp = requests.get(f"http://{esp_ip}/status", timeout=2)
        data = resp.json()
        cam_ip = data.get('cam_ip', '')
        if cam_ip:
            stream_url = f"http://{cam_ip}/stream"
    except Exception as e:
        error_msg = str(e)

    return render_template(
        'observe.html',
        esp_ip=esp_ip,
        cam_ip=cam_ip or '',
        stream_url=stream_url or '',
        error_msg=error_msg,
        cabinet=cab,
    )


@app.route('/demo')
def demo_redirect():
    """Chuyen huong route cu sang trang quan sat."""
    return redirect(url_for('observe'))


def _generate_frames(cam_stream_url: str):
    """
    Generator: lay frame tu ESP32-CAM, chay MediaPipe,
    tra ve MJPEG stream da annotate.
    Khi phat hien hoan tat (ca 2 buoc) -> tat RE1 tren ESP32.
    """
    global _re_triggered
    proc = processor()
    cap = None
    retry_delay = 1.0
    max_retry = 5
    retry_count = 0

    while True:
        try:
            if cap is None or not cap.isOpened():
                cap = cv2.VideoCapture(cam_stream_url)
                if not cap.isOpened():
                    raise ConnectionError(f"Cannot open stream: {cam_stream_url}")
                retry_count = 0
                retry_delay = 1.0

            success, frame = cap.read()
            if not success:
                raise RuntimeError("Frame read failed")

            # Process with MediaPipe
            annotated = proc.process_frame(frame)

            # Neu phat hien hoan tat lan dau -> tat RE va luu log
            if proc.status.get('finished'):
                active_cab = get_active_cabinet()
                cab_uuid = active_cab['id'] if active_cab else None
                
                # Tim ngan dang active de tat LED va ghi log dung ngan
                active_drawer_idx = 0  # default fallback
                if _current_esp_ip:
                    try:
                        resp = requests.get(f"http://{_current_esp_ip}/status", timeout=1.2)
                        if resp.status_code == 200:
                            status_data = resp.json()
                            for i in range(4):
                                drawer_key = f"drawer{i+1}"
                                if status_data.get(drawer_key, {}).get("session_active"):
                                    active_drawer_idx = i
                                    break
                    except Exception as e:
                        logging.warning(f"[DETECTION] Failed to fetch active drawer from ESP32: {e}")

                lock_key = (cab_uuid, active_drawer_idx)
                if not _re_triggered.get(lock_key, False):
                    _re_triggered[lock_key] = True

                    def handle_finish(esp_ip_val, cab_uuid_val, drawer_idx):
                        with app.app_context():
                            cab = Cabinet.query.filter_by(uuid=cab_uuid_val).first()
                            if cab:
                                new_log = MedicineLog(cabinet_id=cab.id, status='completed')
                                db.session.add(new_log)
                                db.session.commit()
                                logging.info(f"[DB] Da luu log uong thuoc cho tu: {cab.name}, ngan: {drawer_idx + 1}")

                            esp_re('off', esp_ip_val, drawer=drawer_idx)

                    threading.Thread(
                        target=handle_finish,
                        args=(_current_esp_ip, cab_uuid, active_drawer_idx),
                        daemon=True,
                    ).start()

                    logging.info(f"[DETECTION] Hoan thanh! Tat RE{active_drawer_idx + 1} + luu log.")

            # Encode to JPEG
            _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
            frame_bytes = buffer.tobytes()

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

            time.sleep(1.0 / 15)  # ~15 fps

        except Exception as e:
            logging.error(f"[CAM STREAM] Error: {e}")
            if cap:
                cap.release()
                cap = None

            retry_count += 1
            if retry_count >= max_retry:
                error_frame = _error_frame(str(e))
                _, buffer = cv2.imencode('.jpg', error_frame)
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                retry_count = 0

            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 16)


def _error_frame(msg: str):
    """Create a black frame with an error message."""
    import numpy as np
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.rectangle(frame, (0, 0), (640, 480), (20, 20, 20), -1)
    cv2.putText(frame, "Loi ket noi camera", (30, 200),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (60, 60, 220), 2)
    cv2.putText(frame, msg[:70], (30, 250),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160, 160, 160), 1)
    cv2.putText(frame, "Dang thu lai...", (30, 300),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 200), 1)
    return frame


@app.route('/api/cam_stream')
def cam_stream():
    """MJPEG stream endpoint — phan tich MediaPipe realtime."""
    global _current_esp_ip
    esp_ip = get_active_esp_ip()
    if not esp_ip:
        return jsonify({"error": "No cabinet selected"}), 400

    _current_esp_ip = esp_ip

    stream_url = request.args.get('url', '').strip()

    if not stream_url:
        try:
            resp = requests.get(f"http://{_current_esp_ip}/status", timeout=2)
            cam_ip = resp.json().get('cam_ip', '')
            if cam_ip:
                stream_url = f"http://{cam_ip}/stream"
        except Exception:
            pass

    if not stream_url:
        return jsonify({"error": "Khong tim thay URL camera"}), 400

    return Response(
        _generate_frames(stream_url),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route('/api/detection_status')
def detection_status():
    """Tra ve trang thai phat hien hien tai."""
    proc = processor()
    return jsonify(proc.status)


@app.route('/api/reset_detection', methods=['POST'])
def reset_detection():
    """Reset detector va tat RE tren ESP32."""
    global _re_triggered
    proc = processor()
    proc.reset()
    _re_triggered = {}
    
    # Tat tat ca RE LED tren ESP32
    esp_ip = get_active_esp_ip()
    if esp_ip:
        def off_all_drawers():
            for i in range(4):
                esp_re('off', esp_ip, drawer=i)
        threading.Thread(target=off_all_drawers, daemon=True).start()
        
    return jsonify({"status": "ok", "message": "Detector da reset, RE da tat"})


@app.route('/api/re', methods=['GET'])
def re_proxy():
    """Proxy bat/tat RE tren ESP32."""
    esp_ip = get_active_esp_ip()
    if not esp_ip:
        return jsonify({"error": "No cabinet selected"}), 400
    state = request.args.get('state', 'off')
    drawer = request.args.get('drawer', 0)
    try:
        resp = requests.get(
            f"http://{esp_ip}/re?state={state}&drawer={drawer}", timeout=2
        )
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/history')
def history():
    """Trang xem lich su uong thuoc."""
    cab = resolve_cabinet()
    if cab:
        logs = MedicineLog.query.filter_by(cabinet_id=cab.id).order_by(MedicineLog.timestamp.desc()).all()
    else:
        logs = []
    return render_template('history.html', logs=logs)


def run_backend_scheduler():
    """Luồng lập lịch chạy ngầm kiểm tra lịch uống thuốc tự động gửi lệnh mở ngăn."""
    import time
    from datetime import datetime
    
    logging.info("[SCHEDULER] Background scheduler thread started.")
    triggered_today = {} # Key: (drawer_id, date_str, time_str)
    
    while True:
        try:
            with app.app_context():
                now = datetime.now()
                current_time_str = now.strftime("%H:%M")
                current_date_str = now.strftime("%Y-%m-%d")
                current_day = now.weekday() # 0 = Monday, ..., 6 = Sunday
                
                # Map Python weekday to DB day index (0 = Sunday, 1-6 = Mon-Sat)
                db_day = (current_day + 1) % 7
                
                cabinets = Cabinet.query.all()
                for cab in cabinets:
                    drawers = Drawer.query.filter_by(cabinet_id=cab.id).all()
                    for drawer in drawers:
                        if not drawer.time:
                            continue
                        
                        days_list = [int(d) for d in drawer.days.split(',')] if drawer.days else []
                        if drawer.time == current_time_str and db_day in days_list:
                            key = (drawer.id, current_date_str, current_time_str)
                            if key not in triggered_today:
                                triggered_today[key] = True
                                logging.info(f"[SCHEDULER] Triggering drawer {drawer.index + 1} on cabinet {cab.name} (IP: {cab.ip})")
                                
                                # Kích hoạt mở ngăn trên ESP32 không chặn luồng chính
                                def trigger_esp(esp_ip, idx):
                                    try:
                                        requests.get(f"http://{esp_ip}/open_drawer?idx={idx}", timeout=3.0)
                                    except Exception as ex:
                                        logging.warning(f"[SCHEDULER] Failed to trigger ESP32 at {esp_ip}: {ex}")
                                        
                                threading.Thread(target=trigger_esp, args=(cab.ip, drawer.index), daemon=True).start()
                                
            # Dọn dẹp bộ nhớ các khóa ngày cũ
            for k in list(triggered_today.keys()):
                if k[1] != current_date_str:
                    triggered_today.pop(k, None)
                    
        except Exception as e:
            logging.error(f"[SCHEDULER] Error in background scheduler: {e}")
            
        time.sleep(15) # Kiểm tra mỗi 15 giây


@app.route('/api/notifications')
def api_notifications():
    """API lay danh sach thong bao va canh bao cua tu hien tai."""
    from datetime import datetime, timedelta
    cab = resolve_cabinet()
    if not cab:
        return jsonify([])

    notifications = []

    # 1. Kiem tra trang thai online/offline cua tu
    online = False
    try:
        resp = requests.get(f"http://{cab.ip}/status", timeout=1.2)
        online = (resp.status_code == 200)
    except:
        online = False

    if not online:
        notifications.append({
            'type': 'danger',
            'title': 'Mất kết nối tủ thuốc',
            'desc': f'Không thể kết nối đến thiết bị tại IP {cab.ip}.',
            'time': 'Thời gian thực'
        })

    # 2. Canh bao thuoc sap het (qty <= 5)
    low_meds = Medication.query.join(Drawer).filter(
        Drawer.cabinet_id == cab.id,
        Medication.qty <= 5
    ).all()
    for med in low_meds:
        drawer = Drawer.query.get(med.drawer_id)
        notifications.append({
            'type': 'warning',
            'title': f'Sắp hết thuốc: {med.name}',
            'desc': f'{drawer.name if drawer else "Ngăn tủ"} chỉ còn {med.qty} viên.',
            'time': 'Cảnh báo số lượng'
        })

    # 3. Canh bao lo lich / loi AI trong 3 ngay qua
    recent_limit = datetime.utcnow() - timedelta(days=3)
    recent_warn_logs = MedicineLog.query.filter(
        MedicineLog.cabinet_id == cab.id,
        MedicineLog.status.in_(['missed', 'not_detect']),
        MedicineLog.timestamp >= recent_limit
    ).order_by(MedicineLog.timestamp.desc()).all()

    for log in recent_warn_logs:
        log_time_str = log.timestamp.strftime('%H:%M — %d/%m/%Y')
        if log.status == 'missed':
            notifications.append({
                'type': 'danger',
                'title': 'Lỡ lịch uống thuốc',
                'desc': 'Hệ thống ghi nhận bạn đã bỏ lỡ lịch uống thuốc.',
                'time': log_time_str
            })
        elif log.status == 'not_detect':
            notifications.append({
                'type': 'warning',
                'title': 'AI không xác nhận',
                'desc': 'Đã đóng ngăn tủ nhưng camera không quét được hành vi uống thuốc.',
                'time': log_time_str
            })

    return jsonify(notifications)


@app.route('/api/logs')
def api_logs():
    """API lay lich su uong thuoc."""
    cab = resolve_cabinet()
    if cab:
        logs = MedicineLog.query.filter_by(cabinet_id=cab.id).order_by(MedicineLog.timestamp.desc()).all()
    else:
        logs = []
    return jsonify([log.to_dict() for log in logs])


def init_db():
    """Khoi tao database va migrate du lieu tu JSON neu can."""
    with app.app_context():
        db.create_all()
        
        # Check if we need to migrate from JSON
        if Cabinet.query.count() == 0 and os.path.exists(CABINETS_FILE):
            logging.info("Migrating cabinets from JSON to SQLite...")
            try:
                with open(CABINETS_FILE, 'r', encoding='utf-8') as f:
                    cabinets_data = json.load(f)
                    for cab_data in cabinets_data:
                        new_cab = Cabinet(
                            uuid=cab_data.get('id', str(uuid.uuid4())[:8]),
                            name=cab_data.get('name', 'Unnamed Cabinet'),
                            ip=cab_data.get('ip', '')
                        )
                        db.session.add(new_cab)
                    db.session.commit()
                    
                    # Dam bao moi cabinet deu co du 4 ngan
                    for cab in Cabinet.query.all():
                        ensure_drawers(cab)
                        
                logging.info(f"Migrated {len(cabinets_data)} cabinets.")
            except Exception as e:
                logging.error(f"Migration error: {e}")


if __name__ == '__main__':
    print("Starting SmartMed Cabinet Server...")
    init_db()
    
    # Chỉ khởi chạy Thread trong tiến trình chính của Werkzeug để tránh chạy đúp khi Reload
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        threading.Thread(target=run_backend_scheduler, daemon=True).start()
        
    app.run(debug=True, host='0.0.0.0', port=5000)
