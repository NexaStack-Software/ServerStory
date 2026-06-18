# Analyse-Protokoll v1

`copy-report` erzeugt JSON mit `schema: "serverstory.analysis.v1"` und
`schemaVersion: 1`. Das Schema ist fuer Debugging, Support und Regressionstests gedacht.

Stabile Kernfelder:

- `schema`, `schemaVersion`: Version des Protokolls.
- `generatedAt`: ISO-Zeitpunkt der Erstellung.
- `format`: erkanntes Hauptformat, z. B. `combined`, `cloudflare`, `cloudfront`.
- `totals`: Zeilen, erkannte/benutzte/gefilterte Aufrufe, Pageviews, Visits, Conversion-Zahl.
- `quality`: Belastbarkeit je Kennzahl und zentrale Diagnoseflags.
- `evidence`: Claim-Safety-Schicht je Kennzahl; trennt Messung, Schaetzung,
  Mindestwert und nicht bestimmbare Aussagen.
- `timeRange`: erkannter Logzeitraum und groesste Luecke.
- `xForwardedFor`: XFF-Nutzung, fehlende oder nur private XFF-Werte.
- `proxyKind`: leer, `private` oder `concentrated`; zeigt Proxy-/CDN-Hinweise in der Besucherzaehlung.
- `filterReasons`: absolute Filtergruende.
- `accuracyNotes`: menschenlesbare Hinweise zur Belastbarkeit.
- `topPages`: Tabellenzeilen mit Server-, GA4-, Differenz- und Abdeckungswerten.

Diagnosefelder:

- `totals.visitorRange`: Bandbreite fuer Besucher, wenn Proxy/CDN/Chronologie die exakte Zahl begrenzen.
- `quality.pageviewReliability`, `visitorReliability`, `ga4Reliability`, `conversionReliability`, `trackingReliability`
- `quality.cacheRisk`, `chronologyIssue`, `hostReliability`, `botReliability`
- `evidence.pageViews`, `visits`, `conversions`, `ga4`, `hostScope`, `botAnomaly`
- `evidence.*.type`: `measured`, `estimated`, `lower_bound`, `comparison`,
  `not_determinable` oder `not_available`.
- `evidence.*.canAnswer`: ob ServerStory die Frage mit diesen Daten serioes
  beantworten kann.
- `evidence.*.reason`: konkrete Begruendung fuer die Aussagegrenze.
- `parser.dataRows`, `metaRows`, `unrecognizedRows`, `unrecognizedPct`
- `parser.formatCounters`
- `parser.hosts`
- `parser.statusCounts`, `parser.methodCounts`
- `parser.filterReasonPct`
- `xForwardedFor.used`, `missing`, `privateOnly`
- `proxyKind`
- `filterReasons.host`, `bot`, `status`, `range`, `method`, `emptyUa`, `strict`

Wichtige Unsicherheiten muessen im Report sichtbar bleiben:

- Proxy/CDN ohne belastbare Besucher-IP: `quality.visitorReliability` ist nicht `high`,
  `quality.cacheRisk` steigt, `totals.visitorRange` oeffnet eine Bandbreite und
  `evidence.visits.type` wird `not_determinable`.
- Origin-Logs hinter Proxy/CDN: `evidence.pageViews.type` kann `lower_bound`
  werden, weil CDN-Cache-Hits im Origin-Log fehlen koennen.
- Mehrere Hosts ohne Hostfilter: `quality.hostReliability` ist `limited` und
  `accuracyNotes.hostScope` empfiehlt Eingrenzung.
- Unsortierte Logs: `quality.chronologyIssue` wird gesetzt und die Besucher-Bandbreite
  wird erweitert.
- Nicht erkannte Zeilen: `parser.unrecognizedRows` und `quality.recognitionRate`
  zeigen die Belastungsgrenze; `accuracyNotes.pageViews` nennt die Pruefung.
- GA4-Importfehler: `accuracyNotes.ga4` uebernimmt Warnungen wie falsche Metrik
  (`Users` statt `Views`) oder nicht lesbare Exporte.

Preflight

Die Kurzpruefung nutzt dieselbe Parser-/Recognition-Logik wie die Vollanalyse.
Sie soll frueh vor Formatproblemen, Host-Mix, fehlendem XFF und niedriger
Recognition-Rate warnen. Ihre Ampeln sind Vorabhinweise; die Vollanalyse und
der Copy-Report bleiben die verbindliche Diagnose.

Dynamische Felder wie `generatedAt` und `timeRange` koennen sich zwischen Laeufen aendern.
Der stabile Snapshot liegt unter `tests/snapshots/analysis-report-v1.json`.
