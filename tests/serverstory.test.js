const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
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

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function fixturePath(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", ...name.split("/")), "utf8");
}

function fixtureNames(dir = path.join(__dirname, "fixtures"), prefix = "") {
  const names = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      names.push(...fixtureNames(path.join(dir, entry.name), prefix + entry.name + "/"));
    } else {
      names.push(prefix + entry.name);
    }
  }
  return names;
}

function combined(ip, stamp, target, status = 200, ua = "Mozilla/5.0 Chrome/124.0 Safari/537.36", method = "GET", extra = "") {
  return `${ip} - - [${stamp}] "${method} ${target} HTTP/1.1" ${status} 123 "-" "${ua}"${extra}`;
}

function cloudflareEvent(ip, iso, target, status = 200, ua = "Mozilla/5.0 Chrome/124.0 Safari/537.36", options = {}) {
  const host = options.host || "example.test";
  return JSON.stringify({
    EdgeStartTimestamp: iso,
    ClientIP: ip,
    ClientRequestMethod: "GET",
    ClientRequestURI: `https://${host}${target}`,
    ClientRequestHost: host,
    EdgeResponseStatus: status,
    ClientRequestUserAgent: ua,
    ClientRequestHeaderXForwardedFor: options.xff || ip
  });
}

function fastlyEvent(ip, iso, target, status = 200, ua = "Mozilla/5.0 Chrome/124.0 Safari/537.36") {
  return JSON.stringify({
    timestamp: iso,
    client_ip: ip,
    method: "GET",
    request: target,
    host: "example.test",
    status,
    user_agent: ua,
    fastly_info_state: "HIT"
  });
}

function akamaiEvent(ip, iso, target, status = 200, ua = "Mozilla/5.0 Chrome/124.0 Safari/537.36") {
  return JSON.stringify({
    start: iso,
    ip,
    reqMethod: "GET",
    reqPath: target,
    reqHost: "example.test",
    statusCode: status,
    userAgent: ua,
    cp: "edge"
  });
}

function cloudfrontFixture() {
  return [
    "#Version: 1.0",
    "#Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer) cs(User-Agent) cs-uri-query",
    "2026-06-05 10:00:00 FRA56-P1 100 203.0.113.10 GET example.test /preise 200 - Mozilla/5.0 -",
    "2026-06-05 10:02:00 FRA56-P1 100 203.0.113.10 GET example.test /assets/app.css 200 - Mozilla/5.0 -",
    "2026-06-05 10:10:00 FRA56-P1 100 203.0.113.10 GET example.test /checkout/danke 200 - Mozilla/5.0 order_id=A1",
    "2026-06-05 10:12:00 FRA56-P1 100 203.0.113.10 GET example.test /checkout/danke 200 - Mozilla/5.0 order_id=A1",
    "2026-06-05 11:00:00 FRA56-P1 100 203.0.113.11 GET example.test /preise 200 - Mozilla/5.0 -",
    "2026-06-05 11:05:00 FRA56-P1 100 203.0.113.12 GET example.test /api/ping 500 - Mozilla/5.0 -"
  ].join("\n");
}

function analyze(text, config = {}) {
  const agg = ctx.makeAggregator({
    assetRe: /\.(css|js|png)(\?|$)/i,
    gzip: false,
    ...config
  });
  for (const line of text.split("\n")) agg.processLine(line);
  return agg.finalize();
}

function withDomValues(values, fn) {
  const previous = ctx.document.getElementById;
  ctx.document.getElementById = (name) => values[name] || { value: "", checked: false };
  try {
    return fn();
  } finally {
    ctx.document.getElementById = previous;
  }
}

function buildResultFor(text, config = {}, values = {}) {
  return withDomValues(values, () => ctx.buildResult(analyze(text, config), {
    assetRe: /\.(css|js|png)(\?|$)/i,
    gzip: false,
    ...config
  }));
}

function assertAggregatorInvariants(result) {
  assert.strictEqual(result.parsed + result.unrecognized + result.meta, result.total);
  assert.strictEqual(result.kept + result.filtered, result.parsed);
  assert.ok(result.pageViews <= result.kept);
  assert.ok(result.success <= result.successRaw);
  assert.ok(result.visits <= result.kept);
  for (const value of [
    result.total, result.dataRows, result.parsed, result.unrecognized, result.meta, result.kept,
    result.pageViews, result.filtered, result.visits, result.successRaw, result.success,
    result.adVisitors, result.adSuccess, result.timeRegressions, result.xffUsed, result.xffMissing,
    result.xffPrivate, result.suspiciousClients
  ]) {
    assert.strictEqual(Number.isFinite(value), true);
    assert.ok(value >= 0);
  }
}

function assertBuiltResultInvariants(result) {
  assertAggregatorInvariants(result);
  assert.ok(result.diagnostics.recognitionRate >= 0);
  assert.ok(result.diagnostics.recognitionRate <= 1);
  assert.ok(["high", "medium", "limited"].includes(result.diagnostics.pageviewReliability));
  assert.ok(["high", "medium", "limited"].includes(result.diagnostics.visitorReliability));
  assert.ok(["high", "medium", "limited"].includes(result.diagnostics.ga4Reliability));
  assert.ok(["high", "medium", "limited", "none"].includes(result.diagnostics.conversionReliability));
  assert.ok(["high", "medium"].includes(result.diagnostics.trackingReliability));
  assert.ok(result.visitorRange.low <= result.visitorRange.high);
  assert.ok(result.visitorRange.low >= 1 || result.visits === 0);
}

function createElement() {
  const classes = new Set();
  const listeners = new Map();
  return {
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    files: [],
    open: false,
    disabled: false,
    style: {},
    className: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !classes.has(name) : !!force;
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
      contains: (name) => classes.has(name)
    },
    addEventListener(type, fn) { listeners.set(type, fn); },
    click() { if (listeners.has("click")) return listeners.get("click")(); },
    scrollIntoView() {}
  };
}

function createRenderContext() {
  const elements = new Map();
  const get = (name) => {
    if (!elements.has(name)) elements.set(name, createElement());
    return elements.get(name);
  };
  const renderCtx = {
    console,
    URL,
    Blob,
    TextDecoderStream,
    DecompressionStream,
    setTimeout,
    clearTimeout,
    location: { protocol: "file:" },
    window: { matchMedia: () => ({ matches: true }) },
    document: {
      getElementById: get,
      querySelectorAll: () => []
    },
    navigator: { clipboard: { writeText: async (text) => { renderCtx.__clipboard = text; } } },
    __clipboard: ""
  };
  vm.createContext(renderCtx);
  vm.runInContext(script, renderCtx);
  return { ctx: renderCtx, get };
}

function visibleDecisionText(ui) {
  return [
    "headline", "subline", "action", "table-caption", "compare-note", "purchase-note",
    "proxy-hint", "recognition-hint", "chrono-hint", "precision-checklist",
    "q-visits", "q-visits-reason", "q-views", "q-views-reason",
    "q-purchases", "q-purchases-reason", "q-ga4", "q-ga4-reason",
    "q-host", "q-host-reason", "q-bot", "q-bot-reason", "q-tracking", "q-tracking-reason"
  ].map((key) => `${ui.get(key).textContent || ""} ${ui.get(key).innerHTML || ""}`).join("\n");
}

