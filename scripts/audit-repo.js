const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_LARGE = new Set(["screenshot.png"]);
const ALLOWED_EMAIL_FILES = new Set([
  "README.md",
  "scripts/sanitize-log.js",
  "tests/sanitize-log.test.js"
]);
const ALLOWED_IP_FILES = new Set(["tests/sanitize-log.test.js"]);
const ALLOWED_DOC_IP_RE = /\b(?:127\.0\.0\.1|10\.0\.0\.5|192\.0\.2\.|192\.168\.|203\.0\.113\.|198\.51\.100\.|2001:db8::|2001:0db8:|::1)\b/i;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BLOCKED_EXT = /\.(zip|tar|tgz|gz|7z|rar)$/i;

function walk(dir, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "serverstory-logs" || entry.name === "realworld-cache" || entry.name === "access-cache" || entry.name === "dist") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, rel));
    else files.push(rel);
  }
  return files;
}

const failures = [];
for (const rel of walk(root)) {
  const full = path.join(root, rel);
  const stat = fs.statSync(full);
  const base = path.basename(rel);
  if (stat.size > MAX_FILE_BYTES && !ALLOWED_LARGE.has(base)) failures.push(`${rel}: file too large (${stat.size} bytes)`);
  if (BLOCKED_EXT.test(rel) && !rel.startsWith("tests/fixtures/")) failures.push(`${rel}: archive/compressed file should not be committed`);
  if (/\.(png|jpg|jpeg|woff2?|ico|pdf)$/i.test(rel)) continue;
  const text = fs.readFileSync(full, "utf8");
  const emails = [...text.matchAll(EMAIL_RE)].map((m) => m[0]).filter((email) => !email.toLowerCase().endsWith("@example.test"));
  if (emails.length && !ALLOWED_EMAIL_FILES.has(rel)) failures.push(`${rel}: possible real email ${emails[0]}`);
  for (const match of text.matchAll(IPV4_RE)) {
    const ip = match[0];
    if (ALLOWED_IP_FILES.has(rel)) continue;
    if (!ALLOWED_DOC_IP_RE.test(ip)) failures.push(`${rel}: non-documentation IPv4 ${ip}`);
  }
}

if (failures.length) {
  console.error("repo audit failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("repo audit ok");
