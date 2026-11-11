-- Replies to reader feedback (2026-11-11).
-- `rid`: a random id the reader's browser made (localStorage jp_fb_rid, and
-- the synced progress for signed-in readers); it is how a reply finds its way
-- back. `email`: only when the reader typed one to be told about a reply;
-- cleared once the reply is mailed, or after EMAIL_DAYS without one.
ALTER TABLE feedback ADD COLUMN rid TEXT;
ALTER TABLE feedback ADD COLUMN email TEXT;
ALTER TABLE feedback ADD COLUMN reply TEXT;
ALTER TABLE feedback ADD COLUMN replied_at TEXT;
ALTER TABLE feedback ADD COLUMN mailed INTEGER;   -- 1 sent, 0 sending failed, NULL no email
CREATE INDEX IF NOT EXISTS feedback_rid ON feedback (rid);
