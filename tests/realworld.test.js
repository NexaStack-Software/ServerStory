const fs = require("fs");
const path = require("path");
const readline = require("readline");
const vm = require("vm");
const zlib = require("zlib");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const cacheDir = path.join(__dirname, "realworld-cache");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = script.slice(0, script.indexOf("function setSignal"));

const ctx = {
  console,
  URL,
  Blob,
  TextDecoderStream,
  DecompressionStream,
  setTimeout,
  clearTimeout,
  window: { matchMedia: () => ({ matches: false }) },
  document: { getElementById: () => ({ value: "", checked: false }) }
};

vm.createContext(ctx);
vm.runInContext(cut, ctx);

function files() {
  if (!fs.existsSync(cacheDir)) return [];
  return fs.readdirSync(cacheDir)
    .filter((name) => /\.(gz|Z)$/i.test(name))
    .map((name) => path.join(cacheDir, name))
    .sort();
}

async function analyzeFile(file) {
  const agg = ctx.makeAggregator({
    assetRe: /\.(css|js|png|gif|jpg|jpeg|webp|svg|ico)(\?|$)/i,
    gzip: false,
    maxTrackedClients: Number(process.env.SERVERSTORY_REALWORLD_TRACKED_CLIENTS || 200000)
  });
  let input;
  if (/\.Z$/i.test(file)) {
    const proc = spawn("gzip", ["-dc", file], { stdio: ["ignore", "pipe", "inherit"] });
    input = proc.stdout;
  } else {
    input = fs.createReadStream(file).pipe(zlib.createGunzip());
  }
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let lines = 0;
  const maxLines = Number(process.env.SERVERSTORY_REALWORLD_MAX_LINES || 0);
  for await (const line of rl) {
    agg.processLine(line);
    lines++;
    if (maxLines && lines >= maxLines) break;
  }
  rl.close();
  return agg.finalize();
}

(async () => {
  const cached = files();
  if (!cached.length) {
    console.log("realworld skipped - run `node scripts/download-realworld-fixtures.js epa,nasa` first");
    return;
  }
  for (const file of cached) {
    const result = await analyzeFile(file);
    const rel = path.relative(root, file);
    if (result.total <= 1000) throw new Error(`${rel}: too few rows (${result.total})`);
    if (result.parsed <= 0) throw new Error(`${rel}: no parsed rows`);
    if (result.formatKind !== "legacy_http_archive") throw new Error(`${rel}: expected legacy_http_archive, got ${result.formatKind}`);
    const recognitionRate = result.dataRows ? result.parsed / result.dataRows : 0;
    if (recognitionRate < 0.95) throw new Error(`${rel}: low recognition rate ${recognitionRate}`);
    if (result.legacyNoUserAgent <= 0) throw new Error(`${rel}: expected no-user-agent rows`);
    if (result.pageViews <= 0) throw new Error(`${rel}: no pageviews`);
    console.log(`realworld ok - ${rel}: ${result.total} rows, ${result.pageViews} pageviews, ${result.visits} visits`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
