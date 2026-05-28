
import cv2
import mediapipe as mp
import math
import time
import logging
from dataclasses import dataclass, field
from typing import Optional, Tuple, List, Dict, Any
from types import SimpleNamespace
import numpy as np


# ===================== CONFIGURATION =====================
@dataclass
class DetectionConfig:
    """Configuration for 2-step detection requirement"""
    # Core detection thresholds
    distance_threshold: float = 0.10       
    water_distance_threshold: float = 0.15  
    required_frames: int = 44             
    cooldown_time: float = 2.0
    session_timeout: float = 30

    # 2-STEP DETECTION
    required_detections: int = 2          
    detection_window: float = 15           
    between_detection_cooldown: float = 4.0

    # Resolution
    fps_target: int = 15

    # Palm center estimation
    palm_landmarks: Tuple[int, ...] = (0, 1, 5, 9, 13, 17)
    min_valid_palm_points: int = 4


# ===================== DETECTION EVENT =====================
@dataclass
class DetectionEvent:
    timestamp: float
    distance: float
    method: str
    hand_count: int = 1


# ===================== ENHANCED DETECTOR =====================
class EnhancedMedicineDetector:
    """2-step detection: Phase 1 (Take Pill) â†’ Phase 2 (Drink Water)"""

    def __init__(self, config: DetectionConfig):
        self.config = config
        self.logger = logging.getLogger("MedicineDetector")

        self.detection_count = 0
        self.last_detection_time = 0
        self.detection_events: List[DetectionEvent] = []
        self.detection_window_start: Optional[float] = None
        self.medicine_fully_taken = False
        self.current_detection_phase = 1

        self.last_mouth_position = None
        self.mouth_lost_frames = 0
        self.max_mouth_lost_frames = 8
        self.hand_near_face_threshold = 0.12
        self.distance_history: List[float] = []
        self.max_history = 3

    def reset(self):
        self.detection_count = 0
        self.last_detection_time = 0
        self.detection_events.clear()
        self.detection_window_start = None
        self.medicine_fully_taken = False
        self.current_detection_phase = 1
        self.distance_history.clear()
        self.last_mouth_position = None
        self.mouth_lost_frames = 0
        self.logger.info("Detector reset")

    def calc_distance(self, p1, p2) -> float:
        return math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)

    def estimate_hand_position(self, hand_landmarks):
        if not hand_landmarks:
            return None

        points = [
            hand_landmarks.landmark[i]
            for i in self.config.palm_landmarks
            if i < len(hand_landmarks.landmark)
        ]
        if len(points) < self.config.min_valid_palm_points:
            return None

        return SimpleNamespace(
            x=sum(p.x for p in points) / len(points),
            y=sum(p.y for p in points) / len(points),
            z=sum(p.z for p in points) / len(points),
        )

    def smooth_distance(self, distance: float) -> float:
        self.distance_history.append(distance)
        if len(self.distance_history) > self.max_history:
            self.distance_history.pop(0)
        return sorted(self.distance_history)[len(self.distance_history) // 2]

    def estimate_mouth_position(self, face_landmarks):
        if not face_landmarks:
            return None
        mouth_indices = [13, 14, 15, 16, 17]
        points = [face_landmarks.landmark[i] for i in mouth_indices if i < len(face_landmarks.landmark)]
        if not points:
            return None
        weights = [2, 1, 3, 1, 2][:len(points)]
        tw = sum(weights)
        return SimpleNamespace(
            x=sum(p.x * w for p, w in zip(points, weights)) / tw,
            y=sum(p.y * w for p, w in zip(points, weights)) / tw,
            z=sum(p.z * w for p, w in zip(points, weights)) / tw,
        )

    def get_current_threshold(self) -> float:
        if self.current_detection_phase == 2 or len(self.detection_events) >= 1:
            return self.config.water_distance_threshold
        return self.config.distance_threshold

    def check_window_timeout(self) -> bool:
        if not self.detection_window_start:
            return False
        if time.time() - self.detection_window_start > self.config.detection_window:
            self.logger.warning("Detection window expired â€” reset to phase 1")
            self.detection_events.clear()
            self.detection_window_start = None
            self.current_detection_phase = 1
            return True
        return False

    def get_phase_label(self, phase: int) -> str:
        return {1: "Take Pill", 2: "Drink Water"}.get(phase, f"PHASE {phase}")

    def get_progress(self) -> Tuple[int, int, str]:
        completed = len(self.detection_events)
        labels = {0: "Take Pill", 1: "Drink Water", 2: "HOÃ€N THÃ€NH!"}
        return completed, self.config.required_detections, labels.get(completed, "HOÃ€N THÃ€NH!")

    def get_time_remaining(self) -> float:
        if not self.detection_window_start:
            return 0
        return max(0, self.config.detection_window - (time.time() - self.detection_window_start))

    def process_detection(self, hand_results, mouth_point, face_landmarks) -> Tuple[int, Optional[float]]:
        """Core detection logic â€” returns (detection_count, distance)"""
        current_time = time.time()
        self.check_window_timeout()

        hand_count = len(hand_results.multi_hand_landmarks) if hand_results.multi_hand_landmarks else 0
        hand_center = None
        if hand_results.multi_hand_landmarks:
            hand_center = self.estimate_hand_position(hand_results.multi_hand_landmarks[0])

        estimated_mouth = self.estimate_mouth_position(face_landmarks) if face_landmarks else None
        target_mouth = mouth_point if mouth_point else estimated_mouth

        if target_mouth:
            self.last_mouth_position = target_mouth
            self.mouth_lost_frames = 0
        else:
            self.mouth_lost_frames += 1

        if not hand_center:
            return len(self.detection_events), None

        detection_occurred = False
        distance = None
        method = "none"
        threshold = self.get_current_threshold()

        if target_mouth:
            raw = self.calc_distance(hand_center, target_mouth)
            distance = self.smooth_distance(raw)
            if distance < threshold:
                detection_occurred = True
                method = "normal"
        elif self.last_mouth_position and self.mouth_lost_frames <= self.max_mouth_lost_frames:
            raw = self.calc_distance(hand_center, self.last_mouth_position)
            distance = self.smooth_distance(raw)
            if distance < threshold * 1.3:
                detection_occurred = True
                method = "backup"
        elif face_landmarks and len(face_landmarks.landmark) > 4:
            face_center = face_landmarks.landmark[4]
            dist = self.calc_distance(hand_center, face_center)
            if dist < self.hand_near_face_threshold and hand_center.y >= face_center.y - 0.03:
                detection_occurred = True
                distance = dist
                method = "emergency"

        if detection_occurred:
            self.detection_count += 1
            if self.detection_count >= self.config.required_frames:
                time_since_last = current_time - self.last_detection_time
                if time_since_last > self.config.between_detection_cooldown:
                    if not self.detection_window_start:
                        self.detection_window_start = current_time

                    event = DetectionEvent(
                        timestamp=current_time,
                        distance=distance if distance else 0.0,
                        method=method,
                        hand_count=hand_count
                    )
                    self.detection_events.append(event)
                    self.last_detection_time = current_time

                    if len(self.detection_events) >= self.config.required_detections:
                        self.medicine_fully_taken = True
                        self.logger.info("MEDICINE FULLY TAKEN! Both steps completed.")
                    else:
                        self.current_detection_phase += 1

                    self.detection_count = 0
        else:
            self.detection_count = max(0, self.detection_count - 1)

        return len(self.detection_events), distance


# ===================== FRAME PROCESSOR =====================
class MedicineFrameProcessor:
    """
    Nháº­n frame tá»« camera, cháº¡y MediaPipe, váº½ overlay, tráº£ vá» frame Ä‘Ã£ annotate
    vÃ  dict tráº¡ng thÃ¡i Ä‘á»ƒ stream vá» browser.
    """

    def __init__(self, config: DetectionConfig = None):
        self.config = config or DetectionConfig()
        self.detector = EnhancedMedicineDetector(self.config)

        # MediaPipe
        self.mp_hands = mp.solutions.hands
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles

        # Persistent MediaPipe instances (reuse to avoid overhead)
        self.hands = self.mp_hands.Hands(
            model_complexity=0,
            max_num_hands=2,
            min_detection_confidence=0.7,
            min_tracking_confidence=0.5
        )
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

        self._status: Dict[str, Any] = self._default_status()
        self.logger = logging.getLogger("FrameProcessor")

    def _default_status(self) -> Dict[str, Any]:
        return {
            "phase": 1,
            "completed": 0,
            "total": 2,
            "next_action": "Take Pill",
            "distance": None,
            "threshold": 0.10,
            "hand_count": 0,
            "finished": False,
            "time_remaining": 0,
        }

    @property
    def status(self) -> Dict[str, Any]:
        return self._status.copy()

    def reset(self):
        self.detector.reset()
        self._status = self._default_status()

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """Process one frame â€” returns annotated frame."""
        try:
            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False

            hand_results = self.hands.process(rgb)
            face_results = self.face_mesh.process(rgb)

            rgb.flags.writeable = True
            frame = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

            img_h, img_w = frame.shape[:2]
            mouth_point = None

            # Draw hands
            if hand_results.multi_hand_landmarks:
                for i, hl in enumerate(hand_results.multi_hand_landmarks):
                    color = (0, 255, 0) if i == 0 else (255, 0, 255)
                    self.mp_drawing.draw_landmarks(
                        frame, hl, self.mp_hands.HAND_CONNECTIONS,
                        self.mp_drawing_styles.get_default_hand_landmarks_style(),
                        self.mp_drawing_styles.get_default_hand_connections_style()
                    )
                    hand_center = self.detector.estimate_hand_position(hl)
                    if hand_center:
                        cv2.circle(frame, (int(hand_center.x * img_w), int(hand_center.y * img_h)), 8, color, -1)
                    for idx in self.config.palm_landmarks:
                        if idx < len(hl.landmark):
                            lm = hl.landmark[idx]
                            cv2.circle(frame, (int(lm.x * img_w), int(lm.y * img_h)), 4, (0, 180, 255), -1)

            # Draw face mesh mouth
            if face_results.multi_face_landmarks:
                for fl in face_results.multi_face_landmarks:
                    mouth_point = fl.landmark[13]
                    mx, my = int(mouth_point.x * img_w), int(mouth_point.y * img_h)
                    cv2.circle(frame, (mx, my), 8, (255, 80, 80), -1)
                    for idx in [13, 14, 15, 16, 17, 18, 19, 20]:
                        lm = fl.landmark[idx]
                        cv2.circle(frame, (int(lm.x * img_w), int(lm.y * img_h)), 3, (255, 120, 120), -1)

            # Run detection
            face_lm = face_results.multi_face_landmarks[0] if face_results.multi_face_landmarks else None
            det_count, distance = self.detector.process_detection(hand_results, mouth_point, face_lm)

            # Update status
            completed, total, next_action = self.detector.get_progress()
            hand_count = len(hand_results.multi_hand_landmarks) if hand_results.multi_hand_landmarks else 0
            self._status = {
                "phase": self.detector.current_detection_phase,
                "completed": completed,
                "total": total,
                "next_action": next_action,
                "distance": round(distance, 4) if distance is not None else None,
                "threshold": round(self.detector.get_current_threshold(), 4),
                "hand_count": hand_count,
                "finished": self.detector.medicine_fully_taken,
                "time_remaining": round(self.detector.get_time_remaining(), 1),
            }

            # Draw UI overlay
            self._draw_overlay(frame, img_h, img_w, distance, hand_count)

            return frame

        except Exception as e:
            self.logger.error(f"Frame processing error: {e}")
            return frame

    def _draw_overlay(self, frame, img_h, img_w, distance, hand_count):
        completed, total, next_action = self.detector.get_progress()
        threshold = self.detector.get_current_threshold()

        # --- Top banner ---
        if self.detector.medicine_fully_taken:
            cv2.rectangle(frame, (10, 10), (min(img_w - 10, 560), 80), (34, 197, 94), -1)
            cv2.putText(frame, "HOAN THANH! Da uong thuoc thanh cong",
                        (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(frame, "Ca 2 buoc da hoan tat!",
                        (20, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
        elif completed > 0:
            cv2.rectangle(frame, (10, 10), (min(img_w - 10, 560), 80), (0, 165, 255), -1)
            cv2.putText(frame, f"BUOC {completed + 1}: {next_action}",
                        (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2)
            cv2.putText(frame, f"Tien do: {completed}/{total} | Tay: {hand_count}",
                        (20, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1)
        else:
            cv2.rectangle(frame, (10, 10), (min(img_w - 10, 560), 80), (50, 130, 200), -1)
            cv2.putText(frame, f"SAN SANG: {next_action}",
                        (20, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2)
            cv2.putText(frame, f"Dua tay lai gan mieng de bat dau | Tay: {hand_count}",
                        (20, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        # --- Distance bar ---
        if distance is not None:
            color = (0, 220, 80) if distance < threshold else (0, 220, 220)
            cv2.putText(frame, f"Khoang cach: {distance:.3f}  (nguong: {threshold:.3f})",
                        (10, 105), cv2.FONT_HERSHEY_SIMPLEX, 0.58, color, 1)
        else:
            cv2.putText(frame, "Khong phat hien tay / mat",
                        (10, 105), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (60, 60, 220), 1)

        cv2.putText(frame, f"Tay: {hand_count}",
                    (10, 128), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    (0, 200, 80) if hand_count > 0 else (60, 60, 220), 1)

        # --- Countdown ---
        tr = self.detector.get_time_remaining()
        if tr > 0 and not self.detector.medicine_fully_taken:
            m, s = int(tr // 60), int(tr % 60)
            c_color = (0, 0, 220) if tr < 30 else (0, 220, 220)
            cv2.putText(frame, f"Con lai: {m:02d}:{s:02d}",
                        (10, 152), cv2.FONT_HERSHEY_SIMPLEX, 0.62, c_color, 2)

        # --- Bottom info bar ---
        bar_y = img_h - 44
        cv2.rectangle(frame, (0, bar_y), (img_w, img_h), (30, 30, 30), -1)
        cv2.putText(frame, f"SmartMed | Phat hien: {completed}/{total} | Nguong thu: {threshold:.3f}",
                    (10, img_h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1)

    def release(self):
        """Release MediaPipe resources."""
        try:
            self.hands.close()
            self.face_mesh.close()
        except Exception:
            pass


