# Changelog

## Unreleased

## 1.0.1 - 2026-06-19

- Extended the multi-format parser for Apache/Nginx Combined, JSON, IIS/W3C,
  Cloudflare, CloudFront, Fastly, and Akamai-like logs.
- Added the no-false-confidence layer: findings are marked as limited or uncertain
  instead of presenting false precision.
- Added evidence and claim safety to the analysis protocol: metrics are classified as
  `measured`, `estimated`, `lower_bound`, `comparison`, or `not_determinable`.
- The UI now marks visits behind proxy/CDN without reliable XFF evidence as not
  determinable instead of showing a precise number.
- Added visible reliability badges and concrete reasons for page views, visits,
  conversions, GA4 comparison, host scope, bot/anomaly detection, and tracking memory.
- Added large golden-corpus tests with 1,250 visitors for Combined, Cloudflare,
  CloudFront, Fastly, Akamai, and IIS/W3C.
- Added failure-mode tests for proxy/XFF, host mix, unsorted logs, broken rows,
  tracking cap, and report uncertainty.
- Preflight now uses the same parser and recognition logic as the full analysis and
  warns early about format problems, host mix, missing XFF, and low recognition rate.
- Made GA4 CSV/TSV import more robust against BOMs, metadata rows, total rows, and
  wrong metrics.
- GA4 import now warns on unreadable input instead of silently assuming missing values.
- Hardened conversion deduplication by pattern and order ID.
- Introduced analysis protocol `serverstory.analysis.v1` with snapshot test, parser
  diagnostics, `visitorRange`, `proxyKind`, reliability fields, and accuracy notes.
- Added browser E2E coverage for upload, preflight, report, demo, host filter, XFF,
  wrong GA4 metric, tracking cap, and `.gz` upload.
- Introduced the log sanitizer and hardened it against IPs, hosts, emails, cookies,
  authorization headers, tokens, and long IDs.
- Added provider-like fixtures for CloudFront, Cloudflare Logpush, IIS/W3C, Fastly, and
  Akamai Matrix.
- Introduced release ZIP build and release audit.
- Added repo audit against accidentally committed real logs, archives, large files, and
  obvious PII.
