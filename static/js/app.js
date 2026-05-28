// ===== DATA =====
let drawerConfig = [
  { name: "Ngăn 01 — Buổi Sáng", color: "#FF6B6B", bg: "#FFF0EE", icon: "🌅", emoji: "🌅",
    schedule: { time: "07:00", reminderBefore: 5, days: [1,2,3,4,5,6,0] } },
  { name: "Ngăn 02 — Buổi Trưa", color: "#4ECDC4", bg: "#E8FAF9", icon: "☀️", emoji: "☀️",
    schedule: { time: "12:00", reminderBefore: 5, days: [1,2,3,4,5,6,0] } },
  { name: "Ngăn 03 — Buổi Chiều", color: "#E6C200", bg: "#FFFBE6", icon: "🌤️", emoji: "🌤️",
    schedule: { time: "17:00", reminderBefore: 5, days: [1,2,3,4,5,6,0] } },
  { name: "Ngăn 04 — Buổi Tối", color: "#5DB884", bg: "#EDFBF3", icon: "🌙", emoji: "🌙",
    schedule: { time: "21:00", reminderBefore: 5, days: [1,2,3,4,5,6,0] } },
];

const medIcons = ["🟠","🔵","🔴","🟡","🟣","⚪","🟢"];

let drawers = [ {meds:[]}, {meds:[]}, {meds:[]}, {meds:[]} ];

const dayNames = ["CN","T2","T3","T4","T5","T6","T7"];
let currentDrawerTab = 0;
let lastTriggered = {};

/** Lấy IP tủ đang active từ thuộc tính data của body (được server render vào HTML). */
function getActiveCabinetIP() {
    return document.body.dataset.cabinetIp || '';
}

// ===== API LOAD =====
async function loadServerData() {
    try {
        const res = await fetch('/api/drawers/list');
        const data = await res.json();
        if (data.status === 'ok') {
            data.drawers.forEach((d, i) => {
                drawerConfig[i].time = d.time;
                drawerConfig[i].schedule = {
                    time: d.time,
                    reminderBefore: d.reminderBefore,
                    days: d.days
                };
                drawers[i].meds = d.meds;
            });
            console.log("[DB] Dữ liệu đã đồng bộ từ server.");
            
            // Refresh UI components
            renderHomeMeds();
            renderDrawerUI();
            renderStats();
            
            if (document.getElementById('page-settings').classList.contains('active')) {
                renderScheduleTab();
                renderMedTab(currentDrawerTab);
            }
        }
    } catch (e) {
        console.error("[DB] Lỗi tải dữ liệu:", e);
    }
}

async function renderStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (data.status !== 'error') {
            const values = document.querySelectorAll('.stat-value');
            if (values.length >= 2) {
                values[0].textContent = data.total_meds;
                values[1].textContent = `${data.taken_today}/${data.total_today}`;
            }

            // Cập nhật Badge trạng thái kết nối
            const badge = document.getElementById('connection-badge');
            if (badge) {
                if (data.online) {
                    badge.innerHTML = '<div class="dot-pulse"></div>Đang hoạt động';
                    badge.style.background = 'rgba(39, 174, 96, 0.1)';
                    badge.style.color = '#27AE60';
                } else {
                    badge.innerHTML = '<div class="dot-pulse" style="background:#E74C3C"></div>Mất kết nối';
                    badge.style.background = 'rgba(231, 76, 60, 0.1)';
                    badge.style.color = '#E74C3C';
                }
            }
        }
    } catch (e) {
        console.error("[DB] Lỗi tải stats:", e);
    }
}

