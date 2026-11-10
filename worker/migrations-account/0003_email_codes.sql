-- Sign-in by a code sent to an email address (worker/src/account.js
-- /auth/email/start and /auth/email/verify). One row per address: the hash of
-- the code now valid, and how many were sent today. Rows are deleted on
-- sign-in and swept when old.
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,            -- SHA-256 of email + code
  expires INTEGER NOT NULL,      -- unix seconds
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,      -- unix seconds of the last send
  day TEXT NOT NULL,             -- UTC date of the count below
  sent INTEGER NOT NULL DEFAULT 0
);
-- Codes requested per network per day (ip = hash salted with the date).
CREATE TABLE IF NOT EXISTS email_ips (
  day TEXT NOT NULL,
  ip TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ip)
);
