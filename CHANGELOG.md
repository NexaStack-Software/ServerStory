# Changelog

## Unreleased

## 1.0.1 - 2026-06-19

- Multi-Format-Parser für Apache/Nginx Combined, JSON, IIS/W3C, Cloudflare, CloudFront, Fastly und Akamai-nahe Logs erweitert.
- No-False-Confidence-Schicht ergänzt: Befunde werden lieber als eingeschränkt/unsicher markiert, statt falsche Präzision zu behaupten.
- Evidence-/Claim-Safety-Schicht im Analyse-Protokoll ergänzt: Kennzahlen werden als `measured`, `estimated`, `lower_bound`, `comparison` oder `not_determinable` klassifiziert.
- UI zeigt Besucher hinter Proxy/CDN ohne belastbare XFF-Auswertung als nicht bestimmbar statt als präzise Zahl.
- Sichtbare Belastbarkeits-Ampeln und konkrete Gründe für Seitenaufrufe, Besucher, Conversions, GA4-Abgleich, Host-Scope, Bot-/Anomalie-Erkennung und Tracking-Speicher ergänzt.
- Große Golden-Corpus-Tests mit 1.250 Besuchern für Combined, Cloudflare, CloudFront, Fastly, Akamai und IIS/W3C ergänzt.
- Störfalltests für Proxy/XFF, Host-Mix, unsortierte Logs, kaputte Zeilen, Tracking-Cap und Report-Unsicherheiten ergänzt.
- Preflight nutzt dieselbe Parser-/Recognition-Logik wie die Vollanalyse und warnt früh bei Formatproblemen, Host-Mix, fehlendem XFF und niedriger Recognition-Rate.
- GA4 CSV/TSV Import robuster gegen BOM, Metazeilen, Summenzeilen und falsche Metriken.
- GA4 Import warnt jetzt auch bei nicht lesbaren Eingaben statt still fehlende Werte anzunehmen.
- Conversion-Deduplizierung per Muster und Order-ID abgesichert.
- Analyse-Protokoll `serverstory.analysis.v1` mit Snapshot-Test, Parser-Diagnostik, `visitorRange`, `proxyKind`, Reliability-Feldern und Accuracy-Notes eingeführt.
- Browser-E2E für Upload, Preflight, Report, Demo, Hostfilter, XFF, falsche GA4-Metrik, Tracking-Cap und `.gz`-Upload ergänzt.
- Sanitizer für echte Log-Snippets eingeführt und gegen IPs, Hosts, E-Mails, Cookies, Authorization-Header, Tokens und lange IDs gehärtet.
- Provider-nahe Fixtures für CloudFront, Cloudflare Logpush, IIS/W3C, Fastly und Akamai-Matrix ergänzt.
- Release-ZIP Build und Release-Audit eingeführt.
- Repo-Audit gegen versehentlich commitete echte Logs, Archive, große Dateien und offensichtliche PII ergänzt.