function renderHomeMeds() {
    const listEl = document.getElementById('today-meds-list');
    if (!listEl) return;
    
    let html = '';
    let anyMeds = false;
    
    // Thu thập tất cả thuốc trong ngày
    const allMeds = [];
    drawers.forEach((drawer, i) => {
        const dConfig = drawerConfig[i];
        drawer.meds.forEach(med => {
            allMeds.push({
                name: med.name,
                time: dConfig.schedule.time,
                color: dConfig.color,
                drawerIdx: i
            });
        });
    });

    // Sắp xếp theo thời gian
    allMeds.sort((a, b) => a.time.localeCompare(b.time));

    allMeds.forEach(med => {
        anyMeds = true;
        html += `
        <div class="med-item">
          <div class="med-dot" style="background:${med.color}"></div>
          <div class="med-name">${med.name}</div>
          <div class="med-time">${med.time}</div>
          <div class="med-taken taken-no">—</div>
        </div>
        `;
    });
    
    if (!anyMeds) {
        html = '<div style="padding:10px; font-size:12px; color:#888; text-align:center">Chưa có lịch uống thuốc.</div>';
    }
    
    listEl.innerHTML = html;
    updateNextDose(allMeds);
}

function updateNextDose(allMeds) {
    if (!allMeds || allMeds.length === 0) return;

    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');

    let next = allMeds.find(m => m.time > currentTime);
    let isTomorrow = false;

    if (!next) {
        next = allMeds[0];
        isTomorrow = true;
    }

    if (next) {
        const timeEl = document.getElementById('next-alarm-time');
        const nameEl = document.getElementById('next-alarm-name');
        const dayEl = document.getElementById('next-alarm-day');
        
        if (timeEl) timeEl.textContent = next.time;
        if (nameEl) nameEl.textContent = `💊 ${next.name}`;
        if (dayEl) dayEl.textContent = isTomorrow ? 'Ngày mai:' : 'Tiếp theo:';
    } else {
        const nameEl = document.getElementById('next-alarm-name');
        if (nameEl) nameEl.textContent = "Chưa có lịch";
    }
}

function startRealTimeClock() {
    function update() {
        // Dùng giờ địa phương của trình duyệt trực tiếp — không cần đồng bộ server
        const now = new Date();
        const h = document.getElementById('clock-hour');
        const m = document.getElementById('clock-min');
        const s = document.getElementById('clock-sec');
        
        if (h) h.textContent = now.getHours().toString().padStart(2, '0');
        if (m) m.textContent = now.getMinutes().toString().padStart(2, '0');
        if (s) s.textContent = now.getSeconds().toString().padStart(2, '0');
    }
    setInterval(update, 1000);
    update();
}

// Khởi chạy đồng hồ ngay lập tức
startRealTimeClock();

function renderDrawerUI() {
    drawerConfig.forEach((d, i) => {
        const drawerEl = document.querySelector(`.drawer-${i+1}`);
        if (!drawerEl) return;
        
        const timeEl = drawerEl.querySelector('.drawer-time');
        const countEl = drawerEl.querySelector('.drawer-count');
        const typeEl = drawerEl.querySelector('.drawer-type');
        
        if (timeEl) timeEl.textContent = `⏰ ${d.schedule.time}`;
        if (countEl) countEl.textContent = `💊 ${drawers[i].meds.length} loại thuốc`;
        if (typeEl) typeEl.textContent = d.name.split('—')[1]?.trim() || d.name;
    });
}

function hwOnOff(val) {
    if (val === true || val === 'true') return 'BẬT';
    if (val === false || val === 'false') return 'TẮT';
    return '—';
}

