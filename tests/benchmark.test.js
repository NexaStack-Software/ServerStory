const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.match(/<script>\n([\s\S]*?)\n\s*<\/script>/)[1];

function element() {
  return {
    value: "",
    files: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    scrollIntoView() {}
  };
}

const elements = new Map();
function getElementById(name) {
  if (!elements.has(name)) elements.set(name, element());
  return elements.get(name);
}

const ctx = {
  console,
  URL,
  Blob,
  TextDecoderStream,
  DecompressionStream,
  setTimeout,
  clearTimeout,
  location: { protocol: "file:" },
  window: { matchMedia: () => ({ matches: true }) },
  document: { getElementById, querySelectorAll: () => [] },
  navigator: { clipboard: { writeText: async () => {} } }
};
vm.createContext(ctx);
vm.runInContext(script, ctx);

const makeAggregator = vm.runInContext("makeAggregator", ctx);

function line(ip, minute, pathName, status = 200, ua = "Mozilla/5.0 Chrome/124.0 Safari/537.36") {
  const hh = String(10 + Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${ip} - - [05/Jun/2026:${hh}:${mm}:00 +0200] "GET ${pathName} HTTP/1.1" ${status} 1200 "-" "${ua}"`;
}

function buildCorpus(visitors = 1500) {
  const lines = [];
  for (let i = 0; i < visitors; i++) {
    const ip = `203.0.${Math.floor(i / 250)}.${i % 250}`;
    const minute = i % 240;
    lines.push(line(ip, minute, `/produkt/${i % 30}`));
    lines.push(line(ip, minute + 1, `/preise`));
    if (i % 12 === 0) lines.push(line(ip, minute + 2, `/checkout/danke?order_id=B-${i}`));
    if (i % 17 === 0) lines.push(line(ip, minute + 3, `/assets/app.css`));
  }
  return lines;
}

const corpus = buildCorpus();
function runBenchmark() {
  const agg = makeAggregator({
    assetRe: /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?)(\?|$)/i,
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true,
    maxTrackedClients: 100000
  });
  const started = process.hrtime.bigint();
  for (const entry of corpus) agg.processLine(entry);
  const analyzed = agg.finalize();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const rowsPerSecond = analyzed.total / Math.max(0.001, elapsedMs / 1000);
  return { analyzed, rowsPerSecond };
}

const runs = [runBenchmark(), runBenchmark(), runBenchmark()];
const { analyzed, rowsPerSecond } = runs.sort((a, b) => b.rowsPerSecond - a.rowsPerSecond)[0];
const recognitionRate = analyzed.dataRows ? analyzed.parsed / analyzed.dataRows : 0;

assert.strictEqual(analyzed.total, corpus.length);
assert.ok(recognitionRate >= 0.99);
assert.ok(analyzed.visits >= 1500);
assert.ok(analyzed.pageViews >= 3000);
assert.ok(analyzed.success >= 100);
assert.strictEqual(analyzed.trackingCapped, false);
assert.ok(rowsPerSecond >= 50000, `benchmark too slow: ${Math.round(rowsPerSecond)} rows/s`);

console.log(`benchmark ok (${analyzed.total} rows, ${Math.round(rowsPerSecond)} rows/s)`);
