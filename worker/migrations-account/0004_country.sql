-- The country a new account signed up from: Cloudflare's two-letter code for
-- the request (request.cf.country), not the IP. Counted on the owner's stats
-- page; NULL for accounts created before 2026-11-11.
ALTER TABLE users ADD COLUMN country TEXT;
