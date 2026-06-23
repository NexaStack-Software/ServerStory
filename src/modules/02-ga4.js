      // @requires id, lastGa4Import, splitMetricLine, normalizePath, parseMetricNumber, ASSET_RE
      // @provides ga4UrlViews, topEntries, buildRows

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