function stableReport(report) {
  const copy = JSON.parse(JSON.stringify(report));
  delete copy.generatedAt;
  delete copy.timeRange;
  return copy;
}

async function copyReportFor(data) {
  const ui = createRenderContext();
  ui.ctx.render(data);
  await ui.get("copy-report").click();
  return JSON.parse(ui.ctx.__clipboard);
}

const baselineCombined = [
  combined("203.0.113.10", "05/Jun/2026:10:00:00 +0000", "/preise?gclid=abc"),
  combined("203.0.113.10", "05/Jun/2026:10:02:00 +0000", "/assets/app.css"),
  combined("203.0.113.10", "05/Jun/2026:10:10:00 +0000", "/checkout/danke?order_id=A1"),
  combined("203.0.113.10", "05/Jun/2026:10:12:00 +0000", "/checkout/danke?order_id=A1"),
  combined("203.0.113.11", "05/Jun/2026:11:00:00 +0000", "/preise"),
  combined("203.0.113.12", "05/Jun/2026:11:05:00 +0000", "/api/ping", 500)
].join("\n");

const baselineCloudflare = [
  cloudflareEvent("203.0.113.10", "2026-06-05T10:00:00Z", "/preise?gclid=abc"),
  cloudflareEvent("203.0.113.10", "2026-06-05T10:02:00Z", "/assets/app.css"),
  cloudflareEvent("203.0.113.10", "2026-06-05T10:10:00Z", "/checkout/danke?order_id=A1"),
  cloudflareEvent("203.0.113.10", "2026-06-05T10:12:00Z", "/checkout/danke?order_id=A1"),
  cloudflareEvent("203.0.113.11", "2026-06-05T11:00:00Z", "/preise"),
  cloudflareEvent("203.0.113.12", "2026-06-05T11:05:00Z", "/api/ping", 500)
].join("\n");

const baselineFastly = [
  fastlyEvent("203.0.113.10", "2026-06-05T10:00:00Z", "/preise?gclid=abc"),
  fastlyEvent("203.0.113.10", "2026-06-05T10:02:00Z", "/assets/app.css"),
  fastlyEvent("203.0.113.10", "2026-06-05T10:10:00Z", "/checkout/danke?order_id=A1"),
  fastlyEvent("203.0.113.10", "2026-06-05T10:12:00Z", "/checkout/danke?order_id=A1"),
  fastlyEvent("203.0.113.11", "2026-06-05T11:00:00Z", "/preise"),
  fastlyEvent("203.0.113.12", "2026-06-05T11:05:00Z", "/api/ping", 500)
].join("\n");

const baselineAkamai = [
  akamaiEvent("203.0.113.10", "2026-06-05T10:00:00Z", "/preise?gclid=abc"),
  akamaiEvent("203.0.113.10", "2026-06-05T10:02:00Z", "/assets/app.css"),
  akamaiEvent("203.0.113.10", "2026-06-05T10:10:00Z", "/checkout/danke?order_id=A1"),
  akamaiEvent("203.0.113.10", "2026-06-05T10:12:00Z", "/checkout/danke?order_id=A1"),
  akamaiEvent("203.0.113.11", "2026-06-05T11:00:00Z", "/preise"),
  akamaiEvent("203.0.113.12", "2026-06-05T11:05:00Z", "/api/ping", 500)
].join("\n");

function isoAt(seconds) {
  return new Date(Date.UTC(2026, 5, 5, 8, 0, seconds)).toISOString();
}

function combinedStampAt(seconds) {
  const d = new Date(Date.UTC(2026, 5, 5, 8, 0, seconds));
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(d.getUTCDate())}/Jun/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

function w3cDateTimeAt(seconds) {
  const iso = isoAt(seconds);
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

function docIp(i) {
  return `198.51.${Math.floor(i / 250)}.${i % 250}`;
}

function splitTarget(target) {
  const [stem, query = "-"] = String(target).split("?");
  return { stem, query: query || "-" };
}

function createLargeGoldenCorpus(format = "combined", options = {}) {
  const lines = [];
  const expected = {
    visitors: 1250,
    meta: 0,
    assetHits: 0,
    botFiltered: 40,
    statusFiltered: 30,
    productViews: 0,
    conversions: 0,
    duplicateConversions: 0,
    adVisitors: 0
  };
  const browserUa = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
  const botUa = "Googlebot/2.1";
  const proxyIp = options.proxyIp || "";
  const xff = !!options.xff;
  const hostFor = options.hostFor || (() => "example.test");
  if (format === "cloudfront") {
    lines.push("#Version: 1.0");
    lines.push("#Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer) cs(User-Agent) cs-uri-query");
    expected.meta = 2;
  } else if (format === "iis") {
    lines.push("#Software: Microsoft Internet Information Services 10.0");
    lines.push("#Fields: date time c-ip cs-method cs-uri-stem cs-uri-query sc-status cs(User-Agent) cs-host");
    expected.meta = 2;
  }
  const emit = (ip, seconds, target, status = 200, ua = browserUa, eventOptions = {}) => {
    const { date, time } = w3cDateTimeAt(seconds);
    const { stem, query } = splitTarget(target);
    const encodedUa = encodeURIComponent(ua);
    const logIp = proxyIp || ip;
    const host = eventOptions.host || "example.test";
    const xffValue = xff ? ip : "";
    if (format === "cloudflare") {
      lines.push(cloudflareEvent(logIp, isoAt(seconds), target, status, ua, { host, xff: xffValue || logIp }));
    } else if (format === "cloudfront") {
      lines.push(`${date} ${time} FRA56-P1 100 ${logIp} GET ${host} ${stem} ${status} - ${encodedUa} ${query}`);
    } else if (format === "fastly") {
      lines.push(fastlyEvent(logIp, isoAt(seconds), target, status, ua));
    } else if (format === "akamai") {
      lines.push(akamaiEvent(logIp, isoAt(seconds), target, status, ua));
    } else if (format === "iis") {
      lines.push(`${date} ${time} ${logIp} GET ${stem} ${query} ${status} ${encodedUa} ${host}`);
    } else {
      const extra = xffValue ? ` "${xffValue}"` : "";
      lines.push(combined(logIp, combinedStampAt(seconds), target, status, ua, "GET", extra));
    }
  };

  for (let i = 0; i < expected.visitors; i++) {
    const ip = docIp(i);
    const base = i * 6;
    const ad = i % 5 === 0;
    const eventOptions = { host: hostFor(i) };
    if (ad) expected.adVisitors++;
    emit(ip, base, `/landing${ad ? "?gclid=ad-" + i : ""}`, 200, browserUa, eventOptions);

    if (i % 2 === 0) {
      expected.productViews++;
      emit(ip, base + 1, `/produkt/${i % 20}`, 200, browserUa, eventOptions);
    }
    if (i % 3 === 0) {
      expected.assetHits++;
      emit(ip, base + 2, "/assets/app.css", 200, browserUa, eventOptions);
    }
    if (i % 10 === 0) {
      expected.conversions++;
      emit(ip, base + 3, `/checkout/danke?order_id=G${i}`, 200, browserUa, eventOptions);
    }
    if (i % 50 === 0) {
      expected.duplicateConversions++;
      emit(ip, base + 4, `/checkout/danke?order_id=G${i}`, 200, browserUa, eventOptions);
    }
  }

  for (let i = 0; i < expected.botFiltered; i++) {
    emit(`203.0.113.${i}`, 9000 + i, `/bot/${i}`, 200, botUa, { host: "example.test" });
  }
  for (let i = 0; i < expected.statusFiltered; i++) {
    emit(`192.0.2.${i}`, 9100 + i, `/fehler/${i}`, 500, browserUa, { host: "example.test" });
  }

  expected.total = lines.length;
  expected.parsed = lines.length - expected.meta;
  expected.filtered = expected.botFiltered + expected.statusFiltered;
  expected.kept = expected.visitors + expected.productViews + expected.assetHits + expected.conversions + expected.duplicateConversions;
  expected.pageViews = expected.visitors + expected.productViews + expected.conversions + expected.duplicateConversions;
  expected.successRaw = expected.conversions + expected.duplicateConversions;
  expected.success = expected.conversions;
  expected.adSuccess = expected.conversions;
  expected.landingViews = expected.visitors;
  return { text: lines.join("\n"), expected };
}

function shuffledEveryOtherBlock(text, blockSize = 50) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += blockSize) {
    const block = lines.slice(i, i + blockSize);
    out.push(...(((i / blockSize) % 2) ? block.reverse() : block));
  }
  return out.join("\n");
}

