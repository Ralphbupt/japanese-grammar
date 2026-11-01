-- Reader feedback from the practice / mock test / flashcard pages (POST /feedback).
-- `ip` is a daily-salted hash, kept only to cap submissions per reader per day.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,            -- ISO time
  day TEXT NOT NULL,           -- UTC date, for the daily cap
  ip TEXT NOT NULL,            -- hashIp(): salted with the date, not reversible
  kind TEXT NOT NULL,          -- 'question' (a problem with one question) | 'general'
  page TEXT,                   -- path, e.g. /zh/n5-practice/
  qid TEXT,                    -- question id for kind = 'question'
  choice INTEGER,              -- the option the reader picked (0–3), if any
  reason TEXT,                 -- answer | two | stem | other
  lang TEXT,                   -- en | zh
  text TEXT                    -- what they wrote (≤ 1000 chars)
);
CREATE INDEX IF NOT EXISTS feedback_day_ip ON feedback (day, ip);
