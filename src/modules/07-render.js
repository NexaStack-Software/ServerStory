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
        const highLabels = {
          "q-visits": "Gut identifizierbar",
          "q-host": "Konnte zuverlässig ausgewertet werden",
          "q-export": "Konnte zuverlässig ausgewertet werden",
          "q-bot": "Konnte zuverlässig ausgewertet werden",
          "q-tracking": "Die Größe der Log-Datei ist in Ordnung"
        };
        const el = id(elId);
        el.className = `quality-badge ${state || "none"}`;
        el.textContent = state === "high" && highLabels[elId] ? highLabels[elId] : (labels[state] || labels.none);
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
          if (data.diagnostics.pageviewReliability === "high") return `Wir konnten diese Zahl zuverlässig bestimmen: Die Datei wurde sauber gelesen (${recognized}).`;
          if (data.diagnostics.pageviewReliability === "medium") return `Nur Richtwert: ${recognized} der Datei wurde gelesen. Einzelne Einträge passen nicht zum erwarteten Format.`;
          return `Nicht entscheidungsfähig: Zu viele Einträge passen nicht zum erwarteten Format (${recognized} gelesen).`;
        }
        if (metric === "visits") {
          if (data.evidence && data.evidence.visits && data.evidence.visits.type === "not_determinable") return "Nicht verlässlich bestimmbar: Die Datei zeigt vor allem Proxy-/CDN-Adressen, nicht echte Besucher.";
          if (data.diagnostics.visitorReliability === "high") return data.xffUsed ? "Wir konnten diese Zahl zuverlässig bestimmen: Echte Besucher-IPs aus einem feldgenau erkannten Proxy-Feld wurden genutzt." : "Wir konnten diese Zahl zuverlässig bestimmen: Keine starke Proxy-Verzerrung sichtbar.";
          if (data.proxyKind) return "Nur Spanne: Proxy oder CDN erkannt. Besucher nicht als exakte Zahl lesen.";
          if (data.xffUsed && data.xffExactUsed !== data.xffUsed) return "Das Proxy-Feld wurde nicht feldgenau erkannt. Besucheradressen nur vorsichtig verwenden.";
          if (data.xffMissing || data.xffPrivate) return "Das Proxy-Feld enthält keine brauchbaren Besucher-IPs.";
          return "Nur Richtwert: Die Reihenfolge der Einträge oder die Besucher-Erkennung macht diese Zahl ungenauer.";
        }
        if (metric === "purchases") {
          if (!data.hasSuccessUrl) return "Keine Kauf-/Danke-Seite angegeben.";
          if (data.diagnostics.conversionReliability === "high") return data.ga4Conversions === null ? "Wir konnten diese Zahl zuverlässig bestimmen: Die Kaufseite wurde erkannt; doppelte Reloads werden reduziert." : "Wir konnten diese Zahl zuverlässig bestimmen: Die Kaufseite wurde erkannt und mit Google-Analytics-Käufen verglichen.";
          return "Nur Richtwert: Kaufseite erkannt, aber ohne Bestellnummer können Reloads die Zahl verzerren.";
        }
        if (metric === "ga4") {
          if (data.ga4Import && data.ga4Import.warning) return data.ga4Import.warning;
          if (!hasGa4) return "Keine Google-Analytics-Seitenzahlen eingetragen.";
          if (data.calibration && data.calibration.ga4MetricKind === "users_or_sessions") return "Für diesen Vergleich wurden Nutzer oder Sitzungen markiert. Bitte Seitenaufrufe aus Google Analytics verwenden.";
          if (data.evidence && data.evidence.ga4 && !data.evidence.ga4.canAnswer) return data.evidence.ga4.reason;
          if (data.diagnostics.ga4Reliability === "medium") return "Achtung - diese Zahl ist nur nach einem Gegencheck zuverlässig: Achte darauf, dass Zeitraum und Seitenauswahl wirklich dieselben sind; die Website muss ebenfalls passen.";
          return "Nicht entscheidungsfähig: Prüfe Zeitraum, Seiten und ob in Google Analytics wirklich Seitenaufrufe stehen.";
        }
        if (metric === "host") {
          if (data.hostFilterUnverifiable) return `${format(data.hostFilterNoHost)} Zeilen hatten keine Website-Adresse. Der Website-Filter konnte dort nicht geprüft werden.`;
          if (data.diagnostics.hostReliability === "limited") return `${format(data.hosts.total)} Domains/Subdomains gefunden. Ohne Filter können fremde Seiten mit drin sein.`;
          return "Wir konnten zuverlässig bestimmen, dass die Datei von nur einer Website und nicht mehreren stammt.";
        }
        if (metric === "export") {
          if (data.calibration && data.calibration.exportComplete === "no") return "Du hast angegeben, dass der Export vermutlich nicht vollständig ist. Zahlen nur als Ausschnitt lesen.";
          if (!data.exportCompleteness || data.exportCompleteness.reliability === "high") return "Der Export scheint vollständig zu sein: Zeitraum, Lesbarkeit und Filterquote sind somit plausibel.";
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
          return data.reasons.bot ? `Wir haben ${format(data.reasons.bot)} klare Bot-Zeilen entfernt. Es gab keine weiteren starken Auffälligkeiten.` : "Es gab keine starken Bot- oder Monitoring-Auffälligkeiten.";
        }
        if (metric === "tracking") {
          if (data.pathCountCapped || data.queryVariantCapped) return "Sehr viele unterschiedliche Seiten oder Varianten gefunden. Hauptzahlen bleiben nutzbar, Detailtabellen wurden begrenzt.";
          if (data.diagnostics.trackingReliability === "medium") return "Interne Schutzgrenze erreicht. Hauptzahlen bleiben nutzbar, Detailsignale werden gröber.";
          return "Die Größe deiner Log-Datei passt - sie ist nicht zu groß, um von ServerStory verarbeitet zu werden.";
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
          ? "Die Datei enthält die Besuche einer einzigen Website, nicht von mehreren."
          : (data.hostFilterUnverifiable ? "Der Website-Filter konnte nicht für alle Zeilen geprüft werden." : `${format(data.hosts.total)} Domains/Subdomains gefunden. Filter setzen, wenn du nur eine Website prüfen willst.`)));
        rows.push(item(data.diagnostics.pageviewReliability !== "limited", `${percent(data.diagnostics.recognitionRate * 100)} der Datei wurde verstanden.`));
        rows.push(item(!hasGa4 || !(data.ga4Import && data.ga4Import.warning), hasGa4
          ? ((data.ga4Import && data.ga4Import.warning) || "Google-Analytics-Zahlen wurden gelesen. Achte bitte darauf, dass Zeitraum und Seitenauswahl gleich sein müssen.")
          : "Keine Google-Analytics-Seitenzahlen eingetragen."));
        rows.push(item(data.diagnostics.visitorReliability !== "limited", data.diagnostics.visitorReliability !== "limited"
          ? "Keine starke Proxy-Verzerrung bei Besuchern sichtbar."
          : "Proxy oder CDN kann die Besucherzahl verzerren. Seitenaufrufe stärker gewichten."));
        rows.push(item(!data.hasSuccessUrl || data.diagnostics.conversionReliability !== "medium", data.hasSuccessUrl
          ? qualityReason(data, "purchases", hasGa4)
          : "Keine Kauf-/Danke-Seite angegeben."));
        id("precision-checklist").innerHTML = rows.join("");
      }
      function buildGuidedDiagnosis(data, hasGa4, hasConv) {
        const usable = [];
        const limits = [];
        const next = [];

        if (data.claimMatrix.pageViews.status === "allowed") usable.push("Die Seitenaufrufe sind die Zahl, die ServerStory am zuverlässigsten aus deiner Server-Datei identifizieren kann.");
        else if (data.claimMatrix.pageViews.status === "limited") limits.push("Seitenaufrufe nur als Richtwert lesen, weil Teile der Datei unsicher sind.");
        else limits.push("Keine feste Aussage zu Seitenaufrufen treffen.");

        if (data.claimMatrix.visits.status === "allowed") usable.push("Besuche als grobe Größenordnung verwenden.");
        else if (data.claimMatrix.visits.status === "limited") limits.push("Besuche nur als Spanne lesen, nicht als exakte Personenzahl.");
        else limits.push("Besuche mit dieser Datei nicht als Zahl behaupten.");

        if (data.hasSuccessUrl && data.claimMatrix.conversions.status === "allowed") usable.push("Die Käufe über die Danke-Seite sind ebenfalls robust bestimmbar.");
        else if (data.hasSuccessUrl) limits.push("Käufe vorsichtig lesen, wenn Reloads oder fehlende Bestellnummern möglich sind.");

        if (hasGa4 && data.claimMatrix.ga4.status === "allowed") usable.push("Google Analytics mit den Server-Zahlen vergleichen.");
        else if (hasGa4) limits.push("Den Google-Analytics-Vergleich solltest du erst dann als Richtwert nutzen, nachdem du Zeitraum, Website und Seiten in Google Analytics gegengeprüft hast.");

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
          next.push("Prüfe in Google Analytics denselben Zeitraum, dieselbe Website und dieselben Seiten, damit die Differenz zwischen Server-Datei und Google Analytics zuverlässig eingeordnet werden kann.");
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
          recognitionText += (recognitionText ? " " : "") + "Deine Server-Datei ist sauber: ServerStory kann deine Website-Aufrufe zuverlässig nachvollziehen.";
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
            const serverGap = cov > 0 ? percent((10000 / cov) - 100) : "deutlich";
            const worstGapText = worst && worst.coverage < 85
              ? ` Den größten Unterschied hat deine Unterseite ${worst.name}: Dort verzeichnet dein Server ${worst.coverage > 0 ? percent((10000 / worst.coverage) - 100) : "deutlich"} mehr Seitenaufrufe als Google Analytics.`
              : "";
            id("subline").textContent = `In deiner Server-Datei stehen für deine ausgewählten Seiten deutlich mehr Seitenaufrufe als in deinem Google Analytics-Dashboard. Deine Server-Datei verzeichnet insgesamt ${serverGap} mehr Seitenaufrufe als Google Analytics.${worstGapText}`;
            id("action").textContent = "Nächster Schritt: Du solltest aus den Ergebnissen jetzt noch keine strategischen Entscheidungen ableiten. Prüfe zuerst: Hast du wirklich den gleichen Zeitraum und die richtige Website geprüft? Stimmen die Seitenaufrufe in Google Analytics? Hast du geprüft, ob Cookie-Banner, Ad-Blocker oder ein Cache die Differenz erklären können?";
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
    
    
    
