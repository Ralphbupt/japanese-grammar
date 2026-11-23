-- Mail sent through Resend per UTC day and kind, for the owner's 邮件 page
-- (Resend's free plan allows 100 a day). kind: 'code' (sign-in codes, this
-- Worker), 'reply' (replies to feedback, admin.jpnotes.dev). Counts only: no
-- addresses.
CREATE TABLE IF NOT EXISTS mail_counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,     -- accepted by Resend
  fail INTEGER NOT NULL DEFAULT 0,  -- refused by Resend (not bounces: those show only in Resend)
  PRIMARY KEY (day, kind)
);
