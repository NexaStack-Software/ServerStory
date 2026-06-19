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
