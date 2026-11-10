-- Restore points: how many questions a stored copy has answers for, shown in
-- the list a reader picks from (worker/src/account.js GET /sync/history).
ALTER TABLE progress ADD COLUMN n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE progress_history ADD COLUMN n INTEGER NOT NULL DEFAULT 0;
