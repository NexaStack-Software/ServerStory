


      const sample = (() => {
        const lines = [];
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36";
        const botUa = "Googlebot/2.1 (+http://www.google.com/bot.html)";
        const pad = (value) => String(value).padStart(2, "0");
        const stamp = (seconds) => {
          const d = new Date(Date.UTC(2026, 5, 5, 8, 0, seconds));
          return `${pad(d.getUTCDate())}/Jun/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0200`;
        };
        const ip = (i) => `198.51.${Math.floor(i / 250)}.${i % 250}`;
        const line = (i, seconds, target, status = 200, userAgent = ua) => `${ip(i)} - - [${stamp(seconds)}] "GET ${target} HTTP/1.1" ${status} 123 "-" "${userAgent}"`;
        for (let i = 0; i < 2500; i++) {
          const base = i * 5;
          lines.push(line(i, base, i % 4 === 0 ? `/?gclid=demo-${i}` : "/"));
          if (i % 2 === 0) lines.push(line(i, base + 1, `/produkt/${i % 20}`));
          if (i % 3 === 0) lines.push(line(i, base + 2, "/assets/app.css"));
          if (i % 10 === 0) lines.push(line(i, base + 3, `/bestellung/danke?order_id=D${i}`));
        }
        for (let i = 0; i < 80; i++) lines.push(line(2600 + i, 14000 + i, `/bot/${i}`, 200, botUa));
        for (let i = 0; i < 40; i++) lines.push(line(2700 + i, 14100 + i, `/fehler/${i}`, 500, ua));
        return lines.join("\n");
      })();
      let sampleMode = false;
      let analyzed = false;
      let lastResult = null;
      let lastGa4Import = { warning: "" };
      // Nicht-HTML-Ressourcen (Bilder, CSS, JS, Sitemaps, Feeds, JSON-Endpunkte …) werden
      // von den "Seitenaufrufen" ausgeschlossen, damit die Zahl mit Google-Analytics-Seitenaufrufen
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
        lastGa4Import = { warning: "", rows: 0, duplicateCount: 0, duplicatePaths: [] };
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
              lastGa4Import.warning = "Die Google-Analytics-Datei enthält Nutzer/Users, aber keine Aufrufe/Page Views. Für den Vergleich brauchst du Seitenaufrufe, nicht Nutzer.";
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
          lastGa4Import.rows++;
          if (values.has(path)) {
            lastGa4Import.duplicateCount++;
            if (!lastGa4Import.duplicatePaths.includes(path)) lastGa4Import.duplicatePaths.push(path);
            values.set(path, values.get(path) + views);
          } else {
            values.set(path, views);
          }
        }
        if (lines.length && values.size === 0 && !lastGa4Import.warning) {
          lastGa4Import.warning = "Die Google-Analytics-Eingabe konnte nicht als Seitenaufrufe gelesen werden. Bitte Export mit Seitenpfad (Page path) und Aufrufen (Views/Page Views) verwenden.";
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
        const reVhostLine = /^(\S+)[ \t]+(\S+)[ \t]+\S+[ \t]+\S+[ \t]+\[([^\]]+)\][ \t]+"([A-Z]+)[ \t]+([^"]*?)[ \t]+(HTTP\/[0-9.]+)"[ \t]+(\d{3})[ \t]+\S+[ \t]+"([^"]*)"[ \t]+"([^"]*)"(.*)$/;
        let first = null;
        function cleanHost(value) {
          let host = String(value || "").trim().toLowerCase();
          host = host.replace(/^https?:\/\//, "").split("/")[0];
          if (host.startsWith("[") && host.includes("]")) return host.slice(1, host.indexOf("]"));
          return host.replace(/:\d+$/, "");
        }
        function looksLikeIp(value) {
          const text = String(value || "");
          return /^(\d{1,3}\.){3}\d{1,3}$/.test(text) || (/^[0-9a-fA-F:]+$/.test(text) && text.includes(":"));
        }
        function norm(value) {
          try {
            const u = new URL(value, "http://x.invalid");
            let path = u.pathname.replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/i, "/");
            path = path === "/" ? "/" : path.replace(/\/$/, "");
            return { path, host: u.hostname === "x.invalid" ? "" : cleanHost(u.hostname) };
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
        const lines = String(text || "").split(/\r?\n/).filter(Boolean).slice(0, sampleLines);
        const rawSample = lines.join("\n");
        const analyticsCsvSignals = [
          /page path/i,
          /screen class/i,
          /\bviews\b/i,
          /\busers\b/i,
          /\bsessions\b/i,
          /event count/i,
          /\bclicks\b/i,
          /\bimpressions\b/i,
          /\bctr\b/i,
          /page_location/i,
          /user_pseudo_id/i,
          /"event"\s*:/
        ].filter((re) => re.test(rawSample)).length;
        const errorLogSignals = lines.filter((line) => /\[(?:error|warn|notice|crit|alert|emerg)\]|\bAH\d{5}:|PHP (?:Fatal|Warning|Notice)|upstream timed out|client denied by server configuration/i.test(line)).length;
        const wafSignals = lines.filter((line) => /\b(?:waf|firewall|blocked|deny|challenge|ruleId|rule_id|threat|bot score|security event)\b/i.test(line)).length;
        const monitoringSignals = lines.filter((line) => /\b(?:cpu|memory|load average|uptime|healthcheck|latency|probe|prometheus|grafana|status check)\b/i.test(line)).length;
        const agg = makeAggregator({
          assetRe: ASSET_RE,
          useXff: !!options.useXff,
          strictBot: false,
          keptQueryParams: [],
          hostFilter: [],
          maxTrackedClients: 100000,
          maxTrackedPaths: 50000
        });
        for (const line of lines) {
          agg.processLine(line);
          const vhost = reVhostLine.exec(line);
          const m = reLine.exec(line);
          if (!m && !vhost) continue;
          const isVhost = !!(vhost && cleanHost(vhost[1]) && looksLikeIp(vhost[2]));
          const target = norm(isVhost ? vhost[5] : m[4]);
          const xff = options.useXff ? firstXff(isVhost ? (vhost[10] || "") : (m[9] || "")) : "";
          if (!first) first = {
            ip: isVhost ? vhost[2] : m[1],
            xff,
            method: isVhost ? vhost[4] : m[3],
            path: target.path,
            host: isVhost ? cleanHost(vhost[1]) : target.host,
            status: Number(isVhost ? vhost[7] : m[6])
          };
        }
        const result = agg.finalize();
        const recognitionRate = result.dataRows ? result.parsed / result.dataRows : 0;
        const strongSignalMin = Math.max(2, lines.length * 0.2);
        const fileClass = analyticsCsvSignals >= 2 ? "analytics_csv"
          : (errorLogSignals >= strongSignalMin ? "error_log"
            : (wafSignals >= strongSignalMin ? "waf_or_security_log"
              : (monitoringSignals >= strongSignalMin ? "monitoring_log"
                : (recognitionRate >= 0.8 ? (result.formatKind === "legacy_http_archive" ? "legacy_access_log" : "access_log") : "unknown"))));
        const classificationLabel = {
          access_log: "Brauchbares Access Log",
          legacy_access_log: "Altes Access-Log-Archiv ohne Browserkennung",
          analytics_csv: "Wahrscheinlich Analytics-CSV, kein Server-Access-Log",
          error_log: "Wahrscheinlich Error Log, kein Access Log",
          waf_or_security_log: "Wahrscheinlich WAF-/Security-Log, kein normales Access Log",
          monitoring_log: "Wahrscheinlich Monitoring-/Health-Log, kein Access Log",
          unknown: "Format nicht sicher als Access Log erkennbar"
        }[fileClass];
        const isLikelyAccessLog = fileClass === "access_log" || fileClass === "legacy_access_log";
        const limitations = [
          ...(fileClass === "legacy_access_log" ? ["Keine Browserkennung in der Stichprobe. Besucher- und Bot-Aussagen werden eingeschränkt."] : []),
          ...(fileClass === "access_log" && recognitionRate < 0.95 ? ["Access Log wirkt lesbar, aber einzelne Zeilen passen nicht zum Format."] : [])
        ];
        const rejectReasons = isLikelyAccessLog ? [] : [
          ...(fileClass === "analytics_csv" ? ["Die Datei sieht wie ein Analytics-Export aus, nicht wie ein Server-Access-Log."] : []),
          ...(fileClass === "error_log" ? ["Die Datei sieht wie ein Fehlerprotokoll aus; daraus lassen sich keine Besucherzahlen ableiten."] : []),
          ...(fileClass === "waf_or_security_log" ? ["Die Datei sieht wie ein WAF-/Security-Log aus; normale Seitenaufrufe fehlen wahrscheinlich."] : []),
          ...(fileClass === "monitoring_log" ? ["Die Datei sieht wie ein Monitoring-/Health-Log aus; normale Besucheraufrufe fehlen wahrscheinlich."] : []),
          ...(fileClass === "unknown" ? ["Die Stichprobe passt nicht ausreichend zu einem bekannten Access-Log-Format."] : [])
        ];
        const privateShare = result.kept ? result.privateClientHits / result.kept : 0;
        const topClientShare = result.kept ? result.topClientHits / result.kept : 0;
        const proxySignal = !options.useXff && result.kept >= 100 && (privateShare >= 0.3 || topClientShare >= 0.5)
          ? (privateShare >= 0.3 ? "private" : "concentrated")
          : "";
        const largeGap = result.maxGapMs >= 6 * 60 * 60 * 1000;
        const warnings = [];
        if (!isLikelyAccessLog) warnings.push(rejectReasons[0]);
        for (const limitation of limitations) warnings.push(limitation);
        if (result.hostCounts.size > 1) warnings.push("Die Stichprobe enthält mehrere Websites oder Subdomains.");
        if (options.useXff && !result.xffUsed) warnings.push("Das Proxy-Feld wurde aktiviert, aber in der Stichprobe nicht brauchbar gefunden.");
        if (recognitionRate < 0.95) warnings.push(`Nur ${percent(recognitionRate * 100)} der Stichprobe konnte gelesen werden.`);
        if (proxySignal) warnings.push("Proxy oder Cache kann echte Besucheradressen verdecken.");
        if (largeGap) warnings.push("Die Stichprobe enthält eine große zeitliche Lücke.");
        const claimBlockers = [
          ...rejectReasons,
          ...(result.hostCounts.size > 1 ? ["Mehrere Websites/Subdomains in der Stichprobe."] : []),
          ...(recognitionRate < 0.8 ? ["Zu viel der Stichprobe konnte nicht gelesen werden."] : []),
          ...(proxySignal ? ["Besucherzahl vorab nicht verlässlich bestimmbar."] : []),
          ...(options.useXff && !result.xffUsed ? ["Proxy-Feld liefert keine brauchbaren Besucheradressen."] : [])
        ];
        const recommendedChecks = [
          ...(!isLikelyAccessLog ? ["Bitte echte Server-Access-Logdatei hochladen."] : []),
          ...(fileClass === "legacy_access_log" ? ["Archivlogs ohne Browserkennung nur für Pageview-/Lasttests nutzen."] : []),
          ...(result.hostCounts.size > 1 ? ["Website-Filter setzen."] : []),
          ...(recognitionRate < 0.95 ? ["Exportformat prüfen."] : []),
          ...(proxySignal ? ["Prüfen, ob Cloudflare oder ein anderer Cache vor der Website sitzt."] : []),
          ...(largeGap ? ["Prüfen, ob im Export Stunden oder Teil-Dateien fehlen."] : []),
          ...(options.useXff && !result.xffUsed ? ["Proxy-Feld nur verwenden, wenn es vom eigenen Proxy kommt und Daten enthält."] : [])
        ];
        return {
          fileClass,
          classificationLabel,
          isLikelyAccessLog,
          limitations,
          rejectReasons,
          formatKind: result.formatKind,
          recognitionRate,
          fields: first || {},
          hosts: { total: result.hostCounts.size, top: topEntries(result.hostCounts, 5) },
          sampleTimeRange: {
            from: result.minTime ? new Date(result.minTime).toISOString() : null,
            to: result.maxTime ? new Date(result.maxTime).toISOString() : null,
            maxGapHours: result.maxGapMs ? Math.round(result.maxGapMs / 3600000) : 0
          },
          proxySignal,
          claimBlockers,
          recommendedChecks,
          quality: {
            pageviews: recognitionRate >= 0.95 ? "high" : recognitionRate >= 0.8 ? "medium" : "limited",
            visitors: options.useXff ? (result.xffUsed && !result.xffMissing && result.xffExactUsed === result.xffUsed ? "high" : "limited") : (proxySignal ? "limited" : "medium")
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
        const probeTotal = new Map(), probeErrors = new Map();
        let probeCapped = false;
        const PROBE_MIN_HITS = 6, PROBE_ERR_SHARE = 0.8;
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
          if (!probeCapped) {
            probeTotal.set(ip0, (probeTotal.get(ip0) || 0) + 1);
            if (status >= 400) probeErrors.set(ip0, (probeErrors.get(ip0) || 0) + 1);
            if (probeTotal.size > 50000) { probeTotal.clear(); probeErrors.clear(); probeCapped = true; }
          }
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
          let probeClients = 0, probeRequests = 0;
          if (!probeCapped) {
            for (const [ip, total] of probeTotal) {
              if (total >= PROBE_MIN_HITS && (probeErrors.get(ip) || 0) / total >= PROBE_ERR_SHARE) {
                probeClients++;
                probeRequests += total;
              }
            }
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
            probeClients, probeRequests,
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
        const selectValue = (name, fallback) => id(name).value || fallback;
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
          maxTrackedPaths: 50000,
          calibration: {
            preset: selectValue("log-preset", "unknown"),
            cache: selectValue("site-cache", "unknown"),
            logSource: selectValue("log-source", "unknown"),
            exportComplete: selectValue("export-complete", "unknown"),
            ga4MetricKind: selectValue("ga4-metric-kind", "unknown")
          },
          gzip: false,
          assetRe: ASSET_RE
        };
      }

      function buildResult(agg, config) {
        const preset = (config.calibration && config.calibration.preset) || "unknown";
        const presetDefaults = {
          cloudflare: { cache: "yes", logSource: "edge" },
          cloudfront: { cache: "yes", logSource: "edge" },
          fastly: { cache: "yes", logSource: "edge" },
          akamai: { cache: "yes", logSource: "edge" },
          apache_nginx: { logSource: "origin" },
          iis: { logSource: "origin" },
          alb: { logSource: "origin" },
          elb: { logSource: "origin" }
        }[preset] || {};
        const rawCalibration = {
          cache: "unknown",
          logSource: "unknown",
          exportComplete: "unknown",
          ga4MetricKind: "unknown",
          ...(config.calibration || {})
        };
        const calibration = {
          preset,
          cache: rawCalibration.cache === "unknown" && presetDefaults.cache ? presetDefaults.cache : rawCalibration.cache,
          logSource: rawCalibration.logSource === "unknown" && presetDefaults.logSource ? presetDefaults.logSource : rawCalibration.logSource,
          exportComplete: rawCalibration.exportComplete,
          ga4MetricKind: rawCalibration.ga4MetricKind,
          presetApplied: preset !== "unknown"
        };
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
        const ga4OnlyRows = ga4Rows.filter((row) => row.ga4Views !== null && row.ga4Views !== undefined && row.serverViews === 0);
        const ga4Validation = {
          rows: lastGa4Import.rows || 0,
          unmatchedRows: ga4OnlyRows.length,
          unmatchedShare: ga4Rows.length ? ga4OnlyRows.length / ga4Rows.length : 0,
          unmatchedPaths: ga4OnlyRows.slice(0, 8).map((row) => row.name),
          duplicateCount: lastGa4Import.duplicateCount || 0,
          duplicatePaths: (lastGa4Import.duplicatePaths || []).slice(0, 8)
        };
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
        const hostFilterRequested = !!(config.hostFilter && config.hostFilter.filter(Boolean).length);
        const hostFilterNoHost = agg.hostFilterNoHost || 0;
        const hostFilterUnverifiable = hostFilterRequested && hostFilterNoHost > 0;
        const hostReliability = (hosts.total > 1 && !hostFilterRequested) || hostFilterUnverifiable ? "limited" : "high";
        const isLegacyArchive = agg.formatKind === "legacy_http_archive";
        const visitorReliability = isLegacyArchive
          ? "medium"
          : config.useXff
          ? (agg.xffUsed > 0 && agg.xffMissing === 0 && agg.xffExactUsed === agg.xffUsed ? "high" : "limited")
          : (proxyKind ? "limited" : (chronologyIssue ? "medium" : "high"));
        const edgeKinds = new Set(["cloudflare", "cloudfront", "fastly", "akamai"]);
        const structuredKinds = new Set([...edgeKinds, "iis", "alb", "elb", "legacy_http_archive"]);
        const userSaysCache = calibration.cache === "yes";
        const userSaysEdgeLog = calibration.logSource === "edge";
        const userSaysOriginLog = calibration.logSource === "origin";
        const userSaysIncompleteExport = calibration.exportComplete === "no";
        const ga4MetricMismatch = calibration.ga4MetricKind === "users_or_sessions";
        const pageviewReliability = recognitionRate >= 0.95 && (agg.formatKind === "combined" || structuredKinds.has(agg.formatKind)) ? "high" : recognitionRate >= 0.8 ? "medium" : "limited";
        const ga4InputProblem = ga4Validation.duplicateCount > 0 || (ga4Validation.unmatchedRows > 0 && ga4Validation.unmatchedShare >= 0.5);
        const ga4Reliability = lastGa4Import.warning || ga4InputProblem || ga4MetricMismatch ? "limited" : (ga4Rows.length && pageviewReliability !== "limited" ? (isLegacyArchive ? "limited" : "medium") : "limited");
        const conversionReliability = config.hasSuccessUrl
          ? (isLegacyArchive ? "medium" : (config.orderParam ? "high" : (agg.successRaw > agg.success * 1.25 ? "medium" : "high")))
          : "none";
        let visitorLow = agg.visits, visitorHigh = agg.visits;
        if (visitorReliability === "limited") {
          const rangeBase = proxyKind ? Math.max(agg.visits, agg.pageViews) : agg.visits;
          visitorLow = Math.max(1, Math.round(agg.visits * 0.55));
          visitorHigh = Math.max(visitorLow, Math.round(rangeBase * 1.45));
        } else if (visitorReliability === "medium") {
          visitorLow = Math.max(1, Math.round(agg.visits * 0.8));
          visitorHigh = Math.max(visitorLow, Math.round(agg.visits * 1.2));
        }
        const scanShare = agg.parsed ? agg.scanRequests / agg.parsed : 0;
        const probeRequests = agg.probeRequests || 0;
        const probeClients = agg.probeClients || 0;
        const probeShare = agg.parsed ? probeRequests / agg.parsed : 0;
        const scanTrafficRisk = agg.scanRequests >= 20 || (agg.scanRequests >= 5 && scanShare >= 0.2)
          || probeClients >= 3 || (probeRequests >= 10 && probeShare >= 0.1);
        const heavyScanTrafficRisk = agg.scanRequests >= 50 || (agg.scanRequests >= 10 && scanShare >= 0.5)
          || (probeRequests >= 50 && probeShare >= 0.15) || probeShare >= 0.3;
        const scanTrafficText = "Viele Aufrufe wirken wie Admin-, Exploit- oder Proxy-Scans.";
        const botReliability = isLegacyArchive ? "limited" : (heavyScanTrafficRisk ? "limited" : (agg.suspiciousClients > 0 || scanTrafficRisk ? "medium" : "high"));
        const isEdgeLog = edgeKinds.has(agg.formatKind) || userSaysEdgeLog;
        const manualOriginCacheRisk = userSaysCache && !userSaysEdgeLog && (userSaysOriginLog || !edgeKinds.has(agg.formatKind));
        const originCacheRisk = !!((proxyKind && !isEdgeLog) || manualOriginCacheRisk);
        const cacheRisk = originCacheRisk || userSaysCache ? "elevated" : "normal";
        const conflicts = [];
        const addConflict = (id, severity, text, check, blocks = []) => conflicts.push({ id, severity, text, check, blocks });
        if (overall && overall.coverage !== null && overall.coverage > 110 && originCacheRisk) {
          addConflict(
            "ga4_above_server_with_cache_risk",
            "medium",
            "Google Analytics liegt über der Server-Datei, gleichzeitig kann ein Cache Aufrufe vor dieser Datei abfangen.",
            "Prüfen, ob Cloudflare oder ein anderer Cache vor der Website sitzt.",
            ["complete_server_pageviews", "tracking_loss_claim"]
          );
        }
        if (overall && hostReliability === "limited") {
          addConflict(
            "ga4_compare_with_multiple_websites",
            "high",
            "Google Analytics wird mit einer Server-Datei verglichen, die mehrere Websites oder Subdomains enthält.",
            "Website-Filter setzen und erneut auswerten.",
            ["ga4_decision"]
          );
        }
        if (overall && ga4Validation.unmatchedRows > 0 && ga4Validation.unmatchedShare >= 0.5) {
          addConflict(
            "ga4_pages_missing_in_server",
            "high",
            `${format(ga4Validation.unmatchedRows)} Google-Analytics-Seiten haben keinen Treffer in der Server-Datei.`,
            "Prüfen, ob Google-Analytics-Zeitraum, Website und Seitenauswahl wirklich zur Server-Datei passen.",
            ["ga4_decision"]
          );
        }
        if (overall && ga4Validation.duplicateCount > 0) {
          addConflict(
            "ga4_duplicate_pages",
            "medium",
            "Google Analytics enthält dieselbe Seite mehrfach. ServerStory summiert diese Zeilen, aber der Export sollte geprüft werden.",
            "Doppelte Google-Analytics-Zeilen entfernen oder den Export nach Seite zusammenfassen.",
            ["ga4_decision"]
          );
        }
        if (overall && ga4MetricMismatch) {
          addConflict(
            "ga4_metric_not_pageviews",
            "high",
            "Die eingetragene Google-Analytics-Zahl ist als Nutzer oder Sitzungen markiert. Für den Seitenvergleich braucht ServerStory Seitenaufrufe.",
            "Google Analytics neu exportieren: Seitenaufrufe/Views nach Seite verwenden.",
            ["ga4_decision", "tracking_loss_claim"]
          );
        }
        if (ga4Conversions !== null && config.hasSuccessUrl && ga4Conversions > agg.successRaw) {
          addConflict(
            "ga4_purchases_exceed_server_success_page",
            "high",
            "Google Analytics meldet mehr Käufe, als die Server-Datei Aufrufe der Kauf-/Danke-Seite enthält.",
            "Prüfen, ob Google Analytics eine andere Kaufdefinition, einen anderen Zeitraum oder eine andere Website nutzt.",
            ["purchase_comparison"]
          );
        }
        if (recognitionRate < 0.95 && overall) {
          addConflict(
            "ga4_compare_with_unread_rows",
            pageviewReliability === "limited" ? "high" : "medium",
            "Ein Teil der Server-Datei konnte nicht gelesen werden, trotzdem werden Google-Analytics-Zahlen verglichen.",
            "Exportformat prüfen und Vergleich danach erneut auswerten.",
            ["ga4_decision", "complete_server_pageviews"]
          );
        }
        if (agg.maxGapMs >= 6 * 60 * 60 * 1000) {
          addConflict(
            "large_time_gap",
            "medium",
            "Die Server-Datei enthält eine große zeitliche Lücke.",
            "Prüfen, ob im Export Stunden oder Teil-Dateien fehlen.",
            ["complete_time_range"]
          );
        }
        const durationHours = agg.minTime && agg.maxTime ? (agg.maxTime - agg.minTime) / 3600000 : 0;
        const filterShare = agg.total ? (agg.filtered + agg.unrecognized) / agg.total : 0;
        const exportReasons = [
          ...(!agg.minTime || !agg.maxTime ? [{ level: "limited", text: "Zeitraum konnte aus der Datei nicht sicher gelesen werden.", check: "Export mit Zeitstempeln verwenden." }] : []),
          ...(durationHours > 0 && durationHours < 1 ? [{ level: "medium", text: "Der Export deckt weniger als eine Stunde ab.", check: "Prüfen, ob der gewünschte Zeitraum vollständig exportiert wurde." }] : []),
          ...(agg.maxGapMs >= 6 * 60 * 60 * 1000 ? [{ level: "medium", text: `Große Lücke von ${Math.round(agg.maxGapMs / 3600000)} Stunden gefunden.`, check: "Prüfen, ob im Export Stunden oder Teil-Dateien fehlen." }] : []),
          ...(userSaysIncompleteExport ? [{ level: "limited", text: "Du hast angegeben, dass der Export vermutlich nicht vollständig ist.", check: "Vollständigen Zeitraum oder alle Teil-Dateien exportieren." }] : []),
          ...(hostFilterUnverifiable ? [{ level: "medium", text: "Der Website-Filter konnte für einen Teil der Zeilen nicht geprüft werden, weil dort keine Website-Adresse steht.", check: "Logformat mit Host-Spalte oder passender vHost-Datei exportieren." }] : []),
          ...(hosts.total > 1 && !hostFilterRequested ? [{ level: "medium", text: "Mehrere Websites oder Subdomains in derselben Datei.", check: "Website-Filter setzen oder passende Datei exportieren." }] : []),
          ...(agg.pathCountCapped ? [{ level: "medium", text: "Sehr viele unterschiedliche Seitenpfade gefunden; die Detailtabelle wurde begrenzt.", check: "Kleineren Zeitraum oder weniger Query-Varianten auswerten." }] : []),
          ...(agg.queryVariantCapped ? [{ level: "medium", text: "Sehr viele Query-Varianten gefunden; Varianten-Details wurden begrenzt.", check: "Nur wirklich relevante Adress-Zusätze behalten." }] : []),
          ...(originCacheRisk ? [{ level: "medium", text: userSaysCache ? "Du hast angegeben, dass ein Cache oder Schutzdienst vor der Website sitzt. Diese Server-Datei kann dadurch Aufrufe verpassen." : "Cache oder Proxy kann Aufrufe vor dieser Server-Datei abfangen.", check: "Prüfen, ob eine Cloudflare-/CDN-Datei verfügbar ist." }] : []),
          ...(isLegacyArchive ? [{ level: "medium", text: "Altes Archivformat ohne Browserkennung erkannt.", check: "Besucher-, Bot- und Conversion-Aussagen nur als grobe Plausibilitätswerte nutzen." }] : []),
          ...(heavyScanTrafficRisk ? [{ level: "limited", text: scanTrafficText, check: "Log mit Security-/Scan-Traffic getrennt von Besucher-Traffic auswerten." }] : (scanTrafficRisk ? [{ level: "medium", text: scanTrafficText, check: "Prüfen, ob die Datei Angriffsscans oder Admin-Traffic enthält." }] : [])),
          ...(recognitionRate < 0.8 ? [{ level: "limited", text: `Nur ${percent(recognitionRate * 100)} der Datei konnte gelesen werden.`, check: "Exportformat prüfen." }] : (recognitionRate < 0.95 ? [{ level: "medium", text: `${percent(recognitionRate * 100)} der Datei wurde gelesen.`, check: "Exportformat prüfen." }] : [])),
          ...(filterShare >= 0.75 ? [{ level: "limited", text: "Sehr viele Zeilen wurden aussortiert.", check: "Prüfen, ob die Datei wirklich Besucheraufrufe enthält." }] : (filterShare >= 0.5 ? [{ level: "medium", text: "Viele Zeilen wurden aussortiert.", check: "Filtergründe prüfen." }] : []))
        ];
        const exportCompletenessReliability = exportReasons.some((reason) => reason.level === "limited") ? "limited" : (exportReasons.length ? "medium" : "high");
        const exportCompleteness = {
          reliability: exportCompletenessReliability,
          reasons: exportReasons.map((reason) => reason.text),
          recommendedChecks: [...new Set(exportReasons.map((reason) => reason.check).filter(Boolean))],
          durationHours: Math.round(durationHours * 10) / 10,
          maxGapHours: agg.maxGapMs ? Math.round(agg.maxGapMs / 3600000) : 0,
          filterShare,
          recognitionRate
        };
        const ga4DecisionBlocked = conflicts.some((conflict) => conflict.blocks.includes("ga4_decision"));
        const evidence = {
          pageViews: {
            type: originCacheRisk ? "lower_bound" : "measured",
            reliability: pageviewReliability,
            canAnswer: pageviewReliability !== "limited",
            reason: originCacheRisk
              ? "Die Datei kommt wahrscheinlich vom Server hinter Cache/CDN. Gecachte Aufrufe koennen fehlen."
              : (pageviewReliability === "limited" ? "Zu viel der Datei konnte nicht sicher gelesen werden." : "Seitenaufrufe wurden aus lesbaren Serverzeilen gezaehlt.")
          },
          visits: {
            type: proxyKind && !config.useXff ? "not_determinable" : "estimated",
            reliability: visitorReliability,
            canAnswer: !(proxyKind && !config.useXff),
            range: { low: visitorLow, high: visitorHigh },
            reason: proxyKind && !config.useXff
              ? "Diese Datei zeigt vor allem Proxy-/CDN-Adressen. Echte Besucher sind damit nicht verlaesslich bestimmbar."
              : (isLegacyArchive ? "Altes Archivformat ohne Browserkennung. Besucher werden nur aus Host und 30-Minuten-Fenster geschaetzt."
              : "Besucher werden aus Adresse, Browserkennung und 30-Minuten-Fenster geschaetzt."
              )
          },
          conversions: {
            type: config.hasSuccessUrl ? (config.orderParam ? "measured" : "estimated") : "not_determinable",
            reliability: conversionReliability,
            canAnswer: !!config.hasSuccessUrl,
            reason: config.hasSuccessUrl
              ? (isLegacyArchive ? "Conversions werden im alten Archivformat nur ueber Pfad und Zeitfenster erkannt; Browserkennung fehlt." : (config.orderParam ? "Conversions werden ueber Erfolgs-URL und Order-ID dedupliziert." : "Conversions werden ueber Erfolgs-URL und Zeitfenster dedupliziert; Reloads koennen stoeren."))
              : "Ohne Danke-Seite oder Conversion-Muster kann ServerStory keine Conversions bestimmen."
          },
          ga4: {
            type: overall && !lastGa4Import.warning && hostReliability !== "limited" && !ga4DecisionBlocked ? "comparison" : "not_determinable",
            reliability: ga4Reliability,
            canAnswer: !!(overall && !lastGa4Import.warning && hostReliability !== "limited" && !ga4DecisionBlocked),
            reason: lastGa4Import.warning || (!overall
              ? "Keine brauchbaren Google-Analytics-Seitenzahlen eingetragen."
              : (hostReliability === "limited"
                ? "Die Datei enthält mehrere Websites. Ohne Filter ist der Google-Analytics-Vergleich unsicher."
                : (ga4DecisionBlocked ? conflicts.find((conflict) => conflict.blocks.includes("ga4_decision")).text : "Google Analytics wurde mit denselben Seitenadressen aus der Server-Datei verglichen.")))
          },
          hostScope: {
            type: hosts.total ? "measured" : "not_available",
            reliability: hostReliability,
            canAnswer: hostReliability !== "limited",
            reason: hostFilterUnverifiable
              ? "Der Website-Filter konnte nicht fuer alle Zeilen geprueft werden, weil Host-Angaben fehlen."
              : (hostReliability === "limited" ? "Mehrere Websites/Subdomains erkannt; ohne Filter koennen fremde Seiten enthalten sein." : "Die Datei wirkt auf eine Website begrenzt.")
          },
          botAnomaly: {
            type: "estimated",
            reliability: botReliability,
            canAnswer: !agg.trackingCapped,
            reason: agg.trackingCapped
              ? "Die Schutzgrenze fuer sehr grosse Dateien begrenzt Bot- und Auffaelligkeits-Hinweise."
              : (scanTrafficRisk
                ? "Admin-, Exploit- oder Proxy-Scan-Muster gefunden."
                : (agg.suspiciousClients ? "Auffaellige Muster mit vielen Aufrufen fast ohne normale Seitenbestandteile gefunden." : "Keine starke Bot-/Monitoring-Auffaelligkeit sichtbar."))
          }
        };
        const claims = {
          pageViews: {
            claimAllowed: pageviewReliability !== "limited",
            confidence: pageviewReliability,
            statement: originCacheRisk
              ? "Seitenaufrufe sind nur ein Mindestwert, weil ein Cache davor sitzen kann."
              : (pageviewReliability === "high" ? "Seitenaufrufe sind gut nutzbar." : "Seitenaufrufe sind nur mit Vorsicht nutzbar."),
            blockingReasons: [
              ...(exportCompleteness.reliability === "limited" ? exportCompleteness.reasons : []),
              ...(pageviewReliability === "limited" ? ["Zu viel der Datei konnte nicht gelesen werden."] : []),
              ...(scanTrafficRisk ? [scanTrafficText] : []),
              ...(originCacheRisk ? ["Cache/CDN kann Aufrufe vor dieser Server-Datei abfangen."] : []),
              ...conflicts.filter((conflict) => conflict.blocks.includes("complete_server_pageviews")).map((conflict) => conflict.text)
            ],
            recommendedChecks: [
              ...exportCompleteness.recommendedChecks,
              ...(pageviewReliability !== "high" ? ["Exportformat prüfen."] : []),
              ...(scanTrafficRisk ? ["Security-/Scan-Traffic getrennt vom Besucher-Traffic auswerten."] : []),
              ...(originCacheRisk ? ["Prüfen, ob Cloudflare oder ein anderer Cache davor sitzt."] : []),
              ...conflicts.filter((conflict) => conflict.blocks.includes("complete_server_pageviews") || conflict.blocks.includes("complete_time_range")).map((conflict) => conflict.check)
            ],
            forbiddenConclusions: exportCompleteness.reliability === "limited" || pageviewReliability === "limited" || scanTrafficRisk
              ? ["Keine harte Aussage über die Gesamtzahl der Seitenaufrufe treffen."]
              : (originCacheRisk || conflicts.some((conflict) => conflict.blocks.includes("complete_server_pageviews")) ? ["Nicht behaupten, dass die Server-Datei alle Aufrufe enthält."] : [])
          },
          visits: {
            claimAllowed: !(proxyKind && !config.useXff),
            confidence: visitorReliability,
            statement: proxyKind && !config.useXff
              ? "Besucher sind mit diesen Daten nicht verlässlich bestimmbar."
              : (visitorReliability === "high" ? "Besucherzahl ist gut nutzbar." : "Besucherzahl ist nur als Spanne nutzbar."),
            blockingReasons: [
              ...(exportCompleteness.reliability === "limited" ? ["Der Export ist nicht vollständig genug für feste Besucher-Aussagen."] : []),
              ...(isLegacyArchive ? ["Altes Archivformat ohne Browserkennung; Besucher werden nur grob aus Host und Zeitfenster abgeleitet."] : []),
              ...(proxyKind && !config.useXff ? ["Proxy oder Cache verdeckt echte Besucheradressen."] : []),
              ...(scanTrafficRisk ? [scanTrafficText] : []),
              ...(chronologyIssue ? ["Die Datei ist nicht sauber zeitlich sortiert."] : []),
              ...(config.useXff && visitorReliability === "limited" ? [agg.xffUsed > 0 && agg.xffExactUsed !== agg.xffUsed ? "Das Proxy-Feld wurde nicht feldgenau erkannt; Besucheradressen sind damit nur eingeschränkt vertrauenswürdig." : "Das Proxy-Feld enthält keine durchgehend brauchbaren Besucheradressen."] : [])
            ],
            recommendedChecks: [
              ...exportCompleteness.recommendedChecks,
              ...(isLegacyArchive ? ["Besucherzahl bei alten Archivlogs nur als grobe Plausibilitätsgröße nutzen."] : []),
              ...(proxyKind && !config.useXff ? ["Echte Besucheradresse hinter Proxy verwenden, falls der Proxy vertrauenswürdig ist."] : []),
              ...(scanTrafficRisk ? ["Security-/Scan-Traffic getrennt vom Besucher-Traffic auswerten."] : []),
              ...(chronologyIssue ? ["Logdateien vor der Analyse zeitlich sortieren oder einzeln auswerten."] : [])
            ],
            forbiddenConclusions: visitorReliability === "limited" || scanTrafficRisk
              ? ["Keine feste Besucherzahl behaupten.", "Keine Conversion-Rate auf Basis dieser Besucherzahl entscheiden."]
              : (visitorReliability === "medium" ? ["Besucherzahl nicht als exakten Wert behandeln."] : [])
          },
          ga4: {
            claimAllowed: !!(overall && !lastGa4Import.warning && hostReliability !== "limited" && pageviewReliability !== "limited" && exportCompleteness.reliability !== "limited" && !ga4DecisionBlocked),
            confidence: ga4Reliability,
            statement: overall ? "Google-Analytics-Vergleich ist nur mit gleicher Website, gleichem Zeitraum und gleichen Seiten belastbar." : "Google-Analytics-Vergleich nicht vorhanden.",
            blockingReasons: [
              ...(exportCompleteness.reliability === "limited" ? ["Der Server-Export ist nicht vollständig genug für einen belastbaren Google-Analytics-Vergleich."] : []),
              ...(isLegacyArchive ? ["Altes Archivformat ohne Browserkennung; Google-Analytics-Vergleiche sind nur eingeschränkt belastbar."] : []),
              ...(ga4MetricMismatch ? ["Die eingetragene Google-Analytics-Zahl ist nicht als Seitenaufruf-Zahl bestätigt."] : []),
              ...(lastGa4Import.warning ? [lastGa4Import.warning] : []),
              ...(!overall ? ["Keine Google-Analytics-Seitenzahlen eingetragen."] : []),
              ...(scanTrafficRisk ? ["Die Server-Datei enthält auffälligen Security-/Scan-Traffic."] : []),
              ...(hostFilterUnverifiable ? ["Der Website-Filter konnte wegen fehlender Host-Angaben nicht sicher angewendet werden."] : []),
              ...(hosts.total > 1 && !hostFilterRequested ? ["Die Server-Datei enthält mehrere Websites oder Subdomains."] : []),
              ...(pageviewReliability === "limited" ? ["Die Server-Datei wurde nicht zuverlässig genug gelesen."] : []),
              ...conflicts.filter((conflict) => conflict.blocks.includes("ga4_decision") || conflict.blocks.includes("tracking_loss_claim")).map((conflict) => conflict.text)
            ],
            recommendedChecks: [
              ...exportCompleteness.recommendedChecks,
              ...(isLegacyArchive ? ["Bei Archivlogs keinen modernen Google-Analytics-Trackingverlust ableiten."] : []),
              "Zeitraum in Google Analytics und Server-Datei abgleichen.",
              "Prüfen, ob wirklich Seitenaufrufe aus Google Analytics eingetragen wurden.",
              ...(ga4MetricMismatch ? ["Google Analytics neu exportieren: Seitenaufrufe/Views nach Seite verwenden."] : []),
              ...(scanTrafficRisk ? ["Security-/Scan-Traffic vor dem Google-Analytics-Vergleich getrennt prüfen."] : []),
              ...(hostReliability === "limited" ? ["Website-Filter setzen."] : []),
              ...conflicts.filter((conflict) => conflict.blocks.includes("ga4_decision") || conflict.blocks.includes("tracking_loss_claim")).map((conflict) => conflict.check)
            ],
            forbiddenConclusions: !(overall && !lastGa4Import.warning && hostReliability !== "limited" && pageviewReliability !== "limited" && exportCompleteness.reliability !== "limited" && !ga4DecisionBlocked)
              ? ["Keine Budget- oder Tracking-Entscheidung aus dem Google-Analytics-Vergleich ableiten."]
              : ["Google-Analytics-Abweichung nicht ohne Zeitraum-, Website- und Cache-Prüfung als Tracking-Verlust verkaufen."]
          },
          hostScope: {
            claimAllowed: hostReliability !== "limited",
            confidence: hostReliability,
            statement: hostFilterUnverifiable
              ? "Der Website-Filter konnte nicht für alle Zeilen geprüft werden."
              : (hostReliability === "limited" ? "Die Datei enthält mehrere Websites oder Subdomains." : "Die Datei wirkt auf eine Website begrenzt."),
            blockingReasons: hostFilterUnverifiable
              ? ["Host-Angaben fehlen in einem Teil der Datei; der Website-Filter ist dort nicht prüfbar."]
              : (hostReliability === "limited" ? ["Mehrere Websites/Subdomains ohne Filter erkannt."] : []),
            recommendedChecks: hostFilterUnverifiable
              ? ["Logformat mit Host-Spalte oder passende vHost-Datei exportieren."]
              : (hostReliability === "limited" ? ["Website-Filter setzen und erneut auswerten."] : []),
            forbiddenConclusions: hostReliability === "limited" ? ["Nicht behaupten, dass die Analyse nur eine Website zeigt."] : []
          },
          conversions: {
            claimAllowed: !!config.hasSuccessUrl,
            confidence: conversionReliability,
            statement: config.hasSuccessUrl
              ? (conversionReliability === "high" ? "Käufe sind gut nutzbar." : "Käufe sind nur mit Vorsicht nutzbar.")
              : "Käufe sind ohne Kauf-/Danke-Seite nicht bestimmbar.",
            blockingReasons: [
              ...(!config.hasSuccessUrl ? ["Keine Kauf-/Danke-Seite angegeben."] : []),
              ...(isLegacyArchive ? ["Altes Archivformat ohne Browserkennung; Conversion-Deduplizierung ist eingeschränkt."] : []),
              ...(conversionReliability === "medium" ? ["Ohne Bestellnummer können Reloads oder Mehrfachaufrufe stören."] : []),
              ...conflicts.filter((conflict) => conflict.blocks.includes("purchase_comparison")).map((conflict) => conflict.text)
            ],
            recommendedChecks: [
              ...(!config.hasSuccessUrl ? ["Kauf-/Danke-Seite angeben."] : []),
              ...(isLegacyArchive ? ["Käufe aus Archivlogs nur als Plausibilitätswert nutzen."] : []),
              ...(conversionReliability === "medium" ? ["Bestellnummer-Parameter angeben, falls vorhanden."] : []),
              ...conflicts.filter((conflict) => conflict.blocks.includes("purchase_comparison")).map((conflict) => conflict.check)
            ],
            forbiddenConclusions: !config.hasSuccessUrl
              ? ["Keine Aussage über Käufe treffen."]
              : (conflicts.some((conflict) => conflict.blocks.includes("purchase_comparison")) ? ["Keinen Kaufvergleich entscheiden, bevor die Google-Analytics-Definition geprüft ist."] : [])
          }
        };
        const claimEvidence = {
          pageViews: [
            "Lesbare Server- oder CDN-Zeilen mit Zeitstempel",
            "Gewünschter Zeitraum vollständig exportiert",
            "Bei Cache/CDN: Edge-Log statt nur Origin-Log"
          ],
          visits: [
            "Echte Client-IP oder vertrauenswürdiges Proxy-Feld",
            "Zeitlich sortierte Logzeilen",
            "Keine dominante Proxy-/Loadbalancer-Adresse"
          ],
          ga4: [
            "Google-Analytics-Seitenaufrufe, keine Nutzer- oder Sitzungsmetrik",
            "Gleicher Zeitraum, gleiche Website, gleiche Seitenauswahl",
            "Server-Export ohne harte Vollständigkeits-Blocker"
          ],
          hostScope: [
            "Eine Website/Subdomain oder gesetzter Website-Filter",
            "Keine fremden Hosts im analysierten Datensatz"
          ],
          conversions: [
            "Kauf-/Danke-Seite oder Conversion-Muster",
            "Bestellnummer oder anderes Deduplizierungsmerkmal für hohe Sicherheit",
            "Gleiche Kaufdefinition bei Google-Analytics-Vergleich"
          ]
        };
        const dedupe = (items) => [...new Set((items || []).filter(Boolean))];
        const evidenceFailures = {
          pageViews: dedupe([
            ...(!agg.minTime || !agg.maxTime ? ["Der Zeitraum der Datei ist nicht sicher lesbar."] : []),
            ...(exportCompleteness.reliability === "limited" ? exportCompleteness.reasons : []),
            ...(pageviewReliability === "limited" ? ["Zu viele Zeilen konnten nicht sicher gelesen werden."] : []),
            ...(scanTrafficRisk ? [scanTrafficText] : []),
            ...(originCacheRisk ? ["Die Datei kommt wahrscheinlich vom Origin-Server hinter Cache/CDN; gecachte Aufrufe können fehlen."] : []),
            ...conflicts.filter((conflict) => conflict.blocks.includes("complete_server_pageviews") || conflict.blocks.includes("complete_time_range")).map((conflict) => conflict.text)
          ]),
          visits: dedupe([
            ...(exportCompleteness.reliability === "limited" ? ["Der Export ist nicht vollständig genug für feste Besucher-Aussagen."] : []),
            ...(proxyKind && !config.useXff ? ["Proxy oder Cache verdeckt echte Besucheradressen."] : []),
            ...(isLegacyArchive ? ["Altes Archivformat ohne Browserkennung; Besucher-Sessions sind nur grob ableitbar."] : []),
            ...(scanTrafficRisk ? [scanTrafficText] : []),
            ...(config.useXff && visitorReliability === "limited" ? [agg.xffUsed > 0 && agg.xffExactUsed !== agg.xffUsed ? "Das Proxy-Feld wurde nicht feldgenau erkannt; Besucheradressen sind damit nur eingeschränkt vertrauenswürdig." : "Das Proxy-Feld enthält keine durchgehend brauchbaren Besucheradressen."] : []),
            ...(chronologyIssue ? ["Die Datei ist nicht sauber zeitlich sortiert."] : [])
          ]),
          ga4: dedupe([
            ...(!overall ? ["Keine Google-Analytics-Seitenaufrufe für einen Vergleich vorhanden."] : []),
            ...(lastGa4Import.warning ? [lastGa4Import.warning] : []),
            ...(ga4InputProblem ? ["Der Google-Analytics-Export enthält Duplikate oder viele Seiten ohne Treffer in der Server-Datei."] : []),
            ...(ga4MetricMismatch ? ["Die eingetragene Google-Analytics-Zahl ist als Nutzer oder Sitzungen markiert, nicht als Seitenaufrufe."] : []),
            ...(hostReliability === "limited" ? ["Die Server-Datei enthält mehrere Websites oder Subdomains."] : []),
            ...(pageviewReliability === "limited" ? ["Die Server-Datei wurde nicht zuverlässig genug gelesen."] : []),
            ...(exportCompleteness.reliability === "limited" ? ["Der Server-Export ist nicht vollständig genug für einen belastbaren Google-Analytics-Vergleich."] : []),
            ...(isLegacyArchive ? ["Altes Archivformat ohne Browserkennung; moderner Google-Analytics-Vergleich ist nur eingeschränkt belastbar."] : []),
            ...(scanTrafficRisk ? ["Die Server-Datei enthält auffälligen Security-/Scan-Traffic."] : []),
            ...(originCacheRisk ? ["Cache/CDN kann Server-Aufrufe vor dieser Datei abfangen; der Google-Analytics-Vergleich ist nur eingeschränkt nutzbar."] : []),
            ...conflicts.filter((conflict) => conflict.blocks.includes("ga4_decision") || conflict.blocks.includes("tracking_loss_claim")).map((conflict) => conflict.text)
          ]),
          hostScope: dedupe([
            ...(hostFilterUnverifiable ? ["Der Website-Filter konnte wegen fehlender Host-Angaben nicht sicher angewendet werden."] : []),
            ...(hosts.total > 1 && !hostFilterRequested ? ["Mehrere Websites/Subdomains ohne Filter erkannt."] : [])
          ]),
          conversions: dedupe([
            ...(!config.hasSuccessUrl ? ["Keine Kauf-/Danke-Seite angegeben."] : []),
            ...(conversionReliability === "medium" ? ["Ohne Bestellnummer können Reloads oder Mehrfachaufrufe stören."] : []),
            ...(isLegacyArchive ? ["Altes Archivformat ohne Browserkennung; Conversion-Sessions sind nur eingeschränkt deduplizierbar."] : []),
            ...(visitorReliability === "limited" ? ["Eine Conversion-Rate auf Besucherbasis ist nicht belastbar, weil die Besucherzahl unsicher ist."] : []),
            ...(scanTrafficRisk ? [scanTrafficText] : []),
            ...conflicts.filter((conflict) => conflict.blocks.includes("purchase_comparison")).map((conflict) => conflict.text)
          ])
        };
        const claimMatrix = Object.fromEntries(Object.entries(claims).map(([key, claim]) => {
          const status = !claim.claimAllowed
            ? "blocked"
            : (claim.confidence === "high" && !(claim.blockingReasons || []).length && !(claim.forbiddenConclusions || []).length && !(evidenceFailures[key] || []).length ? "allowed" : "limited");
          const reason = status === "allowed"
            ? claim.statement
            : dedupe([...(evidenceFailures[key] || []), ...(claim.blockingReasons || []), ...(claim.forbiddenConclusions || []), claim.statement])[0];
          return [key, {
            status,
            allowed: status === "allowed",
            limited: status === "limited",
            blocked: status === "blocked",
            confidence: claim.confidence,
            statement: claim.statement,
            reason,
            evidenceFailures: evidenceFailures[key] || [],
            blockingReasons: claim.blockingReasons,
            requiredEvidence: claimEvidence[key] || [],
            recommendedChecks: dedupe(claim.recommendedChecks || []),
            forbiddenConclusions: dedupe(claim.forbiddenConclusions || [])
          }];
        }));
        const claimsWithMatrix = Object.fromEntries(Object.entries(claims).map(([key, claim]) => [key, {
          ...claim,
          status: claimMatrix[key].status,
          allowed: claimMatrix[key].allowed,
          reason: claimMatrix[key].reason,
          evidenceFailures: claimMatrix[key].evidenceFailures,
          requiredEvidence: claimMatrix[key].requiredEvidence
        }]));
        const decisionReadiness = Object.fromEntries(Object.entries(claimMatrix).map(([key, claim]) => {
          const missingEvidence = dedupe([
            ...(claim.evidenceFailures || []),
            ...(claim.blockingReasons || []),
            ...(claim.requiredEvidence || []).filter((item) => claim.status !== "allowed" && !(claim.evidenceFailures || []).length)
          ]).slice(0, 6);
          const hardDecisionRisk = claim.status === "blocked" || missingEvidence.some((item) => /nicht vollständig|Zu viele Einträge|Zu viele Zeilen|nicht zuverlässig genug/i.test(item));
          return [key, {
            canUseForDecision: claim.status === "allowed",
            decisionRisk: claim.status === "allowed" ? "low" : (hardDecisionRisk ? "high" : "medium"),
            plainLanguageWarning: claim.status === "allowed"
              ? "Diese Zahl ist für eine erste Entscheidung nutzbar."
              : (claim.status === "limited" ? "Diese Zahl nur als vorsichtigen Richtwert verwenden." : "Diese Zahl nicht als Entscheidungsgrundlage verwenden."),
            reason: claim.reason,
            missingEvidence
          }];
        }));
        const auditProtocol = {
          dataBasis: {
            format: agg.formatKind,
            rows: agg.total,
            parsed: agg.parsed,
            kept: agg.kept,
            recognitionRate,
            timeRange: {
              from: agg.minTime ? new Date(agg.minTime).toISOString() : null,
              to: agg.maxTime ? new Date(agg.maxTime).toISOString() : null,
              maxGapHours: agg.maxGapMs ? Math.round(agg.maxGapMs / 3600000) : 0
            },
            hostCount: hosts.total,
            hostFilterRequested,
            hostFilterNoHost,
            proxyKind: proxyKind || "none",
            scanRequests: agg.scanRequests || 0,
            probeRequests,
            probeClients,
            calibration,
            exportCompleteness: exportCompleteness.reliability
          },
          allowedClaims: Object.entries(claimMatrix).filter(([, claim]) => claim.status === "allowed").map(([key]) => key),
          limitedClaims: Object.entries(claimMatrix).filter(([, claim]) => claim.status === "limited").map(([key]) => key),
          blockedClaims: Object.entries(claimMatrix).filter(([, claim]) => claim.status === "blocked").map(([key]) => key),
          evidenceFailures,
          requiredChecks: dedupe(Object.values(claimMatrix).flatMap((claim) => claim.recommendedChecks || [])),
          cannotSay: dedupe(Object.values(claimMatrix).flatMap((claim) => claim.forbiddenConclusions || []))
        };
        return {
          total: agg.total, dataRows: agg.dataRows, parsed: agg.parsed, unrecognized: agg.unrecognized, meta: agg.meta || 0,
          kept: agg.kept, pageViews: agg.pageViews, filtered: agg.filtered, reasons: agg.reasons,
          visits: agg.visits, success: agg.success, successRaw: agg.successRaw,
          adVisitors: agg.adVisitors, adSuccess: agg.adSuccess, timeRegressions: agg.timeRegressions,
          formatKind: agg.formatKind, formatChecked: agg.formatChecked, formatCombined: agg.formatCombined,
          xffUsed: agg.xffUsed, xffMissing: agg.xffMissing, xffPrivate: agg.xffPrivate, xffExactUsed: agg.xffExactUsed || 0,
          legacyNoUserAgent: agg.legacyNoUserAgent || 0,
          suspiciousClients: agg.suspiciousClients,
          scanRequests: agg.scanRequests || 0,
          scanShare,
          probeRequests,
          probeClients,
          probeShare,
          trackingCapped: agg.trackingCapped,
          pathCountCapped: !!agg.pathCountCapped,
          queryVariantCapped: !!agg.queryVariantCapped,
          queryVariantCount: agg.queryVariantCount || 0,
          hostFilterRequested,
          hostFilterNoHost,
          hostFilterUnverifiable,
          minTime: agg.minTime, maxTime: agg.maxTime, maxGapMs: agg.maxGapMs,
          visitorRange: { low: visitorLow, high: visitorHigh },
          hosts,
          evidence,
          claims: claimsWithMatrix,
          claimMatrix,
          decisionReadiness,
          evidenceFailures,
          auditProtocol,
          conflicts,
          ga4Validation,
          calibration,
          exportCompleteness,
          ga4Import: lastGa4Import,
          diagnostics: { recognitionRate, pageviewReliability, visitorReliability, ga4Reliability, conversionReliability, cacheRisk, chronologyIssue, botReliability, hostReliability, exportCompletenessReliability, trackingReliability: (agg.trackingCapped || agg.pathCountCapped || agg.queryVariantCapped) ? "medium" : "high", scanTrafficRisk },
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
        const labels = { high: "Gut nutzbar", medium: "Mit Vorsicht", limited: "Nicht verlässlich", none: "Nicht geprüft" };
        const el = id(elId);
        el.className = `quality-badge ${state || "none"}`;
        el.textContent = labels[state] || labels.none;
      }
      function setQualityReason(elId, text) {
        const el = id(elId + "-reason");
        if (!el) return;
        el.textContent = text || "";
      }
      function unique(items) {
        return [...new Set(items.filter(Boolean))];
      }
      function qualityReason(data, metric, hasGa4) {
        if (metric === "views") {
          const recognized = percent(data.diagnostics.recognitionRate * 100);
          if (data.evidence && data.evidence.pageViews && data.evidence.pageViews.type === "lower_bound") return `Nur Mindestwert: Deine Logdatei sieht wahrscheinlich nicht alle Aufrufe, weil ein Cache/CDN dazwischen sitzen kann.`;
          if (data.diagnostics.pageviewReliability === "high") return `Gut nutzbar: Die Datei wurde sauber gelesen (${recognized}).`;
          if (data.diagnostics.pageviewReliability === "medium") return `Nur Richtwert: ${recognized} der Datei wurde gelesen. Einzelne Einträge passen nicht zum erwarteten Format.`;
          return `Nicht entscheidungsfähig: Zu viele Einträge passen nicht zum erwarteten Format (${recognized} gelesen).`;
        }
        if (metric === "visits") {
          if (data.evidence && data.evidence.visits && data.evidence.visits.type === "not_determinable") return "Nicht verlässlich bestimmbar: Die Datei zeigt vor allem Proxy-/CDN-Adressen, nicht echte Besucher.";
          if (data.diagnostics.visitorReliability === "high") return data.xffUsed ? "Gut nutzbar: Echte Besucher-IPs aus einem feldgenau erkannten Proxy-Feld wurden genutzt." : "Gut nutzbar: Keine starke Proxy-Verzerrung sichtbar.";
          if (data.proxyKind) return "Nur Spanne: Proxy oder CDN erkannt. Besucher nicht als exakte Zahl lesen.";
          if (data.xffUsed && data.xffExactUsed !== data.xffUsed) return "Das Proxy-Feld wurde nicht feldgenau erkannt. Besucheradressen nur vorsichtig verwenden.";
          if (data.xffMissing || data.xffPrivate) return "Das Proxy-Feld enthält keine brauchbaren Besucher-IPs.";
          return "Nur Richtwert: Die Reihenfolge der Einträge oder die Besucher-Erkennung macht diese Zahl ungenauer.";
        }
        if (metric === "purchases") {
          if (!data.hasSuccessUrl) return "Keine Kauf-/Danke-Seite angegeben.";
          if (data.diagnostics.conversionReliability === "high") return data.ga4Conversions === null ? "Gut nutzbar: Kaufseite erkannt; doppelte Reloads werden reduziert." : "Gut nutzbar: Kaufseite erkannt und mit Google-Analytics-Käufen verglichen.";
          return "Nur Richtwert: Kaufseite erkannt, aber ohne Bestellnummer können Reloads die Zahl verzerren.";
        }
        if (metric === "ga4") {
          if (data.ga4Import && data.ga4Import.warning) return data.ga4Import.warning;
          if (!hasGa4) return "Keine Google-Analytics-Seitenzahlen eingetragen.";
          if (data.calibration && data.calibration.ga4MetricKind === "users_or_sessions") return "Für diesen Vergleich wurden Nutzer oder Sitzungen markiert. Bitte Seitenaufrufe aus Google Analytics verwenden.";
          if (data.evidence && data.evidence.ga4 && !data.evidence.ga4.canAnswer) return data.evidence.ga4.reason;
          if (data.diagnostics.ga4Reliability === "medium") return "Nur nach Gegencheck nutzbar: Zeitraum und Seitenauswahl müssen wirklich gleich sein; die Website muss ebenfalls passen.";
          return "Nicht entscheidungsfähig: Prüfe Zeitraum, Seiten und ob in Google Analytics wirklich Seitenaufrufe stehen.";
        }
        if (metric === "host") {
          if (data.hostFilterUnverifiable) return `${format(data.hostFilterNoHost)} Zeilen hatten keine Website-Adresse. Der Website-Filter konnte dort nicht geprüft werden.`;
          if (data.diagnostics.hostReliability === "limited") return `${format(data.hosts.total)} Domains/Subdomains gefunden. Ohne Filter können fremde Seiten mit drin sein.`;
          return "Gut nutzbar: Die Datei wirkt auf eine Website begrenzt.";
        }
        if (metric === "export") {
          if (data.calibration && data.calibration.exportComplete === "no") return "Du hast angegeben, dass der Export vermutlich nicht vollständig ist. Zahlen nur als Ausschnitt lesen.";
          if (!data.exportCompleteness || data.exportCompleteness.reliability === "high") return "Gut nutzbar: Zeitraum, Lesbarkeit und Filterquote wirken plausibel.";
          return data.exportCompleteness.reasons.slice(0, 2).join(" ");
        }
        if (metric === "bot") {
          if (data.scanRequests > 0 || data.probeRequests > 0) {
            const parts = [];
            if (data.scanRequests > 0) parts.push(`${format(data.scanRequests)} Aufrufe treffen bekannte Admin-/Exploit-Pfade`);
            if (data.probeRequests > 0) parts.push(`${format(data.probeRequests)} Aufrufe von ${format(data.probeClients)} Adressen mit Scanner-Muster`);
            return parts.join("; ") + ". Diese Datei nicht als sauberen Besucher-Traffic lesen.";
          }
          if (data.diagnostics.botReliability === "medium") return `${format(data.suspiciousClients)} auffällige Muster gefunden. Das kann Bot-, Monitoring- oder Scraper-Traffic sein.`;
          return data.reasons.bot ? `${format(data.reasons.bot)} klare Bot-Zeilen entfernt. Danach keine starke Auffälligkeit.` : "Keine starke Bot-/Monitoring-Auffälligkeit sichtbar.";
        }
        if (metric === "tracking") {
          if (data.pathCountCapped || data.queryVariantCapped) return "Sehr viele unterschiedliche Seiten oder Varianten gefunden. Hauptzahlen bleiben nutzbar, Detailtabellen wurden begrenzt.";
          if (data.diagnostics.trackingReliability === "medium") return "Interne Schutzgrenze erreicht. Hauptzahlen bleiben nutzbar, Detailsignale werden gröber.";
          return "Keine interne Schutzgrenze erreicht.";
        }
        return "";
      }
      function setPrecisionChecklist(data, hasGa4) {
        const item = (ok, text) => `<li class="${ok ? "ok" : "check"}"><span class="state">${ok ? "OK" : "Prüfen"}</span><span>${escapeHtml(text)}</span></li>`;
        const rows = [];
        rows.push(item(!!(data.minTime && data.maxTime), data.minTime && data.maxTime
          ? `Zeitraum in der Datei: ${formatDateTime(data.minTime)} bis ${formatDateTime(data.maxTime)}.`
          : "Der Zeitraum ist aus der Datei nicht sicher lesbar."));
        rows.push(item(data.diagnostics.hostReliability !== "limited", data.diagnostics.hostReliability !== "limited"
          ? "Die Datei wirkt auf eine Website begrenzt."
          : (data.hostFilterUnverifiable ? "Der Website-Filter konnte nicht für alle Zeilen geprüft werden." : `${format(data.hosts.total)} Domains/Subdomains gefunden. Filter setzen, wenn du nur eine Website prüfen willst.`)));
        rows.push(item(data.diagnostics.pageviewReliability !== "limited", `${percent(data.diagnostics.recognitionRate * 100)} der Datei wurde verstanden.`));
        rows.push(item(!hasGa4 || !(data.ga4Import && data.ga4Import.warning), hasGa4
          ? ((data.ga4Import && data.ga4Import.warning) || "Google-Analytics-Zahlen wurden gelesen. Zeitraum und Seitenauswahl müssen gleich sein.")
          : "Keine Google-Analytics-Seitenzahlen eingetragen."));
        rows.push(item(data.diagnostics.visitorReliability !== "limited", data.diagnostics.visitorReliability !== "limited"
          ? "Keine starke Proxy-Verzerrung bei Besuchern sichtbar."
          : "Proxy oder CDN kann die Besucherzahl verzerren. Seitenaufrufe stärker gewichten."));
        rows.push(item(!data.hasSuccessUrl || data.diagnostics.conversionReliability !== "medium", data.hasSuccessUrl
          ? qualityReason(data, "purchases", hasGa4)
          : "Keine Kauf-/Danke-Seite angegeben."));
        id("precision-checklist").innerHTML = rows.join("");
      }
      function renderClaimBox(data, hasGa4, hasConv) {
        const relevant = [
          data.claimMatrix.pageViews,
          data.claimMatrix.visits,
          ...(hasGa4 ? [data.claimMatrix.ga4] : []),
          data.claimMatrix.hostScope,
          ...(data.hasSuccessUrl || hasConv ? [data.claimMatrix.conversions] : [])
        ].filter(Boolean);
        const allowed = unique(relevant.filter((claim) => claim.status !== "blocked").map((claim) => claim.statement)).slice(0, 4);
        const forbidden = unique(relevant.flatMap((claim) => claim.forbiddenConclusions || [])).slice(0, 4);
        const checks = unique(relevant.flatMap((claim) => claim.recommendedChecks || [])).slice(0, 4);
        const listHtml = (items, fallback) => (items.length ? items : [fallback]).map((text) => `<li>${escapeHtml(text)}</li>`).join("");
        id("claim-allowed").innerHTML = listHtml(allowed, "Die Hauptzahlen als ersten Richtwert nutzen.");
        id("claim-forbidden").innerHTML = listHtml(forbidden, "Keine harte Entscheidung treffen, ohne Zeitraum und Website zu prüfen.");
        id("claim-checks").innerHTML = listHtml(checks, "Zeitraum, Website und Export kurz gegenprüfen.");
        id("claim-box").classList.remove("hidden");
      }
      function buildGuidedDiagnosis(data, hasGa4, hasConv) {
        const usable = [];
        const limits = [];
        const next = [];

        if (data.claimMatrix.pageViews.status === "allowed") usable.push("Seitenaufrufe als robuste Hauptzahl verwenden.");
        else if (data.claimMatrix.pageViews.status === "limited") limits.push("Seitenaufrufe nur als Richtwert lesen, weil Teile der Datei unsicher sind.");
        else limits.push("Keine feste Aussage zu Seitenaufrufen treffen.");

        if (data.claimMatrix.visits.status === "allowed") usable.push("Besuche als grobe Größenordnung verwenden.");
        else if (data.claimMatrix.visits.status === "limited") limits.push("Besuche nur als Spanne lesen, nicht als exakte Personenzahl.");
        else limits.push("Besuche mit dieser Datei nicht als Zahl behaupten.");

        if (data.hasSuccessUrl && data.claimMatrix.conversions.status === "allowed") usable.push("Käufe über die Danke-Seite prüfen.");
        else if (data.hasSuccessUrl) limits.push("Käufe vorsichtig lesen, wenn Reloads oder fehlende Bestellnummern möglich sind.");

        if (hasGa4 && data.claimMatrix.ga4.status === "allowed") usable.push("Google Analytics mit den Server-Zahlen vergleichen.");
        else if (hasGa4) limits.push("Google-Analytics-Vergleich erst nach Gegencheck für Zeitraum, Website und Seiten nutzen.");

        if (data.diagnostics.hostReliability === "limited") {
          limits.push(data.hostFilterUnverifiable ? "Der Website-Filter konnte nicht für alle Zeilen geprüft werden." : "Die Datei enthält mehrere Websites oder Subdomains.");
          next.push(data.hostFilterUnverifiable ? "Logformat mit Website-Adresse exportieren oder passende vHost-Datei nutzen." : "Website-Filter setzen und erneut auswerten.");
        }
        if (data.proxyKind && !data.xffUsed) {
          limits.push("Besucheradressen wirken durch Cache oder Zwischenstation verdeckt.");
          next.push("Falls Cloudflare, Proxy oder Cache davor sitzt: echte Besucheradresse aktivieren und erneut auswerten.");
        }
        if (data.calibration && data.calibration.cache === "yes" && data.calibration.logSource !== "edge") {
          limits.push("Ein Cache oder Schutzdienst kann Aufrufe aus dieser Server-Datei heraushalten.");
          next.push("Wenn möglich eine Cloudflare-/CDN-Datei für denselben Zeitraum auswerten.");
        }
        if (data.calibration && data.calibration.exportComplete === "no") {
          limits.push("Der Export ist vermutlich unvollständig.");
          next.push("Vollständigen Zeitraum oder alle Teil-Dateien exportieren und erneut auswerten.");
        }
        if (data.diagnostics.pageviewReliability !== "high") {
          next.push("Prüfen, ob die Datei wirklich eine vollständige Server-Besuchsliste ist.");
        }
        if (data.diagnostics.chronologyIssue || data.maxGapMs >= 6 * 60 * 60 * 1000) {
          limits.push("Zeitliche Lücken oder unsortierte Einträge können Besuche und Käufe verzerren.");
          next.push("Zeitraum und Vollständigkeit der Datei gegenprüfen.");
        }
        if (hasGa4 && data.ga4Import && data.ga4Import.warning) {
          next.push("Google-Analytics-Export neu holen: Seitenaufrufe verwenden, nicht Nutzer oder Sitzungen.");
        } else if (hasGa4 && data.calibration && data.calibration.ga4MetricKind === "users_or_sessions") {
          limits.push("Die eingetragene Google-Zahl ist für diesen Vergleich die falsche Zahl.");
          next.push("Google Analytics neu exportieren: Seitenaufrufe nach Seite verwenden.");
        } else if (hasGa4) {
          next.push("In Google Analytics denselben Zeitraum und dieselbe Website prüfen.");
        } else {
          next.push("Optional Google-Analytics-Seitenaufrufe eintragen, wenn du die Tracking-Lücke sehen willst.");
        }
        if (data.hasSuccessUrl && data.diagnostics.conversionReliability !== "high") {
          next.push("Wenn möglich Bestellnummer-Parameter eintragen, damit Reloads nicht wie neue Käufe wirken.");
        }
        if (data.suspiciousClients > 0) {
          limits.push("Auffällige Zugriffsmuster können Bot-, Monitoring- oder Test-Traffic sein.");
          next.push("Bei auffälligen Mustern strengen Bot-Filter testen und Ergebnis vergleichen.");
        }
        if (data.trackingCapped) {
          limits.push("Bei dieser großen Datei sind Detailhinweise gröber.");
          next.push("Für Detailprüfungen eine kleinere Zeitspanne zusätzlich auswerten.");
        }

        return {
          usable: unique(usable).slice(0, 4),
          limits: unique(limits).slice(0, 5),
          next: unique(next).slice(0, 5)
        };
      }
      function renderGuidedDiagnosis(data, hasGa4, hasConv) {
        const diagnosis = buildGuidedDiagnosis(data, hasGa4, hasConv);
        const listHtml = (items, fallback) => (items.length ? items : [fallback]).map((text) => `<li>${escapeHtml(text)}</li>`).join("");
        id("guided-use").innerHTML = listHtml(diagnosis.usable, "Seitenaufrufe als ersten Richtwert verwenden.");
        id("guided-limits").innerHTML = listHtml(diagnosis.limits, "Keine harte Entscheidung treffen, ohne Zeitraum und Website zu prüfen.");
        id("guided-next").innerHTML = listHtml(diagnosis.next, "Zeitraum, Website und Export kurz gegenprüfen.");
        id("guided-box").classList.remove("hidden");
        return diagnosis;
      }
      function preflightGuidance(preflight) {
        const ok = [];
        const check = [];
        if (preflight.classification === "access_log" || preflight.classification === "legacy_access_log") {
          ok.push("Die Datei sieht wie eine passende Server-Besuchsliste aus.");
        } else {
          check.push(`${preflight.classificationLabel} Das ist wahrscheinlich nicht die richtige Datei für diese Auswertung.`);
        }
        if (preflight.quality.pageviews === "high") ok.push("Seitenaufrufe wirken gut lesbar.");
        else check.push("Seitenaufrufe nur vorsichtig verwenden, bis das Format geprüft ist.");
        if (preflight.hosts.total > 1) check.push("Mehrere Websites/Subdomains erkannt: Website-Filter setzen.");
        if (preflight.proxySignal && !preflight.fields.xff) check.push("Cache oder Zwischenstation möglich: Besucherzahl kann unsicher sein.");
        if (preflight.fields.xff) ok.push("Proxy-Feld gefunden; bei Bedarf echte Besucheradresse aktivieren.");
        if (preflight.recommendedChecks.length) check.push(...preflight.recommendedChecks);
        return { ok: unique(ok).slice(0, 3), check: unique(check).slice(0, 4) };
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
        id("n-visits").textContent = data.evidence && data.evidence.visits && data.evidence.visits.type === "not_determinable"
          ? "Nicht bestimmbar"
          : data.visitorRange && data.visitorRange.low !== data.visitorRange.high
          ? `${format(data.visitorRange.low)}–${format(data.visitorRange.high)}`
          : format(data.visits);
        id("n-views").textContent = format(data.pageViews);
        id("n-purchases").textContent = data.hasSuccessUrl ? format(data.success) : "-";
        id("n-coverage").textContent = hasGa4 ? percent(data.overall.coverage) : "-";
        setQuality("q-visits", data.diagnostics.visitorReliability);
        setQuality("q-views", data.diagnostics.pageviewReliability);
        setQuality("q-purchases", data.hasSuccessUrl ? data.diagnostics.conversionReliability : "none");
        setQuality("q-ga4", hasGa4 ? data.diagnostics.ga4Reliability : "none");
        setQuality("q-host", data.diagnostics.hostReliability);
        setQuality("q-export", data.diagnostics.exportCompletenessReliability);
        setQuality("q-bot", data.diagnostics.botReliability);
        setQuality("q-tracking", data.diagnostics.trackingReliability);
        setQualityReason("q-visits", qualityReason(data, "visits", hasGa4));
        setQualityReason("q-views", qualityReason(data, "views", hasGa4));
        setQualityReason("q-purchases", qualityReason(data, "purchases", hasGa4));
        setQualityReason("q-ga4", qualityReason(data, "ga4", hasGa4));
        setQualityReason("q-host", qualityReason(data, "host", hasGa4));
        setQualityReason("q-export", qualityReason(data, "export", hasGa4));
        setQualityReason("q-bot", qualityReason(data, "bot", hasGa4));
        setQualityReason("q-tracking", qualityReason(data, "tracking", hasGa4));
        setPrecisionChecklist(data, hasGa4);
        data.guidedDiagnosis = renderGuidedDiagnosis(data, hasGa4, hasConv);
        renderClaimBox(data, hasGa4, hasConv);

        // Kauf-Check (signierte Differenz)
        id("pc-server").textContent = data.hasSuccessUrl ? format(data.success) : "-";
        id("pc-ga4").textContent = format(data.ga4Conversions);
        id("pc-gap").textContent = signed(data.convDiff);
        id("purchase-note").textContent = hasConv ? convNote(data.convDiff) : "";

        // Seiten-Tabelle
        id("table-title").textContent = data.hasChosen ? "Deine ausgewählten Seiten" : "Deine meistbesuchten Seiten";
        id("table-caption").textContent = hasGa4
          ? "Webserver gegen Google Analytics. Die letzte Spalte zeigt, wie viel Google Analytics im Vergleich zur Server-Datei sieht."
          : "So oft hat dein Webserver diese Seiten gesehen. Trag oben optional Google-Analytics-Zahlen ein, um zu vergleichen.";
        id("compare-note").textContent = hasGa4 ? diffNote(data.overall.difference) : "";
        renderPageTable(data.tableRows);

        // Hinweise
        showHint("proxy-hint",
          data.proxyKind === "private"
            ? "Fast alle Zugriffe stammen von einer internen IP-Adresse. Das passiert oft, wenn Cloudflare, ein Cache oder ein anderer Proxy vor deiner Website sitzt. Dann steht vorne nicht der echte Besucher, sondern nur die Zwischenstation. Seitenaufrufe bleiben brauchbar; die Besucherzahl ist so nicht belastbar. Aktiviere oben „Echte Besucheradresse hinter Proxy verwenden“ und werte erneut aus."
          : data.proxyKind === "concentrated"
            ? "Mehr als die Hälfte der Zugriffe kommt von einer einzigen Adresse. Das kann ein Proxy oder Cache sein, aber auch ein sehr aktiver Testzugriff oder Scraper. Seitenaufrufe bleiben brauchbar; die Besucherzahl bitte nur mit Vorsicht lesen. Wenn ein Proxy davor sitzt, aktiviere oben „Echte Besucheradresse hinter Proxy verwenden“."
          : "");
        let recognitionText = "";
        if (["cloudflare", "cloudfront", "fastly", "akamai"].includes(data.formatKind)) {
          const names = { cloudflare: "Cloudflare", cloudfront: "CloudFront", fastly: "Fastly", akamai: "Akamai-nahe" };
          recognitionText = `${names[data.formatKind]}-Datei gelesen. Gut: Damit sieht ServerStory auch Aufrufe, die ein Cache sonst vom Webserver fernhalten kann.`;
        } else if (data.formatKind === "json") {
          recognitionText = "Strukturierte Datei gelesen. Bei eigenen Dateien kurz prüfen, ob Seite, Status und Besucheradresse richtig erkannt wurden.";
        } else if (data.formatKind === "iis") {
          recognitionText = "Microsoft-IIS-Server-Datei gelesen. Die Zeiten werden als Weltzeit (UTC) gelesen.";
        } else if (data.formatKind === "alb" || data.formatKind === "elb") {
          recognitionText = "AWS-Load-Balancer-Datei gelesen. Das ist meist eine Datei vor dem Webserver; Cache- und Host-Kontext trotzdem prüfen.";
        } else if (data.formatKind === "unknown" && data.total) {
          recognitionText = "Diese Datei passt nicht sicher zu den Datei-Arten, die ServerStory kennt.";
        } else if (data.unrecognizedPct >= 10) {
          recognitionText = `${percent(data.unrecognizedPct)} der Datei konnte nicht gelesen werden. Prüfe, ob die Datei gemischt, gekürzt oder im falschen Format ist.`;
        }
        if (data.diagnostics.pageviewReliability === "high") {
          recognitionText += (recognitionText ? " " : "") + "Die Seitenaufrufe wirken gut nutzbar.";
        } else if (data.diagnostics.pageviewReliability === "medium") {
          recognitionText += (recognitionText ? " " : "") + "Die Seitenaufrufe sind brauchbar, aber nicht perfekt.";
        } else if (data.total) {
          recognitionText += (recognitionText ? " " : "") + "Die Seitenaufrufe bitte nur vorsichtig verwenden, weil zu viel der Datei unklar ist.";
        }
        if (data.xffMissing > 0 && data.xffUsed === 0) {
          recognitionText += (recognitionText ? " " : "") + "Das Proxy-Feld wurde aktiviert, aber ServerStory hat dort keine brauchbaren Besucheradressen gefunden. Die Besucherzahl nutzt deshalb weiter die erste Adresse in der Zeile.";
        } else if (data.xffPrivate > 0 && data.xffUsed === 0) {
          recognitionText += (recognitionText ? " " : "") + "Das Proxy-Feld enthält nur interne Adressen. Die Besucherzahl kann deshalb weiter verzerrt sein.";
        } else if (data.diagnostics.visitorReliability === "limited") {
          recognitionText += (recognitionText ? " " : "") + "Die Besucherzahl ist eingeschränkt belastbar; Seitenaufrufe sind hier die robustere Kennzahl.";
        }
        if (data.suspiciousClients > 0) {
          recognitionText += (recognitionText ? " " : "") + `${format(data.suspiciousClients)} auffällige Muster gefunden: sehr viele Aufrufe, aber kaum Bilder oder technische Dateien. Das kann Bot-, Monitoring- oder Scraper-Traffic sein.`;
        }
        if (data.scanRequests > 0) {
          recognitionText += (recognitionText ? " " : "") + `${format(data.scanRequests)} Aufrufe wirken wie Admin-, Exploit- oder Proxy-Scans. Zahlen aus solchen Dateien bitte nur vorsichtig lesen.`;
        }
        if (data.probeRequests > 0) {
          recognitionText += (recognitionText ? " " : "") + `${format(data.probeRequests)} Aufrufe (${percent(data.probeShare * 100)} der Datei) stammen von ${format(data.probeClients)} Adressen, die fast nur Fehlversuche auslösen. Die Fehlversuche selbst zählen nicht als Seitenaufruf; behandle die Datei trotzdem nicht als reinen Besucher-Traffic.`;
        }
        if (data.diagnostics.hostReliability === "limited") {
          recognitionText += (recognitionText ? " " : "") + (data.hostFilterUnverifiable
            ? `Der Website-Filter konnte bei ${format(data.hostFilterNoHost)} Zeilen nicht geprüft werden, weil keine Website-Adresse in der Zeile steht.`
            : `Die Datei enthält mehrere Websites oder Subdomains (${format(data.hosts.total)} erkannt). Setze oben einen Filter, damit ServerStory und Google Analytics wirklich dieselbe Website vergleichen.`);
        }
        if (data.trackingCapped || data.pathCountCapped || data.queryVariantCapped) {
          recognitionText += (recognitionText ? " " : "") + "Die Datei ist sehr groß. Hauptzahlen bleiben nutzbar, aber Besucher-Spanne und Bot-Hinweise werden gröber.";
        }
        if (data.ga4Import && data.ga4Import.warning) {
          recognitionText += (recognitionText ? " " : "") + data.ga4Import.warning;
        }
        showHint("recognition-hint", recognitionText);
        let chronoText = data.minTime && data.maxTime ? `Erkannter Logzeitraum: ${formatDateTime(data.minTime)} bis ${formatDateTime(data.maxTime)}.` : "";
        if (data.diagnostics.chronologyIssue) {
          chronoText += (chronoText ? " " : "") + "Die Einträge sind zeitlich nicht sauber sortiert. Besucher- und Conversion-Zählung können dadurch deutlich ungenauer sein; Seitenaufrufe bleiben robuster.";
        }
        if (data.maxGapMs >= 6 * 60 * 60 * 1000) {
          chronoText += (chronoText ? " " : "") + `Größte erkannte Lücke zwischen zwei Einträgen: ${Math.round(data.maxGapMs / 3600000)} Stunden. Prüfe, ob die Datei vollständig ist.`;
        }
        showHint("chrono-hint", chronoText);

        // Details
        id("server-total").textContent = format(data.total);
        id("server-kept").textContent = format(data.kept);
        id("server-filtered").textContent = format(data.filtered + data.unrecognized);
        id("server-ads").textContent = format(data.adVisitors);
        id("visits").textContent = data.evidence && data.evidence.visits && data.evidence.visits.type === "not_determinable"
          ? `Nicht verlässlich bestimmbar (mögliche Spanne ${format(data.visitorRange.low)}–${format(data.visitorRange.high)})`
          : data.visitorRange && data.visitorRange.low !== data.visitorRange.high
          ? `${format(data.visits)} (mögliche Spanne ${format(data.visitorRange.low)}–${format(data.visitorRange.high)})`
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
          { name: "Bot oder Crawler", count: data.reasons.bot },
          { name: "Fehlerseiten oder Weiterleitungen", count: data.reasons.status },
          { name: "Andere Zugriffsart (kein Seitenaufruf)", count: data.reasons.method },
          { name: "Fehlende Browser-Angabe", count: data.reasons.emptyUa },
          { name: "Außerhalb des Zeitraums", count: data.reasons.range },
          { name: "Andere Website/Subdomain", count: data.reasons.host },
          { name: "Strenger Filter (kein Browser)", count: data.reasons.strict },
          { name: "Eintrag nicht gelesen", count: data.unrecognized }
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
          return "Google Analytics zählt mehr Käufe als dein Webserver. Mögliche Gründe: die Danke-Seite wird auch von Bots oder Monitoring aufgerufen und hier herausgefiltert; Google Analytics zählt Käufe ohne eigene Danke-Seite; mehrere Käufe desselben Besuchers innerhalb einer Stunde wurden hier zusammengefasst; oder die Server-Dateien sind unvollständig.";
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
          const visitText = data.evidence && data.evidence.visits && data.evidence.visits.type === "not_determinable"
            ? "eine mit diesen Daten nicht verlässlich bestimmbare Besucherzahl"
            : `${format(data.visits)} Besuche`;
          let sub = `In ${zeitraumText()} zählt dein Webserver ${visitText} und ${format(data.pageViews)} Seitenaufrufe.`;
          if (data.hasSuccessUrl) sub += ` Davon ${kauf(data.success)} auf der Danke-Seite.`;
          id("subline").textContent = sub;
          id("action").textContent = "Nächster Schritt: Das sind die echten Server-Zahlen. Vergleiche sie mit Google Analytics — oder trag oben optional deine Google-Analytics-Zahlen ein, dann zeigt ServerStory die Lücke direkt.";
          return;
        }

        if (hasGa4) {
          const cov = data.overall.coverage;
          const worst = data.overall.worst;
          // worst.name ist ein URL-Pfad aus dem Log (angreifer-kontrollierter Inhalt). Er wird
          // ausschließlich über .textContent ausgegeben — das rendert Klartext, kein HTML, also
          // kein XSS. WICHTIG: bleibt das so. Wer diese Ausgabe je auf innerHTML umstellt, MUSS
          // worst.name durch escapeHtml() schicken.
          if (cov < 85) {
            setSignal("warn", "!", "Achtung");
            id("headline").textContent = "Dein Server zählt deutlich mehr Seitenaufrufe als Google Analytics";
            const worstGapText = worst && worst.coverage < 85
              ? ` Am größten ist die Lücke bei ${worst.name}: Dort fehlen Google Analytics ${percent(100 - worst.coverage)} der Aufrufe.`
              : "";
            id("subline").textContent = `Für deine ausgewählten Seiten sieht Google Analytics ${percent(100 - cov)} weniger Seitenaufrufe als deine Server-Datei.${worstGapText}`;
            id("action").textContent = "Nächster Schritt: Noch keine Budget-Entscheidung nur daraus ableiten. Prüfe zuerst: gleicher Zeitraum, richtige Website, Seitenaufrufe in Google Analytics, Cookie-Banner, Ad-Blocker und ob ein Cache davor sitzt.";
          } else if (cov < 95) {
            setSignal("medium", "~", "Kleine Lücke");
            id("headline").textContent = "Kleine Abweichung";
            const worstText = worst && worst.coverage < 85 ? ` Am wenigsten auf ${worst.name} (${percent(worst.coverage)}).` : "";
            id("subline").textContent = `Google Analytics findet ${percent(cov)} der Aufrufe aus der Server-Datei. Eine kleine Lücke ist normal.${worstText}`;
            id("action").textContent = "Nächster Schritt: Im Auge behalten, aber keine große Entscheidung nur wegen dieser kleinen Abweichung treffen.";
          } else if (cov <= 110) {
            setSignal("good", "✓", "Passt");
            id("headline").textContent = "Die Zahlen passen zusammen";
            id("subline").textContent = `Google Analytics und die Server-Datei liegen nah beieinander (${percent(cov)}).`;
            id("action").textContent = "Nächster Schritt: Kurz Zeitraum und Seiten prüfen — danach wirken die Google-Analytics-Zahlen verlässlich.";
          } else {
            setSignal("medium", "~", "Google Analytics zählt mehr");
            id("headline").textContent = "Google Analytics liegt über der Server-Datei";
            id("subline").textContent = `Für die verglichenen Seiten meldet Google Analytics mehr als die Server-Datei (${percent(cov)}). Häufige Ursache: Cache/CDN — ein Teil der Aufrufe landet dann nicht in dieser Server-Datei. Auch Mehrfachzählung oder Bots können Google Analytics aufblähen.`;
            id("action").textContent = "Nächster Schritt: Prüfen, ob Cloudflare oder ein anderer Cache vor der Seite sitzt — dann fehlen Aufrufe in dieser Server-Datei. Sonst Bots oder Mehrfachzählung in Google Analytics prüfen.";
          }
          if (hasConv && data.convDiff > 0) {
            id("action").textContent += ` Beim Kauf-Check zählt dein Webserver ${kauf(data.convDiff)} mehr als Google Analytics.`;
          } else if (hasConv && data.convDiff < 0) {
            id("action").textContent += ` Beim Kauf-Check zählt Google Analytics dagegen ${kauf(Math.abs(data.convDiff))} mehr — Details unten beim Kauf-Check.`;
          }
          return;
        }

        // Nur der Kauf-Check liegt vor (keine Seiten-Google-Analytics-Zahlen).
        const diff = data.convDiff;
        if (diff > 0) {
          const rate = data.success ? (diff / data.success) * 100 : 0;
          if (rate >= 15) {
            setSignal("warn", "!", "Achtung");
            id("headline").textContent = "Google-Analytics-Kaufabdeckung ist niedriger";
          } else {
            setSignal("medium", "~", "Kleine Lücke");
            id("headline").textContent = "Kleine Lücke bei den Käufen";
          }
          id("subline").textContent = `Dein Webserver zählt ${kauf(diff)} mehr als Google Analytics.`;
          id("action").textContent = "Nächster Schritt: Kürze jetzt keine Werbung. Lass Tracking, Cookie-Banner, Ad-Blocker und die Danke-Seite prüfen.";
        } else if (diff < 0) {
          setSignal("medium", "~", "Google Analytics zählt mehr");
          id("headline").textContent = "Google Analytics zählt mehr Käufe als der Webserver";
          id("subline").textContent = `Google Analytics meldet ${kauf(Math.abs(diff))} mehr als dein Webserver.`;
          id("action").textContent = "Nächster Schritt: Prüfe die Danke-Seite: Wird sie auch von Bots oder Monitoring aufgerufen? Zählt Google Analytics Käufe ohne eigene Danke-Seite? Fehlen Server-Dateien wegen Cache oder mehreren Exporten?";
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
          const hostText = preflight.hosts.total ? `${format(preflight.hosts.total)} Website(s)/Subdomain(s)` : "keine Website-Adresse erkannt";
          const xffText = preflight.fields.xff ? ", Proxy-Feld gefunden" : "";
          const rangeText = preflight.sampleTimeRange.from && preflight.sampleTimeRange.to
            ? ` Zeitraum: ${formatDateTime(Date.parse(preflight.sampleTimeRange.from))} bis ${formatDateTime(Date.parse(preflight.sampleTimeRange.to))}.`
            : "";
          const guidance = preflightGuidance(preflight);
          const okText = guidance.ok.length ? ` Gut: ${guidance.ok.join(" ")}` : "";
          const checkText = guidance.check.length ? ` Erst prüfen: ${guidance.check.join(" ")}` : "";
          id("message").textContent = `Kurzprüfung: ${preflight.classificationLabel}. ${percent(preflight.recognitionRate * 100)} der Stichprobe lesbar, ${hostText}${xffText}. Beispiel: ${preflight.fields.method || "-"} ${preflight.fields.path || "-"} → ${preflight.fields.status || "-"}.${rangeText}${okText}${checkText}`;
        } catch (error) {
          id("message").textContent = error && error.message ? error.message : "Kurzprüfung fehlgeschlagen.";
        }
      });
      id("sample").addEventListener("click", () => {
        id("ga4-toggle").open = true;
        id("compare-urls").value = "";
        id("ga4-url-views").value = "/,1950\n/produkt/0,58\n/produkt/2,54\n/produkt/4,55\n/bestellung/danke,185";
        id("success-url").value = "/bestellung/danke";
        id("ga4-conversions").value = "185";
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
          evidence: lastResult.evidence,
          evidenceFailures: lastResult.evidenceFailures,
          claims: lastResult.claims,
          claimMatrix: lastResult.claimMatrix,
          decisionReadiness: lastResult.decisionReadiness,
          guidedDiagnosis: lastResult.guidedDiagnosis || buildGuidedDiagnosis(
            lastResult,
            !!(lastResult.overall && lastResult.overall.coverage !== null),
            !!(lastResult.hasSuccessUrl && lastResult.ga4Conversions !== null)
          ),
          auditProtocol: lastResult.auditProtocol,
          conflicts: lastResult.conflicts,
          ga4Validation: lastResult.ga4Validation,
          calibration: lastResult.calibration,
          exportCompleteness: lastResult.exportCompleteness,
          xForwardedFor: {
            used: lastResult.xffUsed,
            exactUsed: lastResult.xffExactUsed,
            missing: lastResult.xffMissing,
            privateOnly: lastResult.xffPrivate
          },
          suspiciousClients: lastResult.suspiciousClients,
          scanRequests: lastResult.scanRequests,
          scanShare: lastResult.scanShare,
          probeRequests: lastResult.probeRequests || 0,
          probeClients: lastResult.probeClients || 0,
          probeShare: lastResult.probeShare || 0,
          trackingCapped: lastResult.trackingCapped,
          pathCountCapped: lastResult.pathCountCapped,
          queryVariantCapped: lastResult.queryVariantCapped,
          queryVariantCount: lastResult.queryVariantCount,
          hostFilter: {
            requested: lastResult.hostFilterRequested,
            rowsWithoutHost: lastResult.hostFilterNoHost,
            unverifiable: lastResult.hostFilterUnverifiable
          },
          legacyNoUserAgent: lastResult.legacyNoUserAgent,
          proxyKind: lastResult.proxyKind,
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
            hostFilterNoHost: lastResult.hostFilterNoHost,
            statusCounts: lastResult.statusCounts,
            methodCounts: lastResult.methodCounts,
            filterReasonPct: Object.fromEntries(Object.entries(lastResult.reasons).map(([key, value]) => [key, lastResult.parsed ? (value / lastResult.parsed) * 100 : 0]))
          },
          accuracyNotes: {
            pageViews: qualityReason(lastResult, "views", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            visits: qualityReason(lastResult, "visits", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            conversions: qualityReason(lastResult, "purchases", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            ga4: qualityReason(lastResult, "ga4", !!(lastResult.overall && lastResult.overall.coverage !== null)),
            setup: lastResult.calibration,
            hostScope: lastResult.hostFilterUnverifiable ? `Website-Filter nicht voll pruefbar: ${format(lastResult.hostFilterNoHost)} Zeilen ohne Host-Angabe.` : (lastResult.diagnostics.hostReliability === "limited" ? `Mehrere Websites/Subdomains erkannt (${format(lastResult.hosts.total)}). Filter empfohlen, sonst kann der Vergleich fremde Seiten enthalten.` : "Die Datei wirkt auf eine Website begrenzt."),
            botAnomaly: lastResult.suspiciousClients ? `${format(lastResult.suspiciousClients)} auffaellige Muster mit Bot-/Monitoring-Verdacht.` : "Keine starke Bot-/Monitoring-Auffaelligkeit sichtbar."
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
