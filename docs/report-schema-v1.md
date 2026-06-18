# Analyse-Protokoll v1

`copy-report` erzeugt JSON mit `schema: "serverstory.analysis.v1"` und
`schemaVersion: 1`. Das Schema ist fuer Debugging, Support und Regressionstests gedacht.

Stabile Kernfelder:

- `schema`, `schemaVersion`: Version des Protokolls.
- `generatedAt`: ISO-Zeitpunkt der Erstellung.
- `format`: erkanntes Hauptformat, z. B. `combined`, `cloudflare`, `cloudfront`.
- `totals`: Zeilen, erkannte/benutzte/gefilterte Aufrufe, Pageviews, Visits, Conversion-Zahl.
- `quality`: Belastbarkeit je Kennzahl und zentrale Diagnoseflags.
- `timeRange`: erkannter Logzeitraum und groesste Luecke.
- `xForwardedFor`: XFF-Nutzung, fehlende oder nur private XFF-Werte.
- `filterReasons`: absolute Filtergruende.
- `accuracyNotes`: menschenlesbare Hinweise zur Belastbarkeit.
- `topPages`: Tabellenzeilen mit Server-, GA4-, Differenz- und Abdeckungswerten.

Diagnosefelder:

- `totals.visitorRange`: Bandbreite fuer Besucher, wenn Proxy/CDN/Chronologie die exakte Zahl begrenzen.
- `quality.pageviewReliability`, `visitorReliability`, `ga4Reliability`, `conversionReliability`, `trackingReliability`
- `quality.cacheRisk`, `chronologyIssue`, `hostReliability`, `botReliability`
- `parser.dataRows`, `metaRows`, `unrecognizedRows`, `unrecognizedPct`
- `parser.formatCounters`
- `parser.hosts`
- `parser.statusCounts`, `parser.methodCounts`
- `parser.filterReasonPct`
- `xForwardedFor.used`, `missing`, `privateOnly`
- `filterReasons.host`, `bot`, `status`, `range`, `method`, `emptyUa`, `strict`

Wichtige Unsicherheiten muessen im Report sichtbar bleiben:

- Proxy/CDN ohne belastbare Besucher-IP: `quality.visitorReliability` ist nicht `high`,
  `quality.cacheRisk` steigt und `totals.visitorRange` oeffnet eine Bandbreite.
- Mehrere Hosts ohne Hostfilter: `quality.hostReliability` ist `limited` und
  `accuracyNotes.hostScope` empfiehlt Eingrenzung.
- Unsortierte Logs: `quality.chronologyIssue` wird gesetzt und die Besucher-Bandbreite
  wird erweitert.
- Nicht erkannte Zeilen: `parser.unrecognizedRows` und `quality.recognitionRate`
  zeigen die Belastungsgrenze; `accuracyNotes.pageViews` nennt die Pruefung.

Dynamische Felder wie `generatedAt` und `timeRange` koennen sich zwischen Laeufen aendern.
Der stabile Snapshot liegt unter `tests/snapshots/analysis-report-v1.json`.