const tests = [];
function test(name, fn) {
  tests.push([name, fn, false]);
}

function expectedFailure(name, fn) {
  tests.push([name, fn, true]);
}

async function run() {
  for (const [name, fn, xfail] of tests) {
    try {
      await fn();
      if (xfail) {
        console.error("unexpected ok - " + name);
        process.exitCode = 1;
        continue;
      }
      console.log("ok - " + name);
    } catch (err) {
      if (xfail) {
        console.log("expected fail - " + name);
        console.log("  " + err.message.split("\n")[0]);
        continue;
      }
      console.error("not ok - " + name);
      console.error(err);
      process.exitCode = 1;
    }
  }
}

test("normalisiert Log-Pfade und filtert Assets/Bots", () => {
  const result = analyze(fixture("combined.log"), { successUrl: "/bestellung/danke", hasSuccessUrl: true });
  assert.strictEqual(result.formatKind, "combined");
  assert.strictEqual(result.pathCounts.get("/preise"), 1);
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.success, 1);
  assert.strictEqual(result.reasons.bot, 1);
});

test("Goldstandard-Combined liefert feste Sollwerte fuer Kernkennzahlen", () => {
  const result = buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  assertBuiltResultInvariants(result);
  assert.strictEqual(result.formatKind, "combined");
  assert.strictEqual(result.total, 6);
  assert.strictEqual(result.parsed, 6);
  assert.strictEqual(result.filtered, 1);
  assert.strictEqual(result.reasons.status, 1);
  assert.strictEqual(result.kept, 5);
  assert.strictEqual(result.pageViews, 4);
  assert.strictEqual(result.visits, 2);
  assert.strictEqual(result.successRaw, 2);
  assert.strictEqual(result.success, 1);
  assert.strictEqual(result.adVisitors, 1);
  assert.strictEqual(result.pathCounts.get("/preise"), 2);
  assert.strictEqual(result.pathCounts.get("/assets/app.css"), 1);
  assert.strictEqual(result.pathCounts.get("/checkout/danke"), 2);
  assert.strictEqual(result.diagnostics.pageviewReliability, "high");
  assert.strictEqual(result.diagnostics.conversionReliability, "high");
});

test("dieselbe Besuchsrealitaet zaehlt ueber Edge-Formate gleich", () => {
  const cases = [
    ["combined", baselineCombined],
    ["cloudflare", baselineCloudflare],
    ["cloudfront", cloudfrontFixture()],
    ["fastly", baselineFastly],
    ["akamai", baselineAkamai]
  ];
  for (const [kind, text] of cases) {
    const result = buildResultFor(text, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    });
    assertBuiltResultInvariants(result);
    assert.strictEqual(result.formatKind, kind);
    assert.strictEqual(result.pageViews, 4);
    assert.strictEqual(result.visits, 2);
    assert.strictEqual(result.successRaw, 2);
    assert.strictEqual(result.success, 1);
    assert.strictEqual(result.pathCounts.get("/preise"), 2);
    assert.strictEqual(result.pathCounts.get("/checkout/danke"), 2);
  }
});

test("grosser Golden-Corpus mit ueber 1000 Besuchern liefert feste Sollwerte", () => {
  for (const kind of ["combined", "cloudflare", "cloudfront", "fastly", "akamai", "iis"]) {
    const { text, expected } = createLargeGoldenCorpus(kind);
    const result = buildResultFor(text, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    }, {
      "ga4-url-views": { value: `/landing,${expected.landingViews}\n/checkout/danke,${expected.successRaw}` },
      "ga4-conversions": { value: String(expected.success) }
    });

    assertBuiltResultInvariants(result);
    assert.strictEqual(result.formatKind, kind);
    assert.strictEqual(result.total, expected.total);
    assert.strictEqual(result.meta, expected.meta);
    assert.strictEqual(result.parsed, expected.parsed);
    assert.strictEqual(result.unrecognized, 0);
    assert.strictEqual(result.filtered, expected.filtered);
    assert.strictEqual(result.reasons.bot, expected.botFiltered);
    assert.strictEqual(result.reasons.status, expected.statusFiltered);
    assert.strictEqual(result.kept, expected.kept);
    assert.strictEqual(result.pageViews, expected.pageViews);
    assert.strictEqual(result.visits, expected.visitors);
    assert.strictEqual(result.successRaw, expected.successRaw);
    assert.strictEqual(result.success, expected.success);
    assert.strictEqual(result.adVisitors, expected.adVisitors);
    assert.strictEqual(result.adSuccess, expected.adSuccess);
    assert.strictEqual(result.pathCounts.get("/landing"), expected.landingViews);
    assert.strictEqual(result.pathCounts.get("/checkout/danke"), expected.successRaw);
    assert.strictEqual(result.pathCounts.get("/assets/app.css"), expected.assetHits);
    assert.strictEqual(result.statusCounts.find((item) => item.name === "200").count, expected.kept);
    assert.strictEqual(result.diagnostics.pageviewReliability, "high");
    assert.strictEqual(result.diagnostics.visitorReliability, "high");
    assert.strictEqual(result.diagnostics.conversionReliability, "high");
    assert.strictEqual(result.diagnostics.trackingReliability, "high");
    assert.strictEqual(result.trackingCapped, false);
  }
});

test("grosser Proxy-Corpus markiert Besucher ohne XFF als unsicher und zaehlt mit XFF exakt", () => {
  const { text, expected } = createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  });
  const config = {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  };

  const withoutXff = buildResultFor(text, config);
  assertBuiltResultInvariants(withoutXff);
  assert.strictEqual(withoutXff.visits, 1);
  assert.strictEqual(withoutXff.proxyKind, "private");
  assert.strictEqual(withoutXff.diagnostics.visitorReliability, "limited");
  assert.ok(withoutXff.visitorRange.high > withoutXff.visits);

  const withXff = buildResultFor(text, { ...config, useXff: true });
  assertBuiltResultInvariants(withXff);
  assert.strictEqual(withXff.visits, expected.visitors);
  assert.strictEqual(withXff.xffUsed, expected.kept);
  assert.strictEqual(withXff.diagnostics.visitorReliability, "high");
  assert.strictEqual(withXff.pageViews, expected.pageViews);
  assert.strictEqual(withXff.success, expected.success);
});

