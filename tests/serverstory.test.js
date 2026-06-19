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
  assert.ok(Array.isArray(result.conflicts));
  for (const conflict of result.conflicts) {
    assert.strictEqual(typeof conflict.id, "string");
    assert.ok(["medium", "high"].includes(conflict.severity));
    assert.strictEqual(typeof conflict.text, "string");
    assert.strictEqual(typeof conflict.check, "string");
    assert.ok(Array.isArray(conflict.blocks));
  }
  assert.ok(result.claims);
  assert.ok(result.claimMatrix);
  assert.ok(result.evidenceFailures);
  for (const key of ["pageViews", "visits", "ga4", "hostScope", "conversions"]) {
    assert.ok(result.claims[key]);
    assert.strictEqual(typeof result.claims[key].claimAllowed, "boolean");
    assert.ok(["allowed", "limited", "blocked"].includes(result.claims[key].status));
    assert.ok(result.claimMatrix[key]);
    assert.strictEqual(result.claimMatrix[key].status, result.claims[key].status);
    assert.strictEqual(typeof result.claimMatrix[key].reason, "string");
    assert.ok(Array.isArray(result.evidenceFailures[key]));
    assert.deepStrictEqual(result.claimMatrix[key].evidenceFailures, result.evidenceFailures[key]);
    if (result.evidenceFailures[key].length) assert.notStrictEqual(result.claimMatrix[key].status, "allowed");
    if (result.claimMatrix[key].status === "blocked") assert.ok(result.claimMatrix[key].reason.length > 0);
    assert.ok(Array.isArray(result.claimMatrix[key].requiredEvidence));
    assert.ok(Array.isArray(result.claims[key].blockingReasons));
    assert.ok(Array.isArray(result.claims[key].recommendedChecks));
    assert.ok(Array.isArray(result.claims[key].forbiddenConclusions));
  }
  assert.ok(result.auditProtocol);
  assert.ok(Array.isArray(result.auditProtocol.allowedClaims));
  assert.ok(Array.isArray(result.auditProtocol.limitedClaims));
  assert.ok(Array.isArray(result.auditProtocol.blockedClaims));
  assert.ok(Array.isArray(result.auditProtocol.requiredChecks));
  assert.ok(Array.isArray(result.auditProtocol.cannotSay));
  assert.deepStrictEqual(result.auditProtocol.evidenceFailures, result.evidenceFailures);
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
    "claim-allowed", "claim-forbidden", "claim-checks",
    "q-visits", "q-visits-reason", "q-views", "q-views-reason",
    "q-purchases", "q-purchases-reason", "q-ga4", "q-ga4-reason",
    "q-host", "q-host-reason", "q-export", "q-export-reason", "q-bot", "q-bot-reason", "q-tracking", "q-tracking-reason"
  ].map((key) => `${ui.get(key).textContent || ""} ${ui.get(key).innerHTML || ""}`).join("\n");
}

function stableReport(report) {
  const copy = JSON.parse(JSON.stringify(report));
  delete copy.generatedAt;
  delete copy.timeRange;
  return copy;
}

