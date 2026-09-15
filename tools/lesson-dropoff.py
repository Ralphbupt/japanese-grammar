#!/usr/bin/env python3
"""Pull GA4 + Search Console figures for the jpnotes.dev lesson pages.

Prints three blocks: how far back GA4 still holds data, a per-lesson
engagement table with level rollups, and the Search Console click/impression
counts per lesson. Use it to see where readers stop rather than guessing.

Reading the output: a sequential course decays even when it is good, so a
lesson having fewer readers than the one before it means nothing on its own.
What matters is a band falling out of line with its neighbours -- N4 30-34
sitting below the harder N3 material, say. Per-lesson user counts run to the
single digits, so treat individual lessons as hints and only trust the bands.

Setup (once, and already done for this repo):
  gcloud services enable analyticsdata.googleapis.com searchconsole.googleapis.com \
      iamcredentials.googleapis.com --project=<project>
  gcloud iam service-accounts add-iam-policy-binding <SA> \
      --member="user:<you>" --role="roles/iam.serviceAccountTokenCreator"
  Then add <SA> as a Viewer in GA4 (Property Access Management) and as a user
  in Search Console -- those two are separate consoles, easy to do only one.

No key file is involved: the token is minted per run via impersonation, so
nothing secret lives on disk or in this repo.

Usage: python3 tools/lesson-dropoff.py
"""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

# Neither of these is a secret: the service-account address is the string you
# paste into the GA4 and Search Console consoles to grant access, and access is
# gated by IAM, not by knowing it. Override via the environment to point the
# script at a different property.
SA = os.environ.get(
    "JPNOTES_GA_SA",
    "jpnotes-analytics@gen-lang-client-0593149740.iam.gserviceaccount.com")
PROPERTY = os.environ.get("JPNOTES_GA_PROPERTY", "531353635")
GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
START, END = "2026-06-01", "2026-09-15"