async function pollHardwareStatus() {
    try {
        const res = await fetch('/api/hardware_status');
        const data = await res.json();
        const d1 = data.drawer1 || {};
        const ouEl = document.getElementById('hw-ou1');
        const reEl = document.getElementById('hw-re1');
        const inEl = document.getElementById('hw-in1');
        const sesEl = document.getElementById('hw-session');
        const resetBtn = document.getElementById('btn-reset-ou');
        if (!ouEl) return;

        if (!data.online) {
            ouEl.textContent = reEl.textContent = inEl.textContent = '—';
            if (sesEl) sesEl.textContent = 'Mất kết nối';
            if (resetBtn) resetBtn.textContent = '📂 Mở tất cả ngăn (OU)';
            return;
        }

        ouEl.textContent = hwOnOff(d1.ou1);
        reEl.textContent = hwOnOff(d1.re1);
        inEl.textContent = hwOnOff(d1.in1);
        if (sesEl) {
            if (d1.ou_all_on) sesEl.textContent = 'Mở thủ công (tất cả OU)';
            else if (d1.missed) sesEl.textContent = 'Chưa uống (missed)';
            else if (d1.not_detect) sesEl.textContent = 'Không xác nhận AI';
            else if (d1.session_active) sesEl.textContent = d1.button_pressed ? 'Đã đóng tủ' : 'Đang chờ';
            else sesEl.textContent = 'Nghỉ';
        }

        if (resetBtn) {
            resetBtn.textContent = d1.ou_all_on ? '⏹ Đóng tất cả ngăn (OU)' : '📂 Mở tất cả ngăn (OU)';
        }

        // Den tren tu: xanh=OU, vang=RE, do=missed hoac not_detect
        const leds = document.querySelectorAll('.cabinet-top .cabinet-led');
        if (leds.length >= 3) {
            leds[0].style.opacity = d1.ou1 ? '1' : '0.25';
            leds[1].style.opacity = d1.re1 ? '1' : '0.25';
            leds[2].style.opacity = (d1.missed || d1.not_detect) ? '1' : '0.25';
        }
    } catch (e) {
        console.warn('[HW] Khong doc duoc trang thai:', e);
    }
}

// Gọi tải dữ liệu khi khởi chạy
loadServerData();
pollHardwareStatus();
setInterval(pollHardwareStatus, 3000);

// ===== DRAWER MODAL =====
function openDrawer(idx) {
  const d = drawerConfig[idx];
  const meds = drawers[idx].meds;
  const modal = document.getElementById('modal');
  document.getElementById('modal-icon').style.background = d.bg;
  document.getElementById('modal-icon').textContent = d.icon;
  document.getElementById('modal-title').textContent = d.name;
  document.getElementById('modal-sub').textContent = `Giờ uống: ${d.schedule.time} • ${meds.length} loại thuốc`;

  document.getElementById('modal-body').innerHTML = meds.map(m => `
    <div class="med-full-item">
      <div class="med-pill-icon" style="background:${d.bg}">${m.icon}</div>
      <div style="flex:1">
        <div class="med-full-name">${m.name}</div>
        <div class="med-full-dose">${m.dose}${m.note ? ' — <em style="color:#E67E22;font-size:11px">' + m.note + '</em>' : ''}</div>
      </div>
      <div class="med-full-time"><div class="med-time-badge">⏰ ${d.schedule.time}</div></div>
    </div>
  `).join('');

  modal.classList.add('open');
}

function closeDrawer(e) {
  if (e.target === document.getElementById('modal')) {
    document.getElementById('modal').classList.remove('open');
  }
}

// ===== PAGE NAV =====
function showPage(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  btn.classList.add('active');

  const titles = {
    home: ['Tủ Thuốc Thông Minh', 'Chào mừng bạn quay lại!'],
    history: ['Lịch Sử Uống Thuốc', 'Theo dõi tuân thủ điều trị'],
    settings: ['Cài Đặt Hệ Thống', 'Tủ thuốc SmartMed Cabinet Pro'],
    info: ['Thông Tin Thiết Bị', 'SmartMed Cabinet Pro v2.4.1']
  };

  const headingEl = document.getElementById('page-heading');
  const subHeadingEl = document.getElementById('page-sub-heading');
  if (headingEl) headingEl.textContent = titles[page][0];
  if (subHeadingEl) subHeadingEl.textContent = titles[page][1];

  if (page === 'settings') {
    renderScheduleTab();
    renderMedTab(currentDrawerTab);
  } else if (page === 'history') {
    renderHistory();
  } else if (page === 'info') {
    renderInfo();
  }
}

