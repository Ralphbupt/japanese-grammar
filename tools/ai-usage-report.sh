#!/bin/sh
# Free-AI relay usage (Analytics Engine dataset jpnotes_ai_usage, written by
# worker/ — one row per request: button, first/follow-up, outcome, neurons).
#
#   tools/ai-usage-report.sh        last 14 days
#   tools/ai-usage-report.sh 30     last 30 days
#
# Outcomes: model = answered by Workers AI · cache = from the edge cache (free)
#   fallback-groq / fallback-cerebras = budget gone or Workers AI failed, a backup answered
#   limited-ip-day / limited-ip-minute = one reader hit their own limit (nothing to do)
#   limited-budget = the site's free budget was gone and no backup answered  ← look at this
#   error = Workers AI failed and no backup answered                          ← and this
# Older rows (before 2026-10-29) only say "limited".
# "you" = requests from the owner's browser (one opted out of GA with ?ga_off);
# rows before 2026-10-30 don't say, so they count as readers.
set -e
DAYS=${1:-14}
case "$DAYS" in ''|*[!0-9]*) echo "usage: tools/ai-usage-report.sh [days]   (days is a number, default 14)" >&2; exit 1;; esac
ACCOUNT=ac5b0b471a6fa56e6acbaef0f4f0810b
BUDGET=9500
cd "$(dirname "$0")/../worker"
npx wrangler whoami >/dev/null 2>&1 || true        # refreshes the OAuth token
TOKEN=$(grep oauth_token ~/Library/Preferences/.wrangler/config/default.toml | cut -d'"' -f2)
# Rows of a query as JSON lines on stdout; on an API error, its message and exit 1.
q() {
  curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/analytics_engine/sql" -H "Authorization: Bearer $TOKEN" -d "$1 FORMAT JSON" |
    python3 -c "
import json, sys
raw = sys.stdin.read()
try: rows = json.loads(raw)['data']
except Exception: sys.exit('Query failed: ' + (raw.strip()[:300] or 'empty response (not logged in? run: cd worker && npx wrangler login)'))
for r in rows: print(json.dumps(r))"
}

echo "Per day (JST): requests (readers + you) · neurons (% of the $BUDGET budget) · limited · backup · error"
q "SELECT toStartOfDay(timestamp + INTERVAL '9' HOUR) d, sum(_sample_interval) n, sumIf(_sample_interval, blob4 = 'owner') me, sum(double2 * _sample_interval) neurons,
     sumIf(_sample_interval, startsWith(blob3, 'limited')) lim, sumIf(_sample_interval, startsWith(blob3, 'fallback')) fb, sumIf(_sample_interval, blob3 = 'error') err
   FROM jpnotes_ai_usage WHERE timestamp > NOW() - INTERVAL '$DAYS' DAY GROUP BY d ORDER BY d" |
  python3 -c "
import json, sys
for r in map(json.loads, sys.stdin):
    n = float(r['neurons'])
    flag = '  <- budget nearly gone' if n >= $BUDGET * 0.8 else ''
    print(f\"  {r['d'][:10]}  {r['n']:>4} req ({int(r['n']) - int(r['me'])} + {r['me']})  {n:7.0f} ({n / $BUDGET:4.0%})  limited {r['lim']:>3}  backup {r['fb']:>3}  error {r['err']:>3}{flag}\")"
echo
echo "By outcome:"
q "SELECT blob3 outcome, sum(_sample_interval) n FROM jpnotes_ai_usage WHERE timestamp > NOW() - INTERVAL '$DAYS' DAY GROUP BY outcome ORDER BY n DESC" |
  python3 -c "
import json, sys
for r in map(json.loads, sys.stdin):
    bad = '  <- check' if r['outcome'] in ('limited-budget', 'error') else ''
    print(f\"  {r['outcome']:<20} {r['n']:>5}{bad}\")"
echo
echo "By button, readers only (example = 讲解 on a sentence, quiz = practice pages, quick = suggested prompts):"
q "SELECT blob1 src, sum(_sample_interval) n FROM jpnotes_ai_usage WHERE timestamp > NOW() - INTERVAL '$DAYS' DAY AND blob4 != 'owner' GROUP BY src ORDER BY n DESC" |
  python3 -c "
import json, sys
for r in map(json.loads, sys.stdin): print(f\"  {r['src']:<12} {r['n']:>5}\")"
