# Changelog

## Unreleased

## 1.0.1 - 2026-06-19

- Multi-Format-Parser fuer Apache/Nginx Combined, JSON, IIS/W3C, Cloudflare, CloudFront, Fastly und Akamai-nahe Logs erweitert.
- No-False-Confidence-Schicht ergaenzt: Befunde werden lieber als eingeschraenkt/unsicher markiert, statt falsche Praezision zu behaupten.
- Evidence-/Claim-Safety-Schicht im Analyse-Protokoll ergaenzt: Kennzahlen werden als `measured`, `estimated`, `lower_bound`, `comparison` oder `not_determinable` klassifiziert.
- UI zeigt Besucher hinter Proxy/CDN ohne belastbare XFF-Auswertung als nicht bestimmbar statt als praezise Zahl.
- Sichtbare Belastbarkeits-Ampeln und konkrete Gruende fuer Seitenaufrufe, Besucher, Conversions, GA4-Abgleich, Host-Scope, Bot-/Anomalie-Erkennung und Tracking-Speicher ergaenzt.
- Grosse Golden-Corpus-Tests mit 1.250 Besuchern fuer Combined, Cloudflare, CloudFront, Fastly, Akamai und IIS/W3C ergaenzt.
- Stoerfalltests fuer Proxy/XFF, Host-Mix, unsortierte Logs, kaputte Zeilen, Tracking-Cap und Report-Unsicherheiten ergaenzt.
- Preflight nutzt dieselbe Parser-/Recognition-Logik wie die Vollanalyse und warnt frueh bei Formatproblemen, Host-Mix, fehlendem XFF und niedriger Recognition-Rate.
- GA4 CSV/TSV Import robuster gegen BOM, Metazeilen, Summenzeilen und falsche Metriken.
- GA4 Import warnt jetzt auch bei nicht lesbaren Eingaben statt still fehlende Werte anzunehmen.
- Conversion-Deduplizierung per Muster und Order-ID abgesichert.
- Analyse-Protokoll `serverstory.analysis.v1` mit Snapshot-Test, Parser-Diagnostik, `visitorRange`, `proxyKind`, Reliability-Feldern und Accuracy-Notes eingefuehrt.
- Browser-E2E fuer Upload, Preflight, Report, Demo, Hostfilter, XFF, falsche GA4-Metrik, Tracking-Cap und `.gz`-Upload ergaenzt.
- Sanitizer fuer echte Log-Snippets eingefuehrt und gegen IPs, Hosts, E-Mails, Cookies, Authorization-Header, Tokens und lange IDs gehaertet.
- Provider-nahe Fixtures fuer CloudFront, Cloudflare Logpush, IIS/W3C, Fastly und Akamai-Matrix ergaenzt.
- Release-ZIP Build und Release-Audit eingefuehrt.
- Repo-Audit gegen versehentlich commitete echte Logs, Archive, grosse Dateien und offensichtliche PII ergaenzt.
