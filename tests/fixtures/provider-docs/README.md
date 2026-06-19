# Provider-Dokumentationsfixtures

Diese Fixtures sind keine echten Kundendaten. Sie sind synthetische, anonymisierte Beispiele,
die sich an offiziellen Formatdokumentationen orientieren.

Quellen:

- Amazon CloudFront Standard Logs: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html
- AWS Application/Classic Load Balancer Access Logs: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-access-logs.html
- Cloudflare Logpush HTTP Requests Dataset: https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/
- Microsoft IIS/W3C Logging: https://learn.microsoft.com/en-us/iis/manage/provisioning-and-managing-iis/configure-logging-in-iis
- Fastly Custom Log Formats: https://www.fastly.com/documentation/guides/integrations/streaming-logs/custom-log-formats/
- Apache mod_log_config / vHost Combined: https://httpd.apache.org/docs/current/mod/mod_log_config.html
- nginx log_format / proxy headers: https://nginx.org/en/docs/http/ngx_http_log_module.html

Alle IPs verwenden Dokumentationsbereiche wie `203.0.113.0/24` und `198.51.100.0/24`.

Feldmapping-Hinweise:

- CloudFront/IIS/W3C: `x-forwarded-for` gilt nur als feldgenau, wenn es in `#Fields:`
  steht.
- Cloudflare/Fastly/Akamai-nahe JSON: XFF gilt nur als feldgenau, wenn ein bekannter
  XFF-Schluessel wie `ClientRequestHeaderXForwardedFor`, `x_forwarded_for` oder
  `reqHeaderXForwardedFor` vorhanden ist.
- Apache/nginx Combined mit frei angehaengten Zusatzfeldern kann XFF zwar lesen, wird
  aber nicht mehr als `high` fuer Besucher bewertet, weil die Feldbedeutung nicht sicher
  aus dem Format hervorgeht.
- ALB/ELB: Request, Status, Client-Adresse, Host und User-Agent werden aus den
  dokumentierten positionsbasierten Feldern gelesen; XFF wird dort nicht automatisch
  als vertrauenswuerdig angenommen.