test("grosser Host-Mix-Corpus zeigt Host-Risiko und wird per Hostfilter exakt eingegrenzt", () => {
  const { text, expected } = createLargeGoldenCorpus("cloudflare", {
    hostFor: (i) => (i % 4 === 0 ? "other.example.test" : "example.test")
  });
  const config = {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  };

  const mixed = buildResultFor(text, config);
  assertBuiltResultInvariants(mixed);
  assert.strictEqual(mixed.hosts.total, 2);
  assert.strictEqual(mixed.diagnostics.hostReliability, "limited");
  assert.strictEqual(mixed.pageViews, expected.pageViews);

  const filtered = buildResultFor(text, { ...config, hostFilter: ["example.test"] });
  assertBuiltResultInvariants(filtered);
  assert.strictEqual(filtered.hosts.total, 1);
  assert.strictEqual(filtered.diagnostics.hostReliability, "high");
  assert.strictEqual(filtered.reasons.host, 807);
  assert.strictEqual(filtered.visits, 937);
  assert.strictEqual(filtered.pageViews, 1323);
  assert.strictEqual(filtered.successRaw, 74);
  assert.strictEqual(filtered.success, 62);
});

test("grosser unsortierter Corpus senkt Besucher-Belastbarkeit statt falsche Sicherheit zu geben", () => {
  const { text, expected } = createLargeGoldenCorpus("combined");
  const result = buildResultFor(shuffledEveryOtherBlock(text), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });

  assertBuiltResultInvariants(result);
  assert.strictEqual(result.pageViews, expected.pageViews);
  assert.strictEqual(result.success, expected.success);
  assert.ok(result.timeRegressions >= 5);
  assert.strictEqual(result.diagnostics.chronologyIssue, true);
  assert.strictEqual(result.diagnostics.visitorReliability, "medium");
  assert.ok(result.visitorRange.low < result.visits);
  assert.ok(result.visitorRange.high > result.visits);
});

test("grosser Corpus mit kaputten Zeilen senkt Recognition-Ampel und behaelt erkannte Zaehler stabil", () => {
  const { text, expected } = createLargeGoldenCorpus("combined");
  const noisy = text + "\n" + Array.from({ length: 200 }, (_, i) => `kaputte zeile ${i} <script>alert(1)</script>`).join("\n");
  const result = buildResultFor(noisy, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });

  assertBuiltResultInvariants(result);
  assert.strictEqual(result.parsed, expected.parsed);
  assert.strictEqual(result.unrecognized, 200);
  assert.strictEqual(result.pageViews, expected.pageViews);
  assert.strictEqual(result.visits, expected.visitors);
  assert.strictEqual(result.success, expected.success);
  assert.ok(result.diagnostics.recognitionRate < 0.95);
  assert.ok(result.diagnostics.recognitionRate >= 0.8);
  assert.strictEqual(result.diagnostics.pageviewReliability, "medium");
});

test("liest GA4-Werte mit Semikolon, Tab und Tausenderzeichen", () => {
  const values = {
    "ga4-url-views": { value: "/preise; 1.234\n/produkt\t840\n/,1,234\nhttps://example.test/a,b,12" }
  };
  ctx.document.getElementById = (name) => values[name] || { value: "", checked: false };
  const rows = ctx.ga4UrlViews();
  assert.strictEqual(rows.get("/preise"), 1234);
  assert.strictEqual(rows.get("/produkt"), 840);
  assert.strictEqual(rows.get("/"), 1234);
  assert.strictEqual(rows.get("/a,b"), 12);
});

test("nutzt X-Forwarded-For nur bei plausibler IP-Liste", () => {
  const result = analyze(fixture("x-forwarded-for.log"), { useXff: true });
  assert.strictEqual(result.visits, 3);
  assert.strictEqual(result.xffUsed, 2);
  assert.strictEqual(result.xffMissing, 1);
});

test("erkennt nicht unterstuetzte IIS- und JSON-Logs", () => {
  assert.strictEqual(analyze(fixture("iis.log")).formatKind, "iis");
  assert.strictEqual(analyze(fixture("json.log")).formatKind, "json");
});

test("liest gzip-komprimierte Logs", async () => {
  const gz = zlib.gzipSync(Buffer.from(fixture("combined.log")));
  const result = await ctx.processOnMainThread(
    new Blob([gz]),
    { assetRe: /\.(css|js|png)(\?|$)/i, gzip: true },
    () => {}
  );
  assert.strictEqual(result.formatKind, "combined");
  assert.strictEqual(result.pathCounts.get("/preise"), 1);
});

test("normalisiert URLs mit Query-Parametern, absoluten URLs und Slash-Varianten", () => {
  const result = analyze(fixture("url-normalization.log"));
  assert.strictEqual(result.formatKind, "combined");
  assert.strictEqual(result.pathCounts.get("/preise"), 4);
  assert.strictEqual(result.pathCounts.get("/landing"), 2);
  assert.strictEqual(result.pageViews, 6);
});

test("kanonisiert index.html und index.php auf das Verzeichnis", () => {
  const result = analyze(fixture("index-documents.log"));
  assert.strictEqual(result.pathCounts.get("/"), 3);
  assert.strictEqual(result.pathCounts.get("/shop"), 3);
  assert.strictEqual(result.pageViews, 6);
});

test("nutzt IPv6-Adressen aus X-Forwarded-For inklusive Port-Schreibweise", () => {
  const result = analyze(fixture("ipv6-x-forwarded-for.log"), { useXff: true });
  assert.strictEqual(result.xffUsed, 2);
  assert.strictEqual(result.xffPrivate, 1);
  assert.strictEqual(result.xffMissing, 1);
  assert.strictEqual(result.visits, 4);
  assert.strictEqual(result.privateClientHits, 0);
});

test("zaehlt Zeitrueckspruenge in unsortierten Logs", () => {
  const result = analyze(fixture("unsorted.log"));
  assert.strictEqual(result.timeRegressions, 2);
  assert.strictEqual(result.parsed, 4);
  assert.strictEqual(result.pageViews, 4);
});

test("filtert Bots und verdaechtige Non-Browser-Clients im strengen Modus", () => {
  const result = analyze(fixture("suspicious-traffic.log"), { strictBot: true });
  assert.strictEqual(result.reasons.bot, 3);
  assert.strictEqual(result.reasons.strict, 2);
  assert.strictEqual(result.kept, 1);
  assert.strictEqual(result.pageViews, 1);
});

test("dedupliziert Conversion-Reloads pro Besucher innerhalb einer Stunde", () => {
  const result = analyze(fixture("conversion-dedup.log"), { successUrl: "/bestellung/danke", hasSuccessUrl: true });
  assert.strictEqual(result.successRaw, 5);
  assert.strictEqual(result.success, 3);
  assert.strictEqual(result.adVisitors, 1);
  assert.strictEqual(result.adSuccess, 1);
});