function assertAnalysisReportSchema(report) {
  const claimKeys = ["pageViews", "visits", "ga4", "hostScope", "conversions"];
  const reliabilityValues = ["high", "medium", "limited", "none"];
  const statusValues = ["allowed", "limited", "blocked"];
  for (const key of [
    "schema", "schemaVersion", "generatedAt", "format", "totals", "quality", "timeRange",
    "evidence", "evidenceFailures", "claims", "claimMatrix", "auditProtocol",
    "conflicts", "ga4Validation", "exportCompleteness", "parser", "accuracyNotes", "topPages"
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(report, key), `report.${key}`);
  }
  assert.strictEqual(report.schema, "serverstory.analysis.v1");
  assert.strictEqual(report.schemaVersion, 1);
  assert.strictEqual(typeof report.generatedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
  for (const key of ["rows", "parsed", "kept", "filtered", "pageViews", "visits", "success"]) {
    assert.strictEqual(Number.isFinite(report.totals[key]), true, `totals.${key}`);
    assert.ok(report.totals[key] >= 0, `totals.${key}`);
  }
  assert.ok(report.totals.visitorRange);
  assert.ok(report.totals.visitorRange.low <= report.totals.visitorRange.high);
  for (const key of [
    "pageviewReliability", "visitorReliability", "ga4Reliability", "conversionReliability",
    "botReliability", "hostReliability", "exportCompletenessReliability", "trackingReliability"
  ]) {
    assert.ok(reliabilityValues.includes(report.quality[key]), `quality.${key}`);
  }
  assert.strictEqual(typeof report.quality.recognitionRate, "number");
  assert.ok(report.quality.recognitionRate >= 0 && report.quality.recognitionRate <= 1);
  assert.ok(["normal", "elevated"].includes(report.quality.cacheRisk));
  assert.strictEqual(typeof report.quality.chronologyIssue, "boolean");
  for (const key of claimKeys) {
    assert.ok(report.claims[key], `claims.${key}`);
    assert.ok(report.claimMatrix[key], `claimMatrix.${key}`);
    assert.ok(report.evidenceFailures[key], `evidenceFailures.${key}`);
    assert.ok(report.evidence[key], `evidence.${key}`);
    assert.strictEqual(report.claims[key].status, report.claimMatrix[key].status, key);
    assert.ok(statusValues.includes(report.claimMatrix[key].status), `claimMatrix.${key}.status`);
    assert.strictEqual(typeof report.claimMatrix[key].allowed, "boolean", key);
    assert.strictEqual(typeof report.claimMatrix[key].limited, "boolean", key);
    assert.strictEqual(typeof report.claimMatrix[key].blocked, "boolean", key);
    assert.strictEqual(report.claimMatrix[key].allowed, report.claimMatrix[key].status === "allowed", key);
    assert.strictEqual(report.claimMatrix[key].limited, report.claimMatrix[key].status === "limited", key);
    assert.strictEqual(report.claimMatrix[key].blocked, report.claimMatrix[key].status === "blocked", key);
    assert.ok(reliabilityValues.includes(report.claimMatrix[key].confidence), `claimMatrix.${key}.confidence`);
    assert.strictEqual(typeof report.claimMatrix[key].statement, "string", key);
    assert.strictEqual(typeof report.claimMatrix[key].reason, "string", key);
    assert.ok(Array.isArray(report.claimMatrix[key].blockingReasons), key);
    assert.ok(Array.isArray(report.claimMatrix[key].requiredEvidence), key);
    assert.ok(Array.isArray(report.claimMatrix[key].recommendedChecks), key);
    assert.ok(Array.isArray(report.claimMatrix[key].forbiddenConclusions), key);
    assert.ok(Array.isArray(report.claimMatrix[key].evidenceFailures), key);
    assert.deepStrictEqual(report.claimMatrix[key].evidenceFailures, report.evidenceFailures[key], key);
    assert.deepStrictEqual(report.claims[key].evidenceFailures, report.evidenceFailures[key], key);
    if (report.evidenceFailures[key].length) assert.notStrictEqual(report.claimMatrix[key].status, "allowed", key);
    if (report.claimMatrix[key].status === "blocked") assert.ok(report.claimMatrix[key].reason.length > 0, key);
  }
  assert.deepStrictEqual(report.auditProtocol.evidenceFailures, report.evidenceFailures);
  for (const list of ["allowedClaims", "limitedClaims", "blockedClaims"]) {
    assert.ok(Array.isArray(report.auditProtocol[list]), `auditProtocol.${list}`);
    for (const key of report.auditProtocol[list]) assert.ok(claimKeys.includes(key), key);
  }
  for (const key of claimKeys) {
    const status = report.claimMatrix[key].status;
    const list = status === "allowed" ? "allowedClaims" : status === "limited" ? "limitedClaims" : "blockedClaims";
    assert.ok(report.auditProtocol[list].includes(key), `${key} missing from ${list}`);
  }
  assert.ok(Array.isArray(report.auditProtocol.requiredChecks));
  assert.ok(Array.isArray(report.auditProtocol.cannotSay));
  assert.ok(["high", "medium", "limited"].includes(report.exportCompleteness.reliability));
  assert.ok(Array.isArray(report.exportCompleteness.reasons));
  assert.ok(Array.isArray(report.exportCompleteness.recommendedChecks));
  assert.strictEqual(typeof report.exportCompleteness.recognitionRate, "number");
  assert.ok(report.ga4Validation);
  for (const key of ["rows", "unmatchedRows", "duplicateCount"]) assert.strictEqual(Number.isFinite(report.ga4Validation[key]), true, key);
  assert.ok(Array.isArray(report.ga4Validation.unmatchedPaths));
  assert.ok(Array.isArray(report.ga4Validation.duplicatePaths));
  for (const key of ["dataRows", "metaRows", "unrecognizedRows"]) assert.strictEqual(Number.isFinite(report.parser[key]), true, key);
  assert.ok(Array.isArray(report.parser.statusCounts));
  assert.ok(Array.isArray(report.parser.methodCounts));
  assert.ok(report.parser.formatCounters);
  assert.ok(Array.isArray(report.topPages));
}

async function copyReportFor(data) {
  const ui = createRenderContext();
  ui.ctx.render(data);
  await ui.get("copy-report").click();
  const report = JSON.parse(ui.ctx.__clipboard);
  assertAnalysisReportSchema(report);
  return report;
}

function calibrationScore(results) {
  const score = {
    truthCoverage: 0,
    claimSafety: 0,
    evidenceCompleteness: 0,
    reportCompleteness: 0,
    languageSafety: 0
  };
  const totals = { ...score };
  for (const result of results) {
    totals.truthCoverage += result.truthChecks.length;
    score.truthCoverage += result.truthChecks.filter(Boolean).length;

    for (const [key, expected] of Object.entries(result.expectedStatuses)) {
      totals.claimSafety++;
      if (result.report.claimMatrix[key].status === expected) score.claimSafety++;
    }

    for (const [key, pattern] of Object.entries(result.requiredFailureText || {})) {
      totals.evidenceCompleteness++;
      const text = [
        ...(result.report.evidenceFailures[key] || []),
        result.report.claimMatrix[key].reason || ""
      ].join(" ");
      if (pattern.test(text)) score.evidenceCompleteness++;
    }

    for (const key of ["evidenceFailures", "claimMatrix", "auditProtocol", "claims", "quality"]) {
      totals.reportCompleteness++;
      if (result.report[key]) score.reportCompleteness++;
    }

    totals.languageSafety += result.bannedText.length;
    const positiveText = [
      ...Object.values(result.report.claimMatrix).map((claim) => claim.statement || ""),
      ...Object.values(result.report.accuracyNotes || {})
    ].join(" ");
    score.languageSafety += result.bannedText.filter((pattern) => !pattern.test(positiveText)).length;
  }
  return Object.fromEntries(Object.entries(score).map(([key, value]) => [
    key,
    totals[key] ? value / totals[key] : 1
  ]));
}

function statusRank(status) {
  return { allowed: 2, limited: 1, blocked: 0 }[status] ?? -1;
}

function reliabilityRank(value) {
  return { high: 2, medium: 1, limited: 0, none: -1 }[value] ?? -1;
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

test("Ground Truth: fehlende Zeitbloecke bleiben im Report als Exportluecke sichtbar", async () => {
  const lines = [];
  for (let i = 0; i < 120; i++) {
    lines.push(combined(docIp(i), combinedStampAt(i * 20), `/morgen/${i}`));
  }
  for (let i = 0; i < 120; i++) {
    lines.push(combined(docIp(i + 120), combinedStampAt((8 * 60 * 60) + (i * 20)), `/abend/${i}`));
  }
  const report = await copyReportFor(buildResultFor(lines.join("\n"), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }));

  assert.strictEqual(report.totals.pageViews, 240);
  assert.ok(report.timeRange.maxGapHours >= 7);
  assert.strictEqual(report.exportCompleteness.reliability, "medium");
  assert.match(report.exportCompleteness.reasons.join(" "), /Große Lücke/i);
  assert.ok(report.conflicts.some((conflict) => conflict.id === "large_time_gap"));
  assert.match(report.accuracyNotes.pageViews, /Datei wurde sauber gelesen/i);
  assert.strictEqual(report.claims.pageViews.claimAllowed, true);
  assert.match(report.claims.pageViews.recommendedChecks.join(" "), /Teil-Dateien fehlen/i);
  assert.match(report.claims.ga4.recommendedChecks.join(" "), /Zeitraum/i);
});

test("Ground Truth: Export-Vollstaendigkeit bewertet normale und kurze Exporte", async () => {
  const { text } = createLargeGoldenCorpus("combined");
  const normalReport = await copyReportFor(buildResultFor(text));
  assert.strictEqual(normalReport.exportCompleteness.reliability, "high");
  assert.deepStrictEqual(normalReport.exportCompleteness.reasons, []);

  const shortLines = [];
  for (let i = 0; i < 20; i++) {
    shortLines.push(combined(docIp(i), combinedStampAt(i * 60), `/kurz/${i}`));
  }
  const shortReport = await copyReportFor(buildResultFor(shortLines.join("\n")));
  assert.strictEqual(shortReport.exportCompleteness.reliability, "medium");
  assert.match(shortReport.exportCompleteness.reasons.join(" "), /weniger als eine Stunde/i);
  assert.match(shortReport.claims.pageViews.recommendedChecks.join(" "), /gewünschte Zeitraum/i);
});

test("Ground Truth: Cache-Origin-Unterzaehlung darf nicht als vollstaendige Server-Wahrheit erscheinen", async () => {
  const { text } = createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  });
  const report = await copyReportFor(buildResultFor(text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,2500\n/checkout/danke,300" }
  }));

  assert.strictEqual(report.quality.cacheRisk, "elevated");
  assert.strictEqual(report.exportCompleteness.reliability, "medium");
  assert.match(report.exportCompleteness.reasons.join(" "), /Cache oder Proxy/i);
  assert.ok(report.conflicts.some((conflict) => conflict.id === "ga4_above_server_with_cache_risk"));
  assert.strictEqual(report.evidence.pageViews.type, "lower_bound");
  assert.match(report.claims.pageViews.statement, /Mindestwert/i);
  assert.match(report.claims.pageViews.blockingReasons.join(" "), /Cache/i);
  assert.match(report.claims.pageViews.forbiddenConclusions.join(" "), /alle Aufrufe/i);
});

