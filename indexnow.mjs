// IndexNow ping — notifies Bing/Yandex/Seznam/Naver of the current URL set so
// they crawl fresh content fast (Google does not support IndexNow). Run in CI
// after deploy. Reads URLs from dist/sitemap.xml. Never fails the build.
//
// Key must match INDEXNOW_KEY in build.js and be live at /<key>.txt.
import fs from "node:fs";

const KEY = "b5c13368abbfcdaf25ed104808caeca9";
const HOST = "jpnotes.dev";

const sitemap = fs.readFileSync("dist/sitemap.xml", "utf-8");
const urlList = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

if (urlList.length === 0) {
  console.log("IndexNow: no URLs found in dist/sitemap.xml, skipping.");
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
  console.log(`IndexNow: submitted ${urlList.length} URLs → HTTP ${res.status}`);
} catch (err) {
  console.log(`IndexNow: ping failed (non-fatal): ${err.message}`);
}