async function renderInfo() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        const cabRes = await fetch('/api/cabinets/list');
        const cabData = await cabRes.json();
        const activeCab = cabData.cabinets.find(c => c.id === cabData.active_id);

        if (activeCab) {
            document.getElementById('info-cab-name').textContent = activeCab.name;
            document.getElementById('info-cab-id').textContent = `ID: ${activeCab.id}`;
            document.getElementById('info-cab-ip').textContent = `📡 IP: ${activeCab.ip}`;
            
            const statusEl = document.getElementById('info-cab-status');
            if (data.online) {
                statusEl.textContent = '● Đang hoạt động';
                statusEl.className = 'status-pill pulse-green';
            } else {
                statusEl.textContent = '● Mất kết nối';
                statusEl.className = 'status-pill pulse-red';
                statusEl.style.color = '#E74C3C';
                statusEl.style.background = '#FDE8E8';
            }
        }
    } catch (e) {
        console.error("Lỗi tải thông tin thiết bị:", e);
    }
}

async function renderHistory() {
    const container = document.getElementById('history-list-dynamic');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">⏳ Đang tải lịch sử...</div>';
    
    try {
        const res = await fetch('/api/logs');
        const logs = await res.json();
        
        if (logs.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:60px 20px;background:white;border-radius:20px;color:var(--text-muted)">
                  <div style="font-size:48px;margin-bottom:16px">📂</div>
                  <p style="font-size:16px;font-weight:700;color:var(--text)">Chưa có dữ liệu lịch sử</p>
                  <p style="margin-top:8px">Dữ liệu sẽ xuất hiện sau khi bạn uống thuốc.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = logs.map(log => {
            const date = new Date(log.timestamp);
            const timeStr = date.toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'});
            const dateStr = date.toLocaleDateString('vi-VN');
            const missed = log.status === 'missed';
            const notDetect = log.status === 'not_detect';
            const icon = missed || notDetect ? '⚠️' : '✅';
            const msg = missed
                ? 'Chưa uống thuốc (hết giờ, chưa đóng tủ)'
                : notDetect
                    ? 'Đã đóng tủ nhưng AI không xác nhận (10 phút)'
                    : 'Quy trình uống thuốc hoàn tất';
            const statusClass = missed || notDetect ? 'status-warn' : 'status-ok';

            return `
            <div class="history-item" style="margin-bottom:12px">
                <div class="history-status ${statusClass}">${icon}</div>
                <div class="history-info">
                  <div class="history-med">${msg}</div>
                  <div class="history-detail">📍 ${log.cabinet_name} • 🆔 #${log.id}</div>
                </div>
                <div class="history-time">${timeStr}<br><small style="color:var(--text-muted)">${dateStr}</small></div>
            </div>
            `;
        }).join('');
        
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#E74C3C">❌ Lỗi tải lịch sử</div>';
    }
}

// ===== SETTINGS TABS =====
function switchSettingsTab(tab, btn) {
  document.querySelectorAll('.stab').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.stab-content').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('stab-' + tab).classList.add('active');
}

// ===== SCHEDULE TAB =====
function renderScheduleTab() {
  const container = document.getElementById('drawer-schedule-list');
  if (!container) return;
  container.innerHTML = drawerConfig.map((d, i) => {
    const s = d.schedule;
    return `
    <div class="schedule-card">
      <div class="schedule-header" onclick="toggleSchedule(${i})">
        <div class="schedule-color-bar" style="background:${d.color}"></div>
        <div class="schedule-icon-wrap" style="background:${d.bg}">${d.icon}</div>
        <div class="schedule-info">
          <div class="schedule-name">${d.name}</div>
          <div class="schedule-sub" id="sched-sub-${i}">${drawers[i].meds.length} loại thuốc • ${s.days.length} ngày/tuần</div>
        </div>
        <div class="schedule-time-display" id="sched-time-display-${i}">${s.time}</div>
        <div class="schedule-chevron" id="sched-chev-${i}">›</div>
      </div>
      <div class="schedule-body" id="sched-body-${i}">
        <div class="time-slot-grid">
          <div class="time-slot-item">
            <div class="time-slot-label">Giờ mở ngăn</div>
            <input type="time" class="time-slot-input" id="sched-time-${i}" value="${s.time}" oninput="previewTime(${i})">
          </div>
          <div class="time-slot-item">
            <div class="time-slot-label">Nhắc trước (phút)</div>
            <input type="number" class="time-slot-input" id="sched-remind-${i}" value="${s.reminderBefore}" min="0" max="60">
          </div>
        </div>

        <div class="days-label">Các ngày trong tuần</div>
        <div class="days-row" id="days-row-${i}">
          ${dayNames.map((dn, di) => `
            <div class="day-chip ${s.days.includes(di)?'active':''}" onclick="toggleDay(${i},${di},this)">${dn}</div>
          `).join('')}
        </div>

        <button class="btn-save-schedule" onclick="saveSchedule(${i})">💾 Lưu lịch ngăn ${i+1}</button>
      </div>
    </div>
    `;
  }).join('');
}

function toggleSchedule(idx) {
  const body = document.getElementById(`sched-body-${idx}`);
  const chev = document.getElementById(`sched-chev-${idx}`);
  const isOpen = body.classList.contains('open');
  document.querySelectorAll('.schedule-body').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.schedule-chevron').forEach(c => c.classList.remove('open'));
  if (!isOpen) { body.classList.add('open'); chev.classList.add('open'); }
}

function previewTime(idx) {
  const val = document.getElementById(`sched-time-${idx}`).value;
  document.getElementById(`sched-time-display-${idx}`).textContent = val || '--:--';
}

function toggleDay(drawerIdx, dayIdx, el) {
  const days = drawerConfig[drawerIdx].schedule.days;
  const pos = days.indexOf(dayIdx);
  if (pos > -1) { days.splice(pos, 1); el.classList.remove('active'); }
  else { days.push(dayIdx); el.classList.add('active'); }
}

async function saveSchedule(idx) {
  const time = document.getElementById(`sched-time-${idx}`).value;
  const remind = parseInt(document.getElementById(`sched-remind-${idx}`).value) || 5;
  
  const scheduleData = {
    index: idx,
    time: time || drawerConfig[idx].schedule.time,
    reminderBefore: remind,
    days: drawerConfig[idx].schedule.days,
    cabinet_ip: getActiveCabinetIP()   // ← truyền IP tủ để backend lưu đúng
  };

  try {
    const res = await fetch('/api/drawers/save_schedule', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(scheduleData)
    });
    if ((await res.json()).status === 'ok') {
        drawerConfig[idx].schedule.time = scheduleData.time;
        drawerConfig[idx].schedule.reminderBefore = scheduleData.reminderBefore;
        document.getElementById(`sched-time-display-${idx}`).textContent = drawerConfig[idx].schedule.time;
        document.getElementById(`sched-sub-${idx}`).textContent = `${drawers[idx].meds.length} loại thuốc • ${drawerConfig[idx].schedule.days.length} ngày/tuần`;
        showToast(`✅ Đã lưu lịch ${drawerConfig[idx].name} vào database`);
    }
  } catch (e) {
    showToast(`❌ Lỗi lưu lịch`);
  }
}

