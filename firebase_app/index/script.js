const firebaseConfig = {
    apiKey: "AIzaSyB_qWzaD4W1ZP_MpFzSLy5mmlX41Nl7gT8",
    authDomain: "medicinebox-43681.firebaseapp.com",
    databaseURL: "https://medicinebox-43681-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "medicinebox-43681",
    storageBucket: "medicinebox-43681.firebasestorage.app",
    messagingSenderId: "185107920565",
    appId: "1:185107920565:web:711c9369891fb26fc0b0fc",
    measurementId: "G-1676D81RBS"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

let currentSchedule = {};
let notificationInterval;
let nextDoseInterval;
let recentNotifications = [];

document.addEventListener('DOMContentLoaded', function() {
    loadSchedule();
    loadHistory();
    loadMissedDetections();
    loadStatistics();
    startNotificationCheck();
    startNextDoseTicker();
    
    document.getElementById('historyDate').value = new Date().toISOString().split('T')[0];
    
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    const themeToggle = document.getElementById('themeToggle');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const savedTheme = localStorage.getItem('theme') || preferred;
    applyTheme(savedTheme);
    if (themeToggle) themeToggle.checked = savedTheme === 'dark';
    updateThemeToggleIcon(savedTheme);
    if (themeToggle) themeToggle.addEventListener('change', () => {
        const theme = themeToggle.checked ? 'dark' : 'light';
        applyTheme(theme);
        localStorage.setItem('theme', theme);
        updateThemeToggleIcon(theme);
    });
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || savedTheme;
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            localStorage.setItem('theme', next);
            updateThemeToggleIcon(next);
        });
    }
});

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Update meta theme-color for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#ffffff');
    }
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme === 'light');
}

function updateThemeToggleIcon(theme) {
    const label = document.querySelector('label[for="themeToggle"] i');
    const btnIcon = document.querySelector('#themeToggleBtn i');
    const targets = [label, btnIcon].filter(Boolean);
    if (targets.length === 0) return;
    targets.forEach(el => {
        el.classList.remove('bi-moon-stars', 'bi-sun');
        el.classList.add(theme === 'dark' ? 'bi-moon-stars' : 'bi-sun');
    });
}

// Live update for Next Dose banner
function startNextDoseTicker() {
    if (nextDoseInterval) clearInterval(nextDoseInterval);
    nextDoseInterval = setInterval(() => {
        try { renderNextDoseBanner(currentSchedule); } catch (e) { /* noop */ }
    }, 60000);
}

// Debug disabled

// Load medicine schedule from Firebase Realtime Database
async function loadSchedule() {
    try {
        showLoading('scheduleContainer');
        
        const scheduleRef = database.ref('medicine_schedule');
        scheduleRef.on('value', (snapshot) => {
            const container = document.getElementById('scheduleContainer');
            
            if (!snapshot.exists()) {
                container.innerHTML = '<div class="alert alert-info alert-custom"><i class="bi bi-info-circle"></i> No schedule has been set. Go to the Settings tab to set up a schedule.</div>';
                return;
            }

            const data = snapshot.val();
            currentSchedule = data;
            
            // Update settings form
            updateSettingsForm(data);
            
            // Display schedule
            displaySchedule(data);
        });
    } catch (error) {
        console.error('Error loading schedule:', error);
        showNotification('Error loading schedule: ' + error.message, 'error');
    }
}

