ALTER TABLE staff_accounts ADD COLUMN totp_secret TEXT;
ALTER TABLE staff_accounts ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE pending_2fa_tokens (
  token TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff_accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
