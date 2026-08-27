-- SQLite has no ALTER TABLE ... DROP CONSTRAINT; rebuild the table with the
-- widened CHECK, copying rows across and preserving id values (sessions.staff_id
-- references staff_accounts.id, so ids must not change).
CREATE TABLE staff_accounts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reception', 'manager', 'admin', 'observer')),
  created_at TEXT NOT NULL
);
INSERT INTO staff_accounts_new SELECT * FROM staff_accounts;
DROP TABLE staff_accounts;
ALTER TABLE staff_accounts_new RENAME TO staff_accounts;