// Display schedule in UI
function displaySchedule(schedule) {
    const container = document.getElementById('scheduleContainer');
    const timeSlots = ['Morning', 'Noon', 'Afternoon', 'Evening'];
    const timeLabels = {
        'Morning': 'Morning',
        'Noon': 'Noon', 
        'Afternoon': 'Afternoon',
        'Evening': 'Evening'
    };
    const timeIcons = {
        'Morning': 'bi-sunrise',
        'Noon': 'bi-sun',
        'Afternoon': 'bi-brightness-high',
        'Evening': 'bi-moon'
    };

    // Build Next Dose banner
    try { renderNextDoseBanner(schedule); } catch (e) { console.warn('Banner render error', e); }

    let html = '';
    timeSlots.forEach(slot => {
        if (schedule[slot] && schedule[slot].enabled) {
            const time = schedule[slot].time;
            const status = getTimeSlotStatus(slot, time);
            
            html += `
                <div class="time-slot enabled fade-in ${status.text === 'Time to take' ? 'medicine-reminder' : ''}">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6><i class="bi ${timeIcons[slot]}"></i> ${timeLabels[slot]}</h6>
                            <p class="mb-0">Time: <strong>${time}</strong></p>
                            <small class="text-muted">Enabled</small>
                        </div>
                        <div class="text-end">
                            <span class="status-badge ${status.class}">${status.text}</span>
                        </div>
                    </div>
                </div>
            `;
        }
    });

    if (html === '') {
        html = '<div class="empty-state"><i class="bi bi-inboxes"></i> No enabled time slots. Go to the Settings tab to enable slots.</div>';
        // Also clear banner if nothing enabled
        const banner = document.getElementById('nextDoseBanner');
        if (banner) banner.innerHTML = '';
    }

    container.innerHTML = html;
}

// Next Dose banner
function renderNextDoseBanner(schedule) {
    const banner = document.getElementById('nextDoseBanner');
    if (!banner) return;

    const now = new Date();
    let next = null;
    let nextSlot = null;
    
    Object.entries(schedule).forEach(([slot, cfg]) => {
        if (!cfg || !cfg.enabled) return;
        const [h, m] = (cfg.time || '00:00').split(':').map(Number);
        const slotDate = new Date(now);
        slotDate.setHours(h, m, 0, 0);
        if (slotDate < now) {
            slotDate.setDate(slotDate.getDate() + 1); // next day
        }
        if (!next || slotDate < next) {
            next = slotDate;
            nextSlot = slot;
        }
    });

    if (!next) {
        banner.innerHTML = '';
        return;
    }

    const timeStr = next.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dayStr = next.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: '2-digit' });
    const label = getTimeSlotLabel(nextSlot);
    const diffMin = Math.max(1, Math.round((next - now) / 60000));

    banner.innerHTML = `
        <div class="banner">
            <i class="bi bi-capsule pill"></i>
            <div>
                <div>Next dose: <span class="time">${timeStr}</span> (${dayStr})</div>
                <small class="text-muted">Slot: ${label} • About ${diffMin} min left</small>
            </div>
            
        </div>
    `;
}

// Get time slot status
function getTimeSlotStatus(slot, time) {
    const now = new Date();
    const [hour, minute] = time.split(':').map(Number);
    const slotTime = hour * 60 + minute;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (currentMinutes < slotTime - 15) {
        return { class: 'pending', text: 'Not yet' };
    } else if (currentMinutes >= slotTime - 15 && currentMinutes <= slotTime + 15) {
        return { class: 'pending', text: 'Time to take' };
    } else {
        return { class: 'missed', text: 'Missed' };
    }
}

// View-only mode: disabled write operations

