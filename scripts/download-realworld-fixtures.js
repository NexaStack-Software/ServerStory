const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const cacheDir = path.join(root, "tests", "realworld-cache");

const datasets = {
  epa: "https://ita.ee.lbl.gov/html/contrib/EPA-HTTP.html",
  nasa: "https://ita.ee.lbl.gov/html/contrib/NASA-HTTP.html",
  clarknet: "https://ita.ee.lbl.gov/html/contrib/ClarkNet-HTTP.html",
  saskatchewan: "https://ita.ee.lbl.gov/html/contrib/Sask-HTTP.html",
  calgary: "https://ita.ee.lbl.gov/html/contrib/Calgary-HTTP.html"
};

function clientFor(url) {
  if (url.startsWith("https:")) return https;
  if (url.startsWith("http:")) return http;
  throw new Error(`unsupported URL scheme: ${url}`);
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = clientFor(url).get(url, { headers: { "user-agent": "ServerStory realworld fixture downloader" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 5) reject(new Error(`too many redirects for ${url}`));
        else resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`${url}: HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
  });
}

async function getText(url) {
  const res = await get(url);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function archiveLinks(html, pageUrl) {
  const links = [];
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const href = match[1].replace(/&amp;/g, "&");
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/gzip|compressed|ascii|access log|jul|aug|sep|archive/i.test(text + " " + href)) continue;
    if (!/\.(gz|Z)(?:$|[?#])|traces|ftp/i.test(href)) continue;
    try {
      const url = new URL(href, pageUrl).toString();
      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("ftp://")) links.push({ url, text });
    } catch (_) {}
  }
  return links;
}

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    console.log(`exists ${path.relative(root, file)}`);
    return;
  }
  const tmp = `${file}.part`;
  if (url.startsWith("ftp://")) {
    const res = spawnSync("curl", ["-L", "--fail", "--silent", "--show-error", "-o", tmp, url], { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`curl failed for ${url}`);
    fs.renameSync(tmp, file);
    console.log(`downloaded ${path.relative(root, file)}`);
    return;
  }
  const res = await get(url);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.pipe(out);
    res.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
  });
  fs.renameSync(tmp, file);
  console.log(`downloaded ${path.relative(root, file)}`);
}

async function main() {
  const selected = (process.argv[2] || "epa,nasa").split(",").map((name) => name.trim()).filter(Boolean);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  for (const name of selected) {
    const page = datasets[name];
    if (!page) throw new Error(`unknown dataset "${name}". Known: ${Object.keys(datasets).join(", ")}`);
    console.log(`discover ${name}: ${page}`);
    const links = archiveLinks(await getText(page), page);
    if (!links.length) throw new Error(`no downloadable archive links found for ${name}`);
    for (let i = 0; i < links.length; i++) {
      const url = links[i].url;
      const base = path.basename(new URL(url).pathname) || `${name}-${i + 1}.gz`;
      const safeBase = base.replace(/[^A-Za-z0-9._-]/g, "_");
      await download(url, path.join(cacheDir, `${name}-${i + 1}-${safeBase}`));
    }
  }
  console.log(`real-world fixtures are in ${path.relative(root, cacheDir)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
