# Design Rationale

Diese Datei sammelt interne Designentscheidungen und Roadmap-Notizen. Die README bleibt
bewusst nutzerorientiert.

## Qualitätsmaßstab

ServerStory darf lieber vorsichtig, eingeschränkt oder `not_determinable` sagen, als
eine präzise falsche Behauptung zu machen. Zahlen und Befunde sind deshalb getrennt:
Eine Zahl kann berechnet werden, ohne dass eine harte Aussage dazu erlaubt ist.

## No-False-Confidence-Schicht

Jede zentrale Aussage wird über eine Claim-Matrix bewertet:

- `allowed`: mit der vorhandenen Evidenz gut nutzbar
- `limited`: nutzbar, aber mit sichtbarer Einschränkung
- `blocked`: mit diesen Daten nicht belastbar behauptbar

Claims enthalten:

- `status`
- `reason`
- `requiredEvidence`
- `evidenceFailures`
- `recommendedChecks`
- `forbiddenConclusions`

Der Copy-Report exportiert dieselbe Matrix. UI und Report dürfen keine zweite,
abweichende Sicherheitslogik haben.

## Evidence Gates

Die wichtigsten Evidence-Gates:

- **Pageviews:** lesbare Datenzeilen, Zeitstempel, keine harte Exportlücke, Cache/CDN
  korrekt eingeordnet.
- **Visits:** echte Client-IP oder plausibles Proxy-Feld, keine starke Proxy-Dominanz,
  Chronologie ausreichend stabil.
- **GA4:** Pageview-Metrik, gleicher Zeitraum, gleicher Host, gleiche Seitenmenge,
  keine Duplikate oder große unmatched Shares.
- **Conversions:** Conversion-Pfad oder Pattern, möglichst Order-ID, Reload-Risiko
  sichtbar.
- **Host-Scope:** eindeutiger Host oder gesetzter Hostfilter.

Wenn `evidenceFailures` vorhanden sind, darf ein Claim nicht `allowed` sein.

## Preflight

Die Kurzprüfung soll falsche Erwartungen verhindern, bevor der Nutzer eine Vollanalyse
startet. Sie klassifiziert die Stichprobe als:

- `access_log`
- `legacy_access_log`
- `analytics_csv`
- `error_log`
- `waf_or_security_log`
- `monitoring_log`
- `unknown`

Nicht-Access-Dateien sollen nicht still Zahlen erzeugen, sondern klare Reject-Gründe
bekommen. Legacy-Logs ohne User-Agent sind analysierbar, aber Besucher-, Bot- und
Conversion-Aussagen werden konservativer bewertet.

## Edge, CDN und Origin

Origin-Logs und Edge-Logs beantworten unterschiedliche Fragen:

- Origin-Log: Was kam beim Webserver an?
- Edge-/CDN-Log: Was wurde am CDN-Rand ausgeliefert?

Wenn nur ein Origin-Log vorliegt, kann ServerStory CDN-Cache-Hits nicht rekonstruieren.
Solche Pageviews sind dann nur ein Mindestwert. Edge-Formate müssen als solche erkannt
werden und dürfen nicht still mit Origin-Logs vermischt werden.

## X-Forwarded-For und Proxy-Vertrauen

`X-Forwarded-For` und ähnliche Proxy-Felder sind nur belastbar, wenn die Logdatei aus
einer kontrollierten Proxy-/CDN-/Loadbalancer-Kette stammt. Ein Besucher darf dieses
Feld nicht selbst setzen können. ServerStory trennt deshalb zwei Fragen:

- Ist im Log ein technisch lesbares Proxy-Feld vorhanden?
- Ist die Quelle des Proxy-Felds als vertrauenswürdig bestätigt?

Ohne diese Bestätigung darf die Besucherzahl nicht als `high` bewertet werden, auch
wenn ServerStory IPs aus dem Feld lesen kann. Der Copy-Report exportiert den
Vertrauensstatus, damit Support und Regressionstests diesen Pfad nachvollziehen können.

## Bot- und Anomalie-Schwellen

Bot-/Anomalie-Erkennung nutzt Standardwerte, die im erweiterten Bereich konfigurierbar
sind:

- verdächtige Hits pro Besucher-Schlüssel
- minimaler Asset-Anteil
- strenger Browserfilter
- Tracking-Cap für sehr große Dateien

Wenn eine Schutzgrenze erreicht wird, bleiben Hauptzahlen möglichst nutzbar, aber
Detail- und Anomalie-Befunde werden herabgestuft.

## Large Files

ServerStory verarbeitet Logs lokal und möglichst streamingbasiert. Große Maps werden
gedeckelt, damit Browser nicht unkontrolliert Speicher verbrauchen. Tests decken
synthetische Großkorpora und optionale Real-World-Logs ab.

Optionale echte Lasttests:

```bash
npm run download:realworld -- epa,nasa
npm run download:access -- secrepo,elastic,lukaszog
npm run test:realworld
npm run test:access-realworld
```

