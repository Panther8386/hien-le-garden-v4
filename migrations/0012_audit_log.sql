CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  entity_label TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