// Load medicine history
async function loadHistory() {
    try {
        showLoading('historyContainer');
        
        const historyRef = database.ref('medicine_detections');
        historyRef.orderByKey().on('value', (snapshot) => {
            const container = document.getElementById('historyContainer');
            
            if (!snapshot.exists()) {
                container.innerHTML = '<div class="alert alert-info alert-custom"><i class="bi bi-info-circle"></i> No medicine history.</div>';
                return;
            }

            const data = snapshot.val();
            const entries = Object.entries(data)
                .map(([key, entry]) => {
                    return { key, ...entry };
                })
                .sort((a, b) => b.key.localeCompare(a.key)) // Sort by key (timestamp) desc
                .slice(0, 20); // Limit to 20 most recent
            
            let html = '';
            entries.forEach((entry) => {
                try {
                    // Parse timestamp from key: "2025-09-06_00:07:52"
                    const timestampStr = entry.key.replace('_', 'T');
                    const date = new Date(timestampStr);
                    
                    // Validate date
                    if (isNaN(date.getTime())) {
                        console.warn('Invalid timestamp from key:', entry.key);
                        return;
                    }

                    // Determine time slot based on scheduled_time
                    let timeSlot = 'Unknown';
                    if (entry.scheduled_time) {
                        const hour = parseInt(entry.scheduled_time.split(':')[0]);
                        if (hour >= 5 && hour < 11) timeSlot = 'Morning';
                        else if (hour >= 11 && hour < 14) timeSlot = 'Noon';
                        else if (hour >= 14 && hour < 18) timeSlot = 'Afternoon';
                        else timeSlot = 'Evening';
                    }

                    // Generate image gallery if multiple images
                    let imageGallery = '';
                    if (entry.image_urls) {
                        const images = Object.values(entry.image_urls);
                        if (images.length > 0) {
                            imageGallery = `
                                <div class="image-gallery">
                                    ${images.map((url, idx) => `
                                        <img src="${url}" 
                                             class="detection-image" 
                                             alt="Detection ${idx + 1}" 
                                             onerror="this.style.display='none'"
                                             title="Detection ${idx + 1} - Click để phóng to"
                                             onclick="showImageModal('${url}', 'Detection ${idx + 1}', '${entry.key}')">
                                    `).join('')}

                                </div>
                            `;
                        }
                    }

                    // Calculate session duration
                    let durationText = '';
                    if (entry.total_duration) {
                        const duration = Math.round(entry.total_duration);
                        durationText = `<br><i class="bi bi-stopwatch"></i> Duration: ${duration}s`;
                    }

                    // Detection count info
                    let detectionInfo = '';
                    if (entry.detection_count) {
                        detectionInfo = `<br><i class="bi bi-camera"></i> Detection count: ${entry.detection_count}`;
                    }
                    
                    html += `
                        <div class="history-item fade-in">
                            <div class="d-flex justify-content-between align-items-start gap-3">
                                <div class="flex-grow-1">
                                    <h6><i class="bi bi-check-circle-fill text-success"></i> ${entry.event === 'medicine_taken_complete' ? 'Medicine taken complete' : 'Medicine taken'}</h6>
                                    <p class="mb-1">Scheduled time: <strong>${entry.scheduled_time || 'N/A'}</strong></p>
                                    <p class="mb-1">Slot: <strong>${getTimeSlotLabel(timeSlot)}</strong></p>
                                    ${entry.completion_time ? `<p class="mb-1">Completed at: <strong>${new Date(entry.completion_time).toLocaleTimeString('en-US')}</strong></p>` : ''}
                                    <small class="text-muted">
                                        <i class="bi bi-calendar"></i> ${formatDateTime(date)}
                                        ${durationText}
                                        ${detectionInfo}
                                        <br><i class="bi bi-hash"></i> ID: ${entry.key}
                                    </small>
                                </div>
                                <div class="d-flex flex-column align-items-end gap-2">
                                    <span class="badge bg-success">${entry.status || 'completed'}</span>
                                    ${imageGallery}
                                </div>
                            </div>
                        </div>
                    `;
                } catch (error) {
                    console.error('Error processing entry:', entry, error);
                }
            });
            
            if (html === '') {
                container.innerHTML = '<div class="alert alert-warning alert-custom"><i class="bi bi-exclamation-triangle"></i> Cannot display history data.</div>';
            } else {
                container.innerHTML = html;
            }
        });
    } catch (error) {
        console.error('Error loading history:', error);
        showNotification('Error loading history: ' + error.message, 'error');
    }
}

