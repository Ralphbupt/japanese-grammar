#!/bin/sh
# Reader feedback from the practice / mock test / flashcard pages (D1
# jpnotes-feedback, written by worker/ POST /feedback).
#
#   tools/feedback-report.sh            last 14 days, newest first
#   tools/feedback-report.sh 60         last 60 days
#   tools/feedback-report.sh 14 --local the local wrangler-dev database
#
# Question reports are grouped by question id first: those are the ones to fix
# (node tools/quiz-blind.js can re-check a lesson after editing).
set -e
DAYS=${1:-14}
WHERE=${2:---remote}
cd "$(dirname "$0")/../worker"
q() { npx wrangler d1 execute jpnotes-feedback "$WHERE" --json --command "$1" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const rows = JSON.parse(s)[0].results;
    if (!rows.length) return console.log("  (none)");
    for (const r of rows) console.log("  " + Object.values(r).map((v) => (v === null ? "" : String(v).replace(/\s+/g, " "))).join(" | "));
  });'; }
SINCE="date('now', '-$DAYS days')"
echo "Questions reported (last $DAYS days): id | reports | reasons | notes"
q "SELECT qid, COUNT(*) n, group_concat(DISTINCT reason), group_concat(text, ' / ') FROM feedback WHERE kind = 'question' AND day >= $SINCE GROUP BY qid ORDER BY n DESC"
echo
echo "General feedback (last $DAYS days): time | page | lang | text"
q "SELECT substr(at, 1, 16), page, lang, text FROM feedback WHERE kind = 'general' AND day >= $SINCE ORDER BY at DESC"