test("Ground Truth: falsche GA4-Seitenauswahl bleibt nur Vergleich mit Pruefpflicht", async () => {
  const { text, expected } = createLargeGoldenCorpus("combined");
  const report = await copyReportFor(buildResultFor(text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: `/landing,${expected.landingViews * 2}\n/nicht-im-log,9000` }
  }));

  assert.ok(report.topPages.find((row) => row.name === "/landing").coverage > 100);
  assert.ok(report.conflicts.some((conflict) => conflict.id === "ga4_pages_missing_in_server"));
  assert.strictEqual(report.ga4Validation.unmatchedRows, 1);
  assert.strictEqual(report.claims.ga4.claimAllowed, false);
  assert.match(report.claims.ga4.statement, /gleicher Website, gleichem Zeitraum und gleichen Seiten/i);
  assert.match(report.claims.ga4.recommendedChecks.join(" "), /Seitenaufrufe/i);
  assert.match(report.claims.ga4.forbiddenConclusions.join(" "), /Keine Budget- oder Tracking-Entscheidung/i);
});

test("Ground Truth: sehr kaputter Export senkt Vollstaendigkeit und Claims", async () => {
  const { text } = createLargeGoldenCorpus("combined");
  const broken = `${text}\n${Array.from({ length: 2200 }, (_, i) => `kaputte zeile ${i}`).join("\n")}`;
  const report = await copyReportFor(buildResultFor(broken, {}, {
    "ga4-url-views": { value: "/landing,1250" }
  }));

  assert.strictEqual(report.exportCompleteness.reliability, "limited");
  assert.match(report.exportCompleteness.reasons.join(" "), /konnte gelesen werden|Zeilen wurden aussortiert/i);
  assert.strictEqual(report.claims.pageViews.claimAllowed, false);
  assert.match(report.claims.pageViews.forbiddenConclusions.join(" "), /Keine harte Aussage/i);
  assert.strictEqual(report.claims.ga4.claimAllowed, false);
});

test("Ground Truth: doppelte GA4-Zeilen blockieren glatten Vergleich", async () => {
  const report = await copyReportFor(buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/preise,1\n/preise,2\n/checkout/danke,1" }
  }));

  assert.strictEqual(report.ga4Validation.duplicateCount, 1);
  assert.deepStrictEqual(report.ga4Validation.duplicatePaths, ["/preise"]);
  assert.ok(report.conflicts.some((conflict) => conflict.id === "ga4_duplicate_pages"));
  assert.strictEqual(report.claims.ga4.claimAllowed, false);
  assert.match(report.claims.ga4.recommendedChecks.join(" "), /Doppelte GA4-Zeilen/i);
});

test("Ground Truth: Danke-Seiten-Reloads ohne Bestellnummer senken Kauf-Sicherheit", () => {
  const lines = [];
  for (let i = 0; i < 30; i++) {
    const ip = docIp(i);
    const base = i * 120;
    lines.push(combined(ip, combinedStampAt(base), "/checkout/danke"));
    lines.push(combined(ip, combinedStampAt(base + 10), "/checkout/danke"));
    lines.push(combined(ip, combinedStampAt(base + 20), "/checkout/danke"));
  }
  const result = buildResultFor(lines.join("\n"), {
    successPattern: "/checkout/*",
    hasSuccessUrl: true
  });

  assertBuiltResultInvariants(result);
  assert.strictEqual(result.successRaw, 90);
  assert.strictEqual(result.success, 30);
  assert.strictEqual(result.conflicts.length, 0);
  assert.strictEqual(result.diagnostics.conversionReliability, "medium");
  assert.strictEqual(result.claims.conversions.claimAllowed, true);
  assert.match(result.claims.conversions.blockingReasons.join(" "), /Ohne Bestellnummer/i);
  assert.match(result.claims.conversions.recommendedChecks.join(" "), /Bestellnummer/i);
});