// Load history by specific date
async function loadHistoryByDate() {
    const selectedDate = document.getElementById('historyDate').value;
    if (!selectedDate) {
        showNotification('Please select a date', 'warning');
        return;
    }

    try {
        showLoading('historyContainer');
        
        const historyRef = database.ref('medicine_detections');
        historyRef.once('value', (snapshot) => {
            const container = document.getElementById('historyContainer');
            
            if (!snapshot.exists()) {
                container.innerHTML = '<div class="alert alert-info alert-custom"><i class="bi bi-info-circle"></i> No data for selected date.</div>';
                return;
            }

            const data = snapshot.val();
            const entries = Object.entries(data)
                .map(([key, entry]) => {
                    return { key, ...entry };
                })
                .filter(entry => {
                    try {
                        // Extract date from key: "2025-09-06_00:07:52"
                        const dateStr = entry.key.split('_')[0]; // Get "2025-09-06"
                        return dateStr === selectedDate;
                    } catch (error) {
                        console.error('Error parsing date from key:', entry.key, error);
                        return false;
                    }
                })
                .sort((a, b) => b.key.localeCompare(a.key));
            
            let html = '';
            entries.forEach(entry => {
                try {
                    const timestampStr = entry.key.replace('_', 'T');
                    const date = new Date(timestampStr);
                    
                    // Determine time slot based on scheduled_time
                    let timeSlot = 'Unknown';
                    if (entry.scheduled_time) {
                        const hour = parseInt(entry.scheduled_time.split(':')[0]);
                        if (hour >= 5 && hour < 11) timeSlot = 'Morning';
                        else if (hour >= 11 && hour < 14) timeSlot = 'Noon';
                        else if (hour >= 14 && hour < 18) timeSlot = 'Afternoon';
                        else timeSlot = 'Evening';
                    }

                    // Generate image gallery if multiple images
                    let imageGallery = '';
                    if (entry.image_urls) {
                        const images = Object.values(entry.image_urls);
                        if (images.length > 0) {
                            imageGallery = `
                                <div class="image-gallery">
                                    ${images.map((url, idx) => `
                                        <img src="${url}" 
                                             class="detection-image" 
                                             alt="Detection ${idx + 1}" 
                                             onerror="this.style.display='none'"
                                             title="Detection ${idx + 1} - Click để phóng to"
                                             onclick="showImageModal('${url}', 'Detection ${idx + 1}', '${entry.key}')">
                                    `).join('')}

                                </div>
                            `;
                        }
                    }

                    // Calculate session duration
                    let durationText = '';
                    if (entry.total_duration) {
                        const duration = Math.round(entry.total_duration);
                        durationText = `<br><i class="bi bi-stopwatch"></i> Duration: ${duration}s`;
                    }

                    // Detection count info
                    let detectionInfo = '';
                    if (entry.detection_count) {
                        detectionInfo = `<br><i class="bi bi-camera"></i> Detection count: ${entry.detection_count}`;
                    }
                    
                    html += `
                        <div class="history-item fade-in">
                            <div class="d-flex justify-content-between align-items-start gap-3">
                                <div class="flex-grow-1">
                                    <h6><i class="bi bi-check-circle-fill text-success"></i> ${entry.event === 'medicine_taken_complete' ? 'Medicine taken complete' : 'Medicine taken'}</h6>
                                    <p class="mb-1">Scheduled time: <strong>${entry.scheduled_time || 'N/A'}</strong></p>
                                    <p class="mb-1">Slot: <strong>${getTimeSlotLabel(timeSlot)}</strong></p>
                                    ${entry.completion_time ? `<p class="mb-1">Completed at: <strong>${new Date(entry.completion_time).toLocaleTimeString('en-US')}</strong></p>` : ''}
                                    <small class="text-muted">
                                        <i class="bi bi-calendar"></i> ${formatDateTime(date)}
                                        ${durationText}
                                        ${detectionInfo}
                                        <br><i class="bi bi-hash"></i> ID: ${entry.key}
                                    </small>
                                </div>
                                <div class="d-flex flex-column align-items-end gap-2">
                                    <span class="badge bg-success">${entry.status || 'completed'}</span>
                                    ${imageGallery}
                                </div>
                            </div>
                        </div>
                    `;
                } catch (error) {
                    console.error('Error processing entry:', entry, error);
                }
            });
            
            if (html === '') {
                container.innerHTML = '<div class="alert alert-info alert-custom"><i class="bi bi-info-circle"></i> No data for selected date.</div>';
            } else {
                container.innerHTML = html;
            }
        });
    } catch (error) {
        console.error('Error loading history by date:', error);
        showNotification('Error loading history: ' + error.message, 'error');
    }
}

