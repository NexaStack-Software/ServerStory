


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