test("Ground Truth: interner Test-Traffic darf nicht automatisch als Proxy-Risiko gelten", () => {
  const lines = [];
  for (let i = 0; i < 220; i++) {
    lines.push(combined("198.51.100.77", combinedStampAt(i * 20), `/test/${i}`));
  }
  const result = buildResultFor(lines.join("\n"));

  assertBuiltResultInvariants(result);
  assert.strictEqual(result.proxyKind, "concentrated");
  assert.strictEqual(result.conflicts.length, 0);
  assert.strictEqual(result.diagnostics.visitorReliability, "limited");
  assert.strictEqual(result.claims.visits.claimAllowed, false);
  assert.match(result.claims.visits.blockingReasons.join(" "), /Proxy oder Cache/i);
  assert.doesNotMatch(result.claims.pageViews.blockingReasons.join(" "), /Zu viel der Datei/i);
});

test("Konflikt-Engine: Host-Mix blockiert GA4-Entscheidung", async () => {
  const { text } = createLargeGoldenCorpus("cloudflare", {
    hostFor: (i) => (i % 3 === 0 ? "other.example.test" : "example.test")
  });
  const report = await copyReportFor(buildResultFor(text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,1250" }
  }));

  assert.ok(report.conflicts.some((conflict) => conflict.id === "ga4_compare_with_multiple_websites"));
  assert.strictEqual(report.claims.ga4.claimAllowed, false);
  assert.match(report.claims.ga4.blockingReasons.join(" "), /mehrere Websites/i);
  assert.match(report.claims.ga4.recommendedChecks.join(" "), /Website-Filter/i);
});