// Load missed detections
async function loadMissedDetections() {
    try {
        showLoading('missedContainer');
        
        const missedRef = database.ref('missed_detections');
        missedRef.orderByKey().limitToLast(20).on('value', (snapshot) => {
            const container = document.getElementById('missedContainer');
            
            if (!snapshot.exists()) {
                container.innerHTML = '<div class="alert alert-success alert-custom"><i class="bi bi-check-circle"></i> No missed doses recorded. Great!</div>';
                return;
            }

            const data = snapshot.val();
            const entries = Object.entries(data)
                .map(([key, entry]) => ({ key, ...entry }))
                .sort((a, b) => {
                    // Sort by date, then by missed_at time
                    const dateA = a.date || '0000-00-00';
                    const dateB = b.date || '0000-00-00';
                    if (dateA !== dateB) {
                        return dateB.localeCompare(dateA); // Newest first
                    }
                    const timeA = a.missed_at || '00:00:00';
                    const timeB = b.missed_at || '00:00:00';
                    return timeB.localeCompare(timeA); // Latest time first
                });
            
            let html = '';
            entries.forEach((entry) => {
                try {
                    // Create date object from date and missed_at
                    const dateStr = entry.date || '2025-01-01';
                    const timeStr = entry.missed_at || '00:00:00';
                    const dateTime = new Date(`${dateStr}T${timeStr}`);
                    
                    // Validate date
                    if (isNaN(dateTime.getTime())) {
                        console.warn('Invalid date/time:', entry.date, entry.missed_at);
                        return;
                    }
                    
                    html += `
                        <div class="missed-item fade-in">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <h6><i class="bi bi-exclamation-triangle-fill text-danger"></i> Missed dose</h6>
                                    <p class="mb-1">Scheduled time: <strong>${entry.scheduled_time || 'N/A'}</strong></p>
                                    <p class="mb-1">Missed at: <strong>${entry.missed_at || 'N/A'}</strong></p>
                                    <small class="text-muted">
                                        <i class="bi bi-calendar"></i> ${formatDateTime(dateTime)}
                                        <br><i class="bi bi-hash"></i> ID: ${entry.key}
                                    </small>
                                </div>
                                <span class="badge bg-danger">${entry.status || 'missed'}</span>
                            </div>
                        </div>
                    `;
                } catch (error) {
                    console.error('Error processing missed entry:', entry, error);
                }
            });
            
            if (html === '') {
                container.innerHTML = '<div class="alert alert-warning alert-custom"><i class="bi bi-exclamation-triangle"></i> Cannot display missed data.</div>';
            } else {
                container.innerHTML = html;
            }
        });
    } catch (error) {
        console.error('Error loading missed detections:', error);
        showNotification('Error loading missed data: ' + error.message, 'error');
    }
}

// Update settings form with current schedule
function updateSettingsForm(schedule) {
    const timeSlots = ['Morning', 'Noon', 'Afternoon', 'Evening'];
    const formIds = ['morning', 'noon', 'afternoon', 'evening'];

    timeSlots.forEach((slot, index) => {
        if (schedule[slot]) {
            document.getElementById(formIds[index] + 'Enabled').checked = schedule[slot].enabled;
            document.getElementById(formIds[index] + 'Time').value = schedule[slot].time;
            // Update badge visibility
            const on = document.getElementById(formIds[index] + 'StatusOn');
            const off = document.getElementById(formIds[index] + 'StatusOff');
            if (on && off) {
                if (schedule[slot].enabled) {
                    on.classList.remove('d-none');
                    off.classList.add('d-none');
                } else {
                    off.classList.remove('d-none');
                    on.classList.add('d-none');
                }
            }
        }
    });
}