test("behaelt ausgewaehlte Query-Parameter fuer Seitenvarianten", () => {
  const result = analyze(fixture("url-normalization.log"), { keptQueryParams: ["variant"] });
  assert.strictEqual(result.pathCounts.get("/landing?variant=a"), 1);
  assert.strictEqual(result.pathCounts.get("/landing?variant=b"), 1);
});

test("zaehlt Conversion-Muster und dedupliziert per Order-ID", () => {
  const result = analyze(fixture("conversion-pattern-order.log"), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  assert.strictEqual(result.successRaw, 4);
  assert.strictEqual(result.success, 2);
});

test("behandelt Regex-Sonderzeichen in Conversion-Mustern als normale Zeichen", () => {
  const text = [
    '203.0.113.10 - - [05/Jun/2026:10:00:00 +0200] "GET /checkout.v2/success HTTP/1.1" 200 100 "-" "Mozilla/5.0 Chrome/124.0 Safari/537.36"',
    '203.0.113.11 - - [05/Jun/2026:10:01:00 +0200] "GET /checkoutXv2/success HTTP/1.1" 200 100 "-" "Mozilla/5.0 Chrome/124.0 Safari/537.36"'
  ].join("\n");
  const result = analyze(text, { successPattern: "/checkout.v2/*", hasSuccessUrl: true });
  assert.strictEqual(result.successRaw, 1);
  assert.strictEqual(result.success, 1);
});

test("erkennt verdaechtige Clients mit vielen Pageviews ohne Assets", () => {
  const result = analyze(fixture("suspicious-volume.log"));
  assert.strictEqual(result.suspiciousClients, 1);
});

test("filtert gemischte Hosts auf erlaubte Domains", () => {
  const result = analyze(fixture("mixed-hosts.log"), { hostFilter: ["example.test"] });
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.pathCounts.get("/preise"), 1);
  assert.strictEqual(result.pathCounts.get("/kontakt"), 1);
  assert.strictEqual(result.pathCounts.has("/landing"), false);
  assert.strictEqual(result.reasons.host, 2);
});

test("meldet gemischte Hosts als Quality-Risiko ohne Hostfilter", () => {
  const result = buildResultFor(fixture("mixed-hosts.log"));
  assert.strictEqual(result.diagnostics.hostReliability, "limited");
  assert.strictEqual(result.hosts.total, 3);
  assert.strictEqual(result.hosts.top[0].name, "example.test");
});

test("liest GA4 CSV Export mit Headern und Views-Spalte", () => {
  const values = {
    "ga4-url-views": {
      value: fixture("ga4-page-views.csv")
    }
  };
  const rows = withDomValues(values, () => ctx.ga4UrlViews());
  assert.strictEqual(rows.get("/preise"), 1234);
  assert.strictEqual(rows.get("/landing"), 42);
  assert.strictEqual(rows.get("/checkout/danke"), 7);
});

test("liest GA4 TSV Export mit Headern und Page-Path-Spalte", () => {
  const values = {
    "ga4-url-views": {
      value: fixture("ga4-page-views.tsv")
    }
  };
  const rows = withDomValues(values, () => ctx.ga4UrlViews());
  assert.strictEqual(rows.get("/preise"), 1234);
  assert.strictEqual(rows.get("/produkt"), 840);
});

test("liest GA4 Export trotz BOM, Metazeilen und Summenzeilen", () => {
  const values = {
    "ga4-url-views": {
      value: "\uFEFF# Export aus GA4\n# Zeitraum: 2026-06-05\nPage path and screen class,Views\n/preise,1.234\n/landing,42\nTotal,1.276\n"
    }
  };
  const rows = withDomValues(values, () => ctx.ga4UrlViews());
  assert.strictEqual(rows.get("/preise"), 1234);
  assert.strictEqual(rows.get("/landing"), 42);
  assert.strictEqual(rows.has("/total"), false);
});

test("warnt bei GA4 CSV mit falscher Metrik statt Views", () => {
  const result = buildResultFor(fixture("mixed-hosts.log"), {}, {
    "ga4-url-views": { value: fixture("ga4-users-wrong-metric.csv") }
  });
  assert.strictEqual(result.diagnostics.ga4Reliability, "limited");
  assert.match(result.ga4Import.warning, /Nutzer|Users|falsche Metrik/i);
});

test("warnt bei unlesbarer GA4-Eingabe statt still falsche Sicherheit zu geben", async () => {
  const result = buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "Dies ist kein GA4 Export\nfoo bar baz" }
  });
  assert.strictEqual(result.diagnostics.ga4Reliability, "limited");
  assert.match(result.ga4Import.warning, /konnte nicht als Seitenaufrufe gelesen werden/i);
  const report = await copyReportFor(result);
  assert.match(report.accuracyNotes.ga4, /konnte nicht als Seitenaufrufe gelesen werden/i);
});

test("liefert Preflight-Beispiele fuer Format, Host und XFF vor der Analyse", () => {
  const preflight = ctx.preflightLogSample(fixture("preflight-xff-mixed-hosts.log"), {
    sampleLines: 10,
    useXff: true
  });
  assert.strictEqual(preflight.formatKind, "combined");
  assert.strictEqual(preflight.recognitionRate, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(preflight.fields)), {
    ip: "10.0.0.5",
    xff: "203.0.113.55",
    method: "GET",
    path: "/preise",
    host: "example.test",
    status: 200
  });
  assert.strictEqual(preflight.quality.pageviews, "high");
  assert.strictEqual(preflight.quality.visitors, "high");
  assert.strictEqual(preflight.warnings.some((warning) => /mehrere Websites/i.test(warning)), true);
});

test("Preflight nutzt dieselbe Format- und Recognition-Logik wie die Analyse", () => {
  const cases = [
    ["cloudflare", fixture("cloudflare-edge.jsonl")],
    ["cloudfront", fixture("cloudfront.tsv")],
    ["iis", fixture("iis.log")]
  ];
  for (const [kind, text] of cases) {
    const preflight = ctx.preflightLogSample(text, { sampleLines: 20 });
    const full = analyze(text);
    assert.strictEqual(preflight.formatKind, kind);
    assert.strictEqual(preflight.formatKind, full.formatKind);
    assert.strictEqual(preflight.recognitionRate, full.dataRows ? full.parsed / full.dataRows : 0);
    assert.strictEqual(preflight.quality.pageviews, full.parsed / Math.max(1, full.dataRows) >= 0.95 ? "high" : "medium");
  }
});

test("Preflight warnt bei kaputten Zeilen und fehlendem XFF vor der Analyse", () => {
  const noisy = fixture("combined.log") + "\nkaputt 1";
  const preflight = ctx.preflightLogSample(noisy, { sampleLines: 20, useXff: true });
  assert.strictEqual(preflight.formatKind, "combined");
  assert.ok(preflight.recognitionRate < 0.95);
  assert.strictEqual(preflight.quality.pageviews, "medium");
  assert.strictEqual(preflight.quality.visitors, "limited");
  assert.strictEqual(preflight.warnings.some((warning) => /Nur .*Stichprobe/i.test(warning)), true);
  assert.strictEqual(preflight.warnings.some((warning) => /Proxy-Feld/i.test(warning)), true);
});