test("Konflikt-Engine: GA4-Kaeufe ueber Danke-Seiten-Aufrufen blockieren Kaufvergleich", async () => {
  const data = buildResultFor(baselineCombined, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-conversions": { value: "99" }
  });
  const report = await copyReportFor(data);

  assert.ok(report.conflicts.some((conflict) => conflict.id === "ga4_purchases_exceed_server_success_page"));
  assert.match(report.claims.conversions.blockingReasons.join(" "), /mehr Käufe/i);
  assert.match(report.claims.conversions.forbiddenConclusions.join(" "), /Keinen Kaufvergleich/i);
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

test("liest alte ITA-HTTP-Archivlogs ohne User-Agent konservativ", async () => {
  const legacy = [
    'spider.example.org [29:23:53:25] "GET /robots.txt HTTP/1.0" 200 120',
    'client-a.example.org [29:23:54:00] "GET /index.html HTTP/1.0" 200 1024',
    'client-a.example.org [29:23:55:00] "GET /assets/app.css HTTP/1.0" 200 2048',
    'client-b.example.org [30:00:01:00] "GET /checkout/danke HTTP/1.0" 200 900',
    'client-b.example.org [30:00:04:00] "GET /checkout/danke HTTP/1.0" 200 900',
    'client-c.example.org [30:00:10:00] "POST /form HTTP/1.0" 200 50',
    'nasa.example.org [Tue Jul 01 00:00:01 1995] "GET /history/apollo/ HTTP/1.0" 200 6245'
  ].join("\n");
  const report = await copyReportFor(buildResultFor(legacy, {
    successPattern: "/checkout/*",
    hasSuccessUrl: true
  }));

  assert.strictEqual(report.format, "legacy_http_archive");
  assert.strictEqual(report.totals.rows, 7);
  assert.strictEqual(report.totals.parsed, 7);
  assert.strictEqual(report.totals.pageViews, 5);
  assert.strictEqual(report.totals.success, 1);
  assert.strictEqual(report.quality.visitorReliability, "medium");
  assert.strictEqual(report.quality.botReliability, "limited");
  assert.strictEqual(report.claimMatrix.visits.status, "limited");
  assert.strictEqual(report.claimMatrix.conversions.status, "limited");
  assert.match(report.evidenceFailures.visits.join(" "), /Archivformat ohne Browserkennung/i);
  assert.match(report.exportCompleteness.reasons.join(" "), /Archivformat ohne Browserkennung/i);
  assert.strictEqual(report.legacyNoUserAgent, 7);
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
  assert.match(preflight.claimBlockers.join(" "), /Mehrere Websites/i);
  assert.match(preflight.recommendedChecks.join(" "), /Website-Filter/i);
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
  assert.match(preflight.recommendedChecks.join(" "), /Exportformat/i);
  assert.match(preflight.claimBlockers.join(" "), /Proxy-Feld/i);
});

test("Preflight erkennt Proxy-Signal und grosse Zeitluecken vor der Analyse", () => {
  const lines = [];
  for (let i = 0; i < 130; i++) {
    lines.push(combined("10.0.0.5", combinedStampAt(i * 10), `/vormittag/${i}`));
  }
  for (let i = 0; i < 20; i++) {
    lines.push(combined("10.0.0.5", combinedStampAt((8 * 60 * 60) + (i * 10)), `/abend/${i}`));
  }
  const preflight = ctx.preflightLogSample(lines.join("\n"), { sampleLines: 500 });

  assert.strictEqual(preflight.proxySignal, "private");
  assert.strictEqual(preflight.quality.visitors, "limited");
  assert.ok(preflight.sampleTimeRange.maxGapHours >= 7);
  assert.match(preflight.warnings.join(" "), /Proxy oder Cache/i);
  assert.match(preflight.warnings.join(" "), /zeitliche Lücke/i);
  assert.match(preflight.claimBlockers.join(" "), /Besucherzahl/i);
  assert.match(preflight.recommendedChecks.join(" "), /Teil-Dateien fehlen/i);
});

test("Preflight klassifiziert Access-, Legacy- und Nicht-Access-Dateien", () => {
  const access = ctx.preflightLogSample(fixture("combined.log"), { sampleLines: 20 });
  assert.strictEqual(access.fileClass, "access_log");
  assert.strictEqual(access.isLikelyAccessLog, true);
  assert.match(access.classificationLabel, /Brauchbares Access Log/i);
  assert.deepStrictEqual(Array.from(access.rejectReasons), []);

  const legacy = ctx.preflightLogSample([
    'client-a.example.org [29:23:54:00] "GET /index.html HTTP/1.0" 200 1024',
    'client-b.example.org [Tue Jul 01 00:00:01 1995] "GET /history/apollo/ HTTP/1.0" 200 6245'
  ].join("\n"), { sampleLines: 20 });
  assert.strictEqual(legacy.fileClass, "legacy_access_log");
  assert.strictEqual(legacy.isLikelyAccessLog, true);
  assert.match(legacy.limitations.join(" "), /Keine Browserkennung/i);
  assert.match(legacy.recommendedChecks.join(" "), /Archivlogs/i);

  const analytics = ctx.preflightLogSample([
    "Page path and screen class,Views,Users,Sessions",
    "/preise,123,100,90",
    "/checkout,12,10,9"
  ].join("\n"), { sampleLines: 20 });
  assert.strictEqual(analytics.fileClass, "analytics_csv");
  assert.strictEqual(analytics.isLikelyAccessLog, false);
  assert.match(analytics.rejectReasons.join(" "), /Analytics-Export/i);
  assert.match(analytics.recommendedChecks.join(" "), /Access-Logdatei/i);

  const errorLog = ctx.preflightLogSample([
    "[Fri Jun 05 10:00:00.000000 2026] [error] [client 203.0.113.10] AH01234: File does not exist",
    "[Fri Jun 05 10:01:00.000000 2026] [warn] [client 203.0.113.11] PHP Warning: test"
  ].join("\n"), { sampleLines: 20 });
  assert.strictEqual(errorLog.fileClass, "error_log");
  assert.strictEqual(errorLog.isLikelyAccessLog, false);
  assert.match(errorLog.claimBlockers.join(" "), /Fehlerprotokoll/i);

  const waf = ctx.preflightLogSample([
    '{"timestamp":"2026-06-05T10:00:00Z","action":"blocked","ruleId":"1001","threat":"sql injection"}',
    '{"timestamp":"2026-06-05T10:01:00Z","action":"challenge","waf":"managed","bot score":5}'
  ].join("\n"), { sampleLines: 20 });
  assert.strictEqual(waf.fileClass, "waf_or_security_log");
  assert.strictEqual(waf.isLikelyAccessLog, false);
  assert.match(waf.rejectReasons.join(" "), /WAF|Security/i);
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
  assert.strictEqual(ui.get("q-export").textContent, "Gut nutzbar");
  assert.match(ui.get("q-export-reason").textContent, /plausibel/i);
  assert.match(ui.get("claim-allowed").innerHTML, /Seitenaufrufe sind gut nutzbar/i);
  assert.match(ui.get("claim-forbidden").innerHTML, /Tracking-Verlust/i);
  assert.match(ui.get("claim-checks").innerHTML, /Zeitraum/i);
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
  assert.match(proxyUi.get("claim-forbidden").innerHTML, /Keine feste Besucherzahl/i);
  assert.match(proxyUi.get("claim-checks").innerHTML, /Besucheradresse hinter Proxy/i);
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
  assertAnalysisReportSchema(report);
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
  assert.match(ui.get("claim-allowed").innerHTML, new RegExp(report.claims.pageViews.statement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(ui.get("claim-forbidden").innerHTML, /Tracking-Verlust/i);
  assert.match(ui.get("claim-checks").innerHTML, /Zeitraum/i);
  assert.strictEqual(report.claimMatrix.pageViews.status, report.claims.pageViews.status);
  assert.deepStrictEqual(report.evidenceFailures.pageViews, []);
  assert.deepStrictEqual(report.claimMatrix.pageViews.evidenceFailures, []);
  assert.deepStrictEqual(report.claimMatrix.pageViews.requiredEvidence, [
    "Lesbare Server- oder CDN-Zeilen mit Zeitstempel",
    "Gewünschter Zeitraum vollständig exportiert",
    "Bei Cache/CDN: Edge-Log statt nur Origin-Log"
  ]);
  assert.ok(report.auditProtocol.allowedClaims.includes("hostScope"));
  assert.ok(report.auditProtocol.limitedClaims.includes("ga4"));
  assert.deepStrictEqual(report.auditProtocol.evidenceFailures, report.evidenceFailures);
  assert.match(report.auditProtocol.cannotSay.join(" "), /GA4-Abweichung/i);
  assert.strictEqual(report.topPages[0].name, "/preise");
});

test("No False Confidence: Claim-Matrix blockiert harte Aussagen bei unsicherer Datenbasis", async () => {
  const proxyReport = await copyReportFor(buildResultFor(createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  }).text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }));
  assert.strictEqual(proxyReport.claimMatrix.visits.status, "blocked");
  assert.strictEqual(proxyReport.claimMatrix.visits.allowed, false);
  assert.match(proxyReport.evidenceFailures.visits.join(" "), /Proxy|Cache/i);
  assert.strictEqual(proxyReport.claimMatrix.conversions.status, "limited");
  assert.match(proxyReport.evidenceFailures.conversions.join(" "), /Conversion-Rate|Besucherzahl/i);
  assert.match(proxyReport.claimMatrix.visits.reason, /Proxy|Cache/i);
  assert.ok(proxyReport.auditProtocol.blockedClaims.includes("visits"));
  assert.match(proxyReport.auditProtocol.cannotSay.join(" "), /Keine feste Besucherzahl/i);

  const mixedHostReport = await copyReportFor(buildResultFor(fixture("mixed-hosts.log"), {}, {
    "ga4-url-views": { value: "/preise,10\n/landing,5" }
  }));
  assert.strictEqual(mixedHostReport.claimMatrix.hostScope.status, "blocked");
  assert.strictEqual(mixedHostReport.claimMatrix.ga4.status, "blocked");
  assert.match(mixedHostReport.evidenceFailures.hostScope.join(" "), /Mehrere Websites/i);
  assert.match(mixedHostReport.evidenceFailures.ga4.join(" "), /mehrere Websites|Subdomains/i);
  assert.match(mixedHostReport.claimMatrix.ga4.reason, /mehrere Websites|Subdomains/i);
  assert.ok(mixedHostReport.auditProtocol.blockedClaims.includes("ga4"));

  const brokenReport = await copyReportFor(buildResultFor(`${baselineCombined}\n${Array.from({ length: 200 }, (_, i) => `kaputte zeile ${i}`).join("\n")}`));
  assert.strictEqual(brokenReport.claimMatrix.pageViews.status, "blocked");
  assert.match(brokenReport.evidenceFailures.pageViews.join(" "), /Zeilen|Datei/i);
  assert.match(brokenReport.evidenceFailures.ga4.join(" "), /Server-Datei|gelesen/i);
  assert.match(brokenReport.claimMatrix.pageViews.reason, /Datei konnte gelesen|harte Aussage|Zeilen/i);
  assert.ok(brokenReport.auditProtocol.blockedClaims.includes("pageViews"));
});