// Save schedule settings
// Enable saving schedule settings
document.getElementById('scheduleForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    try {
        const scheduleData = {
            Morning: {
                enabled: document.getElementById('morningEnabled').checked,
                time: document.getElementById('morningTime').value
            },
            Noon: {
                enabled: document.getElementById('noonEnabled').checked,
                time: document.getElementById('noonTime').value
            },
            Afternoon: {
                enabled: document.getElementById('afternoonEnabled').checked,
                time: document.getElementById('afternoonTime').value
            },
            Evening: {
                enabled: document.getElementById('eveningEnabled').checked,
                time: document.getElementById('eveningTime').value
            }
        };

        // Update schedule in Realtime Database
        const scheduleRef = database.ref('medicine_schedule');
        await scheduleRef.set(scheduleData);
        
        currentSchedule = scheduleData;
        updateSettingsForm(currentSchedule);
        showNotification('💾 Schedule settings saved!', 'success');
    } catch (error) {
        console.error('Error saving schedule:', error);
        showNotification('❌ Error saving settings: ' + error.message, 'error');
    }
});

// Load statistics
async function loadStatistics() {
    try {
        // Get detections count
        const detectionsRef = database.ref('medicine_detections');
        const missedRef = database.ref('missed_detections');
        
        Promise.all([
            detectionsRef.once('value'),
            missedRef.once('value')
        ]).then(([detectionsSnapshot, missedSnapshot]) => {
            // Count successful detections
            let totalTaken = 0;
            if (detectionsSnapshot.exists()) {
                const detections = detectionsSnapshot.val();
                totalTaken = Object.values(detections).filter(detection => 
                    detection.status === 'completed' || detection.event === 'medicine_taken_complete'
                ).length;
            }
            
            // Count missed detections
            let totalMissed = 0;
            if (missedSnapshot.exists()) {
                const missed = missedSnapshot.val();
                totalMissed = Object.values(missed).filter(miss => 
                    miss.status === 'missed'
                ).length;
            }
            
            const total = totalTaken + totalMissed;
            const compliance = total > 0 ? Math.round((totalTaken / total) * 100) : 100;

            // Get today's statistics
            const today = new Date().toISOString().split('T')[0];
            let todayTaken = 0;
            let todayMissed = 0;
            
            if (detectionsSnapshot.exists()) {
                const detections = detectionsSnapshot.val();
                todayTaken = Object.keys(detections).filter(key => {
                    const dateStr = key.split('_')[0]; // Extract date from key like "2025-09-06_00:07:52"
                    const detection = detections[key];
                    return dateStr === today && (detection.status === 'completed' || detection.event === 'medicine_taken_complete');
                }).length;
            }
            
            if (missedSnapshot.exists()) {
                const missed = missedSnapshot.val();
                todayMissed = Object.values(missed).filter(miss => {
                    return miss.date === today && miss.status === 'missed';
                }).length;
            }

            const statisticsContainer = document.getElementById('statisticsContainer');
            statisticsContainer.innerHTML = `
                <div class="statistics-card card">
                    <div class="card-body">
                        <div class="compliance-meter" style="--compliance: ${compliance}%;">
                            <div class="compliance-text">${compliance}%</div>
                        </div>
                        <div class="text-muted mb-3">Overall compliance</div>
                        <div class="stats-grid">
                            <div class="stat-tile">
                                <div class="stat-label text-muted">Total</div>
                                <div class="stat-value">${total}</div>
                            </div>
                            <div class="stat-tile">
                                <div class="stat-label text-success">Taken</div>
                                <div class="stat-value text-success">${totalTaken}</div>
                            </div>
                            <div class="stat-tile">
                                <div class="stat-label text-danger">Missed</div>
                                <div class="stat-value text-danger">${totalMissed}</div>
                            </div>
                        </div>
                        <hr class="my-3">
                        <div class="text-muted mb-2"><i class="bi bi-calendar-day"></i> Today</div>
                        <div class="stats-grid">
                            <div class="stat-tile">
                                <div class="stat-label text-success">Taken</div>
                                <div class="stat-value text-success">${todayTaken}</div>
                            </div>
                            <div class="stat-tile">
                                <div class="stat-label text-danger">Missed</div>
                                <div class="stat-value text-danger">${todayMissed}</div>
                            </div>
                            <div class="stat-tile">
                                <div class="stat-label text-muted">Total</div>
                                <div class="stat-value">${todayTaken + todayMissed}</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

// Start notification check
function startNotificationCheck() {
    // Check every minute
    notificationInterval = setInterval(checkForNotifications, 5000);
    checkForNotifications(); // Check immediately
}

// Check for notifications
function checkForNotifications() {
    if (!document.getElementById('enableNotifications').checked) return;

    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    Object.keys(currentSchedule).forEach(slot => {
        const schedule = currentSchedule[slot];
        if (schedule && schedule.enabled && schedule.time === currentTime) {
            showMedicineNotification(slot);
            addNotificationItem(`Time to take medicine ${getTimeSlotLabel(slot)} (${schedule.time})`, 'now');
        }
        // Pre-alert 15 minutes before
        if (schedule && schedule.enabled) {
            const [h, m] = schedule.time.split(':').map(Number);
            const slotMinutes = h * 60 + m;
            if (currentMinutes === slotMinutes - 15) {
                addNotificationItem(`Almost time to take medicine ${getTimeSlotLabel(slot)} (${schedule.time})`, 'soon');
                showNotification(`⏰ Almost time to take medicine ${getTimeSlotLabel(slot)} (${schedule.time})`, 'warning', 8000);
            }
        }
    });
}

// Show medicine notification
function showMedicineNotification(timeSlot) {
    const timeLabels = {
        'Morning': 'Morning',
        'Noon': 'Noon',
        'Afternoon': 'Afternoon', 
        'Evening': 'Evening'
    };

    const message = `🔔 Time to take medicine ${timeLabels[timeSlot]}! (${currentSchedule[timeSlot].time})`;
    showNotification(message, 'warning', 10000);
    
    // Browser notification
    if (Notification.permission === 'granted') {
        new Notification('Medicine Reminder', {
            body: message,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCA5TDEzLjA5IDE1Ljc0TDEyIDIyTDEwLjkxIDE1Ljc0TDQgOUwxMC45MSA4LjI2TDEyIDJaIiBmaWxsPSIjMjhhNzQ1Ii8+Cjwvc3ZnPgo='
        });
    }
    
    if (document.getElementById('enableSound').checked) {
        playNotificationSound();
    }
}

// Play notification sound
function playNotificationSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmkhBjqDz/DBaiMFl6To7YdJGAw=');
        audio.play().catch(e => console.log('Could not play sound:', e));
    } catch (error) {
        console.log('Sound playback error:', error);
    }
}

// Show notification
function showNotification(message, type = 'info', duration = 5000) {
    const notificationArea = document.getElementById('notificationArea');
    const alertClass = type === 'error' ? 'danger' : type;
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${alertClass} alert-dismissible fade show notification alert-custom`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    notificationArea.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, duration);
}

// Notification feed helpers
function addNotificationItem(text, kind = 'now') {
    recentNotifications.unshift({ text, kind, ts: new Date() });
    if (recentNotifications.length > 20) recentNotifications.pop();
    renderNotificationList();
}

function renderNotificationList() {
    const list = document.getElementById('notificationList');
    if (!list) return;
    if (recentNotifications.length === 0) {
        list.innerHTML = '<div class="text-muted small">No notifications yet</div>';
        return;
    }
    list.innerHTML = recentNotifications
        .map(n => `<div class="d-flex align-items-start gap-2 p-2 rounded ${n.kind === 'soon' ? 'bg-warning bg-opacity-10' : 'bg-success bg-opacity-10'}">
            <i class="bi ${n.kind === 'soon' ? 'bi-clock-history text-warning' : 'bi-check-circle text-success'}"></i>
            <div>
                <div class="small">${n.text}</div>
                <small class="text-muted">${formatTimeAgo(n.ts)}</small>
            </div>
        </div>`)
        .join('');
}

function formatTimeAgo(date) {
    const diff = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diff <= 0) return 'just now';
    if (diff < 60) return `${diff} minutes ago`;
    const hours = Math.floor(diff / 60);
    return `${hours} hours ago`;
}

// Check medicine now
function checkMedicineNow() {
    const now = new Date();
    
    // Find the closest enabled time slot
    let closestSlot = null;
    let minDiff = Infinity;
    
    Object.keys(currentSchedule).forEach(slot => {
        if (currentSchedule[slot] && currentSchedule[slot].enabled) {
            const [hour, minute] = currentSchedule[slot].time.split(':').map(Number);
            const slotMinutes = hour * 60 + minute;
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const diff = Math.abs(slotMinutes - currentMinutes);
            
            if (diff < minDiff) {
                minDiff = diff;
                closestSlot = slot;
            }
        }
    });
    
    if (!closestSlot) {
        showNotification('⚠️ No enabled schedule', 'warning');
    }
}

// Utility functions
function formatDateTime(date) {
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getTimeSlotLabel(slot) {
    const labels = {
        'Morning': 'Morning',
        'Noon': 'Noon',
        'Afternoon': 'Afternoon',
        'Evening': 'Evening'
    };
    return labels[slot] || slot;
}

function showLoading(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div class="loading">
            <i class="bi bi-arrow-clockwise text-primary"></i>
            <p class="mt-2 text-muted">Loading...</p>
        </div>
    `;
}

// Auto-save notification settings
document.getElementById('enableNotifications').addEventListener('change', function() {
    localStorage.setItem('enableNotifications', this.checked);
});

document.getElementById('enableSound').addEventListener('change', function() {
    localStorage.setItem('enableSound', this.checked);
});

// Load notification settings
document.addEventListener('DOMContentLoaded', function() {
    const enableNotifications = localStorage.getItem('enableNotifications');
    const enableSound = localStorage.getItem('enableSound');
    
    if (enableNotifications !== null) {
        document.getElementById('enableNotifications').checked = enableNotifications === 'true';
    }
    
    if (enableSound !== null) {
        document.getElementById('enableSound').checked = enableSound === 'true';
    }
});

// Image modal functions
function showImageModal(imageUrl, title, entryId) {
    // Create modal if not exists
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.className = 'image-modal';
        modal.innerHTML = `
            <div class="image-modal-backdrop" onclick="closeImageModal()"></div>
            <div class="image-modal-content">
                <div class="image-modal-header">
                    <h5 class="image-modal-title"></h5>
                    <button type="button" class="btn-close-modal" onclick="closeImageModal()">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="image-modal-body">
                    <img id="modalImage" src="" alt="" class="modal-image">
                </div>
                <div class="image-modal-footer">
                    <small class="text-muted" id="modalInfo"></small>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Update modal content
    document.querySelector('.image-modal-title').textContent = title;
    document.getElementById('modalImage').src = imageUrl;
    document.getElementById('modalImage').alt = title;
    document.getElementById('modalInfo').textContent = `Session ID: ${entryId}`;
    
    // Show modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Add keyboard listener
    document.addEventListener('keydown', handleModalKeydown);
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        document.removeEventListener('keydown', handleModalKeydown);
    }
}

function handleModalKeydown(e) {
    if (e.key === 'Escape') {
        closeImageModal();
    }
}
