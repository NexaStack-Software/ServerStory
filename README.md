# ServerStory

ServerStory analyzes your website access logs locally in the browser. It shows
server-side page views, rough visit estimates, purchases, and optional comparisons with
Google Analytics. Your log file is not uploaded.

[Deutsche README](README.de.md)

![ServerStory: choose a log file, analyze it, review the result](screenshot.png)

## Usage

1. Download the ServerStory ZIP file from GitHub Releases, not the GitHub source-code ZIP.
2. Open `START_HIER.html` in your browser.
3. Choose your server log file (`.log`, `.txt`, `.gz`).
4. Optionally enter Google Analytics page views and purchase counts.
5. Click `Quick file check` or `Analyze now`.

ServerStory starts in English by default. Use the `DE` / `EN` switch in the top right to
change languages; the choice is stored locally in your browser.

The release ZIP contains only `START_HIER.html` and the `serverstory-app/` folder at the
top level. A double-click on `START_HIER.html` is enough to start.

Modern browsers can process gzip-compressed logs directly. Very large files are streamed;
if internal safety caps are reached, ServerStory marks the affected findings as limited.

## Supported Log Data

ServerStory currently recognizes, among others:

- Apache/Nginx Combined Logs
- IIS/W3C Logs
- CloudFront W3C / standard-like logs
- Cloudflare Logpush-like JSON logs
- Fastly-like JSON logs
- Akamai-like JSON logs
- old ITA HTTP archive logs without a user agent

The quick file check classifies files before the full analysis as access log,
legacy access log, or likely non-access-log data such as analytics CSV, error log,
WAF/security log, or monitoring log.

## Reliability

ServerStory is designed not to create false confidence. It evaluates each important
number separately: good to use, use with caution, or not reliably determinable with the
available data. The visible badges and the copyable report use the same decision logic.

Typical reasons for limited findings:

- multiple hosts or subdomains in one file
- proxy/CDN hides real visitor addresses
- origin logs miss CDN cache hits
- missing or implausible `X-Forwarded-For`
- many unrecognized rows
- unsorted logs
- old format without user agents
- wrong Google Analytics metric, period, or page selection
- conversion page without order ID or reload risk

Page views are usually the most reliable metric when the file is readable and all
relevant requests reach the log. Visits remain an estimate because server logs do not
contain a person ID. Google Analytics comparisons are useful only when period, website,
page paths, and metric really match.

## Copy Report

The copy report exports versioned JSON with `schema: "serverstory.analysis.v1"`. It
contains the numbers and technical evidence, for example:

- `quality`
- `evidence`
- `evidenceFailures`
- `claimMatrix`
- `auditProtocol`
- `exportCompleteness`
- `ga4Validation`
- `parser`
- `accuracyNotes`

The schema is documented in [docs/report-schema-v1.md](docs/report-schema-v1.md).
Known accuracy limits are documented in [docs/accuracy-limits.md](docs/accuracy-limits.md).

## Privacy

The analysis runs entirely in your browser. ServerStory does not send logs to a server.
The UI and report output aggregate findings, not user lists.

Real logs can still contain personal data. Do not commit them to the repository. The
`serverstory-logs/` folder is intended for local files and is excluded via `.gitignore`.

Create anonymized snippets like this:

```bash
node scripts/sanitize-log.js serverstory-logs/original.log serverstory-logs/anonymized.log
```

The sanitizer replaces IPs and hosts with documentation values, masks emails, and
removes risky query parameters such as `email`, `name`, `user`, `token`, or `session`.
Still review anonymized snippets manually before committing them.

## Development

The source of truth lives in `src/`:

- `src/modules/`: source fragments for parser, aggregator, diagnostics, report, worker,
  i18n, and render logic
- `src/app.js`: browser script built from `src/modules/` for tests and build
- `src/styles.css`: styling
- `src/index.template.html`: HTML template with placeholders

The build first bundles `src/modules/` into `src/app.js`, then creates the portable
single-file `index.html`:

```bash
npm run build
```

Full quality gate:

```bash
npm run verify
```

`verify` rebuilds `index.html` and `src/app.js` from `src/` and then checks that the
committed artifacts still match the source. If generated artifacts drift from the source,
the run fails.

Important commands:

```bash
npm test              # parser, diagnostics, report, snapshot, and render tests
npm run test:e2e      # browser flow with upload, preflight, report, demo, XFF, host filter, .gz
npm run test:sanitize # log sanitizer tests
npm run audit:repo    # repo hygiene against real logs, archives, and obvious PII
npm run test:realworld # optional, when real-world logs are available locally
npm run test:access-realworld # optional, when real Combined access logs are available locally
npm run test:local-logs # optional corpus under ~/test-logs or SERVERSTORY_LOCAL_LOG_DIR
```

Optional real-world fixtures:

```bash
npm run download:realworld -- epa,nasa
npm run download:access -- secrepo,elastic,lukaszog
npm run test:realworld
npm run test:access-realworld
npm run test:local-logs
```

Downloaded files stay under `tests/realworld-cache/` and `tests/access-cache/` and are
not committed.

Internal design decisions, no-false-confidence rules, and roadmap notes live in
[docs/design-rationale.md](docs/design-rationale.md).

## Release

Release steps are documented in [docs/release-checklist.md](docs/release-checklist.md).
Build the downloadable ZIP with `npm run build:release` and verify it with
`npm run audit:release`.

## License

MIT - see [LICENSE](LICENSE).
