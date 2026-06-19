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

const maxMsPerMillionRows = Number(process.env.SERVERSTORY_REALWORLD_MAX_MS_PER_MILLION_ROWS || 45000);
const maxRssMb = Number(process.env.SERVERSTORY_REALWORLD_MAX_RSS_MB || 1200);
const requireRealworld = process.env.SERVERSTORY_REQUIRE_REALWORLD === "1";
const assetRe = /\.(css|js|png|gif|jpg|jpeg|webp|svg|ico)(\?|$)/i;
const legacyLineRe = /^(\S+)(?:[ \t]+\S+[ \t]+\S+)?[ \t]+\[([^\]]+)\][ \t]+"([A-Z]+)[ \t]+([^"]*?)(?:[ \t]+HTTP\/[0-9.]+)?"[ \t]+(\d{3})[ \t]+\S+/;
const keptStatuses = new Set([200, 201, 202, 204, 301, 302, 303, 307, 308]);

function files() {
  if (!fs.existsSync(cacheDir)) return [];
  return fs.readdirSync(cacheDir)
    .filter((name) => /\.(gz|Z)$/i.test(name))
    .map((name) => path.join(cacheDir, name))
    .sort();
}

function normalizeLegacyPath(target) {
  let value = String(target || "/").trim() || "/";
  let pathName;
  try {
    const parsed = new URL(value, "http://example.invalid");
    pathName = parsed.pathname || "/";
  } catch (_) {
    pathName = (value.startsWith("/") ? value : "/" + value).split("?")[0].split("#")[0] || "/";
  }
  try { pathName = decodeURI(pathName); } catch (_) {}
  pathName = pathName.replace(/\/{2,}/g, "/");
  pathName = pathName.replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/i, "/");
  return pathName === "/" ? "/" : pathName.replace(/\/$/, "");
}

function independentLegacyCountLine(line, counter) {
  if (!line || !line.trim()) return;
  counter.rows++;
  const match = legacyLineRe.exec(line);
  if (!match) {
    counter.unrecognized++;
    return;
  }
  counter.parsed++;
  const method = String(match[3] || "").toUpperCase();
  const pathName = normalizeLegacyPath(match[4]);
  const status = Number(match[5]);
  if (!keptStatuses.has(status)) return;
  if (method !== "GET" && method !== "POST") return;
  counter.kept++;
  counter.methods.set(method, (counter.methods.get(method) || 0) + 1);
  counter.statuses.set(String(status), (counter.statuses.get(String(status)) || 0) + 1);
  if (method === "GET" && status >= 200 && status < 300) {
    counter.pathHits.set(pathName, (counter.pathHits.get(pathName) || 0) + 1);
    if (!assetRe.test(pathName)) counter.pageViews++;
  }
}

function makeIndependentCounter() {
  return {
    rows: 0,
    parsed: 0,
    unrecognized: 0,
    kept: 0,
    pageViews: 0,
    statuses: new Map(),
    methods: new Map(),
    pathHits: new Map()
  };
}

function topMapEntries(map, limit = 25) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

async function analyzeFile(file) {
  const agg = ctx.makeAggregator({
    assetRe,
    gzip: false,
    maxTrackedClients: Number(process.env.SERVERSTORY_REALWORLD_TRACKED_CLIENTS || 200000)
  });
  const independent = makeIndependentCounter();
  let input;
  let proc = null;
  if (/\.Z$/i.test(file)) {
    proc = spawn("gzip", ["-dc", file], { stdio: ["ignore", "pipe", "ignore"] });
    input = proc.stdout;
  } else {
    input = fs.createReadStream(file).pipe(zlib.createGunzip());
  }
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let lines = 0;
  const maxLines = Number(process.env.SERVERSTORY_REALWORLD_MAX_LINES || 0);
  const startedAt = process.hrtime.bigint();
  try {
    for await (const line of rl) {
      agg.processLine(line);
      independentLegacyCountLine(line, independent);
      lines++;
      if (maxLines && lines >= maxLines) break;
    }
  } finally {
    rl.close();
    if (maxLines) {
      if (input && typeof input.destroy === "function") input.destroy();
      if (proc && !proc.killed) proc.kill();
    }
  }
  const result = agg.finalize();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return { result, independent, elapsedMs, truncated: !!maxLines };
}

