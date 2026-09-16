#!/usr/bin/env python3
"""Tell apart two reasons a lesson page shows low reading time.

A reader working through the course reaches a lesson from the previous one,
mid-session. Someone who searched for one grammar point lands on it directly
and leaves once they have their answer -- for them a short visit is the page
working, not failing. Those two call for opposite fixes, so before trimming
anything it is worth knowing which population a page actually has.

Entrance rate (session entrances / pageviews) separates them: near 1.0 means
almost everyone arrives cold and the page is being used for lookup; well below
1.0 means people arrive from elsewhere on the site and are reading in sequence.

Pairs it with new-vs-returning and channel, which should agree: a lookup page
skews new + organic, a sequential page skews returning + direct/referral.

Usage: python3 tools/lesson-audience.py
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

SA = os.environ.get(
    "JPNOTES_GA_SA",
    "jpnotes-analytics@gen-lang-client-0593149740.iam.gserviceaccount.com")
PROPERTY = os.environ.get("JPNOTES_GA_PROPERTY", "531353635")
SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
START, END = "2026-06-01", "2026-09-15"


def ga(body):
    p = subprocess.run(
        ["gcloud", "auth", "print-access-token",
         f"--impersonate-service-account={SA}", f"--scopes={SCOPE}"],
        capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit("Could not mint a token:\n" + p.stderr.strip())
    req = urllib.request.Request(
        f"https://analyticsdata.googleapis.com/v1beta/properties/{PROPERTY}:runReport",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {p.stdout.strip()}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:500]}")


def num(path):
    m = re.search(r"/lesson(\d+)", path or "")
    return int(m.group(1)) if m else None


base = {"dateRanges": [{"startDate": START, "endDate": END}], "limit": 800}

# --- entrances vs pageviews -------------------------------------------------
r = ga(dict(base, dimensions=[{"name": "pagePath"}],
            metrics=[{"name": "screenPageViews"}, {"name": "entrances"},
                     {"name": "userEngagementDuration"}, {"name": "activeUsers"}]))
ent = {}
for row in r.get("rows", []):
    n = num(row["dimensionValues"][0]["value"])
    if n is None:
        continue
    m = [float(x["value"]) for x in row["metricValues"]]
    a = ent.setdefault(n, [0.0, 0.0, 0.0, 0.0])
    for i in range(4):
        a[i] += m[i]

# --- new vs returning -------------------------------------------------------
r2 = ga(dict(base, dimensions=[{"name": "pagePath"}, {"name": "newVsReturning"}],
             metrics=[{"name": "activeUsers"}]))
nvr = {}
for row in r2.get("rows", []):
    n = num(row["dimensionValues"][0]["value"])
    if n is None:
        continue
    kind = row["dimensionValues"][1]["value"]
    nvr.setdefault(n, {}).setdefault(kind, 0)
    nvr[n][kind] += int(row["metricValues"][0]["value"])

# --- channel ----------------------------------------------------------------
r3 = ga(dict(base, dimensions=[{"name": "pagePath"},
                               {"name": "sessionDefaultChannelGroup"}],
             metrics=[{"name": "sessions"}]))
chan = {}
for row in r3.get("rows", []):
    n = num(row["dimensionValues"][0]["value"])
    if n is None:
        continue
    c = row["dimensionValues"][1]["value"]
    chan.setdefault(n, {}).setdefault(c, 0)
    chan[n][c] += int(row["metricValues"][0]["value"])

print(f"{'lesson':>7}{'views':>7}{'entr':>6}{'entr%':>7}{'sec/user':>10}"
      f"{'new%':>7}  top channel")
print("-" * 76)
for n in sorted(ent):
    views, entr, dur, users = ent[n]
    e_rate = entr / views if views else 0
    sec = dur / users if users else 0
    counts = nvr.get(n, {})
    tot = sum(counts.values())
    new = counts.get("new", 0) / tot if tot else 0
    ch = chan.get(n, {})
    top = max(ch, key=ch.get) if ch else "-"
    band = ""
    if 21 <= n <= 24:
        band = "  [21-24 high engagement]"
    elif 25 <= n <= 34:
        band = "  [25-34 the cliff]"
    print(f"{n:>7}{views:>7.0f}{entr:>6.0f}{e_rate:>6.0%}{sec:>10.1f}"
          f"{new:>6.0%}  {top}{band}")

print()
print("-- band averages --")
for label, lo, hi in (("N5 2-11", 2, 11), ("N4 18-20", 18, 20), ("N4 21-24", 21, 24),
                      ("N4 25-29", 25, 29), ("N4 30-34", 30, 34), ("N3 35-58", 35, 58)):
    sel = [ent[k] for k in ent if lo <= k <= hi]
    if not sel:
        continue
    views = sum(s[0] for s in sel)
    entr = sum(s[1] for s in sel)
    dur = sum(s[2] for s in sel)
    users = sum(s[3] for s in sel)
    print(f"{label:<10} entrance rate {entr / views:>5.0%}   sec/user {dur / users:>6.1f}")

print()
print("How to read it: if the cliff bands show a much HIGHER entrance rate than")
print("21-24, the drop is mostly a change of audience -- those pages are being")
print("used for lookup, and the fix is to make them fast to scan, not shorter.")
print("If entrance rates are similar across bands, the same kind of reader is")
print("arriving and giving up, and the content itself is what needs work.")
