-- v4/migrations/0008_deposit_layout_permission.sql
ALTER TABLE bookings ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff_accounts ADD COLUMN can_manage_room_layout INTEGER NOT NULL DEFAULT 0;

-- One-time grant for the existing Vinhdx account. A no-op locally/in test
-- environments where no such username exists yet -- expected, not an error.
UPDATE staff_accounts SET can_manage_room_layout = 1 WHERE username = 'Vinhdx';

CREATE TABLE room_layout_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changed_by TEXT NOT NULL,
  old_order TEXT NOT NULL,
  new_order TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
