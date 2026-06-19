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
        const maxTrackedPaths = Math.max(1000, Number(config.maxTrackedPaths) || 50000);
        const scanTargetRe = /(?:^|\/)(?:wp-login\.php|xmlrpc\.php|wp-admin(?:\/|$)|wp-content\/themes\/[^?\s]+\.php|theme-editor\.php|admin(?:\/|$)|administrator(?:\/|$)|manager\/html|phpmyadmin|pma(?:\/|$)|cfide\/administrator|\.env(?:$|\?)|\.git(?:\/|$)|testproxy\.php|azenv\.php|setup\.php|shell\.php|cmd\.php|upload\.php|eval-stdin\.php|vendor\/phpunit|cgi-bin)(?:$|[\/?\s])|(?:^|\/)(?:panel|backup|config|database)\.(?:zip|tar|tgz|gz|sql)(?:$|[?\s])|(?:^|\/)(?:HNAP1|boaform|GponForm)(?:$|[\/?\s])|(?:^|\/)(?:\.\.|%2e%2e)|https?:\/\/[^/\s]+\/(?:testproxy|azenv)\.php(?:$|[?\s])|(?:^|[;&|`$<>])(?:wget|curl|chmod|\/bin\/bash|powershell|cmd\.exe)(?:\s|$)/i;

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
            for (const [key, value] of u.searchParams) {
              if (key.toLowerCase() === orderParam) return value || "";
            }
            return "";
          } catch {
            return "";
          }
        }
        function splitLogFields(line) {
          const fields = [];
          let current = "", quoted = false;
          for (let i = 0; i < String(line || "").length; i++) {
            const ch = line[i];
            if (ch === '"') { quoted = !quoted; continue; }
            if (/\s/.test(ch) && !quoted) {
              if (current !== "") { fields.push(current); current = ""; }
              continue;
            }
            current += ch;
          }
          if (current !== "") fields.push(current);
          return fields;
        }
        function requestParts(request) {
          const m = String(request || "").match(/^([A-Z]+)\s+(.+?)(?:\s+HTTP\/[0-9.]+)?$/);
          return m ? { method: m[1], target: m[2] } : { method: "GET", target: request || "/" };
        }
        function looksLikeScanTarget(method, target, ua, trailing) {
          const haystack = `${method || ""} ${target || ""} ${ua || ""} ${trailing || ""}`;
          return scanTargetRe.test(haystack);
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
        function parseLegacyArchiveTime(raw) {
          const text = String(raw || "").trim().replace(/\s+/g, " ");
          let m = text.match(/^(?:[A-Za-z]{3} )?([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/);
          if (m) {
            const mo = monthMap[m[1]];
            if (!mo) return null;
            const day = String(m[2]).padStart(2, "0");
            const t = Date.parse(`${m[6]}-${mo}-${day}T${m[3]}:${m[4]}:${m[5]}-04:00`);
            if (Number.isNaN(t)) return null;
            return { date: `${m[6]}-${mo}-${day}`, timeMs: t };
          }
          m = text.match(/^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/);
          if (m) {
            const day = String(m[1]).padStart(2, "0");
            const t = Date.parse(`1995-08-${day}T${m[2]}:${m[3]}:${m[4]}-04:00`);
            if (Number.isNaN(t)) return null;
            return { date: `1995-08-${day}`, timeMs: t };
          }
          return parseTime(text);
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
        function safeDecodeURIComponent(value) {
          const text = String(value || "").replace(/\+/g, " ");
          try { return decodeURIComponent(text); }
          catch (_) { return text; }
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
              ua: safeDecodeURIComponent(get(["cs(User-Agent)", "cs(User_Agent)"])),
              trailing: get("x-forwarded-for") || "",
              xffExact: iisFields.includes("x-forwarded-for")
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
            const xff = pick(obj, ["ClientRequestHeaderXForwardedFor", "x_forwarded_for", "http_x_forwarded_for", "forwarded_for", "xff", "reqHeaderXForwardedFor", "requestHeaderXForwardedFor", "clientRequestHeaderXForwardedFor"]);
            return {
              kind,
              ip0: pick(obj, ["ClientIP", "ClientRequestIP", "remote_addr", "remoteAddress", "client_ip", "clientIp", "ip", "clientIP", "cliIP", "requestIP", "client.address", "clientAddress"]) || "-",
              pt,
              method: pick(obj, ["ClientRequestMethod", "method", "request_method", "cs_method", "reqMethod", "requestMethod", "req.method", "httpRequestMethod"]) || "GET",
              target: request,
              host: host || pick(obj, ["requestHostHeader", "host_header", "Host"]),
              status: Number(pick(obj, ["EdgeResponseStatus", "status", "status_code", "response_status", "sc_status", "statusCode", "rspStatus", "responseStatus", "httpStatus", "response_status_code"])),
              ua: pick(obj, ["ClientRequestUserAgent", "user_agent", "http_user_agent", "ua", "cs_user_agent", "userAgent", "reqUserAgent", "requestUserAgent", "requestHeaderUserAgent"]),
              trailing: xff,
              xffExact: !!xff
            };
          } catch (_) {
            return null;
          }
        }
        function parseLoadBalancerLine(line) {
          const parts = splitLogFields(line);
          if (parts.length < 12) return null;
          let pt, client = "", request = "", ua = "", status = NaN, kind = "";
          if (/^(?:http|https|h2|ws|wss)$/i.test(parts[0])) {
            pt = parseIsoTime(parts[1]);
            client = parts[3] || "";
            status = Number(parts[8]);
            request = parts[12] || "";
            ua = parts[13] || "";
            kind = "alb";
          } else {
            pt = parseIsoTime(parts[0]);
            if (!pt) return null;
            client = parts[2] || "";
            status = Number(parts[7]);
            request = parts[11] || "";
            ua = parts[12] || "";
            kind = "elb";
          }
          if (!pt || !request || Number.isNaN(status)) return null;
          const req = requestParts(request);
          const ip = normalizeIpToken(client.replace(/:\d+$/, ""));
          let host = "";
          try { host = new URL(req.target, "http://x.invalid").hostname; } catch (_) {}
          return { kind, ip0: ip || client || "-", pt, method: req.method, target: req.target, host, status, ua, trailing: "", xffExact: false };
        }
        function cleanHost(value) {
          let host = String(value || "").trim().toLowerCase();
          host = host.replace(/^https?:\/\//, "").split("/")[0];
          if (host.startsWith("[") && host.includes("]")) return host.slice(1, host.indexOf("]"));
          return host.replace(/:\d+$/, "");
        }
        const reVhostLine = /^(\S+)[ \t]+(\S+)[ \t]+\S+[ \t]+\S+[ \t]+\[([^\]]+)\][ \t]+"([A-Z]+)[ \t]+([^"]*?)[ \t]+(HTTP\/[0-9.]+)"[ \t]+(\d{3})[ \t]+\S+[ \t]+"([^"]*)"[ \t]+"([^"]*)"(.*)$/;
        function parseVhostCombinedLine(line) {
          const m = reVhostLine.exec(line);
          if (!m || !normalizeIpToken(m[2])) return null;
          const pt = parseTime(m[3]);
          if (!pt) return null;
          return { kind: "combined", ip0: m[2], pt, method: m[4], target: m[5], host: cleanHost(m[1]), status: +m[7], ua: m[9], trailing: m[10] || "" };
        }
        function parseCombinedLine(line) {
          const m = reLine.exec(line);
          if (!m) return null;
          const pt = parseTime(m[2]);
          if (!pt) return null;
          return { kind: "combined", ip0: m[1], pt, method: m[3], target: m[4], host: "", status: +m[6], ua: m[8], trailing: m[9] || "" };
        }
        function parseLegacyArchiveLine(line) {
          const m = line.match(/^(\S+)(?:[ \t]+\S+[ \t]+\S+)?[ \t]+\[([^\]]+)\][ \t]+"([A-Z]+)[ \t]+([^"]*?)(?:[ \t]+HTTP\/[0-9.]+)?"[ \t]+(\d{3})[ \t]+\S+/);
          if (!m) return null;
          const pt = parseLegacyArchiveTime(m[2]);
          if (!pt) return null;
          return { kind: "legacy_http_archive", ip0: m[1], pt, method: m[3], target: m[4], host: "", status: +m[5], ua: "__legacy_no_user_agent__", trailing: "", noUserAgent: true };
        }
        function parseLogLine(line) {
          const vhost = parseVhostCombinedLine(line);
          if (vhost) return vhost;
          const combined = parseCombinedLine(line);
          if (combined) return combined;
          const lb = parseLoadBalancerLine(line);
          if (lb) return lb;
          const json = parseJsonLine(line);
          if (json) return json;
          const iis = parseIisLine(line);
          if (iis) return iis;
          return parseLegacyArchiveLine(line);
        }

        const pathCounts = new Map(), statusCounts = new Map(), methodCounts = new Map(), hostCounts = new Map();
        const lastSeen = new Map(), lastSuccess = new Map(), adVisitors = new Set(), adSuccess = new Set(), orderSuccess = new Set();
        const keyHits = new Map(), keyAssets = new Map();
        const stats = {
          total: 0, parsed: 0, unrecognized: 0, kept: 0, pageViews: 0, filtered: 0,
          rBot: 0, rStatus: 0, rRange: 0, rMethod: 0, rEmptyUa: 0, rStrict: 0,
          visits: 0, successRaw: 0, success: 0, timeRegressions: 0,
          xffUsed: 0, xffMissing: 0, xffPrivate: 0, xffExactUsed: 0, suspiciousClients: 0, rHost: 0,
          meta: 0, legacyNoUserAgent: 0, scanRequests: 0, hostFilterNoHost: 0
        };
        const format = { checked: 0, combined: 0, json: 0, iis: 0, cloudflare: 0, cloudfront: 0, fastly: 0, akamai: 0, alb: 0, elb: 0, legacy_http_archive: 0 };
        let prevTime = -Infinity, maxTime = -Infinity, minTime = Infinity, maxGapMs = 0, seen = 0;
        // Proxy-/CDN-Erkennung (nur relevant, wenn X-Forwarded-For NICHT genutzt wird): Sitzt die
        // Seite hinter einem Reverse-Proxy/Loadbalancer/CDN, steht in Spalte 1 immer dieselbe
        // (oft private) IP. Dann kollabieren alle Besucher auf einen Schlüssel und die
        // Besucherzahl wird unbrauchbar. Wir messen die Konzentration der Spalte-1-IP über die
        // behaltenen Zeilen, um davor zu warnen. Map wird gedeckelt, damit sie nicht unbegrenzt wächst.
        const clientIpHits = new Map();
        let privateClientHits = 0, clientIpCapped = false, trackingCapped = false;
        let pathCountCapped = false, queryVariantCapped = false;
        const queryVariantPaths = new Set();

        function prune() {
          if (maxTime === -Infinity) return;
          const visitCut = maxTime - VISIT_MS, successCut = maxTime - SUCCESS_MS;
          for (const [k, t] of lastSeen) if (t < visitCut) lastSeen.delete(k);
          for (const [k, t] of lastSuccess) if (t < successCut) lastSuccess.delete(k);
        }

        function processLine(line) {
          try {
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
            else if (/^(?:http|https|h2|ws|wss)\s+\d{4}-\d{2}-\d{2}T/.test(trimmed)) format.alb++;
            else if (/^\d{4}-\d{2}-\d{2}T[^\s]+\s+\S+\s+\S+:\d+\s+/.test(trimmed)) format.elb++;
            else if (/^\S+(?:\s+\S+\s+\S+)?\s+\[[^\]]+\]\s+"[A-Z]+\s+[^"]+(?:\s+HTTP\/[0-9.]+)?"\s+\d{3}\s+\S+/.test(line)) format.legacy_http_archive++;
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
          else if (rec.kind === "alb") format.alb++;
          else if (rec.kind === "elb") format.elb++;
          else if (rec.kind === "json") format.json++;
          else if (rec.kind === "iis") format.iis++;
          else if (rec.kind === "combined") format.combined++;
          else if (rec.kind === "legacy_http_archive") format.legacy_http_archive++;
          if (pt.timeMs < prevTime) stats.timeRegressions++;
          else if (prevTime !== -Infinity && pt.timeMs - prevTime > maxGapMs) maxGapMs = pt.timeMs - prevTime;
          prevTime = pt.timeMs;
          if (pt.timeMs < minTime) minTime = pt.timeMs;
          if (pt.timeMs > maxTime) maxTime = pt.timeMs;

          const normalized = normTarget(target);
          if (looksLikeScanTarget(method, target, ua, trailing)) stats.scanRequests++;
          const host = cleanHost(rec.host || normalized.host || "");
          if (allowedHosts.size && !host) stats.hostFilterNoHost++;
          if (allowedHosts.size && host && !allowedHosts.has(host)) { stats.filtered++; stats.rHost++; return; }
          if (host) hostCounts.set(host, (hostCounts.get(host) || 0) + 1);

          if ((dateFrom && pt.date < dateFrom) || (dateTo && pt.date > dateTo)) { stats.filtered++; stats.rRange++; return; }
          if (!okStatus.has(status)) { stats.filtered++; stats.rStatus++; return; }
          if (method !== "GET" && method !== "POST") { stats.filtered++; stats.rMethod++; return; }
          const uaTrim = ua.trim();
          if (rec.noUserAgent) stats.legacyNoUserAgent++;
          else {
            if (uaTrim === "" || uaTrim === "-" || uaTrim.length < 8) { stats.filtered++; stats.rEmptyUa++; return; }
            if (botRe.test(ua)) { stats.filtered++; stats.rBot++; return; }
            if (strictBot && !browserRe.test(ua)) { stats.filtered++; stats.rStrict++; return; }
          }

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
            if (pathCounts.has(path) || pathCounts.size < maxTrackedPaths) pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
            else pathCountCapped = true;
            if (path.includes("?")) {
              if (queryVariantPaths.size < maxTrackedPaths || queryVariantPaths.has(path)) queryVariantPaths.add(path);
              else queryVariantCapped = true;
            }
            if (!assetRe.test(path)) stats.pageViews++;
          }
          statusCounts.set(String(status), (statusCounts.get(String(status)) || 0) + 1);
          methodCounts.set(method, (methodCounts.get(method) || 0) + 1);

          const resolvedClient = clientIp(ip0, trailing);
          if (resolvedClient.xff === "used") {
            stats.xffUsed++;
            if (rec.xffExact) stats.xffExactUsed++;
          }
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
          } catch (_) {
            stats.unrecognized++;
          }
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
            ["alb", format.alb],
            ["elb", format.elb],
            ["legacy_http_archive", format.legacy_http_archive],
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
            xffUsed: stats.xffUsed, xffMissing: stats.xffMissing, xffPrivate: stats.xffPrivate, xffExactUsed: stats.xffExactUsed,
            legacyNoUserAgent: stats.legacyNoUserAgent,
            suspiciousClients: stats.suspiciousClients,
            scanRequests: stats.scanRequests,
            trackingCapped, pathCountCapped, queryVariantCapped, queryVariantCount: queryVariantPaths.size,
            hostFilterNoHost: stats.hostFilterNoHost,
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

