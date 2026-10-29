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
set -e
DAYS=${1:-14}
ACCOUNT=ac5b0b471a6fa56e6acbaef0f4f0810b
BUDGET=9500
cd "$(dirname "$0")/../worker"
npx wrangler whoami >/dev/null 2>&1 || true        # refreshes the OAuth token
TOKEN=$(grep oauth_token ~/Library/Preferences/.wrangler/config/default.toml | cut -d'"' -f2)
q() { curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/analytics_engine/sql" -H "Authorization: Bearer $TOKEN" -d "$1 FORMAT JSON"; }

echo "Per day (JST): requests · neurons (% of the $BUDGET budget) · limited · backup · error"
q "SELECT toStartOfDay(timestamp + INTERVAL '9' HOUR) d, sum(_sample_interval) n, sum(double2 * _sample_interval) neurons,
     sumIf(_sample_interval, startsWith(blob3, 'limited')) lim, sumIf(_sample_interval, startsWith(blob3, 'fallback')) fb, sumIf(_sample_interval, blob3 = 'error') err
   FROM jpnotes_ai_usage WHERE timestamp > NOW() - INTERVAL '$DAYS' DAY GROUP BY d ORDER BY d" |
  python3 -c "
import json, sys
for r in json.load(sys.stdin)['data']:
    n = float(r['neurons'])
    flag = '  <- budget nearly gone' if n >= $BUDGET * 0.8 else ''
    print(f\"  {r['d'][:10]}  {r['n']:>4} req  {n:7.0f} ({n / $BUDGET:4.0%})  limited {r['lim']:>3}  backup {r['fb']:>3}  error {r['err']:>3}{flag}\")"
echo
echo "By outcome:"
q "SELECT blob3 outcome, sum(_sample_interval) n FROM jpnotes_ai_usage WHERE timestamp > NOW() - INTERVAL '$DAYS' DAY GROUP BY outcome ORDER BY n DESC" |
  python3 -c "
import json, sys
for r in json.load(sys.stdin)['data']:
    bad = '  <- check' if r['outcome'] in ('limited-budget', 'error') else ''
    print(f\"  {r['outcome']:<20} {r['n']:>5}{bad}\")"
echo
echo "By button (example = 讲解 on a sentence, quiz = practice pages, quick = suggested prompts):"
q "SELECT blob1 src, sum(_sample_interval) n FROM jpnotes_ai_usage WHERE timestamp > NOW() - INTERVAL '$DAYS' DAY GROUP BY src ORDER BY n DESC" |
  python3 -c "
import json, sys
for r in json.load(sys.stdin)['data']: print(f\"  {r['src']:<12} {r['n']:>5}\")"
