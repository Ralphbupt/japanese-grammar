// IndexNow ping — notifies Bing/Yandex/Seznam/Naver of pages whose content
// changed in this deploy so they recrawl them fast (Google does not support
// IndexNow). Run in CI after deploy. Never fails the build.
//
// IndexNow asks for changed URLs only; resubmitting unchanged ones on every
// deploy (once 13 deploys × 87 URLs in a day) risks being throttled. So this
// diffs dist/sitemap.xml against the sitemap that was live before the deploy
// (saved by CI as prev-sitemap.xml) and submits URLs that are new or whose
// <lastmod> moved. lastmod comes from the source file's last commit, so
// template-only changes in build.js don't trigger a resubmit — crawlers still
// pick those up on their normal schedule via the sitemap.
//
// Usage: node indexnow.mjs [prev-sitemap.xml]   (missing file → submit all)
// Key must match INDEXNOW_KEY in build.js and be live at /<key>.txt.
import fs from "node:fs";

const KEY = "b5c13368abbfcdaf25ed104808caeca9";
const HOST = "jpnotes.dev";

function readSitemap(file) {
  const xml = fs.readFileSync(file, "utf-8");
  const map = new Map();
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1];
    if (loc) map.set(loc, block.match(/<lastmod>(.*?)<\/lastmod>/)?.[1] || "");
  }
  return map;
}

// The previous sitemap may predate full timestamps (bare YYYY-MM-DD); then
// compare at day precision so the switch-over doesn't resubmit everything.
function changed(prev, cur) {
  if (prev === undefined) return true;
  if (!prev.includes("T")) return prev !== cur.slice(0, 10);
  return prev !== cur;
}

const current = readSitemap("dist/sitemap.xml");
const prevFile = process.argv[2] || "prev-sitemap.xml";
let urlList;
if (fs.existsSync(prevFile) && fs.statSync(prevFile).size > 0) {
  const prev = readSitemap(prevFile);
  urlList = [...current].filter(([loc, mod]) => changed(prev.get(loc), mod)).map(([loc]) => loc);
} else {
  console.log(`IndexNow: no previous sitemap at ${prevFile}, submitting every URL.`);
  urlList = [...current.keys()];
}

if (urlList.length === 0) {
  console.log("IndexNow: no changed URLs, skipping.");
  process.exit(0);
}

const body = {
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList, // IndexNow accepts up to 10,000 URLs per request
};

try {
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  // 200 = accepted, 202 = accepted & key validation pending. Both are success.
  console.log(`IndexNow: submitted ${urlList.length} changed URLs → HTTP ${res.status}`);
  for (const u of urlList) console.log(`  ${u}`);
} catch (err) {
  console.log(`IndexNow: ping failed (non-fatal): ${err.message}`);
}
