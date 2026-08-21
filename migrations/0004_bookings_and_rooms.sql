CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  room_type TEXT NOT NULL CHECK (room_type IN ('triangle', 'circle', 'ede_cozy', 'vip', 'bungalow', 'dormitory')),
  is_active INTEGER NOT NULL DEFAULT 1,
  needs_cleaning INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_rooms_type_active ON rooms(room_type, is_active);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  room_type TEXT NOT NULL CHECK (room_type IN ('triangle', 'circle', 'ede_cozy', 'vip', 'bungalow', 'dormitory')),
  room_id INTEGER REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  guests_count INTEGER,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled')) DEFAULT 'pending',
  source TEXT NOT NULL CHECK (source IN ('website', 'phone', 'zalo', 'walk_in')) DEFAULT 'website',
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT
);

CREATE INDEX idx_bookings_dates ON bookings(check_in, check_out);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_room ON bookings(room_id);

INSERT INTO rooms (name, room_type) VALUES
  ('Triangle House 1', 'triangle'),
  ('Triangle House 2', 'triangle'),
  ('Triangle House 3', 'triangle'),
  ('Circle House 1', 'circle'),
  ('Circle House 2', 'circle'),
  ('Circle House 3', 'circle'),
  ('Circle House 4', 'circle'),
  ('Circle House 5', 'circle'),
  ('Ê Đê Cozy House 1', 'ede_cozy'),
  ('Ê Đê Cozy House 2', 'ede_cozy'),
  ('VIP House 1', 'vip'),
  ('VIP House 2', 'vip'),
  ('Bungalow Gia Đình 1', 'bungalow'),
  ('Bungalow Gia Đình 2', 'bungalow'),
  ('Bungalow Gia Đình 3', 'bungalow'),
  ('Phòng Tập Thể 1', 'dormitory');
