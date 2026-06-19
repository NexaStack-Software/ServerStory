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

const expected = {
  "epa-1-epa-http.txt.Z": {
    rows: 47748,
    parsed: 47721,
    pageViews: 17915,
    visits: 2899
  },
  "nasa-1-NASA_access_log_Jul95.gz": {
    rows: 1891715,
    parsed: 1891695,
    pageViews: 702639,
    visits: 158312
  },
  "nasa-2-NASA_access_log_Aug95.gz": {
    rows: 1569898,
    parsed: 1569870,
    pageViews: 526842,
    visits: 138603
  }
};

const maxMsPerMillionRows = Number(process.env.SERVERSTORY_REALWORLD_MAX_MS_PER_MILLION_ROWS || 20000);
const maxRssMb = Number(process.env.SERVERSTORY_REALWORLD_MAX_RSS_MB || 1200);

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
  const startedAt = process.hrtime.bigint();
  for await (const line of rl) {
    agg.processLine(line);
    lines++;
    if (maxLines && lines >= maxLines) break;
  }
  rl.close();
  const result = agg.finalize();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return { result, elapsedMs, truncated: !!maxLines };
}

function buildResult(agg) {
  return ctx.buildResult(agg, {
    assetRe: /\.(css|js|png|gif|jpg|jpeg|webp|svg|ico)(\?|$)/i,
    gzip: false
  });
}

function assertKnownAnswer(file, result, elapsedMs, truncated) {
  const base = path.basename(file);
  const rel = path.relative(root, file);
  const known = expected[base];
  if (!known || truncated) return;
  if (result.total !== known.rows) throw new Error(`${rel}: expected ${known.rows} rows, got ${result.total}`);
  if (result.parsed !== known.parsed) throw new Error(`${rel}: expected ${known.parsed} parsed rows, got ${result.parsed}`);
  if (result.pageViews !== known.pageViews) throw new Error(`${rel}: expected ${known.pageViews} pageviews, got ${result.pageViews}`);
  if (result.visits !== known.visits) throw new Error(`${rel}: expected ${known.visits} visits, got ${result.visits}`);
  const budgetMs = Math.max(3000, (known.rows / 1000000) * maxMsPerMillionRows);
  if (elapsedMs > budgetMs) throw new Error(`${rel}: runtime ${Math.round(elapsedMs)}ms exceeds budget ${Math.round(budgetMs)}ms`);
}

function assertReliabilityContract(file, result) {
  const rel = path.relative(root, file);
  if (result.total <= 1000) throw new Error(`${rel}: too few rows (${result.total})`);
  if (result.parsed <= 0) throw new Error(`${rel}: no parsed rows`);
  if (result.formatKind !== "legacy_http_archive") throw new Error(`${rel}: expected legacy_http_archive, got ${result.formatKind}`);
  const recognitionRate = result.dataRows ? result.parsed / result.dataRows : 0;
  if (recognitionRate < 0.99) throw new Error(`${rel}: low recognition rate ${recognitionRate}`);
  if (result.legacyNoUserAgent !== result.kept) throw new Error(`${rel}: expected all kept rows without user-agent`);
  if (result.pageViews <= 0) throw new Error(`${rel}: no pageviews`);

  const built = buildResult(result);
  if (built.diagnostics.pageviewReliability !== "high") throw new Error(`${rel}: pageviews should remain highly readable`);
  if (built.diagnostics.visitorReliability !== "medium") throw new Error(`${rel}: legacy visits must be medium reliability`);
  if (built.diagnostics.botReliability !== "limited") throw new Error(`${rel}: legacy bot reliability must be limited`);
  if (built.claimMatrix.visits.status !== "limited") throw new Error(`${rel}: visits claim must be limited`);
  if (!/Archivformat ohne Browserkennung/.test(built.evidenceFailures.visits.join(" "))) {
    throw new Error(`${rel}: missing legacy visitor evidence failure`);
  }
  if (!/Archivformat ohne Browserkennung/.test(built.exportCompleteness.reasons.join(" "))) {
    throw new Error(`${rel}: missing legacy export completeness note`);
  }
}

(async () => {
  const cached = files();
  if (!cached.length) {
    console.log("realworld skipped - run `node scripts/download-realworld-fixtures.js epa,nasa` first");
    return;
  }
  for (const file of cached) {
    const { result, elapsedMs, truncated } = await analyzeFile(file);
    const rel = path.relative(root, file);
    assertReliabilityContract(file, result);
    assertKnownAnswer(file, result, elapsedMs, truncated);
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > maxRssMb) throw new Error(`${rel}: RSS ${Math.round(rssMb)} MB exceeds budget ${maxRssMb} MB`);
    const mode = truncated ? "sample" : "full";
    console.log(`realworld ok - ${rel}: ${result.total} rows, ${result.pageViews} pageviews, ${result.visits} visits, ${Math.round(elapsedMs)}ms, ${Math.round(rssMb)}MB RSS, ${mode}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
