const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const root = path.resolve(__dirname, "..");
const cacheDir = path.join(root, "tests", "access-cache");

const secrepoDays = [
  "2017-01-13", "2017-01-14", "2017-01-15", "2017-02-17", "2017-02-27",
  "2017-03-16", "2017-04-08", "2017-04-13", "2017-05-01", "2017-06-01",
  "2017-07-01", "2017-08-01", "2017-09-01", "2017-10-01", "2017-11-01"
];

const datasets = {
  elastic: [{
    url: "https://raw.githubusercontent.com/elastic/examples/master/Common%20Data%20Formats/apache_logs/apache_logs",
    file: "elastic-apache_logs.log"
  }],
  lukaszog: [{
    url: "https://gist.githubusercontent.com/lukaszog/e9e027245cbdc54d5d60db5ad9452220/raw/access.log",
    file: "lukaszog-access.log"
  }],
  secrepo: secrepoDays.map((day) => ({
    url: `https://www.secrepo.com/self.logs/access.log.${day}.gz`,
    file: `secrepo-access.log.${day}.gz`
  }))
};

function clientFor(url) {
  if (url.startsWith("https:")) return https;
  if (url.startsWith("http:")) return http;
  throw new Error(`unsupported URL scheme: ${url}`);
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = clientFor(url).get(url, { headers: { "user-agent": "ServerStory access fixture downloader" } }, (res) => {
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

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    console.log(`exists ${path.relative(root, file)}`);
    return;
  }
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  const res = await get(url);
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
  const selected = (process.argv[2] || "secrepo,elastic,lukaszog").split(",").map((name) => name.trim()).filter(Boolean);
  await fs.promises.mkdir(cacheDir, { recursive: true });
  for (const name of selected) {
    const items = datasets[name];
    if (!items) throw new Error(`unknown access dataset "${name}". Known: ${Object.keys(datasets).join(", ")}`);
    for (const item of items) {
      await download(item.url, path.join(cacheDir, item.file));
    }
  }
  console.log(`real access fixtures are in ${path.relative(root, cacheDir)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