test("liest Cloudflare Edge JSON als CDN-Format", () => {
  const result = analyze(fixture("cloudflare-edge.jsonl"));
  assert.strictEqual(result.formatKind, "cloudflare");
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.hostCounts.get("www.example.de"), 2);
  assert.strictEqual(result.pathCounts.get("/preise"), 1);
});

test("liest CloudFront W3C/TSV als CDN-Format", () => {
  const result = buildResultFor(fixture("cloudfront.tsv"));
  assert.strictEqual(result.formatKind, "cloudfront");
  assert.strictEqual(result.pageViews, 1);
  assert.strictEqual(result.hosts.total, 1);
  assert.strictEqual(result.diagnostics.pageviewReliability, "high");
});

test("liest Fastly-nahe JSON Logs als CDN-Format", () => {
  const result = buildResultFor(fixture("fastly-json.log"));
  assert.strictEqual(result.formatKind, "fastly");
  assert.strictEqual(result.pageViews, 1);
  assert.strictEqual(result.diagnostics.pageviewReliability, "high");
});

test("liest Akamai-nahe JSON Logs als CDN-Format", () => {
  const result = buildResultFor(fixture("akamai-json.log"));
  assert.strictEqual(result.formatKind, "akamai");
  assert.strictEqual(result.pageViews, 1);
  assert.strictEqual(result.diagnostics.pageviewReliability, "high");
});

test("liest Akamai-Matrix mit alternativen Feldnamen und Edge-Feldern", () => {
  const result = buildResultFor(fixture("akamai-matrix.jsonl"), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  assertBuiltResultInvariants(result);
  assert.strictEqual(result.formatKind, "akamai");
  assert.strictEqual(result.total, 5);
  assert.strictEqual(result.parsed, 5);
  assert.strictEqual(result.filtered, 1);
  assert.strictEqual(result.reasons.status, 1);
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.success, 1);
  assert.strictEqual(result.pathCounts.get("/preise"), 1);
  assert.strictEqual(result.pathCounts.get("/checkout/danke"), 1);
  assert.strictEqual(result.hosts.top[0].name, "www.example.test");
});

test("liest dokumentationsnahes CloudFront Standard-Log mit voller Feldliste", () => {
  const result = buildResultFor(fixturePath("provider-docs/cloudfront-standard.tsv"), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  assertBuiltResultInvariants(result);
  assert.strictEqual(result.formatKind, "cloudfront");
  assert.strictEqual(result.total, 5);
  assert.strictEqual(result.meta, 2);
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.successRaw, 1);
  assert.strictEqual(result.success, 1);
  assert.strictEqual(result.pathCounts.get("/preise"), 1);
  assert.strictEqual(result.pathCounts.get("/checkout/danke"), 1);
});

test("liest dokumentationsnahes Cloudflare Logpush HTTP JSON", () => {
  const result = buildResultFor(fixturePath("provider-docs/cloudflare-logpush-http.jsonl"), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  assertBuiltResultInvariants(result);
  assert.strictEqual(result.formatKind, "cloudflare");
  assert.strictEqual(result.hosts.top[0].name, "www.example.test");
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.success, 1);
});

test("liest dokumentationsnahes IIS/W3C Log mit variabler Feldreihenfolge", () => {
  const result = buildResultFor(fixturePath("provider-docs/iis-w3c-custom.txt"), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  assertBuiltResultInvariants(result);
  assert.strictEqual(result.formatKind, "iis");
  assert.strictEqual(result.meta, 3);
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.success, 1);
});

test("liest dokumentationsnahes Fastly Custom-JSON", () => {
  const result = buildResultFor(fixturePath("provider-docs/fastly-custom-json.jsonl"), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  assertBuiltResultInvariants(result);
  assert.strictEqual(result.formatKind, "fastly");
  assert.strictEqual(result.pageViews, 2);
  assert.strictEqual(result.success, 1);
});

test("nutzt konfigurierbare Bot-Anomalie-Schwellen", () => {
  const low = analyze(fixture("suspicious-volume.log"), { suspiciousHitThreshold: 50, suspiciousAssetShare: 0.1 });
  const high = analyze(fixture("suspicious-volume.log"), { suspiciousHitThreshold: 200, suspiciousAssetShare: 0.1 });
  assert.strictEqual(low.suspiciousClients, 1);
  assert.strictEqual(high.suspiciousClients, 0);
});

test("meldet Tracking-Cap bei sehr niedrigem Speicherlimit", () => {
  const lines = [];
  for (let i = 0; i < 1005; i++) {
    lines.push(`198.51.${Math.floor(i / 250)}.${i % 250} - - [05/Jun/2026:10:00:00 +0200] "GET /p${i} HTTP/1.1" 200 100 "-" "Mozilla/5.0 Chrome/124.0 Safari/537.36"`);
  }
  const capped = analyze(lines.join("\n"), { maxTrackedClients: 1000 });
  assert.strictEqual(capped.trackingCapped, true);
});

test("fuzzige Parser-Eingaben crashen nicht und werden gefiltert", () => {
  const result = analyze(fixture("fuzz-lines.log"));
  assert.strictEqual(result.total, 5);
  assertAggregatorInvariants(result);
  assert.ok(result.unrecognized >= 3);
  assert.ok(result.filtered >= 1);
});

test("gezielte Parser-Mutationen crashen nicht und bleiben numerisch stabil", () => {
  const mutated = [
    "",
    "   ",
    "not a log line",
    combined("203.0.113.10", "99/Jun/2026:10:00:00 +0000", "/kaputt"),
    combined("203.0.113.10", "05/Jun/2026:10:00:00 +0000", "/normal"),
    '203.0.113.11 - - [05/Jun/2026:10:01:00 +0000] "GET /quote\\"break HTTP/1.1" 200 123 "-" "Mozilla/5.0"',
    '{"time":"not-a-date","status":200,"request":"/bad-date","user_agent":"Mozilla/5.0"}',
    '{"timestamp":"2026-06-05T10:02:00Z","client_ip":"203.0.113.12","method":"GET","request":"/json","status":"200","user_agent":"Mozilla/5.0"}',
    '{"timestamp":"2026-06-05T10:03:00Z","client_ip":"203.0.113.13","method":"GET","request":"/asset.js","status":200,"user_agent":"Mozilla/5.0"}',
    "#Fields: date time c-ip cs-method cs-uri-stem sc-status cs(User-Agent)",
    "2026-06-05 10:04:00 203.0.113.14 GET /w3c 200 Mozilla/5.0",
    "2026-06-05 10:05:00 too-few-fields",
    combined("203.0.113.15", "05/Jun/2026:10:06:00 +0000", "/encoded/%E2%9C%93"),
    combined("203.0.113.16", "05/Jun/2026:10:07:00 +0000", "/very/" + "long".repeat(500)),
    combined("203.0.113.17", "05/Jun/2026:10:08:00 +0000", "/bot", 200, "Googlebot/2.1")
  ].join("\n");
  const result = buildResultFor(mutated);
  assertBuiltResultInvariants(result);
  assert.ok(result.unrecognized >= 4);
  assert.ok(result.filtered >= 1);
  assert.ok(result.pageViews >= 3);
});

test("alle Fixture-Auswertungen erfuellen Aggregator-Invarianten", () => {
  const names = fixtureNames()
    .filter((name) => /\.(log|jsonl|json|tsv|txt)$/i.test(name));
  for (const name of names) {
    assertAggregatorInvariants(analyze(fixturePath(name)));
  }
});

test("Befund-Diagnosen und Report-Kernfelder bleiben konsistent", () => {
  const result = buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/preise,1\n/checkout/danke,1" },
    "ga4-conversions": { value: "1" }
  });
  assertBuiltResultInvariants(result);
  assert.strictEqual(result.ga4Import.warning, "");
  assert.strictEqual(result.ga4Conversions, 1);
  assert.strictEqual(result.convDiff, 0);
  assert.strictEqual(result.overall.totalServer, 4);
  assert.strictEqual(result.overall.totalGa4, 2);
  assert.strictEqual(result.overall.difference, 2);
  const report = {
    format: result.formatKind,
    totals: {
      total: result.total,
      parsed: result.parsed,
      pageViews: result.pageViews,
      visits: result.visits,
      success: result.success
    },
    quality: result.diagnostics,
    topPages: result.tableRows.slice(0, 3).map((row) => ({
      path: row.name,
      serverViews: row.serverViews,
      ga4Views: row.ga4Views
    }))
  };
  assert.deepStrictEqual(report.totals, { total: 6, parsed: 6, pageViews: 4, visits: 2, success: 1 });
  assert.strictEqual(report.quality.pageviewReliability, "high");
  assert.strictEqual(report.quality.conversionReliability, "high");
  assert.deepStrictEqual(report.topPages[0], { path: "/preise", serverViews: 2, ga4Views: 1 });
});

