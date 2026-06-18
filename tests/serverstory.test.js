// ServerStory — Testsuite für die echte Aggregator-Logik aus index.html.
//
// WARUM EIN EIGENER, SCHLANKER RUNNER (statt node:test direkt)?
// Die Aufgabe verlangt ein klares "expectedFailure"-Konzept mit drei Zuständen,
// die node:test allein nicht sauber abbildet:
//   - Ein erwartet fehlschlagender Test (Format wird vom Produktcode noch nicht
//     unterstützt) darf den Gesamt-Exit-Code NICHT auf Fehler setzen, soll aber
//     sichtbar als "EXPECTED FAILURE" geloggt werden.
//   - Schlägt ein erwarteter Fehlschlag plötzlich NICHT mehr fehl (Produktcode
//     wurde ergänzt), muss das als "UNEXPECTED PASS" auffallen — denn dann ist
//     der Test veraltet und sollte zu einem echten Test werden.
//   - Normale Tests sind PASS/FAIL wie üblich.
// node:test kennt zwar todo/skip, aber "todo"-Tests, die unerwartet bestehen,
// erzeugen keinen klaren, eigenständig auswertbaren Status und beeinflussen den
// Exit-Code nicht differenziert genug. Ein eigener Runner (~60 Zeilen) ist hier
// die robusteste Variante: deterministisch, ohne Abhängigkeiten, mit exakt den
// vier benötigten Zuständen und einem definierten Exit-Code.
//
// Exit-Code-Regel:
//   0  = alles in Ordnung (alle echten Tests bestanden, erwartete Fehlschläge
//        sind weiterhin fehlgeschlagen)
//   1  = mindestens ein echter Test ist fehlgeschlagen ODER ein erwarteter
//        Fehlschlag ist unerwartet bestanden (beides erfordert Handeln)
//
// Keine Netzwerkzugriffe, keine Zeitabhängigkeit, vollständig deterministisch.

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadMakeAggregator } = require("./load-aggregator.js");

const makeAggregator = loadMakeAggregator();
const FIX = path.join(__dirname, "fixtures");

// ---------------------------------------------------------------------------
// Minimaler Runner
// ---------------------------------------------------------------------------
const results = { pass: 0, fail: 0, expectedFailure: 0, unexpectedPass: 0 };
const failures = [];

function test(name, fn) {
  try {
    fn();
    results.pass++;
    console.log(`  PASS              ${name}`);
  } catch (err) {
    results.fail++;
    failures.push({ name, err });
    console.log(`  FAIL              ${name}`);
    console.log(`                    -> ${err.message.split("\n")[0]}`);
  }
}

// Ein Test, von dem wir wissen, dass der Produktcode das Format (noch) nicht
// unterstützt. Erwartet wird eine Assertion-Verletzung. Tritt sie ein:
// EXPECTED FAILURE (Suite bleibt grün). Besteht der Test wider Erwarten:
// UNEXPECTED PASS (Suite wird rot, denn der Test ist jetzt veraltet).
function expectedFailure(name, grund, fn) {
  try {
    fn();
    results.unexpectedPass++;
    failures.push({ name, err: new Error("UNEXPECTED PASS — Produktcode unterstützt dieses Format jetzt; Test in echten Test umwandeln") });
    console.log(`  UNEXPECTED PASS   ${name}`);
    console.log(`                    -> Produktcode scheint dieses Format nun zu unterstützen — Test aktualisieren.`);
  } catch (err) {
    results.expectedFailure++;
    console.log(`  EXPECTED FAILURE  ${name}`);
    console.log(`                    -> Produktcode fehlt: ${grund}`);
  }
}

