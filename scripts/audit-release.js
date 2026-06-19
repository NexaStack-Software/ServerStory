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
  "ServerStory/serverstory-app/index.html",
  "ServerStory/serverstory-app/LICENSE",
  "ServerStory/serverstory-app/favicon.png",
  "ServerStory/serverstory-app/serverstory-logo.png",
  "ServerStory/serverstory-app/fonts/OFL.txt",
  "ServerStory/serverstory-app/fonts/ibm-plex-mono-400.woff2",
  "ServerStory/serverstory-app/fonts/ibm-plex-mono-500.woff2"
];
const forbidden = [
  /^ServerStory\/tests\//,
  /^ServerStory\/scripts\//,
  /^ServerStory\/src\//,
  /^ServerStory\/docs\//,
  /^ServerStory\/README\.md$/,
  /^ServerStory\/CHANGELOG\.md$/,
  /^ServerStory\/index\.html$/,
  /^ServerStory\/favicon\.png$/,
  /^ServerStory\/serverstory-logo\.png$/,
  /^ServerStory\/screenshot\.png$/,
  /^ServerStory\/fonts\//,
  /^ServerStory\/serverstory-logs\//,
  /^ServerStory\/package\.json$/,
  /^ServerStory\/\.git/
];

const failures = [];
for (const file of required) if (!entries.includes(file)) failures.push(`missing ${file}`);
for (const entry of entries) {
  if (!entry.startsWith("ServerStory/")) failures.push(`unexpected root entry ${entry}`);
  const rest = entry.slice("ServerStory/".length);
  if (!rest) continue;
  if (!rest.startsWith("serverstory-app/") && rest !== "START_HIER.html") {
    failures.push(`unexpected visible root entry ${entry}`);
  }
  if (forbidden.some((re) => re.test(entry))) failures.push(`forbidden entry ${entry}`);
  if (/\.(log|zip|tar|tgz|gz|7z|rar)$/i.test(entry)) failures.push(`forbidden payload type ${entry}`);
}

const starterPath = path.join(root, "dist", "ServerStory", "START_HIER.html");
if (!fs.existsSync(starterPath)) failures.push("missing staged START_HIER.html");
else {
  const starter = fs.readFileSync(starterPath, "utf8");
  if (!starter.includes("serverstory-app/index.html")) {
    failures.push("START_HIER.html does not point to serverstory-app/index.html");
  }
}

if (failures.length) {
  console.error("release audit failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log(`release audit ok (${entries.length} entries)`);
