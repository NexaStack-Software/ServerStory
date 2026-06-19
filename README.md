# ServerStory

ServerStory wertet Server-Access-Logs lokal im Browser aus. Das Tool zeigt
Seitenaufrufe, Besucher-Schaetzungen, Conversions und optional einen Vergleich mit
Google Analytics 4. Die Logdatei wird nicht hochgeladen.

![ServerStory: Logdatei auswählen, auswerten, Ergebnis ansehen](screenshot.png)

## Nutzung

1. Die bereitgestellte ServerStory-ZIP-Datei entpacken.
2. `START_HIER.html` im Browser öffnen.
3. Access-Log-Datei auswählen (`.log`, `.txt`, `.gz`).
4. Optional GA4-Seitenaufrufe und Kaufzahlen eintragen.
5. `Datei kurz prüfen` oder `Jetzt auswerten` klicken.

Die Nutzer-ZIP zeigt auf der obersten Ebene nur `START_HIER.html` und den Ordner
`serverstory-app/`. Alles Technische liegt im Ordner; normale Nutzer müssen nur die
Startdatei öffnen.

Moderne Browser können gzip-komprimierte Logs direkt verarbeiten. Sehr große Dateien
werden gestreamt; bei internen Schutzgrenzen markiert ServerStory die betroffenen
Befunde als eingeschränkt.

## Unterstützte Logdaten

ServerStory erkennt aktuell unter anderem:

- Apache/Nginx Combined Logs
- IIS/W3C Logs
- CloudFront W3C/Standard-nahe Logs
- Cloudflare Logpush-nahe JSON Logs
- Fastly-nahe JSON Logs
- Akamai-nahe JSON Logs
- alte ITA-HTTP-Archivlogs ohne User-Agent

Die Kurzprüfung klassifiziert Dateien vor der Analyse als Access Log, Legacy-Access-Log
oder als wahrscheinliches Nicht-Access-Log, zum Beispiel Analytics CSV, Error Log,
WAF-/Security-Log oder Monitoring-Log.

## Belastbarkeit

ServerStory soll keine falsche Sicherheit erzeugen. Jede zentrale Aussage wird intern
als `allowed`, `limited` oder `blocked` bewertet. Sichtbare Ampeln und der Copy-Report
verwenden dieselbe Entscheidungslogik.

Typische Gründe für eingeschränkte Befunde:

- mehrere Hosts oder Subdomains in einer Datei
- Proxy/CDN verdeckt echte Besucheradressen
- Origin-Logs enthalten keine CDN-Cache-Hits
- fehlendes oder unplausibles X-Forwarded-For
- niedrige Recognition Rate
- unsortierte Logs
- altes Format ohne User-Agent
- falsche GA4-Metrik, falscher Zeitraum oder falsche Seitenauswahl
- Conversion-Seite ohne Order-ID oder Reload-Risiko

Seitenaufrufe sind meist am belastbarsten, sofern die Datei lesbar ist und alle
relevanten Requests im Log landen. Besucher bleiben eine Schaetzung, weil Serverlogs
keine Personen-ID enthalten. GA4-Vergleiche sind nur sinnvoll, wenn Zeitraum, Host,
Seitenpfade und Metrik wirklich zusammenpassen.

## Copy-Report

Der Copy-Report exportiert ein versioniertes JSON-Protokoll
`serverstory.analysis.v1`. Es enthält neben den Zahlen auch:

- `quality`
- `evidence`
- `evidenceFailures`
- `claimMatrix`
- `auditProtocol`
- `exportCompleteness`
- `ga4Validation`
- `parser`
- `accuracyNotes`

Das Schema ist in [docs/report-schema-v1.md](docs/report-schema-v1.md) beschrieben.
Bekannte Genauigkeitsgrenzen stehen in [docs/accuracy-limits.md](docs/accuracy-limits.md).

## Datenschutz

Die Auswertung läuft ausschließlich lokal im Browser. ServerStory sendet keine Logs an
einen Server. Im UI und im Report werden aggregierte Befunde ausgegeben, keine
Nutzerlisten.

Echte Logs können trotzdem personenbezogene Daten enthalten. Lege sie nicht ins Repo.
Der Ordner `serverstory-logs/` ist für lokale Dateien vorgesehen und per `.gitignore`
ausgeschlossen.

Anonymisierte Snippets lassen sich so erzeugen:

```bash
node scripts/sanitize-log.js serverstory-logs/original.log serverstory-logs/anonymized.log
```

Der Sanitizer ersetzt IPs und Hosts durch Dokumentationswerte, maskiert E-Mails und
entfernt riskante Query-Parameter wie `email`, `name`, `user`, `token` oder `session`.
Vor dem Commit trotzdem manuell prüfen.

## Entwicklung

Die Source of Truth liegt in `src/`:

- `src/app.js`: Parser, Aggregator, Diagnose-, Report- und Render-Logik
- `src/styles.css`: Styling
- `src/index.template.html`: HTML-Template mit Platzhaltern

Der Build erzeugt daraus die portable Einzeldatei `index.html`:

```bash
npm run build
```

Das vollständige Qualitätsgate:

```bash
npm run verify
```

`verify` baut `index.html` aus `src/` und prüft danach per Git-Diff, ob das Artefakt
zum Quellstand passt. Wenn `index.html` und `src/` auseinanderlaufen, schlägt der Lauf
fehl.

Wichtige Einzelbefehle:

```bash
npm test              # Parser-, Diagnose-, Report-, Snapshot- und Render-Tests
npm run test:e2e      # Browserflow mit Upload, Preflight, Report, Demo, XFF, Hostfilter, .gz
npm run test:sanitize # Log-Sanitizer prüfen
npm run audit:repo    # Repo-Hygiene gegen echte Logs/Archive/PII
npm run test:realworld # optional, wenn Real-World-Logs lokal im Cache liegen
```

Optionale Real-World-Fixtures:

```bash
npm run download:realworld -- epa,nasa
npm run test:realworld
```

Die heruntergeladenen Dateien liegen unter `tests/realworld-cache/` und werden nicht
committet.

Interne Designentscheidungen, No-False-Confidence-Regeln und weitere Roadmap-Notizen
stehen in [docs/design-rationale.md](docs/design-rationale.md).

## Release

Release-Schritte stehen in [docs/release-checklist.md](docs/release-checklist.md).
Die Nutzer-ZIP wird mit `npm run build:release` erzeugt und mit `npm run audit:release`
geprüft.

## Lizenz

MIT - siehe [LICENSE](LICENSE).
