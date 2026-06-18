const fs = require("fs");

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]{0,}[0-9a-f]{1,4}\b/gi;
const HOST_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
const LONG_ID_RE = /\b(?=[a-z0-9_-]*\d)(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{16,}\b/gi;
const PII_QUERY_KEYS = new Set([
  "email", "e-mail", "mail", "name", "first_name", "last_name", "firstname", "lastname",
  "user", "username", "kunde", "customer", "customer_id", "uid", "userid", "user_id",
  "token", "auth", "session", "sid", "phpsessid", "password", "pass", "phone", "tel"
]);
const SECRET_JSON_KEYS = /"(?:cookie|cookies|authorization|auth|request_headers|requestHeaders|headers|ClientRequestHeaderCookie|ClientRequestHeaderAuthorization)"\s*:\s*"[^"]*"/gi;
const SECRET_HEADER_RE = /\b(authorization|cookie|set-cookie)\s*[:=]\s*("[^"]*"|[^\s"]+)/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi;

function makeMapper(prefix, width = 3) {
  const seen = new Map();
  return (value) => {
    const key = String(value || "").toLowerCase();
    if (!seen.has(key)) seen.set(key, `${prefix}${String(seen.size + 1).padStart(width, "0")}`);
    return seen.get(key);
  };
}

function sanitizeUrl(raw, hostMap) {
  let text = String(raw || "");
  text = text.replace(EMAIL_RE, "redacted@example.test");
  try {
    const url = new URL(text, "https://example.test");
    if (url.hostname && url.hostname !== "example.test") url.hostname = hostMap(url.hostname) + ".example.test";
    for (const key of [...url.searchParams.keys()]) {
      if (PII_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, "REDACTED");
    }
    url.pathname = url.pathname.replace(LONG_ID_RE, "ID_REDACTED");
    if (/^https?:\/\//i.test(text)) return url.toString();
    return url.pathname + (url.search ? url.search : "");
  } catch (_) {
    return text
      .replace(LONG_ID_RE, "ID_REDACTED")
      .replace(/([?&])([^=&\s]+)=([^&\s"]*)/g, (m, sep, key, value) =>
        PII_QUERY_KEYS.has(String(key).toLowerCase()) ? `${sep}${key}=REDACTED` : `${sep}${key}=${value}`
      );
  }
}

function sanitizeText(input) {
  const ip4 = makeMapper("203.0.113.");
  const ip6 = makeMapper("2001:db8::");
  const hosts = makeMapper("host");
  let text = String(input || "");
  text = text.replace(EMAIL_RE, "redacted@example.test");
  text = text.replace(SECRET_JSON_KEYS, (value) => value.replace(/:\s*"[^"]*"/, ': "REDACTED"'));
  text = text.replace(SECRET_HEADER_RE, (m, key) => `${key}: REDACTED`);
  text = text.replace(BEARER_RE, (m, scheme) => `${scheme} REDACTED`);
  text = text.replace(IPV4_RE, (value) => ip4(value));
  text = text.replace(IPV6_RE, (value) => ip6(value));
  text = text.replace(/"([A-Z]+)\s+([^"\s]+)\s+HTTP\/[0-9.]+"?/g, (m, method, target) =>
    `"${method} ${sanitizeUrl(target, hosts)} HTTP/1.1"`
  );
  text = text.replace(/("ClientRequestURI"\s*:\s*")([^"]+)(")/g, (m, a, value, b) => a + sanitizeUrl(value, hosts) + b);
  text = text.replace(/("(?:request|request_uri|uri|url|path|reqPath|requestPath)"\s*:\s*")([^"]+)(")/gi, (m, a, value, b) => a + sanitizeUrl(value, hosts) + b);
  text = text.replace(/("(?:host|http_host|ClientRequestHost|reqHost|cs_host|server_name)"\s*:\s*")([^"]+)(")/gi, (m, a, value, b) => a + hosts(value) + ".example.test" + b);
  text = text.replace(HOST_RE, (value) => {
    const lower = value.toLowerCase();
    if (lower === "example.test" || lower.endsWith(".example.test")) return lower;
    return hosts(value) + ".example.test";
  });
  text = text.replace(/([?&])([^=&\s]+)=([^&\s"]*)/g, (m, sep, key, value) =>
    PII_QUERY_KEYS.has(String(key).toLowerCase()) ? `${sep}${key}=REDACTED` : `${sep}${key}=${value}`
  );
  text = text.replace(LONG_ID_RE, "ID_REDACTED");
  return text;
}

function main(argv) {
  const inputPath = argv[2];
  const outputPath = argv[3];
  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/sanitize-log.js <input.log> <output.log>");
    process.exit(2);
  }
  const input = fs.readFileSync(inputPath, "utf8");
  fs.writeFileSync(outputPath, sanitizeText(input));
}

if (require.main === module) main(process.argv);

module.exports = { sanitizeText, sanitizeUrl };