Die Dateien bleiben lokal unter `tests/realworld-cache/` bzw. `tests/access-cache/`.
`realworld` prueft alte Forschungsarchive auf Last, Streaming und Legacy-Erkennung.
`access-realworld` prueft echte Combined-Access-Logs mit Referrer/User-Agent gegen
einen unabhaengigen Zaehler. So wird nicht nur getestet, ob die App irgendetwas
berechnet, sondern ob sie echte Webserver-Logs konservativ und reproduzierbar
bewertet. Wenn mindestens zehn SecRepo-Tageslogs lokal liegen, prueft der Test
zusaetzlich einen kombinierten Corpus mit deutlich mehr als 1.000 Besuchen.
`test:local-logs` prueft zusaetzlich einen lokalen Corpus unter `~/test-logs` oder
`SERVERSTORY_LOCAL_LOG_DIR`, falls vorhanden. Dieser Corpus wird nicht committet, kann
aber echte Security-, Bot- und Kleinsite-Logs gegen feste No-False-Confidence-Regeln
testen.

## Parser-Robustheit

Parserfehler dürfen nie die gesamte Analyse abbrechen. Eine kaputte Zeile zählt als
`unrecognized`. Das gilt auch für unerwartete Encodings, defekte Prozentkodierung,
abgeschnittene Zeilen oder unbekannte Felder.

Regressionen werden durch bekannte Fixtures, Fuzzing, gezielte Mutationen,
Calibration-Tests, Metamorphic-Tests und Monotonicity-Tests abgesichert.

## Aktuelle Architektur

Die aktuelle Source of Truth ist bewusst klein gehalten:

- `src/modules/`: nummerierte Browser-Script-Fragmente für Parser, Aggregator,
  Diagnose-, Worker-, Claim- und Render-Logik
- `src/app.js`: aus `src/modules/` gebautes Browser-Script für Tests und Build
- `src/styles.css`: Styling
- `src/index.template.html`: HTML-Template
- `scripts/build.js`: erzeugt `index.html`

`index.html` ist ein Build-Artefakt und wird committet, damit das Tool direkt per
Doppelklick funktioniert. `npm run verify` baut es neu und prüft per Git-Diff, dass es
zum Source-Stand passt. Zusätzlich muss auch `src/app.js` zum Stand der
`src/modules/` passen; `verify` bricht ab, wenn der Build eines der committeten
Artefakte verändert.

## Modulverträge

Die Dateien unter `src/modules/` sind bewusst noch keine ES-Module. Die App muss als
einzelne HTML-Datei unter `file://` laufen und der Worker serialisiert den Aggregator
per `makeAggregator.toString()`. Deshalb werden die Fragmente zu einem klassischen
Browser-Script gebündelt.

Damit die globale Kopplung nicht still wächst, enthalten die Moduldateien
`@provides`-/`@requires`-Metadaten. `scripts/build.js` prüft beim Build:

- jedes Modul deklariert seine bereitgestellten Globals
- alle benötigten Globals existieren
- die Build-Reihenfolge erfüllt die deklarierten Abhängigkeiten
- kein Global wird doppelt bereitgestellt

Eine spätere Umstellung auf echte ES-Module bleibt möglich, muss aber den Offline-Start,
den Inline-Worker und die VM-basierten Tests gemeinsam lösen.

## Internationalisierung

Die App ist als eine Codebasis mit Sprachumschalter aufgebaut. `src/modules/00-i18n.js`
enthält die Übersetzungstabelle, `t()` für dynamische Texte und `data-i18n`-Attribute
für statische UI-Elemente. Die Standardsprache ist Englisch, weil der öffentliche
Marktauftritt international ausgerichtet ist. Eine manuelle Auswahl (`DE`/`EN`) wird in
`localStorage` gespeichert.

Maschinenlesbare Report-Felder, Statuswerte und Claim-IDs bleiben sprachneutral stabil.
Sichtbare UI-Texte werden lokalisiert; fachliche Reporttexte können später schrittweise
zusätzlich sprachabhängig ausgegeben werden, ohne das Schema zu brechen.

## Report-Schema

Das Analyse-Protokoll ist versioniert als `serverstory.analysis.v1`. Tests validieren
Pflichtfelder, erlaubte Statuswerte und Konsistenz zwischen `claims`, `claimMatrix`,
`evidenceFailures` und `auditProtocol`.

Schema-Details: [report-schema-v1.md](report-schema-v1.md)

## Roadmap

Nützliche nächste Schritte:

- mehr moderne Provider-Fixtures: Plesk, cPanel, nginx variants, Apache vhost,
  ALB, Cloudflare/Fastly/Akamai/CloudFront Varianten
- stärkere Preflight-Provider-Erkennung
- echte ES-Module oder ein kleiner Modul-Bundler, wenn Wartungsdruck entsteht
- optionaler Benchmark-Report für Real-World-Tests
- weitere negative Fixtures: Error Logs, WAF Events, Monitoring CSVs, Analytics CSVs
