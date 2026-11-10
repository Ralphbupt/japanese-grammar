-- Accounts for jpnotes.dev (worker/src/account.js, api.jpnotes.dev): who signed
-- in, their sessions, and one copy of their practice progress.
-- The only personal data is the email address.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,           -- random
  email TEXT NOT NULL UNIQUE,    -- lower case
  created TEXT NOT NULL          -- ISO time
);
-- A user can have several ways to sign in (google now; an email code or a
-- sync code later) without the users table changing.
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,        -- 'google'
  subject TEXT NOT NULL,         -- the provider's stable user id (Google `sub`)
  user_id TEXT NOT NULL,
  created TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,         -- SHA-256 of the token; the token itself is only in the browser
  user_id TEXT NOT NULL,
  created TEXT NOT NULL,
  expires INTEGER NOT NULL       -- unix seconds
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
-- The reader's jp_quiz_v1 (site/quiz.js) as JSON. `version` goes up by one on
-- every write; a write must name the version it was based on.
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated TEXT NOT NULL,
  day TEXT NOT NULL DEFAULT '',  -- UTC date of the writes counted below
  writes INTEGER NOT NULL DEFAULT 0
);
-- The versions before the current one (the last KEEP_HISTORY), to roll back a bad merge.
CREATE TABLE IF NOT EXISTS progress_history (
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  saved TEXT NOT NULL,
  PRIMARY KEY (user_id, version)
);