def token(scope):
    p = subprocess.run(
        ["gcloud", "auth", "print-access-token",
         f"--impersonate-service-account={SA}", f"--scopes={scope}"],
        capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit("Could not mint a token:\n" + p.stderr.strip())
    return p.stdout.strip()


def call(url, body, scope, method="POST"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token(scope)}",
        "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        print(f"  !! HTTP {e.code}: {e.read().decode()[:400]}", file=sys.stderr)
        return None


def ga(body):
    return call(f"https://analyticsdata.googleapis.com/v1beta/properties/"
                f"{PROPERTY}:runReport", body, GA_SCOPE)


def lesson_no(path):
    m = re.search(r"/lesson(\d+)", path or "")
    return int(m.group(1)) if m else None


def level(n):
    return ("N5" if n <= 17 else "N4" if n <= 34 else "N3" if n <= 58 else "N2")


print("=" * 78)
print("PART 1 — GA4 data availability (is late August still retained?)")
print("=" * 78)
r = ga({"dateRanges": [{"startDate": START, "endDate": END}],
        "dimensions": [{"name": "date"}],
        "metrics": [{"name": "screenPageViews"}],
        "orderBys": [{"dimension": {"dimensionName": "date"}}], "limit": 400})
days = [(x["dimensionValues"][0]["value"], int(x["metricValues"][0]["value"]))
        for x in (r or {}).get("rows", [])]
if not days:
    print("NO DATA in this window.")
else:
    print(f"days with data : {len(days)}")
    print(f"earliest       : {days[0][0]}")
    print(f"latest         : {days[-1][0]}")
    print(f"total pageviews: {sum(v for _, v in days)}")
    aug = [d for d, _ in days if "20260825" <= d <= "20260901"]
    print(f"Aug 25-Sep 1 retained: {'YES ' + str(len(aug)) + ' days' if aug else 'NO -- rolled off'}")

print()
print("=" * 78)
print("PART 2 — per-lesson engagement (the decay curve)")
print("=" * 78)
r = ga({"dateRanges": [{"startDate": START, "endDate": END}],
        "dimensions": [{"name": "pagePath"}],
        "metrics": [{"name": "screenPageViews"}, {"name": "activeUsers"},
                    {"name": "userEngagementDuration"}, {"name": "bounceRate"}],
        "limit": 500})
data = {}
for x in (r or {}).get("rows", []):
    path = x["dimensionValues"][0]["value"]
    n = lesson_no(path)
    if n is None:
        continue
    m = x["metricValues"]
    pv, au, dur, br = int(m[0]["value"]), int(m[1]["value"]), float(m[2]["value"]), float(m[3]["value"])
    d = data.setdefault(n, [0, 0, 0.0, 0.0])
    d[0] += pv
    d[1] += au
    d[2] += dur
    d[3] = br

if not data:
    print("No lesson pageviews returned.")
else:
    print(f"{'lesson':>7} {'lvl':>4} {'views':>7} {'users':>6} {'sec/user':>9} {'bounce':>7}")
    print("-" * 78)
    for n in sorted(data):
        pv, au, dur, br = data[n]
        per = dur / au if au else 0
        mark = "  <-- N4 mid" if 18 <= n <= 24 else ""
        print(f"{n:>7} {level(n):>4} {pv:>7} {au:>6} {per:>9.1f} {br:>6.1%}{mark}")

    print()
    print("-- level rollup --")
    for lv in ("N5", "N4", "N3", "N2"):
        sel = [v for k, v in data.items() if level(k) == lv]
        if not sel:
            continue
        pv = sum(s[0] for s in sel)
        au = sum(s[1] for s in sel)
        dur = sum(s[2] for s in sel)
        print(f"{lv}: pages={len(sel):>3} views={pv:>6} users={au:>5} "
              f"sec/user={dur/au if au else 0:>6.1f}")

    print()
    print("-- N4 mid-section (18-24) vs its neighbours --")
    for label, lo, hi in (("N5 tail   (12-17)", 12, 17), ("N4 early  (18-20)", 18, 20),
                          ("N4 MID    (21-24)", 21, 24), ("N4 late   (25-34)", 25, 34)):
        sel = [v for k, v in data.items() if lo <= k <= hi]
        if not sel:
            continue
        pv = sum(s[0] for s in sel)
        au = sum(s[1] for s in sel)
        dur = sum(s[2] for s in sel)
        print(f"{label}: views={pv:>6} users={au:>5} sec/user={dur/au if au else 0:>6.1f}")

print()
print("=" * 78)
print("PART 3 — Search Console (is the entry funnel healthy?)")
print("=" * 78)
sites = call("https://searchconsole.googleapis.com/webmasters/v3/sites",
             None, GSC_SCOPE, method="GET")
avail = [s["siteUrl"] for s in (sites or {}).get("siteEntry", [])]
print("accessible properties:", avail or "(none -- was the SA added in GSC?)")
for site in avail:
    if "jpnotes" not in site:
        continue
    print(f"\n-- {site} --")
    body = {"startDate": "2026-06-01", "endDate": "2026-09-15",
            "dimensions": ["page"], "rowLimit": 500}
    res = call("https://searchconsole.googleapis.com/webmasters/v3/sites/"
               + urllib.parse.quote(site, safe="") + "/searchAnalytics/query",
               body, GSC_SCOPE)
    agg = {}
    for row in (res or {}).get("rows", []):
        n = lesson_no(row["keys"][0])
        if n is None:
            continue
        a = agg.setdefault(n, [0, 0])
        a[0] += row["clicks"]
        a[1] += row["impressions"]
    if not agg:
        print("  no lesson rows")
        continue
    print(f"  {'lesson':>7} {'clicks':>7} {'impr':>8} {'ctr':>7}")
    for n in sorted(agg):
        c, i = agg[n]
        mark = "  <-- N4 mid" if 18 <= n <= 24 else ""
        print(f"  {n:>7} {c:>7} {i:>8} {c / i if i else 0:>6.1%}{mark}")