// ===== MEDICINE TAB =====
function switchDrawerTab(idx, btn) {
  currentDrawerTab = idx;
  document.querySelectorAll('.dtab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderMedTab(idx);
}

function renderMedTab(idx) {
  const meds = drawers[idx].meds;
  const d = drawerConfig[idx];
  const container = document.getElementById('med-list-container');
  if (!container) return;

  container.innerHTML = `
    <div class="med-mgmt-toolbar">
      <div class="med-mgmt-title">
        ${meds.length} loại thuốc trong ${d.name}
      </div>
      <button class="btn-add-med" onclick="openMedForm(${idx}, -1)">➕ Thêm thuốc</button>
    </div>
    ${meds.length === 0
      ? `<div style="text-align:center;padding:40px;color:var(--text-muted);background:white;border-radius:16px;border:2px dashed #E0E0E0">
           <div style="font-size:36px;margin-bottom:12px">💊</div>
           <div style="font-weight:600">Ngăn này chưa có thuốc</div>
           <div style="font-size:13px;margin-top:4px">Nhấn "Thêm thuốc" để bắt đầu</div>
         </div>`
      : meds.map((m, mi) => `
        <div class="med-mgmt-item">
          <div class="med-mgmt-avatar" style="background:${d.bg}">${m.icon}</div>
          <div class="med-mgmt-info">
            <div class="med-mgmt-name">${m.name}</div>
            <div class="med-mgmt-meta">
              <span>⏰ ${d.schedule.time}</span>
              <span>💊 ${m.dose}</span>
            </div>
            ${m.note ? `<div style="font-size:11px;color:#E67E22;margin-top:4px;font-style:italic">📝 ${m.note}</div>` : ''}
          </div>
          <div class="med-mgmt-actions">
            <button class="btn-edit-med" onclick="openMedForm(${idx}, ${mi})" title="Chỉnh sửa">✏️</button>
            <button class="btn-del-med" onclick="deleteMed(${idx}, ${mi})" title="Xóa">🗑️</button>
          </div>
        </div>
      `).join('')
    }
  `;
}

// ===== MEDICINE FORM =====
function openMedForm(drawerIdx, medIdx) {
  const overlay = document.getElementById('med-form-overlay');
  const titleEl = document.getElementById('med-form-title');

  document.getElementById('edit-drawer-idx').value = drawerIdx;
  document.getElementById('edit-med-idx').value = medIdx;
  document.getElementById('f-drawer').value = drawerIdx;

  const drawerTime = drawerConfig[drawerIdx].schedule.time;
  const timeInput = document.getElementById('f-time');
  timeInput.value = drawerTime;
  timeInput.disabled = true;

  document.getElementById('f-time-hint').textContent = `⏰ Giờ uống của ngăn ${drawerIdx + 1}: ${drawerTime}`;

  if (medIdx === -1) {
    titleEl.textContent = '➕ Thêm thuốc mới';
    document.getElementById('f-name').value = '';
    document.getElementById('f-dose').value = '';
    document.getElementById('f-note').value = '';
  } else {
    titleEl.textContent = '✏️ Chỉnh sửa thuốc';
    const m = drawers[drawerIdx].meds[medIdx];
    document.getElementById('f-name').value = m.name;
    document.getElementById('f-dose').value = m.dose;
    document.getElementById('f-note').value = m.note;
  }

  overlay.classList.add('open');
}

function updateMedFormTime() {
  const drawerIdx = parseInt(document.getElementById('f-drawer').value);
  const drawerTime = drawerConfig[drawerIdx].schedule.time;
  document.getElementById('f-time').value = drawerTime;
  document.getElementById('f-time-hint').textContent = `⏰ Giờ uống của ngăn ${drawerIdx + 1}: ${drawerTime}`;
}

function closeMedForm(e) {
  if (e.target === document.getElementById('med-form-overlay')) {
    document.getElementById('med-form-overlay').classList.remove('open');
  }
}

async function saveMedicine() {
  const drawerIdx = parseInt(document.getElementById('edit-drawer-idx').value);
  const medIdx = parseInt(document.getElementById('edit-med-idx').value);
  const targetDrawer = parseInt(document.getElementById('f-drawer').value);

  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Vui lòng nhập tên thuốc!'); return; }

  const med = {
    name,
    dose: document.getElementById('f-dose').value.trim() || '1 liều',
    note: document.getElementById('f-note').value.trim(),
    icon: medIcons[Math.floor(Math.random() * medIcons.length)],
  };

  if (medIdx !== -1) {
      med.icon = drawers[drawerIdx].meds[medIdx].icon;
  }

  try {
    const res = await fetch('/api/meds/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            drawer_idx: drawerIdx,
            med_idx: medIdx,
            med: med,
            new_drawer_idx: targetDrawer,
            cabinet_ip: getActiveCabinetIP()   // ← lưu đúng tủ theo IP
        })
    });
    
    if ((await res.json()).status === 'ok') {
        showToast(`✅ Đã lưu thuốc vào database`);
        await loadServerData(); // Reload all data to keep sync
        document.getElementById('med-form-overlay').classList.remove('open');
        renderMedTab(currentDrawerTab);
        updateDrawerTabButtons();
    }
  } catch (e) {
    showToast(`❌ Lỗi lưu thuốc`);
  }
}

