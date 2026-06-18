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

- `parser.dataRows`, `metaRows`, `unrecognizedRows`, `unrecognizedPct`
- `parser.formatCounters`
- `parser.hosts`
- `parser.statusCounts`, `parser.methodCounts`
- `parser.filterReasonPct`

Dynamische Felder wie `generatedAt` und `timeRange` koennen sich zwischen Laeufen aendern.
Der stabile Snapshot liegt unter `tests/snapshots/analysis-report-v1.json`.
