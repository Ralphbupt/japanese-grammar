#!/usr/bin/env python3
"""Search Console report for jpnotes.dev: what to rewrite next.

Prints, for the last N days against the N days before:
  1. totals (clicks / impressions / CTR / position) and the change;
  2. the top queries;
  3. title candidates — pages with plenty of impressions but few clicks for
     their position, each with the queries that bring it impressions. These
     are the pages whose <title> in seo-titles.js is worth rewriting to match
     the words people actually typed;
  4. how the /zh/ copies are doing next to the bilingual pages;
  5. countries.

Search Console data lags ~3 days, so the window ends 3 days ago. At this
site's volume single pages see a handful of clicks: read CTR as a hint and
let impressions decide what to look at first.

Auth: same service-account impersonation as tools/lesson-dropoff.py (see its
docstring for the one-time setup). Nothing secret lives in the repo.

Usage: python3 tools/gsc-report.py [--days 28] [--min-impr 30] [--json out.json]
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

SA = os.environ.get(
    "JPNOTES_GA_SA",
    "jpnotes-analytics@gen-lang-client-0593149740.iam.gserviceaccount.com")
SITE = os.environ.get("JPNOTES_GSC_SITE", "https://jpnotes.dev/")
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"

# Rough organic CTR by position for a small informational site. Only used to
# rank pages against each other, so the exact numbers matter little.
EXPECTED_CTR = [(3, 0.10), (5, 0.05), (10, 0.025), (20, 0.008), (100, 0.003)]


def expected_ctr(pos):
    for limit, ctr in EXPECTED_CTR:
        if pos <= limit:
            return ctr
    return EXPECTED_CTR[-1][1]


_token = None


def token():
    global _token
    if _token is None:
        p = subprocess.run(
            ["gcloud", "auth", "print-access-token",
             f"--impersonate-service-account={SA}", f"--scopes={SCOPE}"],
            capture_output=True, text=True)
        if p.returncode != 0:
            sys.exit("Could not mint a token:\n" + p.stderr.strip())
        _token = p.stdout.strip()
    return _token


def query(start, end, dims, row_limit=5000):
    url = ("https://www.googleapis.com/webmasters/v3/sites/"
           + urllib.parse.quote(SITE, safe="") + "/searchAnalytics/query")
    body = {"startDate": str(start), "endDate": str(end),
            "dimensions": dims, "rowLimit": row_limit}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token()}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r).get("rows", [])
    except urllib.error.HTTPError as e:
        sys.exit(f"Search Console HTTP {e.code}: {e.read().decode()[:400]}")


def totals(rows):
    clicks = sum(r["clicks"] for r in rows)
    impr = sum(r["impressions"] for r in rows)
    pos = sum(r["position"] * r["impressions"] for r in rows) / impr if impr else 0
    return clicks, impr, (clicks / impr if impr else 0), pos


def short(page):
    return page.replace(SITE, "/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=28)
    ap.add_argument("--min-impr", type=int, default=30,
                    help="impressions a page needs to be a title candidate")
    ap.add_argument("--json", help="also dump the raw rows to this file")
    args = ap.parse_args()

    end = dt.date.today() - dt.timedelta(days=3)
    start = end - dt.timedelta(days=args.days - 1)
    prev_end = start - dt.timedelta(days=1)
    prev_start = prev_end - dt.timedelta(days=args.days - 1)

    pages = query(start, end, ["page"])
    prev_pages = query(prev_start, prev_end, ["page"])
    page_query = query(start, end, ["page", "query"])
    queries = query(start, end, ["query"])
    countries = query(start, end, ["country"])

    print(f"Search Console — {SITE}  {start} → {end}  (vs {prev_start} → {prev_end})\n")
    c, i, ctr, pos = totals(pages)
    pc, pi, pctr, ppos = totals(prev_pages)
    print(f"  clicks       {c:>7.0f}   ({c - pc:+.0f})")
    print(f"  impressions  {i:>7.0f}   ({i - pi:+.0f})")
    print(f"  CTR          {ctr:>7.2%}   (was {pctr:.2%})")
    print(f"  position     {pos:>7.1f}   (was {ppos:.1f})\n")

    print("Top queries by impressions")
    print(f"  {'impr':>5} {'clk':>4} {'pos':>5}  query")
    for r in sorted(queries, key=lambda r: -r["impressions"])[:25]:
        print(f"  {r['impressions']:>5.0f} {r['clicks']:>4.0f} {r['position']:>5.1f}  {r['keys'][0]}")

    by_page = {}
    for r in page_query:
        by_page.setdefault(r["keys"][0], []).append(r)
    print(f"\nTitle candidates (≥{args.min_impr} impressions, fewest clicks vs. expected)")
    cands = []
    for r in pages:
        if r["impressions"] < args.min_impr:
            continue
        missing = r["impressions"] * expected_ctr(r["position"]) - r["clicks"]
        cands.append((missing, r))
    for missing, r in sorted(cands, key=lambda x: -x[0])[:15]:
        page = r["keys"][0]
        print(f"\n  {short(page)}  impr {r['impressions']:.0f} · clicks {r['clicks']:.0f} · "
              f"CTR {r['ctr']:.1%} · pos {r['position']:.1f}")
        for q in sorted(by_page.get(page, []), key=lambda q: -q["impressions"])[:5]:
            print(f"      {q['impressions']:>4.0f} impr  pos {q['position']:>5.1f}  {q['keys'][1]}")

    zh = [r for r in pages if "/zh/" in r["keys"][0]]
    main_pages = [r for r in pages if "/zh/" not in r["keys"][0]]
    print("\nBilingual pages vs /zh/ copies")
    for label, rows in (("bilingual", main_pages), ("/zh/", zh)):
        c, i, ctr, pos = totals(rows)
        print(f"  {label:<10} pages {len(rows):>3}  clicks {c:>5.0f}  impr {i:>6.0f}  "
              f"CTR {ctr:.2%}  pos {pos:.1f}")

    print("\nCountries")
    for r in sorted(countries, key=lambda r: -r["impressions"])[:10]:
        print(f"  {r['keys'][0]:<4} impr {r['impressions']:>6.0f}  clicks {r['clicks']:>4.0f}  "
              f"pos {r['position']:.1f}")

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"range": [str(start), str(end)], "pages": pages,
                       "page_query": page_query, "queries": queries,
                       "countries": countries}, f, ensure_ascii=False, indent=1)
        print(f"\nRaw rows written to {args.json}")


if __name__ == "__main__":
    main()
