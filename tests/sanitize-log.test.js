const assert = require("assert");
const { sanitizeText } = require("../scripts/sanitize-log.js");

const input = [
  '91.12.34.56 - - [05/Jun/2026:10:00:00 +0000] "GET https://shop.real-domain.de/preise?email=max@example.com&gclid=abc&session=secret HTTP/1.1" 200 123 "https://real-domain.de/start?user=42" "Mozilla/5.0"',
  '2001:4860:4860::8888 - - [05/Jun/2026:10:01:00 +0000] "GET /konto?name=Max&variant=a HTTP/1.1" 200 123 "-" "max@example.com"',
  '{"timestamp":"2026-06-05T10:02:00Z","client_ip":"8.8.8.8","host":"www.real-domain.de","request":"/checkout?token=abc&order_id=100","user_agent":"Mozilla/5.0","status":200}',
  '{"EdgeStartTimestamp":"2026-06-05T10:03:00Z","ClientIP":"1.1.1.1","ClientRequestHost":"cdn.real-domain.de","ClientRequestURI":"https://cdn.real-domain.de/pfad?uid=7&utm_source=x","EdgeResponseStatus":200}',
  '{"timestamp":"2026-06-05T10:04:00Z","authorization":"Bearer abcdef1234567890SECRET","cookie":"sid=supersecret; user=max","request":"/account/customer_abcdef1234567890/orders"}',
  'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ== Cookie: sessionid=secret'
].join("\n");

const output = sanitizeText(input);

assert.match(output, /203\.0\.113\.001/);
assert.match(output, /2001:db8::001/);
assert.match(output, /redacted@example\.test/);
assert.match(output, /host001\.example\.test|host002\.example\.test/);
assert.match(output, /email=REDACTED/);
assert.match(output, /session=REDACTED/);
assert.match(output, /name=REDACTED/);
assert.match(output, /token=REDACTED/);
assert.match(output, /uid=REDACTED/);
assert.match(output, /"authorization": "REDACTED"/);
assert.match(output, /"cookie": "REDACTED"/);
assert.match(output, /Authorization: REDACTED/i);
assert.match(output, /Cookie: REDACTED/i);
assert.match(output, /ID_REDACTED/);
assert.match(output, /gclid=abc/);
assert.match(output, /order_id=100/);
assert.doesNotMatch(output, /91\.12\.34\.56|8\.8\.8\.8|1\.1\.1\.1/);
assert.doesNotMatch(output, /real-domain\.de|max@example\.com|supersecret|abcdef1234567890SECRET|QWxhZGRpbjpvcGVuIHNlc2FtZQ/);

console.log("sanitize-log ok");