test("Kalibrierung: Wahrheitsszenarien erzwingen konservative Claims und vollstaendige Evidenz", async () => {
  const large = createLargeGoldenCorpus("combined");
  const normal = await copyReportFor(buildResultFor(large.text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }));
  const proxy = await copyReportFor(buildResultFor(createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  }).text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }));
  const hostMix = await copyReportFor(buildResultFor(createLargeGoldenCorpus("cloudflare", {
    hostFor: (i) => (i % 4 === 0 ? "other.example.test" : "example.test")
  }).text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,1250" }
  }));
  const noisy = await copyReportFor(buildResultFor(`${large.text}\n${Array.from({ length: 200 }, (_, i) => `kaputte zeile ${i}`).join("\n")}`, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }));
  const broken = await copyReportFor(buildResultFor(`${large.text}\n${Array.from({ length: 2200 }, (_, i) => `kaputte zeile ${i}`).join("\n")}`, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,1250" }
  }));
  const unsorted = await copyReportFor(buildResultFor(shuffledEveryOtherBlock(large.text), {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }));
  const cacheRisk = await copyReportFor(buildResultFor(createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  }).text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,2500\n/checkout/danke,300" }
  }));
  const reloadLines = [];
  for (let i = 0; i < 30; i++) {
    const base = i * 120;
    reloadLines.push(combined(docIp(i), combinedStampAt(base), "/checkout/danke"));
    reloadLines.push(combined(docIp(i), combinedStampAt(base + 10), "/checkout/danke"));
    reloadLines.push(combined(docIp(i), combinedStampAt(base + 20), "/checkout/danke"));
  }
  const reloads = await copyReportFor(buildResultFor(reloadLines.join("\n"), {
    successPattern: "/checkout/*",
    hasSuccessUrl: true
  }));

  const results = [
    {
      report: normal,
      truthChecks: [
        normal.totals.pageViews === large.expected.pageViews,
        normal.totals.visits === large.expected.visitors,
        normal.totals.success === large.expected.success
      ],
      expectedStatuses: { pageViews: "allowed", visits: "allowed", hostScope: "allowed", conversions: "allowed" },
      requiredFailureText: {},
      bannedText: [/GA4 zählt zu wenig/i, /Server-Datei enthält alle Aufrufe/i]
    },
    {
      report: proxy,
      truthChecks: [
        proxy.totals.pageViews === large.expected.pageViews,
        proxy.totals.visits === 1,
        proxy.totals.visitorRange.high > proxy.totals.visits
      ],
      expectedStatuses: { pageViews: "limited", visits: "blocked", conversions: "limited" },
      requiredFailureText: { visits: /Proxy|Cache/i, conversions: /Conversion-Rate|Besucherzahl/i },
      bannedText: [/Besucherzahl ist gut nutzbar/i, /feste Besucherzahl/i]
    },
    {
      report: hostMix,
      truthChecks: [
        hostMix.parser.hosts.total === 2,
        hostMix.totals.pageViews === large.expected.pageViews
      ],
      expectedStatuses: { hostScope: "blocked", ga4: "blocked" },
      requiredFailureText: { hostScope: /Mehrere Websites|Subdomains/i, ga4: /mehrere Websites|Subdomains/i },
      bannedText: [/Analyse nur eine Website/i]
    },
    {
      report: noisy,
      truthChecks: [
        noisy.parser.unrecognizedRows === 200,
        noisy.totals.pageViews === large.expected.pageViews,
        noisy.quality.pageviewReliability === "medium"
      ],
      expectedStatuses: { pageViews: "limited", visits: "allowed" },
      requiredFailureText: {},
      bannedText: [/harte Aussage über die Gesamtzahl/i]
    },
    {
      report: broken,
      truthChecks: [
        broken.parser.unrecognizedRows === 2200,
        broken.quality.pageviewReliability === "limited"
      ],
      expectedStatuses: { pageViews: "blocked", ga4: "blocked" },
      requiredFailureText: { pageViews: /Zeilen|Datei/i, ga4: /Server-Export|Server-Datei/i },
      bannedText: [/Seitenaufrufe sind gut nutzbar/i]
    },
    {
      report: unsorted,
      truthChecks: [
        unsorted.quality.chronologyIssue === true,
        unsorted.totals.pageViews === large.expected.pageViews
      ],
      expectedStatuses: { visits: "limited", pageViews: "allowed" },
      requiredFailureText: { visits: /zeitlich sortiert/i },
      bannedText: [/Besucherzahl ist gut nutzbar/i]
    },
    {
      report: cacheRisk,
      truthChecks: [
        cacheRisk.quality.cacheRisk === "elevated",
        cacheRisk.evidence.pageViews.type === "lower_bound"
      ],
      expectedStatuses: { pageViews: "limited", visits: "blocked", ga4: "limited" },
      requiredFailureText: { pageViews: /Cache|CDN/i, ga4: /Cache|CDN/i },
      bannedText: [/Server-Datei alle Aufrufe/i]
    },
    {
      report: reloads,
      truthChecks: [
        reloads.totals.success === 30,
        reloads.quality.conversionReliability === "medium"
      ],
      expectedStatuses: { conversions: "limited" },
      requiredFailureText: { conversions: /Bestellnummer|Reloads/i },
      bannedText: [/Käufe sind gut nutzbar/i]
    }
  ];

  for (const result of results) {
    for (const [key, expected] of Object.entries(result.expectedStatuses)) {
      assert.strictEqual(result.report.claimMatrix[key].status, expected, key);
      assert.strictEqual(result.report.claims[key].status, expected, key);
      if (result.report.evidenceFailures[key].length) assert.notStrictEqual(result.report.claimMatrix[key].status, "allowed", key);
    }
    for (const [key, pattern] of Object.entries(result.requiredFailureText)) {
      assert.match([
        ...(result.report.evidenceFailures[key] || []),
        result.report.claimMatrix[key].reason || ""
      ].join(" "), pattern, key);
    }
  }

  const score = calibrationScore(results);
  assert.deepStrictEqual(score, {
    truthCoverage: 1,
    claimSafety: 1,
    evidenceCompleteness: 1,
    reportCompleteness: 1,
    languageSafety: 1
  });
});

