# Changelog

## Unreleased

- Multi-Format-Parser fuer Apache/Nginx Combined, JSON, IIS/W3C, Cloudflare, CloudFront, Fastly und Akamai-nahe Logs erweitert.
- Sichtbare Belastbarkeits-Ampeln und Praezisions-Check je Befund ergaenzt.
- GA4 CSV/TSV Import robuster gegen BOM, Metazeilen, Summenzeilen und falsche Metriken.
- Conversion-Deduplizierung per Muster und Order-ID abgesichert.
- Analyse-Protokoll `serverstory.analysis.v1` mit Snapshot-Test und Parser-Diagnostik eingefuehrt.
- Browser-E2E fuer Upload, Preflight, Report, Demo, Hostfilter, XFF, falsche GA4-Metrik, Tracking-Cap und `.gz`-Upload ergaenzt.
- Sanitizer fuer echte Log-Snippets eingefuehrt und gegen IPs, Hosts, E-Mails, Cookies, Authorization-Header, Tokens und lange IDs gehaertet.
- Provider-nahe Fixtures fuer CloudFront, Cloudflare Logpush, IIS/W3C, Fastly und Akamai-Matrix ergaenzt.
- Release-ZIP Build und Release-Audit eingefuehrt.
- Repo-Audit gegen versehentlich commitete echte Logs, Archive, grosse Dateien und offensichtliche PII ergaenzt.
