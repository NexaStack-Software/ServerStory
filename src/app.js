


      const sample = `203.0.113.10 - - [05/Jun/2026:10:00:00 +0200] "GET /?gclid=abc123 HTTP/1.1" 200 5321 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
203.0.113.10 - - [05/Jun/2026:10:05:00 +0200] "GET /produkt HTTP/1.1" 200 3421 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
203.0.113.10 - - [05/Jun/2026:10:12:00 +0200] "GET /bestellung/danke HTTP/1.1" 200 2411 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
203.0.113.10 - - [05/Jun/2026:10:12:20 +0200] "GET /bestellung/danke HTTP/1.1" 200 2411 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36"
198.51.100.20 - - [05/Jun/2026:11:00:00 +0200] "GET / HTTP/1.1" 200 5321 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"
198.51.100.20 - - [05/Jun/2026:11:04:00 +0200] "GET /bestellung/danke HTTP/1.1" 200 2411 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"
2001:db8::1 - - [05/Jun/2026:11:30:00 +0200] "GET /produkt HTTP/1.1" 200 3400 "-" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1"
10.0.0.5 - - [05/Jun/2026:11:45:00 +0200] "GET /preise HTTP/1.1" 200 2100 "-" "Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0" "203.0.113.55, 10.0.0.5"
192.0.2.30 - - [05/Jun/2026:12:00:00 +0200] "GET / HTTP/1.1" 200 5321 "-" "Googlebot/2.1 (+http://www.google.com/bot.html)"
198.51.100.77 - - [05/Jun/2026:12:10:00 +0200] "GET /agb HTTP/1.1" 200 800 "-" "-"`;
      let sampleMode = false;
      let analyzed = false;
      let lastResult = null;
      let lastGa4Import = { warning: "" };
      // Nicht-HTML-Ressourcen (Bilder, CSS, JS, Sitemaps, Feeds, JSON-Endpunkte …) werden
      // von den "Seitenaufrufen" ausgeschlossen, damit die Zahl mit GA4-Seitenaufrufen
      // (page_view für HTML-Dokumente) vergleichbar bleibt. Eine einzige Quelle; wird via
      // config (RegExp ist strukturiert klonbar) auch in den Worker gereicht, damit Haupt-
      // und Worker-Pfad garantiert identisch zählen.
      const ASSET_RE = /\.(css|js|mjs|map|json|xml|txt|rss|webmanifest|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|pdf|zip|gz)(\?|$)/i;

      function id(name) { return document.getElementById(name); }
      function number(idName) {
        const value = id(idName).value.trim();
        return value === "" ? null : Number(value);
      }
      function format(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return new Intl.NumberFormat("de-DE").format(value);
      }
      function percent(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        return `${Number(value).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
      }
      function signed(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return "-";
        if (value > 0) return "+" + format(value);
        if (value < 0) return "−" + format(Math.abs(value));
        return "0";
      }
      function kauf(n) {
        if (n === null || n === undefined || Number.isNaN(n)) return "-";
        return n === 1 ? "1 Kauf" : `${format(n)} Käufe`;
      }
      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }
      function normalizePath(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        let path;
        try {
          path = new URL(raw, "https://example.invalid").pathname;
        } catch {
          path = raw.startsWith("/") ? raw.split("?")[0] : `/${raw.split("?")[0]}`;
        }
        try { path = decodeURI(path); } catch (_) {}
        path = path.replace(/\/{2,}/g, "/");
        path = path.replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/i, "/");
        return path === "/" ? "/" : path.replace(/\/$/, "");
      }
      function compareUrls() {
        return id("compare-urls").value
          .split(/\r?\n|,/)
          .map((value) => normalizePath(value))
          .filter(Boolean)
          .filter((value, index, all) => all.indexOf(value) === index);
      }
      function parseMetricNumber(value) {
        let raw = String(value || "").trim();
        if (!raw) return null;
        raw = raw.replace(/\s+/g, "");
        const commaCount = (raw.match(/,/g) || []).length;
        const dotCount = (raw.match(/\./g) || []).length;
        const singleCommaDecimal = commaCount === 1 && dotCount === 0 && !/,\d{3}(\D|$)/.test(raw);
        if (singleCommaDecimal) {
          raw = raw.replace(",", ".");
        } else if (commaCount === 1 && dotCount > 0 && raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
          raw = raw.replace(/\./g, "").replace(",", ".");
        } else {
          raw = raw.replace(/[,.](?=\d{3}(\D|$))/g, "");
        }
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      function splitMetricLine(line) {
        const delimiter = line.includes("\t") ? "\t" : (line.includes(";") ? ";" : ",");
        if (delimiter !== ",") return line.split(delimiter).map((part) => part.trim());
        const cells = [];
        let current = "", quoted = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { quoted = !quoted; continue; }
          if (ch === "," && !quoted) { cells.push(current.trim()); current = ""; continue; }
          current += ch;
        }
        cells.push(current.trim());
        return cells;
      }
      function ga4UrlViews() {
        const values = new Map();
        lastGa4Import = { warning: "" };
        const lines = id("ga4-url-views").value
          .replace(/^\uFEFF/, "")
          .split(/\r?\n/)
          .map((line) => line.replace(/^\uFEFF/, "").trim())
          .filter((line) => line && !/^#/.test(line) && !/^insgesamt\b|^total\b/i.test(line));
        let pathIndex = -1, metricIndex = -1, start = 0;
        if (lines.length) {
          for (let i = 0; i < Math.min(lines.length, 10); i++) {
            const header = splitMetricLine(lines[i]).map((cell) => cell.toLowerCase());
            const maybePath = header.findIndex((cell) => /seite|page|path|pfad|url|landing/.test(cell));
            const maybeMetric = header.findIndex((cell) => /aufrufe|views|pageviews|screen page views|seitenaufrufe|ereignisanzahl/.test(cell));
            if (maybePath >= 0 && maybeMetric >= 0) {
              pathIndex = maybePath;
              metricIndex = maybeMetric;
              start = i + 1;
              break;
            }
            if (maybePath >= 0 && maybeMetric < 0 && header.some((cell) => /nutzer|users|active users|total users/.test(cell))) {
              lastGa4Import.warning = "Die GA4-Datei enthält Nutzer/Users, aber keine Aufrufe/Page Views. Für den Vergleich brauchst du Seitenaufrufe, nicht Nutzer.";
            }
          }
        }
        for (const line of lines.slice(start)) {
          let path = "", views = null;
          if (pathIndex >= 0 && metricIndex >= 0) {
            const cells = splitMetricLine(line);
            path = normalizePath(cells[pathIndex] || "");
            views = parseMetricNumber(cells[metricIndex] || "");
          } else {
          const tabOrSemicolon = line.search(/[\t;]/);
          if (tabOrSemicolon >= 0) {
            path = normalizePath(line.slice(0, tabOrSemicolon));
            views = parseMetricNumber(line.slice(tabOrSemicolon + 1));
          } else {
            const matches = [...line.matchAll(/,/g)];
            for (const match of matches) {
              const candidatePath = normalizePath(line.slice(0, match.index));
              const candidateViews = parseMetricNumber(line.slice(match.index + 1));
              if (candidatePath && candidateViews !== null) {
                path = candidatePath;
                views = candidateViews;
                break;
              }
            }
          }
          }
          if (!path || views === null) continue;
          values.set(path, views);
        }
        return values;
      }
      function topEntries(map, limit) {
        return Array.from(map.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([name, count]) => ({ name, count }));
      }
      function buildRows(pathCounts, chosen) {
        const ga4 = ga4UrlViews();
        let names;
        if (chosen.length) {
          names = [...chosen];
        } else {
          // Automatische Top-Liste: statische Dateien (Bilder, CSS, JS …) ausblenden,
          // damit echte Seiten sichtbar sind. Selbst eingetragene URLs bleiben unberührt.
          const isAsset = (p) => ASSET_RE.test(p);
          const pages = new Map();
          for (const [path, count] of pathCounts) {
            if (!isAsset(path)) pages.set(path, count);
          }
          names = topEntries(pages, 8).map((entry) => entry.name);
        }
        for (const url of ga4.keys()) {
          if (!names.includes(url)) names.push(url);
        }
        return names.map((name) => {
          const serverViews = pathCounts.get(name) || 0;
          const ga4Value = ga4.has(name) ? ga4.get(name) : null;
          return {
            name,
            serverViews,
            ga4Views: ga4Value,
            difference: ga4Value === null ? null : serverViews - ga4Value,
            coverage: ga4Value === null || serverViews === 0 ? null : (ga4Value / serverViews) * 100
          };
        });
      }
      function zeitraumText() {
        const from = id("date-from").value;
        const to = id("date-to").value;
        if (!from && !to) return "deiner Datei";
        return `${from || "Anfang"} bis ${to || "Ende"}`;
      }
      function formatDateTime(ms) {
        if (!ms) return "-";
        return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
      }
      function preflightLogSample(text, options = {}) {
        const sampleLines = options.sampleLines || 500;
        const reLine = /^(\S+)[ \t]+\S+[ \t]+\S+[ \t]+\[([^\]]+)\][ \t]+"([A-Z]+)[ \t]+([^"]*?)[ \t]+(HTTP\/[0-9.]+)"[ \t]+(\d{3})[ \t]+\S+[ \t]+"([^"]*)"[ \t]+"([^"]*)"(.*)$/;
        const hosts = new Map();
        let checked = 0, parsed = 0, first = null, xffUsed = 0;
        function norm(value) {
          try {
            const u = new URL(value, "http://x.invalid");
            let path = u.pathname.replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/i, "/");
            path = path === "/" ? "/" : path.replace(/\/$/, "");
            return { path, host: u.hostname === "x.invalid" ? "" : u.hostname };
          } catch {
            return { path: String(value || "/").split("?")[0].replace(/\/$/, "") || "/", host: "" };
          }
        }
        function firstXff(trailing) {
          const fields = [...String(trailing || "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);
          fields.push(String(trailing || ""));
          for (const field of fields) {
            for (const part of field.split(",")) {
              const tok = part.trim().replace(/^\[/, "").replace(/\](?::\d+)?$/, "").replace(/:\d+$/, "");
              if (/^(\d{1,3}\.){3}\d{1,3}$/.test(tok) || (/^[0-9a-fA-F:]+$/.test(tok) && tok.includes(":"))) return tok;
            }
          }
          return "";
        }
        for (const line of String(text || "").split(/\r?\n/).filter(Boolean).slice(0, sampleLines)) {
          checked++;
          const m = reLine.exec(line);
          if (!m) continue;
          parsed++;
          const target = norm(m[4]);
          const host = target.host;
          if (host) hosts.set(host, (hosts.get(host) || 0) + 1);
          const xff = options.useXff ? firstXff(m[9] || "") : "";
          if (xff) xffUsed++;
          if (!first) first = { ip: m[1], xff, method: m[3], path: target.path, host, status: Number(m[6]) };
        }
        const recognitionRate = checked ? parsed / checked : 0;
        const warnings = [];
        if (hosts.size > 1) warnings.push("Mehrere Hosts/Domains in der Stichprobe erkannt.");
        if (options.useXff && !xffUsed) warnings.push("X-Forwarded-For aktiviert, aber in der Stichprobe nicht plausibel gefunden.");
        return {
          formatKind: parsed ? "combined" : "unknown",
          recognitionRate,
          fields: first || {},
          hosts: { total: hosts.size, top: topEntries(hosts, 5) },
          quality: {
            pageviews: recognitionRate >= 0.95 ? "high" : recognitionRate >= 0.8 ? "medium" : "limited",
            visitors: options.useXff && xffUsed ? "high" : "medium"
          },
          warnings
        };
      }

      // ---- Parser/Aggregator: läuft entweder im Worker oder (Fallback) im Hauptthread ----
      // Vollständig in sich geschlossen, damit er per toString() in den Inline-Worker
      // serialisiert werden kann (keine externen Referenzen, keine DOM-Zugriffe).
      function makeAggregator(config) {
        const reLine = /^(\S+)[ \t]+\S+[ \t]+\S+[ \t]+\[([^\]]+)\][ \t]+"([A-Z]+)[ \t]+([^"]*?)[ \t]+(HTTP\/[0-9.]+)"[ \t]+(\d{3})[ \t]+\S+[ \t]+"([^"]*)"[ \t]+"([^"]*)"(.*)$/;
        const botRe = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|linkedinbot|twitterbot|preview|monitor|uptime|pingdom|headless|python-requests|curl|wget/i;
        const browserRe = /mozilla\/.*(chrome|safari|firefox|edg|opr|gecko|trident)/i;
        const assetRe = config.assetRe || /(?!)/;
        const adParams = ["gclid", "gbraid", "wbraid"];
        const okStatus = new Set([200, 201, 202, 204, 301, 302, 303, 307, 308]);
        const VISIT_MS = 30 * 60 * 1000;
        const SUCCESS_MS = 60 * 60 * 1000;
        const monthMap = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

        const successUrl = config.successUrl || "";
        const successPattern = config.successPattern || "";
        const orderParam = (config.orderParam || "").toLowerCase();
        const hasSuccessUrl = successUrl !== "" || successPattern !== "";
        const dateFrom = config.dateFrom || "";
        const dateTo = config.dateTo || "";
        const useXff = !!config.useXff;
        const strictBot = !!config.strictBot;
        const keptQueryParams = new Set((config.keptQueryParams || []).map((p) => String(p).toLowerCase()).filter(Boolean));
        const allowedHosts = new Set((config.hostFilter || []).map((h) => String(h).trim().toLowerCase()).filter(Boolean));
        const suspiciousHitThreshold = Math.max(10, Number(config.suspiciousHitThreshold) || 100);
        const suspiciousAssetShare = Math.max(0, Math.min(1, Number(config.suspiciousAssetShare) || 0.05));
        const maxTrackedClients = Math.max(1000, Number(config.maxTrackedClients) || 100000);

        function normPath(value) {
          const raw = String(value || "").trim();
          if (!raw) return "";
          let path;
          try { path = new URL(raw, "http://x.invalid").pathname; }
          catch { path = raw.startsWith("/") ? raw.split("?")[0] : "/" + raw.split("?")[0]; }
          try { path = decodeURI(path); } catch (_) {}
          path = path.replace(/\/{2,}/g, "/");
          path = path.replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/i, "/");
          return path === "/" ? "/" : path.replace(/\/$/, "");
        }
        function normTarget(target) {
          let path = normPath(target), hasAd = false, query = "", host = "";
          try {
            const u = new URL(target, "http://x.invalid");
            path = normPath(u.pathname);
            host = u.hostname === "x.invalid" ? "" : u.hostname.toLowerCase();
            query = u.search || "";
            for (const p of adParams) { if (u.searchParams.has(p)) { hasAd = true; break; } }
            if (keptQueryParams.size) {
              const kept = [];
              for (const [key, value] of u.searchParams) {
                if (keptQueryParams.has(key.toLowerCase())) kept.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
              }
              if (kept.length) path += "?" + kept.sort().join("&");
            }
          } catch {
            const parts = String(target || "").split("?");
            path = normPath(parts[0] || "/");
            query = parts[1] ? "?" + parts[1] : "";
            for (const p of adParams) { if (new RegExp("(^|[?&])" + p + "(=|&|$)", "i").test(query)) { hasAd = true; break; } }
          }
          return { path, hasAd, query, host };
        }
        function wildcardRe(pattern) {
          if (!pattern) return null;
          const normalized = normPath(pattern);
          const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
          return new RegExp("^" + escaped + "$");
        }
        const successPatternRe = wildcardRe(successPattern);
        function isSuccessPath(path) {
          if (successUrl && normPath(path) === successUrl) return true;
          return !!(successPatternRe && successPatternRe.test(normPath(path)));
        }
        function orderIdFromTarget(target) {
          if (!orderParam) return "";
          try {
            const u = new URL(target, "http://x.invalid");
            return u.searchParams.get(orderParam) || "";
          } catch {
            return "";
          }
        }
        function parseTime(raw) {
          const m = raw.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})[ \t]+([+-])(\d{2})(\d{2})$/);
          if (!m) return null;
          const mo = monthMap[m[2]];
          if (!mo) return null;
          const t = Date.parse(m[3] + "-" + mo + "-" + m[1] + "T" + m[4] + ":" + m[5] + ":" + m[6] + m[7] + m[8] + ":" + m[9]);
          if (Number.isNaN(t)) return null;
          return { date: m[3] + "-" + mo + "-" + m[1], timeMs: t };
        }
        function parseIsoTime(raw) {
          const t = Date.parse(String(raw || ""));
          if (Number.isNaN(t)) return null;
          return { date: new Date(t).toISOString().slice(0, 10), timeMs: t };
        }
        function isPrivate(ip) {
          if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^127\./.test(ip) || /^169\.254\./.test(ip)) return true;
          if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
          const l = ip.toLowerCase();
          return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
        }
        function normalizeIpToken(token) {
          let tok = String(token || "").trim();
          tok = tok.replace(/^for=/i, "").replace(/^"|"$/g, "").replace(/^\[/, "");
          const colons = (tok.match(/:/g) || []).length;
          if (colons === 1) tok = tok.replace(/:\d+$/, "");
          else if (colons > 1) tok = tok.replace(/\](?::\d+)?$/, "");
          const isV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(tok) && tok.split(".").every((part) => Number(part) <= 255);
          const isV6 = colons > 1 && /^[0-9a-fA-F:]+$/.test(tok);
          return isV4 || isV6 ? tok : "";
        }
        function parseIpList(value) {
          const ips = [];
          for (const part of String(value || "").split(",")) {
            const ip = normalizeIpToken(part);
            if (ip) ips.push(ip);
          }
          return ips;
        }
        function xffIps(trailing) {
          const fields = [...String(trailing || "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);
          fields.push(String(trailing || "").trim());
          let best = [];
          for (const field of fields) {
            const ips = parseIpList(field);
            if (ips.length > best.length) best = ips;
          }
          return best;
        }
        function clientIp(firstField, trailing) {
          if (!useXff) return { ip: firstField, xff: "off" };
          const ips = xffIps(trailing);
          if (!ips.length) return { ip: firstField, xff: "missing" };
          for (const ip of ips) if (!isPrivate(ip)) return { ip, xff: "used" };
          return { ip: ips[0], xff: "private" };
        }
        let iisFields = null, w3cKind = "iis";
        function parseIisLine(line) {
          const trimmed = line.trim();
          if (trimmed.startsWith("#Fields:")) {
            iisFields = trimmed.slice(8).trim().split(/\s+/);
            w3cKind = iisFields.some((field) => /^x-edge-|^x-host-header$|^time-taken$|^ssl-protocol$/i.test(field)) ? "cloudfront" : "iis";
            return { meta: true, kind: w3cKind };
          }
          if (trimmed[0] === "#") return { meta: true, kind: w3cKind };
          if (!iisFields) return null;
          const parts = trimmed.split(/\s+/);
          if (parts.length < iisFields.length) return null;
          const get = (name) => {
            const names = Array.isArray(name) ? name : [name];
            for (const n of names) {
              const idx = iisFields.indexOf(n);
              if (idx >= 0) return parts[idx];
            }
            return "";
          };
          const date = get("date"), time = get("time");
          const pt = parseIsoTime(date && time ? `${date}T${time}Z` : "");
          if (!pt) return null;
          return {
            kind: w3cKind,
            ip0: get("c-ip") || get("x-forwarded-for") || "-",
            pt,
            method: get("cs-method") || "GET",
            target: get("cs-uri-stem") + (get("cs-uri-query") && get("cs-uri-query") !== "-" ? "?" + get("cs-uri-query") : ""),
            host: get(["cs-host", "cs(Host)"]),
            status: Number(get("sc-status")),
            ua: decodeURIComponent((get(["cs(User-Agent)", "cs(User_Agent)"]) || "").replace(/\+/g, " ")),
            trailing: get("x-forwarded-for") || ""
          };
        }
        function pick(obj, names) {
          for (const name of names) if (obj[name] !== undefined && obj[name] !== null && obj[name] !== "") return obj[name];
          return "";
        }
        function parseJsonLine(line) {
          const trimmed = line.trim();
          if (trimmed[0] !== "{") return null;
          try {
            const obj = JSON.parse(trimmed);
            const pt = parseIsoTime(pick(obj, ["time", "timestamp", "@timestamp", "ts", "EdgeStartTimestamp", "ClientRequestStartTime", "StartTime", "start", "reqTimeSec", "reqTime", "requestTime", "datetime", "dateTime"]));
            if (!pt) return null;
            const request = pick(obj, ["ClientRequestURI", "request", "request_uri", "uri", "url", "path", "cs_uri_stem", "reqPath", "requestPath", "reqURL", "requestUrl", "urlPath"]) || "/";
            const host = pick(obj, ["ClientRequestHost", "http_host", "host", "server_name", "cs_host", "reqHost", "requestHost", "hostname"]);
            const kind = obj.ClientRequestURI || obj.EdgeResponseStatus ? "cloudflare"
              : obj.fastly_info_state || obj.fastly_is_edge || obj.fastly_server ? "fastly"
              : obj.cp || obj.reqHost || obj.statusCode || obj.edgeIP || obj.cacheStatus ? "akamai"
              : "json";
            return {
              kind,
              ip0: pick(obj, ["ClientIP", "ClientRequestIP", "remote_addr", "remoteAddress", "client_ip", "clientIp", "ip", "clientIP", "cliIP", "requestIP"]) || "-",
              pt,
              method: pick(obj, ["ClientRequestMethod", "method", "request_method", "cs_method", "reqMethod", "requestMethod", "req.method"]) || "GET",
              target: request,
              host,
              status: Number(pick(obj, ["EdgeResponseStatus", "status", "status_code", "response_status", "sc_status", "statusCode", "rspStatus", "responseStatus"])),
              ua: pick(obj, ["ClientRequestUserAgent", "user_agent", "http_user_agent", "ua", "cs_user_agent", "userAgent", "reqUserAgent", "requestUserAgent"]),
              trailing: pick(obj, ["ClientRequestHeaderXForwardedFor", "x_forwarded_for", "http_x_forwarded_for", "forwarded_for", "xff", "reqHeaderXForwardedFor"])
            };
          } catch (_) {
            return null;
          }
        }
        function parseCombinedLine(line) {
          const m = reLine.exec(line);
          if (!m) return null;
          const pt = parseTime(m[2]);
          if (!pt) return null;
          return { kind: "combined", ip0: m[1], pt, method: m[3], target: m[4], host: "", status: +m[6], ua: m[8], trailing: m[9] || "" };
        }
        function parseLogLine(line) {
          const combined = parseCombinedLine(line);
          if (combined) return combined;
          const json = parseJsonLine(line);
          if (json) return json;
          return parseIisLine(line);
        }

        const pathCounts = new Map(), statusCounts = new Map(), methodCounts = new Map(), hostCounts = new Map();
        const lastSeen = new Map(), lastSuccess = new Map(), adVisitors = new Set(), adSuccess = new Set(), orderSuccess = new Set();
        const keyHits = new Map(), keyAssets = new Map();
        const stats = {
          total: 0, parsed: 0, unrecognized: 0, kept: 0, pageViews: 0, filtered: 0,
          rBot: 0, rStatus: 0, rRange: 0, rMethod: 0, rEmptyUa: 0, rStrict: 0,
          visits: 0, successRaw: 0, success: 0, timeRegressions: 0,
          xffUsed: 0, xffMissing: 0, xffPrivate: 0, suspiciousClients: 0, rHost: 0,
          meta: 0
        };
        const format = { checked: 0, combined: 0, json: 0, iis: 0, cloudflare: 0, cloudfront: 0, fastly: 0, akamai: 0 };
        let prevTime = -Infinity, maxTime = -Infinity, minTime = Infinity, maxGapMs = 0, seen = 0;
        // Proxy-/CDN-Erkennung (nur relevant, wenn X-Forwarded-For NICHT genutzt wird): Sitzt die
        // Seite hinter einem Reverse-Proxy/Loadbalancer/CDN, steht in Spalte 1 immer dieselbe
        // (oft private) IP. Dann kollabieren alle Besucher auf einen Schlüssel und die
        // Besucherzahl wird unbrauchbar. Wir messen die Konzentration der Spalte-1-IP über die
        // behaltenen Zeilen, um davor zu warnen. Map wird gedeckelt, damit sie nicht unbegrenzt wächst.
        const clientIpHits = new Map();
        let privateClientHits = 0, clientIpCapped = false, trackingCapped = false;

        function prune() {
          if (maxTime === -Infinity) return;
          const visitCut = maxTime - VISIT_MS, successCut = maxTime - SUCCESS_MS;
          for (const [k, t] of lastSeen) if (t < visitCut) lastSeen.delete(k);
          for (const [k, t] of lastSuccess) if (t < successCut) lastSuccess.delete(k);
        }

        function processLine(line) {
          if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
          if (!line || !line.trim()) return;
          stats.total++;
          if (format.checked < 100) {
            const trimmed = line.trim();
            format.checked++;
            if (reLine.test(line)) format.combined++;
            else if (trimmed[0] === "{" && /"(ClientRequest|EdgeResponse|time|timestamp|request|method|uri|status)"/i.test(trimmed)) {
              if (/"(ClientRequest|EdgeResponse)/.test(trimmed)) format.cloudflare++;
              else if (/"fastly_/.test(trimmed)) format.fastly++;
              else if (/"(reqHost|statusCode|cp)"/.test(trimmed)) format.akamai++;
              else format.json++;
            }
            else if (trimmed.startsWith("#Software: Microsoft") || trimmed.startsWith("#Fields:") || /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/.test(trimmed)) {
              if (trimmed.includes("x-edge-") || trimmed.includes("cs(Host)")) format.cloudfront++;
              else if (w3cKind === "cloudfront") format.cloudfront++;
              else format.iis++;
            }
          }
          const rec = parseLogLine(line);
          if (rec && rec.meta) { stats.meta++; return; }
          if (!rec) { stats.unrecognized++; return; }
          const ip0 = rec.ip0, method = String(rec.method || "").toUpperCase(), target = rec.target || "/", status = Number(rec.status), ua = rec.ua || "", trailing = rec.trailing || "", pt = rec.pt;
          if (!pt || Number.isNaN(status)) { stats.unrecognized++; return; }
          stats.parsed++;
          if (rec.kind === "cloudflare") format.cloudflare++;
          else if (rec.kind === "cloudfront") format.cloudfront++;
          else if (rec.kind === "fastly") format.fastly++;
          else if (rec.kind === "akamai") format.akamai++;
          else if (rec.kind === "json") format.json++;
          else if (rec.kind === "iis") format.iis++;
          else if (rec.kind === "combined") format.combined++;
          if (pt.timeMs < prevTime) stats.timeRegressions++;
          else if (prevTime !== -Infinity && pt.timeMs - prevTime > maxGapMs) maxGapMs = pt.timeMs - prevTime;
          prevTime = pt.timeMs;
          if (pt.timeMs < minTime) minTime = pt.timeMs;
          if (pt.timeMs > maxTime) maxTime = pt.timeMs;

          const normalized = normTarget(target);
          const host = String(rec.host || normalized.host || "").toLowerCase();
          if (allowedHosts.size && host && !allowedHosts.has(host)) { stats.filtered++; stats.rHost++; return; }
          if (host) hostCounts.set(host, (hostCounts.get(host) || 0) + 1);

          if ((dateFrom && pt.date < dateFrom) || (dateTo && pt.date > dateTo)) { stats.filtered++; stats.rRange++; return; }
          if (!okStatus.has(status)) { stats.filtered++; stats.rStatus++; return; }
          if (method !== "GET" && method !== "POST") { stats.filtered++; stats.rMethod++; return; }
          const uaTrim = ua.trim();
          if (uaTrim === "" || uaTrim === "-" || uaTrim.length < 8) { stats.filtered++; stats.rEmptyUa++; return; }
          if (botRe.test(ua)) { stats.filtered++; stats.rBot++; return; }
          if (strictBot && !browserRe.test(ua)) { stats.filtered++; stats.rStrict++; return; }

          stats.kept++;
          if (!useXff) {
            if (isPrivate(ip0)) privateClientHits++;
            if (!clientIpCapped) {
              clientIpHits.set(ip0, (clientIpHits.get(ip0) || 0) + 1);
              // > 50k verschiedene Quell-IPs ⇒ sicher kein einzelner Proxy: Tracking stoppen.
              if (clientIpHits.size > 50000) { clientIpHits.clear(); clientIpCapped = true; }
            }
          }
          const path = normalized.path;
          const hasAd = normalized.hasAd;
          // Seitenaufruf = echter Seitenabruf, den der Besucher auch sieht: nur GET mit 2xx.
          // Weiterleitungen (3xx) und Formular-POSTs erzeugen Logzeilen, sind aber keine
          // angesehene Seite — Google Analytics zählt sie ebenfalls nicht als Pageview. Sie aus
          // pathCounts/pageViews herauszuhalten verhindert eine künstliche "Server > GA"-Lücke.
          // (Für Besuche/Conversions zählen sie weiter mit — ein Mensch war ja da.)
          const isPageHit = method === "GET" && status >= 200 && status < 300;
          if (isPageHit) {
            pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
            if (!assetRe.test(path)) stats.pageViews++;
          }
          statusCounts.set(String(status), (statusCounts.get(String(status)) || 0) + 1);
          methodCounts.set(method, (methodCounts.get(method) || 0) + 1);

          const resolvedClient = clientIp(ip0, trailing);
          if (resolvedClient.xff === "used") stats.xffUsed++;
          else if (resolvedClient.xff === "missing") stats.xffMissing++;
          else if (resolvedClient.xff === "private") stats.xffPrivate++;
          const key = resolvedClient.ip + "|" + ua;
          const knownSessionKey = lastSeen.has(key);
          const canTrackNewKey = knownSessionKey || lastSeen.size < maxTrackedClients;
          if (!canTrackNewKey) trackingCapped = true;
          if (!trackingCapped || keyHits.has(key)) {
            keyHits.set(key, (keyHits.get(key) || 0) + 1);
            if (assetRe.test(path)) keyAssets.set(key, (keyAssets.get(key) || 0) + 1);
            if (keyHits.size > maxTrackedClients) trackingCapped = true;
          }
          const ps = knownSessionKey ? lastSeen.get(key) : undefined;
          if (ps === undefined || pt.timeMs - ps > VISIT_MS) stats.visits++;
          if (canTrackNewKey) lastSeen.set(key, pt.timeMs);
          if (hasAd && (canTrackNewKey || adVisitors.has(key))) adVisitors.add(key);

          if (hasSuccessUrl && isSuccessPath(path)) {
            stats.successRaw++;
            const orderId = orderIdFromTarget(target);
            const orderKey = orderId ? orderParam + ":" + orderId : "";
            const canTrackSuccess = canTrackNewKey || lastSuccess.has(key);
            const pl = canTrackSuccess ? lastSuccess.get(key) : undefined;
            if (orderKey && orderSuccess.has(orderKey)) {
              // same order id already counted
            } else if (orderKey || pl === undefined || pt.timeMs - pl > SUCCESS_MS) {
              if (orderKey && (orderSuccess.size < maxTrackedClients || orderSuccess.has(orderKey))) orderSuccess.add(orderKey);
              if (canTrackSuccess) lastSuccess.set(key, pt.timeMs);
              stats.success++;
              if (adVisitors.has(key)) adSuccess.add(key);
            }
          }

          if ((++seen % 250000) === 0) prune();
        }

        function finalize() {
          let topClientHits = 0;
          if (!clientIpCapped) for (const c of clientIpHits.values()) if (c > topClientHits) topClientHits = c;
          for (const [key, hits] of keyHits) {
            const assets = keyAssets.get(key) || 0;
            if (hits >= suspiciousHitThreshold && assets / hits < suspiciousAssetShare) stats.suspiciousClients++;
          }
          let formatKind = "unknown";
          const formatScores = [
            ["cloudflare", format.cloudflare],
            ["cloudfront", format.cloudfront],
            ["fastly", format.fastly],
            ["akamai", format.akamai],
            ["combined", format.combined],
            ["json", format.json],
            ["iis", format.iis]
          ].sort((a, b) => b[1] - a[1]);
          if (formatScores[0][1] > 0) formatKind = formatScores[0][0];
          const dataRows = Math.max(0, stats.total - stats.meta);
          return {
            total: stats.total, dataRows, parsed: stats.parsed, unrecognized: stats.unrecognized, meta: stats.meta,
            kept: stats.kept, pageViews: stats.pageViews, filtered: stats.filtered,
            reasons: { bot: stats.rBot, status: stats.rStatus, range: stats.rRange, method: stats.rMethod, emptyUa: stats.rEmptyUa, strict: stats.rStrict, host: stats.rHost },
            visits: stats.visits, successRaw: stats.successRaw, success: stats.success,
            adVisitors: adVisitors.size, adSuccess: adSuccess.size,
            formatKind, formatChecked: format.checked, formatCombined: format.combined,
            xffUsed: stats.xffUsed, xffMissing: stats.xffMissing, xffPrivate: stats.xffPrivate,
            suspiciousClients: stats.suspiciousClients,
            trackingCapped,
            timeRegressions: stats.timeRegressions,
            minTime: minTime === Infinity ? null : minTime,
            maxTime: maxTime === -Infinity ? null : maxTime,
            maxGapMs,
            privateClientHits, topClientHits, distinctClientIps: clientIpCapped ? -1 : clientIpHits.size,
            pathCounts, statusCounts, methodCounts, hostCounts
          };
        }

        return { processLine, finalize };
      }

      // Worker-Quelle: makeAggregator wird per toString() eingebettet, damit alles inline
      // bleibt (keine externen Skripte, läuft auch unter file://).
      const WORKER_SRC = `
        self.onmessage = async function (e) {
          var cfg = e.data.config, blob = e.data.blob;
          ${makeAggregator.toString()}
          try {
            var agg = makeAggregator(cfg);
            if (!blob.stream) {
              if (cfg.gzip) throw new Error("Dieser Browser kann komprimierte .gz-Dateien nicht direkt lesen. Bitte Datei entpacken und erneut auswählen.");
              var text = await blob.text();
              var all = text.split("\\n");
              for (var k = 0; k < all.length; k++) agg.processLine(all[k]);
              self.postMessage({ type: "done", result: agg.finalize() });
              return;
            }
            var inputStream = blob.stream();
            if (cfg.gzip) {
              if (typeof DecompressionStream === "undefined") throw new Error("Dieser Browser kann .gz-Dateien nicht direkt lesen. Bitte Datei entpacken und erneut auswählen.");
              inputStream = inputStream.pipeThrough(new DecompressionStream("gzip"));
            }
            var reader = inputStream.pipeThrough(new TextDecoderStream()).getReader();
            var buf = "", processed = 0, lastPost = 0;
            for (;;) {
              var r = await reader.read();
              if (r.done) break;
              processed += r.value.length;
              buf += r.value;
              var parts = buf.split("\\n");
              buf = parts.pop();
              for (var j = 0; j < parts.length; j++) agg.processLine(parts[j]);
              if (processed - lastPost > 500000) { lastPost = processed; self.postMessage({ type: "progress", processed: processed }); }
            }
            if (buf.length) agg.processLine(buf);
            self.postMessage({ type: "done", result: agg.finalize() });
          } catch (err) {
            self.postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
          }
        };
      `;

      function processViaWorker(blob, config, onProgress) {
        return new Promise((resolve, reject) => {
          let worker, url, settled = false, gotFirst = false, watchdog;
          try {
            url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "application/javascript" }));
            worker = new Worker(url);
          } catch (e) { reject(e); return; }
          const cleanup = () => { clearTimeout(watchdog); try { worker.terminate(); } catch (_) {} try { URL.revokeObjectURL(url); } catch (_) {} };
          const ok = (res) => { if (settled) return; settled = true; cleanup(); resolve(res); };
          const fail = (err) => { if (settled) return; settled = true; cleanup(); reject(err); };
          worker.onmessage = (e) => {
            gotFirst = true;
            clearTimeout(watchdog);
            const msg = e.data;
            if (msg.type === "progress") onProgress(msg.processed);
            else if (msg.type === "done") ok(msg.result);
            else if (msg.type === "error") fail(new Error(msg.message));
          };
          worker.onerror = (e) => fail(new Error((e && e.message) || "Worker nicht verfügbar"));
          // Manche Umgebungen (z. B. Chrome unter file://) starten Blob-Worker nicht und
          // melden keinen Fehler. Reagiert der Worker nicht, fällt processFile auf den
          // Hauptthread zurück.
          watchdog = setTimeout(() => { if (!gotFirst) fail(new Error("Worker reagiert nicht – Fallback auf Hauptthread")); }, 2500);
          worker.postMessage({ blob, config });
        });
      }

      async function processOnMainThread(blob, config, onProgress) {
        const agg = makeAggregator(config);
        if (!blob.stream) {
          if (config.gzip) throw new Error("Dieser Browser kann komprimierte .gz-Dateien nicht direkt lesen. Bitte Datei entpacken und erneut auswählen.");
          const text = await blob.text();
          const all = text.split("\n");
          for (let i = 0; i < all.length; i++) {
            agg.processLine(all[i]);
            if ((i & 32767) === 0) await new Promise((r) => setTimeout(r));
          }
          return agg.finalize();
        }
        let inputStream = blob.stream();
        if (config.gzip) {
          if (typeof DecompressionStream === "undefined") throw new Error("Dieser Browser kann .gz-Dateien nicht direkt lesen. Bitte Datei entpacken und erneut auswählen.");
          inputStream = inputStream.pipeThrough(new DecompressionStream("gzip"));
        }
        const reader = inputStream.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "", processed = 0, lastPost = 0, sinceYield = 0;
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          processed += r.value.length;
          buf += r.value;
          const parts = buf.split("\n");
          buf = parts.pop();
          for (let i = 0; i < parts.length; i++) {
            agg.processLine(parts[i]);
            if (++sinceYield >= 25000) { sinceYield = 0; onProgress(processed); await new Promise((r2) => setTimeout(r2)); }
          }
          if (processed - lastPost > 500000) { lastPost = processed; onProgress(processed); }
        }
        if (buf.length) agg.processLine(buf);
        return agg.finalize();
      }

      async function processFile(blob, config, onProgress) {
        // Worker nur über http(s): unter file:// starten viele Browser (z. B. Chrome) keine
        // Blob-Worker. Dort läuft das Streaming direkt im Hauptthread (mit Yield, bleibt
        // responsiv). Auf der gehosteten Version übernimmt der Worker.
        if (location.protocol === "http:" || location.protocol === "https:") {
          try { return await processViaWorker(blob, config, onProgress); }
          catch (e) { /* Fallback unten */ }
        }
        return await processOnMainThread(blob, config, onProgress);
      }

      function readConfig() {
        const raw = id("success-url").value.trim();
        return {
          successUrl: raw ? normalizePath(raw) : "",
          successPattern: id("success-pattern").value.trim(),
          orderParam: id("order-param").value.trim(),
          hasSuccessUrl: raw !== "" || id("success-pattern").value.trim() !== "",
          dateFrom: id("date-from").value,
          dateTo: id("date-to").value,
          useXff: id("use-xff").checked,
          strictBot: id("strict-bot").checked,
          keptQueryParams: id("keep-query").value.split(/\s*,\s*/),
          hostFilter: id("host-filter").value.split(/\s*,\s*/),
          suspiciousHitThreshold: number("bot-hit-threshold") || 100,
          suspiciousAssetShare: (number("bot-asset-share") === null ? 5 : number("bot-asset-share")) / 100,
          maxTrackedClients: number("tracking-cap") || 100000,
          gzip: false,
          assetRe: ASSET_RE
        };
      }

      function buildResult(agg, config) {
        const chosen = compareUrls();
        const tableRows = buildRows(agg.pathCounts, chosen);
        const hosts = { total: agg.hostCounts ? agg.hostCounts.size : 0, top: agg.hostCounts ? topEntries(agg.hostCounts, 5) : [] };
        const ga4Rows = tableRows.filter((row) => row.ga4Views !== null && row.ga4Views !== undefined);
        const totalServer = ga4Rows.reduce((sum, row) => sum + row.serverViews, 0);
        const totalGa4 = ga4Rows.reduce((sum, row) => sum + row.ga4Views, 0);
        const overall = ga4Rows.length
          ? {
              totalServer,
              totalGa4,
              difference: totalServer - totalGa4,
              coverage: totalServer > 0 ? (totalGa4 / totalServer) * 100 : null,
              worst: ga4Rows.filter((row) => row.coverage !== null && row.serverViews > 0).sort((a, b) => a.coverage - b.coverage)[0] || null
            }
          : null;
        const ga4Conversions = number("ga4-conversions");
        const convDiff = ga4Conversions === null ? null : agg.success - ga4Conversions;
        const serverCr = agg.visits ? (agg.success / agg.visits) * 100 : 0;
        // IP-Konzentration prüfen (nur wenn X-Forwarded-For aus ist). Zwei Fälle bewusst getrennt,
        // um Fehlalarme zu vermeiden:
        //  - "private": viele Zugriffe von privaten IPs in Spalte 1 ⇒ nahezu sicher ein Reverse-Proxy
        //    auf demselben Host. Klares Signal, klare Empfehlung (X-Forwarded-For).
        //  - "concentrated": eine einzige öffentliche IP dominiert ⇒ mehrdeutig. Kann ein CDN/Proxy
        //    sein, aber genauso ein einzelner intensiver Nutzer (Owner beim Testen) oder ein Scraper.
        //    Deshalb vorsichtiger formulierter Hinweis statt definitiver Proxy-Aussage.
        const privateShare = agg.kept ? agg.privateClientHits / agg.kept : 0;
        const topClientShare = agg.kept ? agg.topClientHits / agg.kept : 0;
        let proxyKind = "";
        if (!config.useXff && agg.kept >= 100) {
          if (privateShare >= 0.3) proxyKind = "private";
          else if (topClientShare >= 0.5) proxyKind = "concentrated";
        }
        const analyzableRows = Math.max(0, agg.total - (agg.meta || 0));
        const recognitionRate = analyzableRows ? agg.parsed / analyzableRows : 0;
        const chronologyIssue = agg.timeRegressions >= 5 && agg.parsed && agg.timeRegressions / agg.parsed >= 0.01;
        const cacheRisk = proxyKind ? "elevated" : "normal";
        const hostReliability = hosts.total > 1 && !(config.hostFilter && config.hostFilter.filter(Boolean).length) ? "limited" : "high";
        const visitorReliability = config.useXff
          ? (agg.xffUsed > 0 && agg.xffMissing === 0 ? "high" : "limited")
          : (proxyKind ? "limited" : (chronologyIssue ? "medium" : "high"));
        const structuredKinds = new Set(["cloudflare", "cloudfront", "fastly", "akamai", "iis"]);
        const pageviewReliability = recognitionRate >= 0.95 && (agg.formatKind === "combined" || structuredKinds.has(agg.formatKind)) ? "high" : recognitionRate >= 0.8 ? "medium" : "limited";
        const ga4Reliability = lastGa4Import.warning ? "limited" : (ga4Rows.length && pageviewReliability !== "limited" ? "medium" : "limited");
        const conversionReliability = config.hasSuccessUrl
          ? (config.orderParam ? "high" : (agg.successRaw > agg.success * 1.25 ? "medium" : "high"))
          : "none";
        let visitorLow = agg.visits, visitorHigh = agg.visits;
        if (visitorReliability === "limited") {
          visitorLow = Math.max(1, Math.round(agg.visits * 0.55));
          visitorHigh = Math.max(visitorLow, Math.round(agg.visits * 1.45));
        } else if (visitorReliability === "medium") {
          visitorLow = Math.max(1, Math.round(agg.visits * 0.8));
          visitorHigh = Math.max(visitorLow, Math.round(agg.visits * 1.2));
        }
        const botReliability = agg.suspiciousClients > 0 ? "medium" : "high";
        return {
          total: agg.total, dataRows: agg.dataRows, parsed: agg.parsed, unrecognized: agg.unrecognized, meta: agg.meta || 0,
          kept: agg.kept, pageViews: agg.pageViews, filtered: agg.filtered, reasons: agg.reasons,
          visits: agg.visits, success: agg.success, successRaw: agg.successRaw,
          adVisitors: agg.adVisitors, adSuccess: agg.adSuccess, timeRegressions: agg.timeRegressions,
          formatKind: agg.formatKind, formatChecked: agg.formatChecked, formatCombined: agg.formatCombined,
          xffUsed: agg.xffUsed, xffMissing: agg.xffMissing, xffPrivate: agg.xffPrivate,
          suspiciousClients: agg.suspiciousClients,
          trackingCapped: agg.trackingCapped,
          minTime: agg.minTime, maxTime: agg.maxTime, maxGapMs: agg.maxGapMs,
          visitorRange: { low: visitorLow, high: visitorHigh },
          hosts,
          ga4Import: lastGa4Import,
          diagnostics: { recognitionRate, pageviewReliability, visitorReliability, ga4Reliability, conversionReliability, cacheRisk, chronologyIssue, botReliability, hostReliability, trackingReliability: agg.trackingCapped ? "medium" : "high" },
          hasSuccessUrl: config.hasSuccessUrl, ga4Conversions, convDiff, serverCr,
          proxyKind, hasChosen: chosen.length > 0, tableRows, overall, pathCounts: agg.pathCounts,
          statusCounts: topEntries(agg.statusCounts, 12), methodCounts: topEntries(agg.methodCounts, 6),
          unrecognizedPct: agg.total ? (agg.unrecognized / agg.total) * 100 : 0
        };
      }

      function setSignal(state, icon, label) {
        const signal = id("signal");
        signal.className = "signal" + (state ? ` ${state}` : "");
        signal.textContent = icon;
        id("signal-label").textContent = label;
      }
      function showHint(elId, text) {
        const el = id(elId);
        if (text) { el.textContent = text; el.classList.remove("hidden"); }
        else { el.textContent = ""; el.classList.add("hidden"); }
      }
      function setQuality(elId, state) {
        const labels = { high: "Belastbarkeit hoch", medium: "Belastbarkeit mittel", limited: "Belastbarkeit niedrig", none: "Nicht bewertet" };
        const el = id(elId);
        el.className = `quality-badge ${state || "none"}`;
        el.textContent = labels[state] || labels.none;
      }
      function setQualityReason(elId, text) {
        const el = id(elId + "-reason");
        if (!el) return;
        el.textContent = text || "";
      }
      function qualityReason(data, metric, hasGa4) {
        if (metric === "views") {
          const recognized = percent(data.diagnostics.recognitionRate * 100);
          if (data.diagnostics.pageviewReliability === "high") return `${recognized} der Datenzeilen erkannt; Format ${data.formatKind}.`;
          if (data.diagnostics.pageviewReliability === "medium") return `${recognized} erkannt; einzelne Zeilen/Formate pruefen.`;
          return `${recognized} erkannt; Befund nur eingeschraenkt belastbar.`;
        }
        if (metric === "visits") {
          if (data.diagnostics.visitorReliability === "high") return data.xffUsed ? `${format(data.xffUsed)} XFF-IP(s) genutzt.` : "Keine starke Proxy-Verzerrung erkannt.";
          if (data.proxyKind) return "Proxy-/CDN-Muster erkannt; Besucherzahl als Bandbreite lesen.";
          if (data.xffMissing || data.xffPrivate) return "XFF liefert keine voll belastbare Besucher-IP.";
          return "Log-Reihenfolge oder Besucher-Schluessel begrenzen die Genauigkeit.";
        }
        if (metric === "purchases") {
          if (!data.hasSuccessUrl) return "Keine Danke-Seite oder kein Conversion-Muster gesetzt.";
          if (data.diagnostics.conversionReliability === "high") return data.ga4Conversions === null ? "Danke-Seite erkannt; Reloads werden dedupliziert." : "Danke-Seite erkannt; GA4-Kaufvergleich aktiv.";
          return "Danke-Seite erkannt; ohne Order-ID koennen Reloads/Mehrfachaufrufe stoeren.";
        }
        if (metric === "ga4") {
          if (!hasGa4) return "Keine GA4-Seitenaufrufe eingetragen.";
          if (data.ga4Import && data.ga4Import.warning) return data.ga4Import.warning;
          if (data.diagnostics.ga4Reliability === "medium") return "GA4-Werte mit Server-Seiten abgeglichen; Zeitraum/Seiten muessen identisch sein.";
          return "GA4-Vergleich eingeschraenkt; Eingabe oder Server-Erkennung pruefen.";
        }
        return "";
      }
      function setPrecisionChecklist(data, hasGa4) {
        const item = (ok, text) => `<li class="${ok ? "ok" : "check"}"><span class="state">${ok ? "OK" : "Prüfen"}</span><span>${escapeHtml(text)}</span></li>`;
        const rows = [];
        rows.push(item(!!(data.minTime && data.maxTime), data.minTime && data.maxTime
          ? `Zeitraum erkannt: ${formatDateTime(data.minTime)} bis ${formatDateTime(data.maxTime)}.`
          : "Zeitraum konnte nicht sicher aus den Logs gelesen werden."));
        rows.push(item(data.diagnostics.hostReliability !== "limited", data.diagnostics.hostReliability !== "limited"
          ? "Host-Scope wirkt eindeutig."
          : `Mehrere Hosts/Domains erkannt (${format(data.hosts.total)}). Hostfilter setzen, wenn nur eine Domain verglichen werden soll.`));
        rows.push(item(data.diagnostics.pageviewReliability !== "limited", `Logformat ${data.formatKind}, ${percent(data.diagnostics.recognitionRate * 100)} der Datenzeilen erkannt.`));
        rows.push(item(!hasGa4 || !(data.ga4Import && data.ga4Import.warning), hasGa4
          ? ((data.ga4Import && data.ga4Import.warning) || "GA4-Seitenaufrufe erkannt; Zeitraum und Seitenauswahl muessen identisch sein.")
          : "Kein GA4-Seitenvergleich eingetragen."));
        rows.push(item(data.diagnostics.visitorReliability !== "limited", data.diagnostics.visitorReliability !== "limited"
          ? "XFF/Proxy-Signale begrenzen die Besucherzahl nicht stark."
          : "XFF/Proxy/CDN kann die Besucherzahl verzerren; Seitenaufrufe staerker gewichten."));
        rows.push(item(!data.hasSuccessUrl || data.diagnostics.conversionReliability !== "medium", data.hasSuccessUrl
          ? qualityReason(data, "purchases", hasGa4)
          : "Keine Conversion-Definition gesetzt."));
        id("precision-checklist").innerHTML = rows.join("");
      }
      function render(data) {
        analyzed = true;
        lastResult = data;
        id("result-panel").classList.remove("hidden");
        id("results-body").classList.remove("hidden");
        id("demo-badge").classList.toggle("visible", sampleMode);

        const hasGa4 = !!(data.overall && data.overall.coverage !== null);
        const hasConv = data.hasSuccessUrl && data.ga4Conversions !== null;

        document.querySelectorAll(".ga4-only").forEach((el) => el.classList.toggle("hidden", !hasGa4));
        document.querySelectorAll(".purchase-only").forEach((el) => el.classList.toggle("hidden", !data.hasSuccessUrl));
        id("compare-block").classList.toggle("no-ga4", !hasGa4);
        id("purchase-box").classList.toggle("hidden", !hasConv);

        // Server-Zahlen
        id("n-visits").textContent = data.visitorRange && data.visitorRange.low !== data.visitorRange.high
          ? `${format(data.visitorRange.low)}–${format(data.visitorRange.high)}`
          : format(data.visits);
        id("n-views").textContent = format(data.pageViews);
        id("n-purchases").textContent = data.hasSuccessUrl ? format(data.success) : "-";
        id("n-coverage").textContent = hasGa4 ? percent(data.overall.coverage) : "-";
        setQuality("q-visits", data.diagnostics.visitorReliability);
        setQuality("q-views", data.diagnostics.pageviewReliability);
        setQuality("q-purchases", data.hasSuccessUrl ? data.diagnostics.conversionReliability : "none");
        setQuality("q-ga4", hasGa4 ? data.diagnostics.ga4Reliability : "none");
        setQualityReason("q-visits", qualityReason(data, "visits", hasGa4));
        setQualityReason("q-views", qualityReason(data, "views", hasGa4));
        setQualityReason("q-purchases", qualityReason(data, "purchases", hasGa4));
        setQualityReason("q-ga4", qualityReason(data, "ga4", hasGa4));
        setPrecisionChecklist(data, hasGa4);

        // Kauf-Check (signierte Differenz)
        id("pc-server").textContent = data.hasSuccessUrl ? format(data.success) : "-";
        id("pc-ga4").textContent = format(data.ga4Conversions);
        id("pc-gap").textContent = signed(data.convDiff);
        id("purchase-note").textContent = hasConv ? convNote(data.convDiff) : "";

        // Seiten-Tabelle
        id("table-title").textContent = data.hasChosen ? "Deine ausgewählten Seiten" : "Deine meistbesuchten Seiten";
        id("table-caption").textContent = hasGa4
          ? "Webserver gegen Google Analytics. „Abdeckung“ = wie viel Prozent Google Analytics von den Webserver-Aufrufen sieht."
          : "So oft hat dein Webserver diese Seiten gesehen. Trag oben optional Google-Analytics-Zahlen ein, um zu vergleichen.";
        id("compare-note").textContent = hasGa4 ? diffNote(data.overall.difference) : "";
        renderPageTable(data.tableRows);

        // Hinweise
        showHint("proxy-hint",
          data.proxyKind === "private"
            ? "Fast alle Zugriffe stammen von internen/privaten IP-Adressen. Das ist das typische Muster, wenn ein Reverse-Proxy oder Loadbalancer vor deiner Seite sitzt — dann steht die echte Besucher-IP nicht in der ersten Spalte deiner Logzeilen. Die Seitenaufrufe stimmen, aber die Besucherzahl ist so nicht belastbar. Aktiviere oben unter den erweiterten Filtern „X-Forwarded-For“ und werte erneut aus."
          : data.proxyKind === "concentrated"
            ? "Mehr als die Hälfte der Zugriffe kommt von einer einzigen IP-Adresse. Das kann ein Reverse-Proxy oder CDN (z. B. Cloudflare) vor deiner Seite sein — dann steht die echte Besucher-IP nicht in der ersten Spalte; aktiviere in diesem Fall unter den erweiterten Filtern „X-Forwarded-For“. Es kann aber auch ein einzelner sehr aktiver Zugriff sein (z. B. du selbst beim Testen oder ein Scraper). Die Seitenaufrufe stimmen in beiden Fällen — die Besucherzahl solltest du hier mit Vorsicht lesen."
          : "");
        let recognitionText = "";
        if (["cloudflare", "cloudfront", "fastly", "akamai"].includes(data.formatKind)) {
          const names = { cloudflare: "Cloudflare", cloudfront: "CloudFront", fastly: "Fastly", akamai: "Akamai-nahe" };
          recognitionText = `${names[data.formatKind]} Edge-Logs erkannt und ausgewertet. Das ist fuer gecachte Aufrufe robuster als reine Origin-Logs, sofern der Export denselben Zeitraum abdeckt.`;
        } else if (data.formatKind === "json") {
          recognitionText = "JSON-Logs erkannt und ausgewertet. Prüfe bei eigenen JSON-Logformaten kurz die technischen Details, weil Feldnamen je nach Server variieren können.";
        } else if (data.formatKind === "iis") {
          recognitionText = "IIS/W3C-Logs erkannt und ausgewertet. Die Zeitangaben werden als UTC gelesen, wie es bei W3C-Logs üblich ist.";
        } else if (data.formatKind === "unknown" && data.total) {
          recognitionText = "Das Logformat wurde nicht sicher erkannt. ServerStory erwartet Apache/Nginx Combined Log.";
        } else if (data.unrecognizedPct >= 10) {
          recognitionText = `${percent(data.unrecognizedPct)} der Zeilen wurden nicht als Apache/Nginx Combined Log erkannt. Prüfe, ob die Datei gemischte oder abweichende Logzeilen enthält.`;
        }
        if (data.diagnostics.pageviewReliability === "high") {
          recognitionText += (recognitionText ? " " : "") + "Die Seitenaufrufe wirken nach Format- und Erkennungsprüfung sehr belastbar.";
        } else if (data.diagnostics.pageviewReliability === "medium") {
          recognitionText += (recognitionText ? " " : "") + "Die Seitenaufrufe sind nutzbar, aber wegen Format-/Erkennungsquote mit etwas Vorsicht zu lesen.";
        } else if (data.total) {
          recognitionText += (recognitionText ? " " : "") + "Die Seitenaufrufe sind nur eingeschränkt belastbar, weil zu viele Zeilen nicht sicher gelesen wurden.";
        }
        if (data.xffMissing > 0 && data.xffUsed === 0) {
          recognitionText += (recognitionText ? " " : "") + "X-Forwarded-For ist aktiviert, aber ServerStory hat in den Zusatzfeldern keine plausible IP-Liste gefunden. Die Besucherzahl nutzt deshalb weiterhin die erste IP-Spalte.";
        } else if (data.xffPrivate > 0 && data.xffUsed === 0) {
          recognitionText += (recognitionText ? " " : "") + "X-Forwarded-For ist aktiviert, enthält aber nur private/interne IPs. Die Besucherzahl kann dadurch weiterhin proxy-verzerrt sein.";
        } else if (data.diagnostics.visitorReliability === "limited") {
          recognitionText += (recognitionText ? " " : "") + "Die Besucherzahl ist eingeschränkt belastbar; Seitenaufrufe sind hier die robustere Kennzahl.";
        }
        if (data.suspiciousClients > 0) {
          recognitionText += (recognitionText ? " " : "") + `${format(data.suspiciousClients)} Besucher-Schlüssel zeigen sehr viele Aufrufe fast ohne Asset-Abrufe. Das kann getarnter Bot- oder Monitoring-Traffic sein.`;
        }
        if (data.diagnostics.hostReliability === "limited") {
          recognitionText += (recognitionText ? " " : "") + `Die Logdatei enthält mehrere Hosts/Domains (${format(data.hosts.total)} erkannt). Setze bei Bedarf oben einen Hostfilter, damit GA4- und Server-Zahlen dieselbe Domain meinen.`;
        }
        if (data.trackingCapped) {
          recognitionText += (recognitionText ? " " : "") + "Das Tracking-Speicherlimit wurde erreicht. Hauptzählungen bleiben nutzbar, aber Bot-/Anomalie-Erkennung und Besucher-Bandbreite können gröber werden.";
        }
        if (data.ga4Import && data.ga4Import.warning) {
          recognitionText += (recognitionText ? " " : "") + data.ga4Import.warning;
        }
        showHint("recognition-hint", recognitionText);
        let chronoText = data.minTime && data.maxTime ? `Erkannter Logzeitraum: ${formatDateTime(data.minTime)} bis ${formatDateTime(data.maxTime)}.` : "";
        if (data.diagnostics.chronologyIssue) {
          chronoText += (chronoText ? " " : "") + "Die Logzeilen sind nicht durchgehend chronologisch. Besucher- und Conversion-Zählung können dadurch deutlich ungenauer sein; Seitenaufrufe bleiben robuster.";
        }
        if (data.maxGapMs >= 6 * 60 * 60 * 1000) {
          chronoText += (chronoText ? " " : "") + `Größte erkannte Lücke zwischen aufeinanderfolgenden Logzeilen: ${Math.round(data.maxGapMs / 3600000)} Stunden. Prüfe, ob der Export vollständig ist.`;
        }
        showHint("chrono-hint", chronoText);

        // Details
        id("server-total").textContent = format(data.total);
        id("server-kept").textContent = format(data.kept);
        id("server-filtered").textContent = format(data.filtered + data.unrecognized);
        id("server-ads").textContent = format(data.adVisitors);
        id("visits").textContent = data.visitorRange && data.visitorRange.low !== data.visitorRange.high
          ? `${format(data.visits)} (Bandbreite ${format(data.visitorRange.low)}–${format(data.visitorRange.high)})`
          : format(data.visits);
        id("kept").textContent = format(data.kept);
        id("parsed").textContent = format(data.parsed);
        id("filtered").textContent = format(data.filtered + data.unrecognized);
        id("server-cr").textContent = data.hasSuccessUrl ? percent(data.serverCr) : "-";
        id("ads-success").textContent = data.hasSuccessUrl ? format(data.adSuccess) : "-";
        renderRows("status-methods", [
          ...data.statusCounts.map((item) => ({ name: `Status ${item.name}`, count: item.count })),
          ...data.methodCounts.map((item) => ({ name: `Methode ${item.name}`, count: item.count }))
        ]);
        const reasonRows = [
          { name: "Bot/Crawler (User-Agent)", count: data.reasons.bot },
          { name: "Fehler- oder Sonderstatus", count: data.reasons.status },
          { name: "Methode (kein GET/POST)", count: data.reasons.method },
          { name: "Leerer/zu kurzer User-Agent", count: data.reasons.emptyUa },
          { name: "Außerhalb Zeitraum", count: data.reasons.range },
          { name: "Anderer Host/Domain", count: data.reasons.host },
          { name: "Strenger Filter (kein Browser)", count: data.reasons.strict },
          { name: "Format nicht erkannt", count: data.unrecognized }
        ].filter((row) => row.count > 0);
        renderRows("filter-reasons", reasonRows);

        setVerdict(data, hasGa4, hasConv);

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        id("result-panel").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
      function convNote(diff) {
        if (diff > 0) {
          return "Dein Webserver zählt mehr Käufe als Google Analytics. Häufige Gründe: Besucher haben Cookies/Consent abgelehnt, ein Ad-Blocker war aktiv, oder das Tracking-Skript wurde nicht geladen — der Kauf kam also nie in Google Analytics an.";
        }
        if (diff < 0) {
          return "Google Analytics zählt mehr Käufe als dein Webserver. Mögliche Gründe: die Danke-Seite wird auch von Bots oder Monitoring aufgerufen und hier herausgefiltert; Google Analytics zählt Käufe ohne eigene Danke-URL (z. B. AJAX-/Ein-Seiten-Shops); mehrere Käufe desselben Besuchers innerhalb einer Stunde wurden hier zu einem zusammengefasst; oder die Server-Logs sind unvollständig (CDN-Cache, mehrere Logdateien).";
        }
        return "Beide Quellen zählen gleich viele Käufe — das spricht für sauberes Tracking.";
      }
      function diffNote(diff) {
        if (diff > 0) {
          return "Differenz = Webserver − Google Analytics. Eine positive Zahl heißt: dein Webserver hat mehr Aufrufe gezählt, Google Analytics sieht sie nicht (z. B. Ad-Blocker, abgelehnter Consent, nicht geladenes Skript).";
        }
        if (diff < 0) {
          return "Differenz = Webserver − Google Analytics. Eine negative Zahl heißt: Google Analytics hat mehr gezählt als der Webserver — möglich durch Mehrfachzählung, gefilterte Server-Zugriffe oder unvollständige Logs (CDN-Cache, mehrere Logdateien).";
        }
        return "Differenz = Webserver − Google Analytics. Beide Quellen zählen hier gleich viele Aufrufe.";
      }
      function setVerdict(data, hasGa4, hasConv) {
        if (!hasGa4 && !hasConv) {
          setSignal("good", "✓", "Ausgewertet");
          id("headline").textContent = "Das hat dein Webserver gesehen";
          let sub = `In ${zeitraumText()} zählt dein Webserver ${format(data.visits)} Besuche und ${format(data.pageViews)} Seitenaufrufe.`;
          if (data.hasSuccessUrl) sub += ` Davon ${kauf(data.success)} auf der Danke-Seite.`;
          id("subline").textContent = sub;
          id("action").textContent = "Nächster Schritt: Das sind die echten Server-Zahlen. Vergleiche sie mit Google Analytics — oder trag oben optional deine GA4-Zahlen ein, dann zeigt ServerStory die Lücke direkt.";
          return;
        }

        if (hasGa4) {
          const cov = data.overall.coverage;
          const worst = data.overall.worst;
          // worst.name ist ein URL-Pfad aus dem Log (angreifer-kontrollierter Inhalt). Er wird
          // ausschließlich über .textContent ausgegeben — das rendert Klartext, kein HTML, also
          // kein XSS. WICHTIG: bleibt das so. Wer diese Ausgabe je auf innerHTML umstellt, MUSS
          // worst.name durch escapeHtml() schicken.
          const worstText = worst && worst.coverage < 85 ? ` Am wenigsten auf ${worst.name} (${percent(worst.coverage)}).` : "";
          if (cov < 85) {
            setSignal("warn", "!", "Achtung");
            id("headline").textContent = "Google Analytics zählt zu wenig";
            id("subline").textContent = `Auf den verglichenen Seiten sieht Google Analytics nur ${percent(cov)} von dem, was dein Webserver gezählt hat.${worstText}`;
            id("action").textContent = "Nächster Schritt: Kürze jetzt keine Werbung. Lass Tracking, Cookie-Banner und Ad-Blocker prüfen — das sind die häufigsten Gründe, warum Google Analytics weniger zählt.";
          } else if (cov < 95) {
            setSignal("medium", "~", "Kleine Lücke");
            id("headline").textContent = "Kleine Abweichung";
            id("subline").textContent = `Google Analytics sieht ${percent(cov)} der Webserver-Aufrufe. Eine kleine Lücke ist normal.${worstText}`;
            id("action").textContent = "Nächster Schritt: Im Auge behalten, aber keine große Entscheidung nur wegen dieser kleinen Abweichung treffen.";
          } else if (cov <= 110) {
            setSignal("good", "✓", "Passt");
            id("headline").textContent = "Die Zahlen passen zusammen";
            id("subline").textContent = `Google Analytics und dein Webserver zählen fast gleich (${percent(cov)}).`;
            id("action").textContent = "Nächster Schritt: Kurz Zeitraum und Seiten prüfen — danach wirken die Google-Analytics-Zahlen verlässlich.";
          } else {
            setSignal("medium", "~", "GA4 zählt mehr");
            id("headline").textContent = "Google Analytics zählt mehr als der Webserver";
            id("subline").textContent = `Für die verglichenen Seiten meldet Google Analytics mehr als der Webserver (${percent(cov)}). Häufigste Ursache: Caching/CDN — gecachte Aufrufe erreichen das Server-Log gar nicht, das Tracking-Skript läuft aber trotzdem. Auch Mehrfachzählung oder Bots können Google Analytics aufblähen.`;
            id("action").textContent = "Nächster Schritt: Prüfen, ob ein CDN oder Cache (z. B. Cloudflare) vor der Seite sitzt — dann fehlen Aufrufe im Server-Log. Sonst Bots oder Mehrfachzählung in Google Analytics prüfen.";
          }
          if (hasConv && data.convDiff > 0) {
            id("action").textContent += ` Beim Kauf-Check zählt dein Webserver ${kauf(data.convDiff)} mehr als Google Analytics.`;
          } else if (hasConv && data.convDiff < 0) {
            id("action").textContent += ` Beim Kauf-Check zählt Google Analytics dagegen ${kauf(Math.abs(data.convDiff))} mehr — Details unten beim Kauf-Check.`;
          }
          return;
        }

        // Nur der Kauf-Check liegt vor (keine Seiten-GA4-Zahlen).
        const diff = data.convDiff;
        if (diff > 0) {
          const rate = data.success ? (diff / data.success) * 100 : 0;
          if (rate >= 15) {
            setSignal("warn", "!", "Achtung");
            id("headline").textContent = "Google Analytics sieht weniger Käufe";
          } else {
            setSignal("medium", "~", "Kleine Lücke");
            id("headline").textContent = "Kleine Lücke bei den Käufen";
          }
          id("subline").textContent = `Dein Webserver zählt ${kauf(diff)} mehr als Google Analytics.`;
          id("action").textContent = "Nächster Schritt: Kürze jetzt keine Werbung. Lass Tracking, Cookie-Banner, Ad-Blocker und die Danke-Seite prüfen.";
        } else if (diff < 0) {
          setSignal("medium", "~", "GA4 zählt mehr");
          id("headline").textContent = "Google Analytics zählt mehr Käufe als der Webserver";
          id("subline").textContent = `Google Analytics meldet ${kauf(Math.abs(diff))} mehr als dein Webserver.`;
          id("action").textContent = "Nächster Schritt: Prüfe die Danke-Seite — wird sie auch von Bots/Monitoring getroffen, zählt GA Käufe ohne eigene URL (AJAX/SPA), oder fehlen Server-Logs (CDN-Cache, mehrere Dateien)?";
        } else {
          setSignal("good", "✓", "Passt");
          id("headline").textContent = "Keine Lücke bei den Käufen";
          id("subline").textContent = "Google Analytics und dein Webserver zählen gleich viele Käufe.";
          id("action").textContent = "Nächster Schritt: Zeitraum und Danke-Seite kurz prüfen. Danach wirkt die Google-Analytics-Zahl plausibel.";
        }
      }
      function renderRows(targetId, rows) {
        const target = id(targetId);
        if (!rows.length) {
          target.innerHTML = "<tr><td>-</td><td>-</td></tr>";
          return;
        }
        target.innerHTML = rows
          .map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${format(row.count)}</td></tr>`)
          .join("");
      }
      function renderPageTable(rows) {
        const target = id("page-table");
        if (!rows.length) {
          target.innerHTML = `<tr><td colspan="5">Keine Seiten gefunden. Prüfe Zeitraum und Datei — oder trag oben bestimmte Seiten ein.</td></tr>`;
          return;
        }
        target.innerHTML = rows
          .map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${format(row.serverViews)}</td><td class="ga4-col">${format(row.ga4Views)}</td><td class="ga4-col">${signed(row.difference)}</td><td class="ga4-col">${percent(row.coverage)}</td></tr>`)
          .join("");
      }

      function setBusy(busy) {
        id("run").disabled = busy;
        id("run").textContent = busy ? "Wird ausgewertet …" : "Jetzt auswerten";
        id("progress").classList.toggle("hidden", !busy);
      }
      function updateProgress(done, total) {
        if (!total) {
          id("progress-bar").style.width = "100%";
          id("progress-label").textContent = "Wird ausgewertet …";
          return;
        }
        const pct = Math.max(0, Math.min(100, (done / total) * 100));
        id("progress-bar").style.width = pct.toFixed(1) + "%";
        id("progress-label").textContent = `Wird ausgewertet … ${Math.round(pct)} %`;
      }
      async function runAnalysis(blob, isSample) {
        sampleMode = !!isSample;
        setBusy(true);
        const isGzip = !isSample && /\.gz$/i.test(blob.name || "");
        const progressTotal = isGzip ? 0 : (blob.size || 1);
        updateProgress(0, progressTotal);
        try {
          const config = readConfig();
          config.gzip = isGzip;
          const agg = await processFile(blob, config, (processed) => updateProgress(processed, progressTotal));
          updateProgress(progressTotal || 1, progressTotal || 1);
          render(buildResult(agg, config));
        } catch (error) {
          id("message").textContent = error && error.message ? error.message : "Auswertung fehlgeschlagen.";
        } finally {
          setBusy(false);
        }
      }

      id("run").addEventListener("click", () => {
        id("message").textContent = "";
        const file = id("log-file").files[0];
        if (!file) {
          id("message").textContent = "Bitte Logdatei auswählen oder „Demo mit Beispieldaten starten“ klicken.";
          return;
        }
        runAnalysis(file, false);
      });
      id("preflight").addEventListener("click", async () => {
        id("message").textContent = "";
        const file = id("log-file").files[0];
        if (!file) {
          id("message").textContent = "Bitte zuerst eine Logdatei auswählen.";
          return;
        }
        if (/\.gz$/i.test(file.name || "")) {
          id("message").textContent = "Kurzprüfung für .gz-Dateien läuft über die vollständige Auswertung, weil komprimierte Dateien nicht sinnvoll angeschnitten werden können.";
          return;
        }
        try {
          const text = await file.slice(0, 512 * 1024).text();
          const preflight = preflightLogSample(text, { sampleLines: 500, useXff: id("use-xff").checked });
          const hostText = preflight.hosts.total ? `${format(preflight.hosts.total)} Host(s)` : "kein Host-Feld";
          const xffText = preflight.fields.xff ? `, XFF-Beispiel ${preflight.fields.xff}` : "";
          const warnings = preflight.warnings.length ? ` Hinweise: ${preflight.warnings.join(" ")}` : "";
          id("message").textContent = `Kurzprüfung: ${preflight.formatKind}, ${percent(preflight.recognitionRate * 100)} erkannt, ${hostText}${xffText}. Beispiel: ${preflight.fields.method || "-"} ${preflight.fields.path || "-"} → ${preflight.fields.status || "-"}.${warnings}`;
        } catch (error) {
          id("message").textContent = error && error.message ? error.message : "Kurzprüfung fehlgeschlagen.";
        }
      });
      id("sample").addEventListener("click", () => {
        id("ga4-toggle").open = true;
        id("compare-urls").value = "";
        id("ga4-url-views").value = "/,1\n/produkt,1\n/bestellung/danke,1\n/preise,1";
        id("success-url").value = "/bestellung/danke";
        id("ga4-conversions").value = "1";
        id("date-from").value = "2026-06-05";
        id("date-to").value = "2026-06-05";
        id("message").textContent = "Demo gestartet — mit Beispieldaten, ohne echte Datei.";
        runAnalysis(new Blob([sample], { type: "text/plain" }), true);
      });
      async function copyText(text, okMsg) {
        try {
          await navigator.clipboard.writeText(text);
          id("message").textContent = okMsg;
        } catch {
          id("message").textContent = text;
        }
      }
      id("copy-it").addEventListener("click", () => copyText(
        `Bitte exportiere mir das Access Log (die Besuchsliste des Webservers) für den gewünschten Zeitraum.\n\nBitte als .log-, .txt- oder .gz-Datei, idealerweise Apache/Nginx Combined Log.\n\nEs geht nur um Summen (Besuche, Seitenaufrufe), keine Auswertung einzelner Nutzer. Die Datei wird lokal im Browser ausgewertet und nicht in fremde Cloudtools hochgeladen.`,
        "Text für IT/Agentur kopiert — jetzt einfügen und abschicken."
      ));
      id("copy-hoster").addEventListener("click", () => copyText(
        `Hallo, ich bin Inhaber bzw. berechtigt für das Hosting-Paket zur Domain [DEINE-DOMAIN.DE].\n\nBitte stellt mir das Access Log (die Server-Logdatei mit den Seitenaufrufen) für den Zeitraum [VON] bis [BIS] zum Download bereit oder schickt es mir per E-Mail. Falls ich es selbst im Kundenmenü herunterladen kann: Wo finde ich die Logdateien?\n\nFormat bitte als .log-, .txt- oder .gz-Datei (Apache/Nginx Combined Log). Es geht nur um aggregierte Zugriffszahlen, keine personenbezogene Auswertung.\n\nVielen Dank!`,
        "Text für Hoster-Support kopiert — Platzhalter [...] ersetzen, dann abschicken."
      ));
      id("copy-report").addEventListener("click", () => {
        if (!lastResult) {
          id("message").textContent = "Noch kein Analyse-Protokoll vorhanden.";
          return;
        }
        const report = {
          schema: "serverstory.analysis.v1",
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          format: lastResult.formatKind,
          totals: {
            rows: lastResult.total,
            parsed: lastResult.parsed,
            kept: lastResult.kept,
            filtered: lastResult.filtered + lastResult.unrecognized,
            pageViews: lastResult.pageViews,
            visits: lastResult.visits,
            visitorRange: lastResult.visitorRange,
            success: lastResult.success
          },
          quality: lastResult.diagnostics,
          timeRange: {
            from: lastResult.minTime ? new Date(lastResult.minTime).toISOString() : null,
            to: lastResult.maxTime ? new Date(lastResult.maxTime).toISOString() : null,
            maxGapHours: lastResult.maxGapMs ? Math.round(lastResult.maxGapMs / 3600000) : 0
          },
          xForwardedFor: {
            used: lastResult.xffUsed,
            missing: lastResult.xffMissing,
            privateOnly: lastResult.xffPrivate
          },
          suspiciousClients: lastResult.suspiciousClients,
          trackingCapped: lastResult.trackingCapped,
          filterReasons: lastResult.reasons,
          parser: {
            dataRows: lastResult.dataRows,
            metaRows: lastResult.meta,
            unrecognizedRows: lastResult.unrecognized,
            unrecognizedPct: lastResult.unrecognizedPct,
            formatCounters: lastResult.formatChecked ? {
              checked: lastResult.formatChecked,
              combined: lastResult.formatCombined,
              detected: lastResult.formatKind
            } : { checked: 0, combined: 0, detected: lastResult.formatKind },
            hosts: lastResult.hosts,
            statusCounts: lastResult.statusCounts,
            methodCounts: lastResult.methodCounts,
            filterReasonPct: Object.fromEntries(Object.entries(lastResult.reasons).map(([key, value]) => [key, lastResult.parsed ? (value / lastResult.parsed) * 100 : 0]))
          },
          accuracyNotes: {
            pageViews: qualityReason(lastResult, "views", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            visits: qualityReason(lastResult, "visits", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            conversions: qualityReason(lastResult, "purchases", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            ga4: qualityReason(lastResult, "ga4", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            hostScope: lastResult.diagnostics.hostReliability === "limited" ? `Mehrere Hosts/Domains erkannt (${format(lastResult.hosts.total)}). Hostfilter empfohlen.` : "Host-Scope wirkt eindeutig.",
            botAnomaly: lastResult.suspiciousClients ? `${format(lastResult.suspiciousClients)} Besucher-Schluessel mit Bot-/Monitoring-Verdacht.` : "Keine auffaellige Bot-/Monitoring-Konzentration erkannt."
          },
          topPages: lastResult.tableRows
        };
        copyText(JSON.stringify(report, null, 2), "Analyse-Protokoll kopiert.");
      });
      id("log-file").addEventListener("change", () => {
        sampleMode = false;
        id("demo-badge").classList.remove("visible");
      });
      if (location.protocol === "file:") id("offline-note").classList.add("hidden");
    
    
    
