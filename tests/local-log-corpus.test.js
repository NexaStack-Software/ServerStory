const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const corpusDir = process.env.SERVERSTORY_LOCAL_LOG_DIR || path.join(os.homedir(), "test-logs");
const requireLocal = process.env.SERVERSTORY_REQUIRE_LOCAL_LOGS === "1";
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

function analyzeFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const agg = ctx.makeAggregator({ assetRe, gzip: false, maxTrackedClients: 200000 });
  for (const line of text.split(/\r?\n/)) agg.processLine(line);
  const result = agg.finalize();
  return ctx.buildResult(result, { assetRe, gzip: false });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fileMap() {
  if (!fs.existsSync(corpusDir)) return new Map();
  return new Map(fs.readdirSync(corpusDir)
    .filter((name) => /\.log$/i.test(name))
    .sort()
    .map((name) => [name, path.join(corpusDir, name)]));
}

const files = fileMap();
if (!files.size) {
  const message = `local log corpus skipped - set SERVERSTORY_LOCAL_LOG_DIR or create ${corpusDir}`;
  if (requireLocal) throw new Error(message);
  console.log(message);
  process.exit(0);
}

assert(files.size >= 20, `expected at least 20 local logs, got ${files.size}`);

const results = new Map();
for (const [name, file] of files) {
  const result = analyzeFile(file);
  results.set(name, result);
  assert(result.total > 0, `${name}: no rows`);
  assert(result.parsed + result.unrecognized > 0, `${name}: no data rows`);
  assert(result.formatKind !== "unknown", `${name}: unknown format`);
  assert(result.decisionReadiness.pageViews, `${name}: missing pageview decision`);
  assert(result.decisionReadiness.visits, `${name}: missing visits decision`);
  if (result.claimMatrix.pageViews.status !== "allowed") {
    assert((result.evidenceFailures.pageViews || []).length > 0, `${name}: limited pageviews need evidence`);
  }
  console.log(`local corpus ok - ${name}: ${result.total} rows, ${result.pageViews} pageviews, ${result.visits} visits, ${result.formatKind}, scan=${result.scanRequests || 0}`);
}

const elastic = results.get("elastic_apache_blog.log");
assert(elastic, "missing elastic_apache_blog.log");
assert(elastic.total === 10000, `elastic rows changed: ${elastic.total}`);
assert(elastic.pageViews === 2904, `elastic pageviews changed: ${elastic.pageViews}`);
assert(elastic.visits === 2272, `elastic visits changed: ${elastic.visits}`);

const googlebot = results.get("adorsys_googlebot.log");
assert(googlebot, "missing adorsys_googlebot.log");
assert(googlebot.kept === 0, "googlebot corpus should have no kept visitor rows");
assert(googlebot.pageViews === 0, "googlebot corpus must not create pageviews");
assert(googlebot.visits === 0, "googlebot corpus must not create visits");
assert(googlebot.claimMatrix.pageViews.status !== "allowed", "googlebot corpus must not allow pageviews");

const malware = results.get("bediger4000_php_malware.log");
assert(malware, "missing bediger4000_php_malware.log");
assert(malware.scanRequests >= 20, `malware scan count too low: ${malware.scanRequests}`);
assert(malware.diagnostics.scanTrafficRisk, "malware corpus must raise scan traffic risk");
assert(malware.claimMatrix.pageViews.status !== "allowed", "malware corpus must not allow pageviews");
assert(malware.claimMatrix.visits.status !== "allowed", "malware corpus must not allow visits");

const ctf = results.get("ucrcyber_ncl2016.log");
assert(ctf, "missing ucrcyber_ncl2016.log");
assert(ctf.scanRequests >= 10, `ctf scan count too low: ${ctf.scanRequests}`);
assert(ctf.claimMatrix.pageViews.status === "blocked", "ctf corpus must block pageviews");

console.log(`local log corpus ok (${files.size} files from ${corpusDir})`);