async function readSampleLines(file, limit) {
  let input;
  let proc = null;
  if (/\.Z$/i.test(file)) {
    proc = spawn("gzip", ["-dc", file], { stdio: ["ignore", "pipe", "ignore"] });
    input = proc.stdout;
  } else {
    input = fs.createReadStream(file).pipe(zlib.createGunzip());
  }
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const lines = [];
  try {
    for await (const line of rl) {
      if (line && line.trim()) lines.push(line);
      if (lines.length >= limit) break;
    }
  } finally {
    rl.close();
    if (input && typeof input.destroy === "function") input.destroy();
    if (proc && !proc.killed) proc.kill();
  }
  return lines;
}

function analyzeLines(lines) {
  const agg = ctx.makeAggregator({
    assetRe,
    gzip: false,
    maxTrackedClients: 50000
  });
  for (const line of lines) agg.processLine(line);
  return agg.finalize();
}

function corruptEvery(lines, every) {
  return lines.map((line, index) => ((index + 1) % every === 0 ? `kaputte echte Logzeile ${index} %ZZ <script>alert(1)</script>` : line));
}

function shuffleBlocks(lines, blockSize) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += blockSize) blocks.push(lines.slice(i, i + blockSize));
  return blocks.reverse().flat();
}

function buildResult(agg) {
  return ctx.buildResult(agg, {
    assetRe,
    gzip: false
  });
}

async function assertFailureInjection(file) {
  const rel = path.relative(root, file);
  const sample = await readSampleLines(file, 12000);
  if (sample.length < 5000) throw new Error(`${rel}: not enough sample rows for failure injection`);

  const baseline = analyzeLines(sample);
  assertReliabilityContract(file, baseline);

  const mildlyBroken = analyzeLines(corruptEvery(sample, 10));
  const mildlyBuilt = buildResult(mildlyBroken);
  if (mildlyBroken.total !== baseline.total) throw new Error(`${rel}: mild corruption changed total rows`);
  if (mildlyBroken.unrecognized <= baseline.unrecognized) throw new Error(`${rel}: mild corruption did not increase unrecognized rows`);
  if (mildlyBuilt.diagnostics.pageviewReliability === "high") throw new Error(`${rel}: mild corruption kept high pageview reliability`);
  if (mildlyBuilt.claimMatrix.pageViews.status === "allowed") throw new Error(`${rel}: mild corruption allowed hard pageview claim`);

  const heavilyBroken = analyzeLines(corruptEvery(sample, 3));
  const heavilyBuilt = buildResult(heavilyBroken);
  if (heavilyBuilt.diagnostics.pageviewReliability !== "limited") throw new Error(`${rel}: heavy corruption must limit pageview reliability`);
  if (heavilyBuilt.claimMatrix.pageViews.status !== "blocked") throw new Error(`${rel}: heavy corruption must block pageview claim`);
  if (heavilyBuilt.decisionReadiness.pageViews.canUseForDecision) throw new Error(`${rel}: heavy corruption must not be decision-ready`);
  if (!/gelesen|Einträge|Zeilen|Datei|harte Aussage|Gesamtzahl/i.test(heavilyBuilt.evidenceFailures.pageViews.join(" "))) {
    throw new Error(`${rel}: heavy corruption lacks clear pageview evidence failure: ${heavilyBuilt.evidenceFailures.pageViews.join(" ")}`);
  }

  const truncated = analyzeLines(sample.slice(0, 500));
  const truncatedBuilt = buildResult(truncated);
  if (truncated.total >= baseline.total) throw new Error(`${rel}: truncated sample did not shrink`);
  if (truncatedBuilt.exportCompleteness.reliability === "high") throw new Error(`${rel}: truncated realworld sample must not look fully reliable`);

  const unsorted = analyzeLines(shuffleBlocks(sample, 250));
  const unsortedBuilt = buildResult(unsorted);
  if (unsorted.timeRegressions <= 0) throw new Error(`${rel}: unsorted sample did not record time regressions`);
  if (!/zeitlich sortiert|Archivformat ohne Browserkennung/i.test(unsortedBuilt.evidenceFailures.visits.join(" "))) {
    throw new Error(`${rel}: unsorted sample lacks visitor evidence warning`);
  }

  console.log(`realworld negative ok - ${rel}: corruption, truncation and ordering guarded`);
}

