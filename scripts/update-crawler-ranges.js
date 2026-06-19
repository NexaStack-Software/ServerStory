#!/usr/bin/env node
// Aktualisiert die eingebetteten Suchmaschinen-Crawler-IP-Netze in src/app.js.
// Quelle: offizielle, von Google und Microsoft veröffentlichte Bot-IP-Listen.
// Damit kann das Tool offline (ohne Netzwerk, ohne Reverse-DNS) prüfen, ob ein
// als Googlebot/Bingbot deklarierter Zugriff wirklich aus deren Netzen kommt.
//
// Aufruf:  node scripts/update-crawler-ranges.js
// Danach:  npm run build   (schreibt index.html aus src/ neu)

const fs = require("fs");
const path = require("path");

const SOURCES = {
  googlebot: "https://developers.google.com/static/search/apis/ipranges/googlebot.json",
  bingbot: "https://www.bing.com/toolbox/bingbot.json"
};

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "src", "app.js");
const START = "// CRAWLER_RANGES_START";
const END = "// CRAWLER_RANGES_END";

async function fetchPrefixes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const json = await res.json();
  const v4 = (json.prefixes || []).filter((p) => p.ipv4Prefix).map((p) => p.ipv4Prefix);
  if (!v4.length) throw new Error(`${url} -> keine IPv4-Präfixe gefunden`);
  return v4;
}

function formatList(arr) {
  const lines = [];
  for (let i = 0; i < arr.length; i += 6) {
    lines.push("            " + arr.slice(i, i + 6).map((x) => JSON.stringify(x)).join(", ") + (i + 6 < arr.length ? "," : ""));
  }
  return lines.join("\n");
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const ranges = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    ranges[name] = await fetchPrefixes(url);
    console.log(`${name}: ${ranges[name].length} IPv4-Netze`);
  }

  const block = [
    `${START} — generiert von scripts/update-crawler-ranges.js (Stand ${today}). NICHT von Hand editieren.`,
    "        const CRAWLER_RANGES = {",
    "          googlebot: [",
    formatList(ranges.googlebot),
    "          ],",
    "          bingbot: [",
    formatList(ranges.bingbot),
    "          ]",
    "        };",
    `        ${END}`
  ].join("\n");

  const src = fs.readFileSync(appPath, "utf8");
  const a = src.indexOf(START);
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) throw new Error("Marker CRAWLER_RANGES_START/END nicht in src/app.js gefunden");
  // Vom Marker-Start (inkl. der "// "-Einrückung davor) bis zum END-Markerende ersetzen.
  const lineStart = src.lastIndexOf("\n", a) + 1;
  const lineEnd = src.indexOf("\n", b);
  const next = src.slice(0, lineStart) + "        " + block + src.slice(lineEnd);
  fs.writeFileSync(appPath, next);
  console.log("src/app.js aktualisiert. Jetzt: npm run build");
})().catch((err) => {
  console.error("Fehler:", err.message);
  process.exit(1);
});
