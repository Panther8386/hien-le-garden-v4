-- Shared, temporary login budgets. Keys are SHA-256 digests, not raw IPs/usernames.
CREATE TABLE login_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_login_rate_limits_expiry ON login_rate_limits(expires_at);
