from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Cabinet(db.Model):
    __tablename__ = 'cabinets'
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String(36), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    ip = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.uuid,
            'name': self.name,
            'ip': self.ip,
            'created_at': self.created_at.isoformat()
        }

class Drawer(db.Model):
    __tablename__ = 'drawers'
    id = db.Column(db.Integer, primary_key=True)
    cabinet_id = db.Column(db.Integer, db.ForeignKey('cabinets.id'), nullable=False)
    index = db.Column(db.Integer, nullable=False)  # 0, 1, 2, 3
    name = db.Column(db.String(100))
    time = db.Column(db.String(10), default="07:00")
    reminder_before = db.Column(db.Integer, default=5)
    days = db.Column(db.String(50), default="0,1,2,3,4,5,6")  # Comma separated
    
    # Relationship
    cabinet = db.relationship('Cabinet', backref=db.backref('drawers', lazy=True, cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            'index': self.index,
            'name': self.name,
            'time': self.time,
            'reminderBefore': self.reminder_before,
            'days': [int(d) for d in self.days.split(',')] if self.days else []
        }

class Medication(db.Model):
    __tablename__ = 'medications'
    id = db.Column(db.Integer, primary_key=True)
    drawer_id = db.Column(db.Integer, db.ForeignKey('drawers.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    dose = db.Column(db.String(100))
    icon = db.Column(db.String(10))
    qty = db.Column(db.Integer, default=0)
    type = db.Column(db.String(50))
    note = db.Column(db.Text)

    # Relationship
    drawer = db.relationship('Drawer', backref=db.backref('medications', lazy=True, cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            'name': self.name,
            'dose': self.dose,
            'icon': self.icon,
            'qty': self.qty,
            'type': self.type,
            'note': self.note
        }

class MedicineLog(db.Model):
    __tablename__ = 'medicine_logs'
    id = db.Column(db.Integer, primary_key=True)
    cabinet_id = db.Column(db.Integer, db.ForeignKey('cabinets.id'), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='completed')  # 'completed', 'cancelled'
    
    # Relationship
    cabinet = db.relationship('Cabinet', backref=db.backref('logs', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'cabinet_name': self.cabinet.name if self.cabinet else "Unknown",
            'timestamp': self.timestamp.isoformat(),
            'status': self.status
        }
