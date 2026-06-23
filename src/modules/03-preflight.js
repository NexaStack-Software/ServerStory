      // @requires id, percent, ASSET_RE, makeAggregator, topEntries, t
      // @provides zeitraumText, formatDateTime, preflightLogSample

      function zeitraumText() {
        const from = id("date-from").value;
        const to = id("date-to").value;
        if (!from && !to) return t("range.file");
        return t("range.fromTo", { from: from || t("range.start"), to: to || t("range.end") });
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
