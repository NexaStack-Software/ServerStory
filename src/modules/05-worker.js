      // @requires makeAggregator, id, number, normalizePath, ASSET_RE
      // @provides WORKER_SRC, processViaWorker, processOnMainThread, processFile, readConfig

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
          trustXffSource: id("trust-xff-source").checked,
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