function countFromTopEntries(entries, name) {
  if (entries && typeof entries.get === "function") return entries.get(name) || 0;
  const found = entries.find((entry) => entry.name === name);
  return found ? found.count : 0;
}

function assertDifferentialCounter(file, result, independent) {
  const rel = path.relative(root, file);
  if (independent.rows !== result.total) throw new Error(`${rel}: differential rows mismatch ${independent.rows} vs ${result.total}`);
  if (independent.parsed !== result.parsed) throw new Error(`${rel}: differential parsed mismatch ${independent.parsed} vs ${result.parsed}`);
  if (independent.unrecognized !== result.unrecognized) throw new Error(`${rel}: differential unrecognized mismatch ${independent.unrecognized} vs ${result.unrecognized}`);
  if (independent.kept !== result.kept) throw new Error(`${rel}: differential kept mismatch ${independent.kept} vs ${result.kept}`);
  if (independent.pageViews !== result.pageViews) throw new Error(`${rel}: differential pageviews mismatch ${independent.pageViews} vs ${result.pageViews}`);

  for (const [status, count] of topMapEntries(independent.statuses, 12)) {
    const actual = countFromTopEntries(result.statusCounts, status);
    if (actual !== count) throw new Error(`${rel}: differential status ${status} mismatch ${actual} vs ${count}`);
  }
  for (const [method, count] of topMapEntries(independent.methods, 6)) {
    const actual = countFromTopEntries(result.methodCounts, method);
    if (actual !== count) throw new Error(`${rel}: differential method ${method} mismatch ${actual} vs ${count}`);
  }
  for (const [pathName, count] of topMapEntries(independent.pathHits, 20)) {
    const actual = result.pathCounts.get(pathName) || 0;
    if (actual !== count) throw new Error(`${rel}: differential path ${pathName} mismatch ${actual} vs ${count}`);
  }
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
  if (built.decisionReadiness.visits.canUseForDecision) throw new Error(`${rel}: legacy visits must not be decision-ready`);
  if (built.decisionReadiness.visits.decisionRisk === "low") throw new Error(`${rel}: legacy visits risk must not be low`);
  if (built.decisionReadiness.botAnomaly && built.decisionReadiness.botAnomaly.decisionRisk === "low") throw new Error(`${rel}: legacy bot risk must not be low`);
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
    const message = "realworld skipped - run `node scripts/download-realworld-fixtures.js epa,nasa` first";
    if (requireRealworld) throw new Error(message);
    console.log(message);
    return;
  }
  for (const file of cached) {
    const { result, independent, elapsedMs, truncated } = await analyzeFile(file);
    const rel = path.relative(root, file);
    assertDifferentialCounter(file, result, independent);
    assertReliabilityContract(file, result);
    assertKnownAnswer(file, result, elapsedMs, truncated);
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > maxRssMb) throw new Error(`${rel}: RSS ${Math.round(rssMb)} MB exceeds budget ${maxRssMb} MB`);
    const mode = truncated ? "sample" : "full";
    console.log(`realworld ok - ${rel}: ${result.total} rows, ${result.pageViews} pageviews, ${result.visits} visits, ${Math.round(elapsedMs)}ms, ${Math.round(rssMb)}MB RSS, ${mode}`);
  }
  await assertFailureInjection(cached[0]);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