function section(title) {
  console.log("\n" + title);
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Baut eine valide Combined-Log-Zeile.
function combined(opts = {}) {
  const ip = opts.ip || "203.0.113.10";
  const time = opts.time || "05/Jun/2026:12:00:00 +0200";
  const method = opts.method || "GET";
  const target = opts.target || "/";
  const status = opts.status != null ? opts.status : 200;
  const size = opts.size != null ? opts.size : 1234;
  const ref = opts.ref || "-";
  const ua = opts.ua != null ? opts.ua : BROWSER_UA;
  const trailing = opts.trailing || "";
  return `${ip} - - [${time}] "${method} ${target} HTTP/1.1" ${status} ${size} "${ref}" "${ua}"${trailing}`;
}

function feed(agg, lines) {
  for (const l of lines) agg.processLine(l);
  return agg.finalize();
}

function readFixtureLines(file) {
  return fs.readFileSync(path.join(FIX, file), "utf8").split("\n").filter((l) => l.length > 0);
}

// ===========================================================================
// 1.–3. NICHT unterstützte Fremdformate — erwartete Fehlschläge
// ===========================================================================
section("Fremdformate (erwartete Fehlschläge — Produktcode unterstützt nur Combined Log)");

expectedFailure(
  "Cloudflare Logpush (NDJSON) wird geparst",
  "kein JSON-/NDJSON-Parser im Aggregator (reLine erwartet Combined-Format)",
  () => {
    const agg = makeAggregator({});
    const lines = readFixtureLines("cloudflare-logpush.ndjson");
    const r = feed(agg, lines);
    // Erwartung an einen funktionierenden Parser: alle 4 Zeilen geparst,
    // 3 GET/2xx davon sind Seitenaufrufe (/, /preise, /danke).
    assert.ok(r.parsed > 0, "parsed sollte > 0 sein");
    assert.strictEqual(r.parsed, 4, "alle 4 NDJSON-Zeilen sollten geparst werden");
    assert.strictEqual(r.pageViews, 3, "3 Seitenaufrufe erwartet");
  }
);

expectedFailure(
  "CloudFront Standard Logs (TSV/W3C) werden geparst",
  "kein TSV-/#Fields-Header-Parser im Aggregator",
  () => {
    const agg = makeAggregator({});
    const lines = readFixtureLines("cloudfront-standard.tsv").filter((l) => !l.startsWith("#"));
    const r = feed(agg, lines);
    assert.ok(r.parsed > 0, "parsed sollte > 0 sein");
    assert.strictEqual(r.parsed, 4, "alle 4 Datenzeilen sollten geparst werden");
    assert.strictEqual(r.pageViews, 3, "3 Seitenaufrufe erwartet");
  }
);

expectedFailure(
  "Fastly/Akamai-nahe JSON-Logs werden geparst",
  "kein verschachtelter-JSON-Parser (request.method/response.status) im Aggregator",
  () => {
    const agg = makeAggregator({});
    const lines = readFixtureLines("fastly-akamai.ndjson");
    const r = feed(agg, lines);
    assert.ok(r.parsed > 0, "parsed sollte > 0 sein");
    assert.strictEqual(r.parsed, 4, "alle 4 JSON-Zeilen sollten geparst werden");
    assert.strictEqual(r.pageViews, 3, "3 Seitenaufrufe erwartet");
  }
);

// Gegenprobe: Die Fremdformat-Zeilen müssen als 'unrecognized' gezählt werden,
// nicht etwa eine Exception auslösen. Das ist ein ECHTER Test und soll PASSEN.
test("Fremdformat-Zeilen landen sauber in unrecognized (keine Exception)", () => {
  const agg = makeAggregator({});
  const lines = [
    ...readFixtureLines("cloudflare-logpush.ndjson"),
    ...readFixtureLines("fastly-akamai.ndjson"),
  ];
  const r = feed(agg, lines);
  assert.strictEqual(r.parsed, 0, "kein Fremdformat darf als geparst gelten");
  assert.strictEqual(r.unrecognized, lines.length, "alle Fremdzeilen müssen unrecognized sein");
});

// ===========================================================================
// 4. Bot-Schwellen — echte Tests, sollen PASSEN
// ===========================================================================
section("Bot-Erkennung und strictBot");

test("Googlebot wird als Bot gefiltert (reasons.bot)", () => {
  const agg = makeAggregator({});
  const r = feed(agg, [
    combined({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }),
  ]);
  assert.strictEqual(r.kept, 0);
  assert.strictEqual(r.reasons.bot, 1);
});

test("curl und python-requests werden als Bots gefiltert", () => {
  const agg = makeAggregator({});
  const r = feed(agg, [
    combined({ ua: "curl/8.4.0" }),
    combined({ ua: "python-requests/2.31.0" }),
  ]);
  assert.strictEqual(r.kept, 0);
  assert.strictEqual(r.reasons.bot, 2);
});

test("echter Browser wird durchgelassen", () => {
  const agg = makeAggregator({});
  const r = feed(agg, [combined({ ua: BROWSER_UA })]);
  assert.strictEqual(r.kept, 1);
  assert.strictEqual(r.reasons.bot, 0);
  assert.strictEqual(r.pageViews, 1);
});

test("strictBot: unklarer (aber nicht bot-verdächtiger) UA wird per reasons.strict gefiltert", () => {
  // UA ist >= 8 Zeichen, kein Bot-Treffer, aber kein klarer Browser.
  const oddUa = "MyCustomNativeApp/3.2 (internal build)";
  const agg = makeAggregator({ strictBot: true });
  const r = feed(agg, [combined({ ua: oddUa })]);
  assert.strictEqual(r.kept, 0);
  assert.strictEqual(r.reasons.strict, 1);
  assert.strictEqual(r.reasons.bot, 0);
});

test("strictBot: echter Browser bleibt erhalten, strict zählt nicht hoch", () => {
  const agg = makeAggregator({ strictBot: true });
  const r = feed(agg, [combined({ ua: BROWSER_UA })]);
  assert.strictEqual(r.kept, 1);
  assert.strictEqual(r.reasons.strict, 0);
});

test("ohne strictBot wird derselbe unklare UA durchgelassen", () => {
  const oddUa = "MyCustomNativeApp/3.2 (internal build)";
  const agg = makeAggregator({ strictBot: false });
  const r = feed(agg, [combined({ ua: oddUa })]);
  assert.strictEqual(r.kept, 1);
  assert.strictEqual(r.reasons.strict, 0);
});

// ===========================================================================
// 5. Large-file-Caps — echte Tests, sollen PASSEN
// ===========================================================================
section("Large-File-Verhalten (IP-Cap und Prune)");

function ipFromIndex(i) {
  // Erzeugt > 50000 garantiert verschiedene öffentliche IPv4-Adressen.
  const a = 11 + (Math.floor(i / (254 * 254)) % 200); // 11..210, nie privat
  const b = Math.floor(i / 254) % 254;
  const c = i % 254;
  return `${a}.${b}.${c + 1}.7`;
}

test("> 50000 verschiedene Client-IPs lassen distinctClientIps auf -1 kippen", () => {
  const agg = makeAggregator({});
  const N = 50001;
  let base = Date.parse("2026-06-05T10:00:00+02:00");
  for (let i = 0; i < N; i++) {
    // Zeit minimal variieren, bleibt aber deterministisch.
    const t = new Date(base + i * 1000);
    const time = formatApacheTime(t);
    agg.processLine(combined({ ip: ipFromIndex(i), time, ua: BROWSER_UA }));
  }
  const r = agg.finalize();
  assert.strictEqual(r.distinctClientIps, -1, "Cap muss greifen (distinctClientIps === -1)");
  assert.strictEqual(r.topClientHits, 0, "bei aktivem Cap wird topClientHits nicht berechnet");
  assert.strictEqual(r.kept, N, "alle Browser-Zeilen bleiben behalten");
});

test("unterhalb des Caps wird distinctClientIps korrekt gezählt", () => {
  const agg = makeAggregator({});
  for (let i = 0; i < 100; i++) {
    agg.processLine(combined({ ip: ipFromIndex(i), ua: BROWSER_UA, time: "05/Jun/2026:12:00:00 +0200" }));
  }
  const r = agg.finalize();
  assert.strictEqual(r.distinctClientIps, 100);
  assert.ok(r.topClientHits >= 1);
});

test("Prune läuft beim Überschreiten von 250000 Zeilen ohne Fehler und hält Visits konsistent", () => {
  // Wir speisen > 250000 Zeilen ein, damit der Prune-Pfad (seen % 250000 === 0)
  // mindestens einmal ausgeführt wird. Ein und derselbe Besucher, Zeitstempel
  // immer steigend, Lücken < 30min -> genau 1 Visit. Prune darf das nicht
  // verfälschen und keine Exception werfen.
  const agg = makeAggregator({});
  const N = 250002;
  let base = Date.parse("2026-06-05T08:00:00+02:00");
  for (let i = 0; i < N; i++) {
    const t = new Date(base + i * 60 * 1000); // jede Minute -> nie > 30min Lücke
    agg.processLine(combined({ ip: "203.0.113.99", time: formatApacheTime(t), ua: BROWSER_UA }));
  }
  const r = agg.finalize();
  assert.strictEqual(r.parsed, N);
  assert.strictEqual(r.visits, 1, "lückenloser Verlauf eines Besuchers = genau 1 Visit");
});

function formatApacheTime(d) {
  // Deterministisch in fester Zone +0200 formatieren (auf Basis von UTC + 2h),
  // damit der Test unabhängig von der lokalen Zeitzone läuft.
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const shifted = new Date(d.getTime() + 2 * 60 * 60 * 1000);
  const p2 = (n) => String(n).padStart(2, "0");
  const dd = p2(shifted.getUTCDate());
  const mon = months[shifted.getUTCMonth()];
  const yyyy = shifted.getUTCFullYear();
  const hh = p2(shifted.getUTCHours());
  const mi = p2(shifted.getUTCMinutes());
  const ss = p2(shifted.getUTCSeconds());
  return `${dd}/${mon}/${yyyy}:${hh}:${mi}:${ss} +0200`;
}

// ===========================================================================
// 6. Parser-Fuzzing — echte Tests, sollen PASSEN (NIE eine Exception)
// ===========================================================================
section("Parser-Fuzzing (Robustheit, keine Exceptions)");

test("kaputte/randständige Zeilen werfen nie eine Exception", () => {
  const agg = makeAggregator({});
  const garbage = [
    "",                                            // leer
    "   ",                                          // nur Whitespace
    "\t\t",                                         // nur Tabs
    "völliger Müll ohne Struktur 12345",            // Unicode + Müll
    "10.0.0.1 - - [kaputt] \"GET / HTTP/1.1\" 200", // unvollständig
    "10.0.0.1 - - [05/Jun/2026:12:00:00 +0200] \"GET /",  // abgeschnitten
    "{\"json\":true}",                              // JSON
    "GET /ohne/alles HTTP/1.1 200",                 // ohne Klammern/Quotes
    "   ",                           // NUL-Bytes
    "a".repeat(200000),                             // sehr lange Zeile
    combined({ time: "31/Foo/2026:99:99:99 +9999" }), // unparsbare Zeit
    combined({ status: 999 }),                      // exotischer Status (3 Ziffern)
    combined({ method: "PROPFIND" }),               // exotische Methode
    combined({ ua: "" }),                           // leere UA
    combined({ ua: "-" }),                          // UA "-"
    combined({ ua: "ab" }),                         // zu kurze UA (< 8)
    combined({ target: "/pfad mit leerzeichen" }),  // Leerzeichen im Pfad
    combined({ target: "/ünïcödé/path/ß" }),        // Unicode im Pfad
    combined({ ip: "::1" }) + "\r",                 // CRLF + IPv6-Loopback
    "10.0.0.1 - - [05/Jun/2026:12:00:00 +0200] \"\" 200 1 \"-\" \"-\"", // leere Request-Line
    "🦊🦊🦊 emoji only line 🦊",                    // reine Emojis
    "10.0.0.1 - - [05/Jun/2026:12:00:00 +0200] \"GET / HTTP/1.1\" 20 1 \"-\" \"" + BROWSER_UA + "\"", // 2-stelliger Status
  ];
  assert.doesNotThrow(() => {
    for (const l of garbage) agg.processLine(l);
  });
  const r = agg.finalize();
  // Konsistenz: total == parsed + unrecognized + (leere Zeilen wurden gar nicht
  // gezählt, weil processLine vor stats.total++ bei leer/whitespace returnt).
  assert.strictEqual(r.total, r.parsed + r.unrecognized, "total = parsed + unrecognized");
  // kept + filtered darf parsed nie übersteigen.
  assert.ok(r.kept + r.filtered <= r.parsed, "kept + filtered <= parsed");
});

test("leere und reine Whitespace-Zeilen erhöhen total nicht", () => {
  const agg = makeAggregator({});
  const r = feed(agg, ["", "   ", "\t", "\r"]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.parsed, 0);
  assert.strictEqual(r.unrecognized, 0);
});

test("CRLF am Zeilenende wird abgeschnitten und stört das Parsen nicht", () => {
  const agg = makeAggregator({});
  const r = feed(agg, [combined({ ua: BROWSER_UA }) + "\r"]);
  assert.strictEqual(r.parsed, 1);
  assert.strictEqual(r.kept, 1);
});

test("massenhaftes Fuzzing (1000 zufällig-zerstörte Zeilen) bleibt exceptionfrei und konsistent", () => {
  const agg = makeAggregator({});
  // Deterministischer Pseudo-Zufall (linearer Kongruenzgenerator), kein Math.random.
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const valid = combined({ ua: BROWSER_UA });
  assert.doesNotThrow(() => {
    for (let i = 0; i < 1000; i++) {
      // Eine valide Zeile zufällig an einer Stelle beschädigen.
      const cut = Math.floor(rnd() * valid.length);
      let line = valid.slice(0, cut) + String.fromCharCode(Math.floor(rnd() * 60)) + valid.slice(cut);
      if (rnd() < 0.1) line = line + " ";
      if (rnd() < 0.1) line = line.repeat(1 + Math.floor(rnd() * 3));
      agg.processLine(line);
    }
  });
  const r = agg.finalize();
  assert.strictEqual(r.total, r.parsed + r.unrecognized);
});

// ===========================================================================
// Zusätzliche echte Sanity-Tests gegen den Combined-Parser
// ===========================================================================
section("Combined-Parser Grundverhalten");

test("Datumsbereich-Filter zählt range hoch", () => {
  const agg = makeAggregator({ dateFrom: "2026-06-10", dateTo: "2026-06-20" });
  const r = feed(agg, [
    combined({ time: "05/Jun/2026:12:00:00 +0200" }), // vor Bereich
    combined({ time: "15/Jun/2026:12:00:00 +0200" }), // im Bereich
    combined({ time: "25/Jun/2026:12:00:00 +0200" }), // nach Bereich
  ]);
  assert.strictEqual(r.reasons.range, 2);
  assert.strictEqual(r.kept, 1);
});

test("nicht-ok-Status (404) wird per reasons.status gefiltert", () => {
  const agg = makeAggregator({});
  const r = feed(agg, [combined({ status: 404 })]);
  assert.strictEqual(r.reasons.status, 1);
  assert.strictEqual(r.kept, 0);
});

test("PUT/DELETE werden per reasons.method gefiltert, POST nicht", () => {
  const agg = makeAggregator({});
  const r = feed(agg, [
    combined({ method: "PUT" }),
    combined({ method: "DELETE" }),
    combined({ method: "POST" }),
  ]);
  assert.strictEqual(r.reasons.method, 2);
  assert.strictEqual(r.kept, 1);
});

test("successUrl zählt Conversions (success/successRaw)", () => {
  const agg = makeAggregator({ successUrl: "/danke" });
  const r = feed(agg, [
    combined({ ip: "203.0.113.1", target: "/danke", ua: BROWSER_UA, time: "05/Jun/2026:12:00:00 +0200" }),
    // gleicher Besucher erneut innerhalb 60min -> successRaw++ aber nicht success
    combined({ ip: "203.0.113.1", target: "/danke", ua: BROWSER_UA, time: "05/Jun/2026:12:10:00 +0200" }),
  ]);
  assert.strictEqual(r.successRaw, 2);
  assert.strictEqual(r.success, 1);
});

test("Asset-Pfade zählen nicht als pageView, aber als pathCount", () => {
  const agg = makeAggregator({ assetRe: /\.(css|js|png|jpg|svg|woff2?)$/i });
  const r = feed(agg, [
    combined({ target: "/style.css", ua: BROWSER_UA }),
    combined({ target: "/start", ua: BROWSER_UA }),
  ]);
  assert.strictEqual(r.pageViews, 1, "nur /start ist ein Seitenaufruf");
  assert.ok(r.pathCounts.get("/style.css") >= 1, "Asset taucht in pathCounts auf");
});

test("Zeit-Regression (Zeitstempel springt zurück) wird erkannt", () => {
  const agg = makeAggregator({});
  const r = feed(agg, [
    combined({ time: "05/Jun/2026:12:00:00 +0200", ua: BROWSER_UA }),
    combined({ time: "05/Jun/2026:11:00:00 +0200", ua: BROWSER_UA }), // zurück
  ]);
  assert.strictEqual(r.timeRegressions, 1);
});

test("useXff: Client-IP wird aus X-Forwarded-For-Trailing gelesen", () => {
  const agg = makeAggregator({ useXff: true });
  // Spalte 1 ist die private Proxy-IP; echte IP steht im Trailing-Feld.
  const line = combined({
    ip: "10.0.0.1",
    ua: BROWSER_UA,
    trailing: ' "198.51.100.23, 10.0.0.1"',
  });
  const r = feed(agg, [line]);
  assert.strictEqual(r.kept, 1);
  // privateClientHits zählt nur ohne XFF; mit XFF nicht.
  assert.strictEqual(r.privateClientHits, 0);
});

// ===========================================================================
// Abschlussbericht
// ===========================================================================
console.log("\n" + "=".repeat(60));
console.log("ZUSAMMENFASSUNG");
console.log("=".repeat(60));
console.log(`  PASS (echte Tests bestanden):        ${results.pass}`);
console.log(`  EXPECTED FAILURE (Produktcode fehlt): ${results.expectedFailure}`);
console.log(`  UNEXPECTED PASS (Test veraltet):      ${results.unexpectedPass}`);
console.log(`  FAIL (echte Fehler):                  ${results.fail}`);

const exitCode = results.fail > 0 || results.unexpectedPass > 0 ? 1 : 0;
if (exitCode !== 0) {
  console.log("\nHandlungsbedarf:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message.split("\n")[0]}`);
}
console.log(`\nExit-Code: ${exitCode}`);
process.exit(exitCode);
