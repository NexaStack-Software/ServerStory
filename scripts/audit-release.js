const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const zipPath = path.join(root, "dist", "serverstory.zip");

if (!fs.existsSync(zipPath)) throw new Error("dist/serverstory.zip does not exist. Run npm run build:release first.");

const res = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
if (res.status !== 0) {
  process.stdout.write(res.stdout || "");
  process.stderr.write(res.stderr || "");
  throw new Error("could not list release zip");
}

const entries = res.stdout.trim().split(/\r?\n/).filter(Boolean);
const required = [
  "ServerStory/START_HIER.html",
  "ServerStory/index.html",
  "ServerStory/README.md",
  "ServerStory/CHANGELOG.md",
  "ServerStory/LICENSE",
  "ServerStory/favicon.png",
  "ServerStory/serverstory-logo.png",
  "ServerStory/screenshot.png",
  "ServerStory/fonts/OFL.txt",
  "ServerStory/fonts/ibm-plex-mono-400.woff2",
  "ServerStory/fonts/ibm-plex-mono-500.woff2"
];
const forbidden = [
  /^ServerStory\/tests\//,
  /^ServerStory\/scripts\//,
  /^ServerStory\/src\//,
  /^ServerStory\/docs\//,
  /^ServerStory\/serverstory-logs\//,
  /^ServerStory\/package\.json$/,
  /^ServerStory\/\.git/
];

const failures = [];
for (const file of required) if (!entries.includes(file)) failures.push(`missing ${file}`);
for (const entry of entries) {
  if (!entry.startsWith("ServerStory/")) failures.push(`unexpected root entry ${entry}`);
  if (forbidden.some((re) => re.test(entry))) failures.push(`forbidden entry ${entry}`);
  if (/\.(log|zip|tar|tgz|gz|7z|rar)$/i.test(entry)) failures.push(`forbidden payload type ${entry}`);
}

if (failures.length) {
  console.error("release audit failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log(`release audit ok (${entries.length} entries)`);
