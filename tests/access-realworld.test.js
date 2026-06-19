const fs = require("fs");
const path = require("path");
const readline = require("readline");
const vm = require("vm");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const cacheDir = path.join(__dirname, "access-cache");
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

const assetRe = /\.(css|js|png|gif|jpg|jpeg|webp|svg|ico)(\?|$)/i;
const keptStatuses = new Set([200, 201, 202, 204, 301, 302, 303, 307, 308]);
const botRe = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|linkedinbot|twitterbot|preview|monitor|uptime|pingdom|headless|python-requests|curl|wget/i;
const combinedRe = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^"]*?)\s+(HTTP\/[0-9.]+)"\s+(\d{3})\s+\S+\s+"([^"]*)"\s+"([^"]*)"(.*)$/;
const legacyRe = /^(\S+)(?:[ \t]+\S+[ \t]+\S+)?[ \t]+\[([^\]]+)\][ \t]+"([A-Z]+)[ \t]+([^"]*?)(?:[ \t]+HTTP\/[0-9.]+)?"[ \t]+(\d{3})[ \t]+\S+/;
const requireAccess = process.env.SERVERSTORY_REQUIRE_ACCESS_REALWORLD === "1";
const maxMsPerMillionRows = Number(process.env.SERVERSTORY_ACCESS_MAX_MS_PER_MILLION_ROWS || 30000);
const maxRssMb = Number(process.env.SERVERSTORY_ACCESS_MAX_RSS_MB || 800);

function files() {
  if (!fs.existsSync(cacheDir)) return [];
  return fs.readdirSync(cacheDir)
    .filter((name) => /\.(gz|log|txt)$/i.test(name))
    .map((name) => path.join(cacheDir, name))
    .sort();
}