test("Metamorphic: gleiche Besuchsrealitaet bleibt ueber Varianten stabil oder konservativer", async () => {
  const combinedCase = createLargeGoldenCorpus("combined");
  const cloudflareCase = createLargeGoldenCorpus("cloudflare");
  const cloudfrontCase = createLargeGoldenCorpus("cloudfront");
  const withNoise = [
    ...combinedCase.text.split("\n"),
    combined("198.51.100.220", combinedStampAt(9999), "/assets/extra.js"),
    combined("198.51.100.221", combinedStampAt(10000), "/assets/extra.css"),
    combined("198.51.100.222", combinedStampAt(10001), "/landing?utm_source=x&gclid=y")
  ].join("\n");
  const withKeptQuery = createLargeGoldenCorpus("combined", {
    hostFor: () => "EXAMPLE.TEST"
  });
  const cases = [
    ["combined", await copyReportFor(buildResultFor(combinedCase.text, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    }))],
    ["cloudflare", await copyReportFor(buildResultFor(cloudflareCase.text, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    }))],
    ["cloudfront", await copyReportFor(buildResultFor(cloudfrontCase.text, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    }))],
    ["noise", await copyReportFor(buildResultFor(withNoise, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    }))],
    ["uppercase-host", await copyReportFor(buildResultFor(withKeptQuery.text, {
      successPattern: "/checkout/*",
      orderParam: "order_id",
      hasSuccessUrl: true
    }))]
  ];

  for (const [name, report] of cases) {
    assert.strictEqual(report.totals.success, combinedCase.expected.success, name);
    assert.strictEqual(report.claimMatrix.visits.status, "allowed", name);
    assert.strictEqual(report.claimMatrix.conversions.status, "allowed", name);
    assert.ok(statusRank(report.claimMatrix.pageViews.status) >= statusRank("limited"), name);
    assert.ok(reliabilityRank(report.quality.pageviewReliability) >= reliabilityRank("medium"), name);
  }
  assert.strictEqual(cases[0][1].totals.pageViews, combinedCase.expected.pageViews);
  assert.strictEqual(cases[1][1].totals.pageViews, combinedCase.expected.pageViews);
  assert.strictEqual(cases[2][1].totals.pageViews, combinedCase.expected.pageViews);
  assert.strictEqual(cases[3][1].totals.pageViews, combinedCase.expected.pageViews + 1);
});

test("Monotonicity: schlechtere Daten duerfen Claims nie optimistischer machen", async () => {
  const large = createLargeGoldenCorpus("combined");
  const base = await copyReportFor(buildResultFor(large.text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,1250" }
  }));
  const noisy = await copyReportFor(buildResultFor(`${large.text}\n${Array.from({ length: 200 }, (_, i) => `kaputte zeile ${i}`).join("\n")}`, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,1250" }
  }));
  const broken = await copyReportFor(buildResultFor(`${large.text}\n${Array.from({ length: 2200 }, (_, i) => `kaputte zeile ${i}`).join("\n")}`, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,1250" }
  }));

  assert.ok(noisy.quality.recognitionRate < base.quality.recognitionRate);
  assert.ok(broken.quality.recognitionRate < noisy.quality.recognitionRate);
  assert.ok(reliabilityRank(noisy.quality.pageviewReliability) <= reliabilityRank(base.quality.pageviewReliability));
  assert.ok(reliabilityRank(broken.quality.pageviewReliability) <= reliabilityRank(noisy.quality.pageviewReliability));
  assert.ok(statusRank(noisy.claimMatrix.pageViews.status) <= statusRank(base.claimMatrix.pageViews.status));
  assert.ok(statusRank(broken.claimMatrix.pageViews.status) <= statusRank(noisy.claimMatrix.pageViews.status));
  assert.ok(statusRank(broken.claimMatrix.ga4.status) <= statusRank(noisy.claimMatrix.ga4.status));

  const proxyLow = await copyReportFor(buildResultFor(createLargeGoldenCorpus("combined").text));
  const proxyHigh = await copyReportFor(buildResultFor(createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  }).text));
  assert.ok(statusRank(proxyHigh.claimMatrix.visits.status) <= statusRank(proxyLow.claimMatrix.visits.status));
  assert.ok(reliabilityRank(proxyHigh.quality.visitorReliability) <= reliabilityRank(proxyLow.quality.visitorReliability));

  const hostClean = await copyReportFor(buildResultFor(createLargeGoldenCorpus("cloudflare").text));
  const hostMixed = await copyReportFor(buildResultFor(createLargeGoldenCorpus("cloudflare", {
    hostFor: (i) => (i % 4 === 0 ? "other.example.test" : "example.test")
  }).text));
  assert.ok(statusRank(hostMixed.claimMatrix.hostScope.status) <= statusRank(hostClean.claimMatrix.hostScope.status));
  assert.ok(reliabilityRank(hostMixed.quality.hostReliability) <= reliabilityRank(hostClean.quality.hostReliability));

  const ga4Clean = await copyReportFor(buildResultFor(baselineCombined, {}, {
    "ga4-url-views": { value: "/preise,2\n/checkout/danke,2" }
  }));
  const ga4Duplicate = await copyReportFor(buildResultFor(baselineCombined, {}, {
    "ga4-url-views": { value: "/preise,1\n/preise,1\n/checkout/danke,2" }
  }));
  assert.ok(statusRank(ga4Duplicate.claimMatrix.ga4.status) <= statusRank(ga4Clean.claimMatrix.ga4.status));
  assert.ok(reliabilityRank(ga4Duplicate.quality.ga4Reliability) <= reliabilityRank(ga4Clean.quality.ga4Reliability));
});