test("Render setzt Ampeln und sichtbare Gruende pro Kennzahl", () => {
  const data = buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/preise,1\n/checkout/danke,1" },
    "ga4-conversions": { value: "1" }
  });
  const ui = createRenderContext();
  ui.ctx.render(data);
  assert.strictEqual(ui.get("q-views").textContent, "Gut nutzbar");
  assert.match(ui.get("q-views-reason").textContent, /Datei wurde sauber gelesen.*100/i);
  assert.match(ui.get("q-visits-reason").textContent, /Keine starke Proxy-Verzerrung/i);
  assert.match(ui.get("q-purchases-reason").textContent, /mit GA4-Käufen verglichen/i);
  assert.match(ui.get("q-ga4-reason").textContent, /Zeitraum und Seitenauswahl/i);
  assert.match(ui.get("precision-checklist").innerHTML, /eine Website begrenzt/i);
  assert.match(ui.get("precision-checklist").innerHTML, /Datei wurde verstanden/i);
  assert.strictEqual(ui.get("n-views").textContent, "4");
  assert.strictEqual(ui.get("n-purchases").textContent, "1");
});

test("Entscheidungsbereich bleibt frei von interner Analytics-Sprache", () => {
  const scenarios = [
    buildResultFor(baselineCombined, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    }, {
      "ga4-url-views": { value: "/preise,1\n/checkout/danke,1" },
      "ga4-conversions": { value: "1" }
    }),
    buildResultFor(createLargeGoldenCorpus("combined", {
      proxyIp: "10.0.0.5",
      xff: true
    }).text),
    buildResultFor(fixture("mixed-hosts.log"))
  ];
  const banned = [
    /Host-Scope/i,
    /Datenzeilen/i,
    /\bXFF\b/i,
    /X-Forwarded/i,
    /Logformat/i,
    /Recognition/i,
    /Belastbarkeit/i,
    /GA4-Abdeckung/i,
    /Server-Log/i,
    /Serverpfad/i,
    /User-Agent/i,
    /Tracking-Speicher/i,
    /Besucher-Schl(?:u|ü)ssel/i,
    /Bandbreite/i,
    /\bMetrik\b/i
  ];
  for (const data of scenarios) {
    const ui = createRenderContext();
    ui.ctx.render(data);
    const text = visibleDecisionText(ui);
    for (const pattern of banned) {
      assert.doesNotMatch(text, pattern);
    }
  }
});

test("Render zeigt Limitierungsgruende bei gemischten Hosts und falscher GA4-Metrik", () => {
  const data = buildResultFor(fixture("mixed-hosts.log"), {}, {
    "ga4-url-views": { value: fixture("ga4-users-wrong-metric.csv") }
  });
  const ui = createRenderContext();
  ui.ctx.render(data);
  assert.strictEqual(ui.get("q-ga4").textContent, "Nicht verlässlich");
  assert.match(ui.get("q-ga4-reason").textContent, /Nutzer|Users|falsche Metrik/i);
  assert.strictEqual(ui.get("q-host").textContent, "Nicht verlässlich");
  assert.match(ui.get("q-host-reason").textContent, /Domains\/Subdomains gefunden/i);
  assert.match(ui.get("recognition-hint").textContent, /mehrere Websites oder Subdomains/i);
  assert.match(ui.get("recognition-hint").textContent, /Nutzer|Users|falsche Metrik/i);
  assert.match(ui.get("precision-checklist").innerHTML, /Domains\/Subdomains gefunden/i);
});

test("Render verhindert falsche Sicherheit bei Proxy, Bot-Anomalien und Tracking-Cap", () => {
  const proxyData = buildResultFor(createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  }).text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  const proxyUi = createRenderContext();
  proxyUi.ctx.render(proxyData);
  assert.strictEqual(proxyUi.get("n-visits").textContent, "Nicht bestimmbar");
  assert.strictEqual(proxyUi.get("q-visits").textContent, "Nicht verlässlich");
  assert.match(proxyUi.get("q-visits-reason").textContent, /Nicht verlässlich bestimmbar/i);
  assert.doesNotMatch(proxyUi.get("subline").textContent, /1 Besuche|1 Besuch/i);
  assert.match(proxyUi.get("proxy-hint").textContent, /Proxy|Loadbalancer|CDN/i);

  const botUi = createRenderContext();
  botUi.ctx.render(buildResultFor(fixture("suspicious-volume.log")));
  assert.strictEqual(botUi.get("q-bot").textContent, "Mit Vorsicht");
  assert.match(botUi.get("q-bot-reason").textContent, /auffällige Muster/i);

  const cappedLines = [];
  for (let i = 0; i < 1005; i++) {
    cappedLines.push(`198.51.${Math.floor(i / 250)}.${i % 250} - - [05/Jun/2026:10:00:00 +0200] "GET /p${i} HTTP/1.1" 200 100 "-" "Mozilla/5.0 Chrome/124.0 Safari/537.36"`);
  }
  const capUi = createRenderContext();
  capUi.ctx.render(buildResultFor(cappedLines.join("\n"), { maxTrackedClients: 1000 }));
  assert.strictEqual(capUi.get("q-tracking").textContent, "Mit Vorsicht");
  assert.match(capUi.get("q-tracking-reason").textContent, /Schutzgrenze erreicht/i);
  assert.match(capUi.get("recognition-hint").textContent, /sehr groß/i);
});