function normalizePath(target) {
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

function counter() {
  return {
    rows: 0,
    parsed: 0,
    unrecognized: 0,
    kept: 0,
    pageViews: 0,
    referrerRows: 0,
    userAgentRows: 0,
    botRows: 0,
    statuses: new Map(),
    methods: new Map(),
    pathHits: new Map()
  };
}

function countLine(line, c) {
  if (!line || !line.trim()) return;
  c.rows++;
  let match = combinedRe.exec(line);
  let noUserAgent = false;
  if (!match) {
    match = legacyRe.exec(line);
    noUserAgent = !!match;
  }
  if (!match) {
    c.unrecognized++;
    return;
  }
  c.parsed++;
  const method = String(match[3] || "").toUpperCase();
  const pathName = normalizePath(match[4]);
  const status = Number(noUserAgent ? match[5] : match[6]);
  const referrer = noUserAgent ? "" : (match[7] || "");
  const ua = noUserAgent ? "__legacy_no_user_agent__" : (match[8] || "");
  if (referrer && referrer !== "-") c.referrerRows++;
  if (ua && ua !== "-") c.userAgentRows++;
  if (botRe.test(ua)) c.botRows++;
  if (!keptStatuses.has(status)) return;
  if (method !== "GET" && method !== "POST") return;
  if (!noUserAgent) {
    if (ua.trim() === "" || ua.trim() === "-" || ua.trim().length < 8) return;
    if (botRe.test(ua)) return;
  }
  c.kept++;
  c.methods.set(method, (c.methods.get(method) || 0) + 1);
  c.statuses.set(String(status), (c.statuses.get(String(status)) || 0) + 1);
  if (method === "GET" && status >= 200 && status < 300) {
    c.pathHits.set(pathName, (c.pathHits.get(pathName) || 0) + 1);
    if (!assetRe.test(pathName)) c.pageViews++;
  }
}

function topMapEntries(map, limit = 25) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

function countFromTopEntries(entries, name) {
  if (entries && typeof entries.get === "function") return entries.get(name) || 0;
  const found = entries.find((entry) => entry.name === name);
  return found ? found.count : 0;
}

async function processFileInto(file, agg, independent, maxLines, linesSeen) {
  const input = /\.gz$/i.test(file) ? fs.createReadStream(file).pipe(zlib.createGunzip()) : fs.createReadStream(file);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let lines = linesSeen;
  try {
    for await (const line of rl) {
      agg.processLine(line);
      countLine(line, independent);
      lines++;
      if (maxLines && lines >= maxLines) break;
    }
  } finally {
    rl.close();
    if (maxLines && lines >= maxLines && input && typeof input.destroy === "function") input.destroy();
  }
  return lines;
}

async function analyzeFiles(inputFiles) {
  const agg = ctx.makeAggregator({
    assetRe,
    gzip: false,
    maxTrackedClients: Number(process.env.SERVERSTORY_ACCESS_TRACKED_CLIENTS || 200000)
  });
  const independent = counter();
  const maxLines = Number(process.env.SERVERSTORY_ACCESS_MAX_LINES || 0);
  let lines = 0;
  const startedAt = process.hrtime.bigint();
  for (const file of inputFiles) {
    lines = await processFileInto(file, agg, independent, maxLines, lines);
    if (maxLines && lines >= maxLines) break;
  }
  const result = agg.finalize();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return { result, independent, elapsedMs, truncated: !!maxLines };
}

async function analyzeFile(file) {
  return analyzeFiles([file]);
}

function assertDifferential(label, result, independent) {
  const rel = Array.isArray(label) ? label.join(", ") : String(label);
  if (independent.rows !== result.total) throw new Error(`${rel}: rows mismatch ${independent.rows} vs ${result.total}`);
  if (independent.parsed !== result.parsed) throw new Error(`${rel}: parsed mismatch ${independent.parsed} vs ${result.parsed}`);
  if (independent.unrecognized !== result.unrecognized) throw new Error(`${rel}: unrecognized mismatch ${independent.unrecognized} vs ${result.unrecognized}`);
  if (independent.kept !== result.kept) throw new Error(`${rel}: kept mismatch ${independent.kept} vs ${result.kept}`);
  if (independent.pageViews !== result.pageViews) throw new Error(`${rel}: pageviews mismatch ${independent.pageViews} vs ${result.pageViews}`);
  for (const [status, count] of topMapEntries(independent.statuses, 12)) {
    const actual = countFromTopEntries(result.statusCounts, status);
    if (actual !== count) throw new Error(`${rel}: status ${status} mismatch ${actual} vs ${count}`);
  }
  for (const [method, count] of topMapEntries(independent.methods, 6)) {
    const actual = countFromTopEntries(result.methodCounts, method);
    if (actual !== count) throw new Error(`${rel}: method ${method} mismatch ${actual} vs ${count}`);
  }
  for (const [pathName, count] of topMapEntries(independent.pathHits, 20)) {
    const actual = result.pathCounts.get(pathName) || 0;
    if (actual !== count) throw new Error(`${rel}: path ${pathName} mismatch ${actual} vs ${count}`);
  }
}

function buildResult(agg) {
  return ctx.buildResult(agg, { assetRe, gzip: false });
}

function assertReliability(label, result, independent, elapsedMs) {
  const rel = Array.isArray(label) ? label.join(", ") : String(label);
  if (result.formatKind !== "combined") throw new Error(`${rel}: expected combined format, got ${result.formatKind}`);
  const recognitionRate = result.dataRows ? result.parsed / result.dataRows : 0;
  if (recognitionRate < 0.98) throw new Error(`${rel}: low recognition rate ${recognitionRate}`);
  if (independent.userAgentRows < result.parsed * 0.9) throw new Error(`${rel}: not enough user-agent coverage`);
  if (result.pageViews <= 0) throw new Error(`${rel}: no pageviews`);
  if (result.total < 1000) return "smoke";

  const built = buildResult(result);
  if (built.diagnostics.pageviewReliability !== "high") throw new Error(`${rel}: pageviews should be high reliability`);
  if (built.diagnostics.botReliability === "limited" && !built.diagnostics.scanTrafficRisk) {
    throw new Error(`${rel}: limited bot reliability needs scan/suspicious evidence`);
  }
  if (built.claimMatrix.pageViews.status === "allowed") {
    if (!built.decisionReadiness.pageViews.canUseForDecision) throw new Error(`${rel}: allowed pageviews should be decision-ready`);
  } else {
    if (!(built.evidenceFailures.pageViews || []).length) throw new Error(`${rel}: limited pageviews need a concrete evidence failure`);
    if (built.decisionReadiness.pageViews.canUseForDecision) throw new Error(`${rel}: limited pageviews must not be decision-ready`);
  }
  if (built.decisionReadiness.visits.canUseForDecision) {
    if (built.diagnostics.visitorReliability !== "high") throw new Error(`${rel}: decision-ready visits need high visitor reliability`);
    if ((built.evidenceFailures.visits || []).length) throw new Error(`${rel}: decision-ready visits still have evidence failures`);
  }

  const budgetMs = Math.max(3000, (result.total / 1000000) * maxMsPerMillionRows);
  if (elapsedMs > budgetMs) throw new Error(`${rel}: runtime ${Math.round(elapsedMs)}ms exceeds budget ${Math.round(budgetMs)}ms`);
  return "full";
}

async function assertCombinedSecRepoCorpus(cached) {
  const secrepo = cached.filter((file) => /secrepo-access\.log\./.test(path.basename(file)));
  if (secrepo.length < 10) return;
  const label = "tests/access-cache/secrepo-combined-corpus";
  const { result, independent, elapsedMs, truncated } = await analyzeFiles(secrepo);
  assertDifferential(label, result, independent);
  const reliabilityMode = assertReliability(label, result, independent, elapsedMs);
  if (result.visits < 1000) throw new Error(`${label}: expected more than 1000 visits, got ${result.visits}`);
  if (result.total < 10000) throw new Error(`${label}: expected more than 10000 rows, got ${result.total}`);
  const rssMb = process.memoryUsage().rss / (1024 * 1024);
  if (rssMb > maxRssMb) throw new Error(`${label}: RSS ${Math.round(rssMb)} MB exceeds budget ${maxRssMb} MB`);
  const mode = truncated ? "sample" : "full";
  console.log(`access realworld ok - ${label}: ${result.total} rows, ${result.pageViews} pageviews, ${result.visits} visits, ${Math.round(elapsedMs)}ms, ${Math.round(rssMb)}MB RSS, ${mode}, ${reliabilityMode}`);
}

(async () => {
  const cached = files();
  if (!cached.length) {
    const message = "access realworld skipped - run `node scripts/download-access-fixtures.js secrepo,elastic,lukaszog` first";
    if (requireAccess) throw new Error(message);
    console.log(message);
    return;
  }
  for (const file of cached) {
    const { result, independent, elapsedMs, truncated } = await analyzeFile(file);
    const rel = path.relative(root, file);
    assertDifferential(rel, result, independent);
    const reliabilityMode = assertReliability(rel, result, independent, elapsedMs);
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > maxRssMb) throw new Error(`${rel}: RSS ${Math.round(rssMb)} MB exceeds budget ${maxRssMb} MB`);
    const mode = truncated ? "sample" : "full";
    console.log(`access realworld ok - ${rel}: ${result.total} rows, ${result.pageViews} pageviews, ${result.visits} visits, ${Math.round(elapsedMs)}ms, ${Math.round(rssMb)}MB RSS, ${mode}, ${reliabilityMode}`);
  }
  await assertCombinedSecRepoCorpus(cached);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