test("Report und UI spiegeln Matrix-Unsicherheit ohne stille Gruende", async () => {
  const data = buildResultFor(createLargeGoldenCorpus("combined", {
    proxyIp: "10.0.0.5",
    xff: true
  }).text, {
    successPattern: "/checkout/*",
    orderParam: "order_id",
    hasSuccessUrl: true
  }, {
    "ga4-url-views": { value: "/landing,2500\n/checkout/danke,300" }
  });
  const ui = createRenderContext();
  ui.ctx.render(data);
  await ui.get("copy-report").click();
  const report = JSON.parse(ui.ctx.__clipboard);

  for (const [key, claim] of Object.entries(report.claimMatrix)) {
    assert.strictEqual(report.claims[key].status, claim.status, key);
    if (claim.status !== "allowed") {
      assert.ok(claim.reason || claim.evidenceFailures.length || claim.forbiddenConclusions.length, key);
    }
    if (claim.evidenceFailures.length) {
      assert.notStrictEqual(claim.status, "allowed", key);
      assert.deepStrictEqual(report.auditProtocol.evidenceFailures[key], claim.evidenceFailures, key);
    }
  }

  assert.strictEqual(ui.get("q-visits").textContent, "Nicht verlässlich");
  assert.match(ui.get("q-visits-reason").textContent, /Proxy|CDN/i);
  assert.strictEqual(ui.get("q-ga4").textContent, "Mit Vorsicht");
  assert.match(ui.get("claim-forbidden").innerHTML, /Keine feste Besucherzahl|alle Aufrufe|Tracking-Entscheidung/i);
  assert.match(ui.get("claim-checks").innerHTML, /Proxy|Cache|Zeitraum|Besucheradresse/i);
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
  assert.strictEqual(report.claims.visits.claimAllowed, false);
  assert.strictEqual(report.claimMatrix.visits.status, "blocked");
  assert.deepStrictEqual(report.claims.visits.evidenceFailures, report.evidenceFailures.visits);
  assert.ok(report.claimMatrix.visits.requiredEvidence.some((item) => /Client-IP|Proxy-Feld/i.test(item)));
  assert.match(report.claims.visits.blockingReasons.join(" "), /Proxy|Cache/i);
  assert.match(report.claims.visits.forbiddenConclusions.join(" "), /Keine feste Besucherzahl/i);
  assert.match(report.claims.visits.forbiddenConclusions.join(" "), /Conversion-Rate/i);
  assert.strictEqual(report.evidence.pageViews.type, "lower_bound");
  assert.match(report.claims.pageViews.forbiddenConclusions.join(" "), /alle Aufrufe/i);
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
  assert.strictEqual(mixedReport.claims.hostScope.claimAllowed, false);
  assert.strictEqual(mixedReport.claims.ga4.claimAllowed, false);
  assert.match(mixedReport.evidence.hostScope.reason, /Mehrere Websites\/Subdomains/i);
  assert.match(mixedReport.accuracyNotes.hostScope, /Mehrere Websites\/Subdomains erkannt/i);
  assert.match(mixedReport.claims.ga4.forbiddenConclusions.join(" "), /Keine Budget- oder Tracking-Entscheidung/i);

  const filteredReport = await copyReportFor(buildResultFor(text, { ...config, hostFilter: ["example.test"] }));
  assert.strictEqual(filteredReport.quality.hostReliability, "high");
  assert.strictEqual(filteredReport.parser.hosts.total, 1);
  assert.strictEqual(filteredReport.filterReasons.host, 807);
  assert.match(filteredReport.accuracyNotes.hostScope, /eine Website begrenzt/i);
  assert.strictEqual(filteredReport.claims.hostScope.claimAllowed, true);
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
  assert.strictEqual(unsortedReport.claims.visits.claimAllowed, true);
  assert.match(unsortedReport.claims.visits.blockingReasons.join(" "), /zeitlich sortiert/i);
  assert.match(unsortedReport.claims.visits.forbiddenConclusions.join(" "), /exakten Wert/i);

  const noisy = text + "\n" + Array.from({ length: 200 }, (_, i) => `kaputte zeile ${i} <script>alert(1)</script>`).join("\n");
  const noisyReport = await copyReportFor(buildResultFor(noisy, config));
  assert.strictEqual(noisyReport.parser.unrecognizedRows, 200);
  assert.strictEqual(noisyReport.totals.pageViews, expected.pageViews);
  assert.strictEqual(noisyReport.quality.pageviewReliability, "medium");
  assert.ok(noisyReport.quality.recognitionRate < 0.95);
  assert.match(noisyReport.accuracyNotes.pageViews, /Einzelne Zeilen passen nicht/i);
  assert.strictEqual(noisyReport.claims.pageViews.claimAllowed, true);
  assert.strictEqual(noisyReport.claims.pageViews.confidence, "medium");

  const brokenReport = await copyReportFor(buildResultFor(`${text}\n${Array.from({ length: 2000 }, (_, i) => `kaputte zeile ${i}`).join("\n")}`, config));
  assert.strictEqual(brokenReport.quality.pageviewReliability, "limited");
  assert.strictEqual(brokenReport.claims.pageViews.claimAllowed, false);
  assert.match(brokenReport.claims.pageViews.forbiddenConclusions.join(" "), /Keine harte Aussage/i);
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