async function deleteMed(drawerIdx, medIdx) {
  const m = drawers[drawerIdx].meds[medIdx];
  if (!confirm(`Xóa "${m.name}" khỏi ${drawerConfig[drawerIdx].name}?`)) return;

  try {
    const res = await fetch('/api/meds/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            drawer_idx: drawerIdx,
            med_idx: medIdx,
            cabinet_ip: getActiveCabinetIP()   // ← xóa đúng tủ theo IP
        })
    });
    if ((await res.json()).status === 'ok') {
        showToast(`🗑️ Đã xóa thuốc khỏi database`);
        await loadServerData();
        renderMedTab(drawerIdx);
    }
  } catch (e) {
    showToast(`❌ Lỗi xóa thuốc`);
  }
}

function updateDrawerTabButtons() {
  document.querySelectorAll('.dtab').forEach((btn, i) => {
    btn.classList.toggle('active', i === currentDrawerTab);
  });
}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ===== RESET OU (mo/tat tat ca ngan, ve idle khi tat) =====
async function toggleOuReset() {
    try {
        const res = await fetch('/api/reset_ou', { method: 'POST' });
        const data = await res.json();
        const btn = document.getElementById('btn-reset-ou');
        if (data.status === 'ok') {
            if (data.ou_all_on) {
                if (btn) btn.textContent = '⏹ Đóng tất cả ngăn (OU)';
                showToast('📂 Đã mở tất cả ngăn — bấm lại để đóng');
            } else {
                if (btn) btn.textContent = '📂 Mở tất cả ngăn (OU)';
                showToast('✅ Đã đóng ngăn — tủ về trạng thái ban đầu');
            }
            pollHardwareStatus();
        } else {
            showToast('❌ ' + (data.message || 'Lỗi reset OU'));
        }
    } catch (e) {
        showToast('❌ Không kết nối được ESP32');
    }
}

// ===== HARDWARE SYNC =====
async function triggerHardwareDrawer(idx) {
    try {
        console.log(`[HARDWARE] Đang kích hoạt ngăn ${idx + 1}...`);
        const response = await fetch(`/api/trigger_drawer/${idx}`);
        const result = await response.json();
        if (result.status === 'ok') {
            showToast(`🚀 Đã mở ngăn ${idx + 1}!`);
        }
    } catch (e) {
        console.error("[HARDWARE] Lỗi kích hoạt ngăn:", e);
    }
}

// ===== SCHEDULER (Kích hoạt phần cứng đúng giờ) =====
function runScheduler() {
  const now = new Date();
  const currentHHMM = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
  const currentDay = now.getDay();

  drawerConfig.forEach((d, i) => {
    const s = d.schedule;
    if (s.time === currentHHMM && s.days.includes(currentDay)) {
        const key = `${i}-${currentHHMM}`;
        if (!lastTriggered[key]) {
            triggerHardwareDrawer(i);
            lastTriggered[key] = true;
            if (Object.keys(lastTriggered).length > 10) lastTriggered = { [key]: true };
        }
    }
  });
}

setInterval(runScheduler, 1000);
runScheduler();