test("Copy-Report liefert versioniertes Schema mit Genauigkeitshinweisen", async () => {
  const data = buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/preise,1\n/checkout/danke,1" },
    "ga4-conversions": { value: "1" }
  });
  const ui = createRenderContext();
  ui.ctx.render(data);
  await ui.get("copy-report").click();
  const report = JSON.parse(ui.ctx.__clipboard);
  assert.strictEqual(report.schema, "serverstory.analysis.v1");
  assert.strictEqual(report.schemaVersion, 1);
  assert.deepStrictEqual(report.totals.visitorRange, { low: 2, high: 2 });
  assert.strictEqual(report.quality.pageviewReliability, "high");
  assert.strictEqual(report.parser.dataRows, 6);
  assert.strictEqual(report.parser.statusCounts[0].name, "200");
  assert.strictEqual(report.parser.methodCounts[0].name, "GET");
  assert.match(report.accuracyNotes.pageViews, /Datei wurde sauber gelesen/i);
  assert.match(report.accuracyNotes.visits, /Proxy-Verzerrung/i);
  assert.match(report.accuracyNotes.hostScope, /eine Website begrenzt/i);
  assert.strictEqual(report.topPages[0].name, "/preise");
});

test("Copy-Report macht Proxy-XFF-Risiko mit Besucher-Bandbreite sichtbar", async () => {
  const { text } = createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  });
  const data = buildResultFor(text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  });
  const report = await copyReportFor(data);

  assert.strictEqual(report.quality.visitorReliability, "limited");
  assert.strictEqual(report.quality.cacheRisk, "elevated");
  assert.strictEqual(report.proxyKind, "private");
  assert.strictEqual(report.evidence.visits.type, "not_determinable");
  assert.strictEqual(report.evidence.visits.canAnswer, false);
  assert.match(report.evidence.visits.reason, /nicht verlaesslich bestimmbar/i);
  assert.strictEqual(report.evidence.pageViews.type, "lower_bound");
  assert.deepStrictEqual(report.xForwardedFor, { used: 0, missing: 0, privateOnly: 0 });
  assert.strictEqual(report.totals.visits, 1);
  assert.ok(report.totals.visitorRange.high > report.totals.visits);
  assert.match(report.accuracyNotes.visits, /Nicht verlässlich bestimmbar/i);
});

test("Copy-Report macht Host-Mix und Hostfilter-Wirkung sichtbar", async () => {
  const { text } = createLargeGoldenCorpus("cloudflare", {
    hostFor: (i) => (i % 4 === 0 ? "other.example.test" : "example.test")
  });
  const config = {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  };
  const mixedReport = await copyReportFor(buildResultFor(text, config));
  assert.strictEqual(mixedReport.quality.hostReliability, "limited");
  assert.strictEqual(mixedReport.parser.hosts.total, 2);
  assert.strictEqual(mixedReport.evidence.hostScope.canAnswer, false);
  assert.match(mixedReport.evidence.hostScope.reason, /Mehrere Websites\/Subdomains/i);
  assert.match(mixedReport.accuracyNotes.hostScope, /Mehrere Websites\/Subdomains erkannt/i);

  const filteredReport = await copyReportFor(buildResultFor(text, { ...config, hostFilter: ["example.test"] }));
  assert.strictEqual(filteredReport.quality.hostReliability, "high");
  assert.strictEqual(filteredReport.parser.hosts.total, 1);
  assert.strictEqual(filteredReport.filterReasons.host, 807);
  assert.match(filteredReport.accuracyNotes.hostScope, /eine Website begrenzt/i);
});

test("Copy-Report verschweigt Chronologie- und Recognition-Risiken nicht", async () => {
  const { text, expected } = createLargeGoldenCorpus("combined");
  const config = {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  };

  const unsortedReport = await copyReportFor(buildResultFor(shuffledEveryOtherBlock(text), config));
  assert.strictEqual(unsortedReport.quality.chronologyIssue, true);
  assert.strictEqual(unsortedReport.quality.visitorReliability, "medium");
  assert.ok(unsortedReport.totals.visitorRange.low < unsortedReport.totals.visits);
  assert.ok(unsortedReport.totals.visitorRange.high > unsortedReport.totals.visits);
  assert.match(unsortedReport.accuracyNotes.visits, /Reihenfolge der Logs/i);

  const noisy = text + "\n" + Array.from({ length: 200 }, (_, i) => `kaputte zeile ${i} <script>alert(1)</script>`).join("\n");
  const noisyReport = await copyReportFor(buildResultFor(noisy, config));
  assert.strictEqual(noisyReport.parser.unrecognizedRows, 200);
  assert.strictEqual(noisyReport.totals.pageViews, expected.pageViews);
  assert.strictEqual(noisyReport.quality.pageviewReliability, "medium");
  assert.ok(noisyReport.quality.recognitionRate < 0.95);
  assert.match(noisyReport.accuracyNotes.pageViews, /Einzelne Zeilen passen nicht/i);
});

test("Analyse-Protokoll v1 bleibt snapshot-stabil", async () => {
  const data = buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/preise,1\n/checkout/danke,1" },
    "ga4-conversions": { value: "1" }
  });
  const ui = createRenderContext();
  ui.ctx.render(data);
  await ui.get("copy-report").click();
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "snapshots", "analysis-report-v1.json"), "utf8"));
  assert.deepStrictEqual(stableReport(JSON.parse(ui.ctx.__clipboard)), expected);
});

test("separate Source-Dateien fuer Build existieren", () => {
  assert.ok(fs.existsSync(path.join(root, "scripts", "build.js")));
  assert.ok(fs.existsSync(path.join(root, "scripts", "build-single-html.js")));
  assert.ok(fs.existsSync(path.join(root, "src", "inline-script.js")));
  assert.ok(fs.existsSync(path.join(root, "src", "inline-style.css")));
  assert.ok(fs.existsSync(path.join(root, "src", "app.js")));
  assert.ok(fs.existsSync(path.join(root, "src", "styles.css")));
  assert.ok(fs.existsSync(path.join(root, "src", "index.template.html")));
  assert.strictEqual(script.includes("\\{{SCRIPT}}"), false);
  assert.strictEqual(script.includes("\\$&"), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.strictEqual(pkg.scripts.test, "node tests/serverstory.test.js");
  assert.match(pkg.scripts.build, /scripts\/build/);
});

test("CSP blockiert Netzwerkverbindungen und breite Default-Quellen", () => {
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /default-src \*/);
});

test("Demo nutzt realistische Groessenordnung und keine harte GA4-zu-wenig-Headline", () => {
  const demoSample = vm.runInContext("sample", ctx);
  const result = buildResultFor(demoSample, {
    successUrl: "/bestellung/danke",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/,1950\n/produkt/0,58\n/produkt/2,54\n/produkt/4,55\n/bestellung/danke,185" },
    "ga4-conversions": { value: "185" }
  });
  assert.ok(result.visits >= 2000);
  assert.ok(result.pageViews >= 3500);
  assert.ok(result.success >= 200);
  assert.doesNotMatch(script, /Google Analytics zählt zu wenig/);
  assert.doesNotMatch(script, /Google Analytics sieht weniger Käufe/);
  assert.doesNotMatch(script, /GA4-Abdeckung ist niedrig/);
  assert.match(script, /GA4 sieht deutlich weniger/);
});

run();
