// Lädt die ECHTE Produktlogik aus index.html, ohne die Datei zu verändern.
//
// Hintergrund: Die gesamte Parser-/Aggregator-Logik steckt eingebettet in
// index.html in der Funktion makeAggregator(config). Sie ist bewusst in sich
// geschlossen (keine DOM-Zugriffe, keine externen Referenzen), damit sie per
// toString() in einen Inline-Worker serialisiert werden kann. Genau diese
// Eigenschaft nutzen wir hier: Wir lesen index.html als Text, extrahieren per
// Klammer-Matching die Quelle ab "function makeAggregator", evaluieren sie in
// Node und bekommen so eine aufrufbare makeAggregator-Funktion — also den
// echten, unveränderten Produktcode.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function extractMakeAggregatorSource(html) {
  const marker = "function makeAggregator";
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error("makeAggregator wurde in index.html nicht gefunden");
  }
  // Ab der ersten öffnenden geschweiften Klammer per Tiefenzählung das
  // passende schließende "}" finden. Klammern in Strings/RegExp/Kommentaren
  // müssen dabei übersprungen werden, sonst zählt man falsch.
  const braceOpen = html.indexOf("{", start);
  if (braceOpen === -1) throw new Error("Funktionskörper nicht gefunden");

  let depth = 0;
  let i = braceOpen;
  const n = html.length;

  // Zustände für Skip-Logik
  let inLine = false;     // // ...
  let inBlock = false;    // /* ... */
  let inStr = null;       // ' " `
  let inRegex = false;
  let prevSignificant = ""; // letztes nicht-whitespace-Zeichen (für Regex-Erkennung)

  for (; i < n; i++) {
    const c = html[i];
    const next = html[i + 1];

    if (inLine) {
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i++; }
      continue;
    }
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (inRegex) {
      if (c === "\\") { i++; continue; }
      if (c === "[") {
        // Zeichenklasse: bis ] alles roh überspringen (auch / darin)
        i++;
        for (; i < n; i++) {
          if (html[i] === "\\") { i++; continue; }
          if (html[i] === "]") break;
        }
        continue;
      }
      if (c === "/") inRegex = false;
      continue;
    }

    // Normaler Code
    if (c === "/" && next === "/") { inLine = true; i++; continue; }
    if (c === "/" && next === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/") {
      // Regex vs. Division: Regex steht typischerweise nach einem dieser Zeichen.
      if (prevSignificant === "" || "(,=:[!&|?{};+-*%<>~^".includes(prevSignificant) || prevSignificant === "n" /* return */) {
        inRegex = true;
        continue;
      }
    }

    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }

    if (!/\s/.test(c)) prevSignificant = c;
  }
  throw new Error("Schließende Klammer von makeAggregator nicht gefunden");
}

function loadMakeAggregator() {
  const indexPath = path.join(__dirname, "..", "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const src = extractMakeAggregatorSource(html);
  // Quelle in eine aufrufbare Funktion verwandeln. Der extrahierte Text ist
  // "function makeAggregator(config) { ... }" — wir geben sie per return zurück.
  const factory = new Function(src + "\nreturn makeAggregator;");
  return factory();
}

module.exports = { loadMakeAggregator, extractMakeAggregatorSource };
