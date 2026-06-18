# Genauigkeitsgrenzen

ServerStory liefert belastbare Plausibilitaetsbefunde, aber keine absolute Wahrheit.

Seitenaufrufe:

- Belastbar, wenn das Logformat sauber erkannt wird und der Export vollstaendig ist.
- Origin-only Logs koennen bei CDN-/Cache-Setups zu niedrig sein.
- Edge-Logs von Cloudflare, CloudFront, Fastly oder Akamai-nahen Exporten sind fuer gecachte Aufrufe robuster.

Besuche:

- Immer eine Schaetzung aus IP + User-Agent im 30-Minuten-Fenster.
- Mehrere Menschen hinter derselben IP koennen zusammenfallen.
- Ohne korrektes X-Forwarded-For koennen Proxy/CDN/Loadbalancer Besucherzahlen stark verzerren.
- XFF ist nur belastbar, wenn es aus einer vertrauenswuerdigen Proxy-Kette kommt.

GA4-Vergleich:

- Zeitraum, Host/Domain und Seitenauswahl muessen identisch sein.
- GA4-Metrik muss Page Views/Views sein, nicht Users/Nutzer/Sessions.
- Consent, Adblocker und Scriptfehler senken GA4 gegenueber Serverlogs.
- Caching/CDN kann Server-Origin-Logs gegenueber GA4 senken.

Conversions:

- Danke-Seite oder Conversion-Muster muss eindeutig sein.
- Order-ID-Dedupe ist genauer als reine Reload-Dedupe.
- SPA/AJAX-Kaeufe ohne eigene Danke-URL koennen in Serverlogs fehlen.

Bots und Monitoring:

- Klare Bots werden gefiltert.
- Getarnte Bots koennen wie Browser aussehen.
- Sehr viele Pageviews ohne Asset-Abrufe werden als Anomalie markiert, aber nicht automatisch entfernt.
