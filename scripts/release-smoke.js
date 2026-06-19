const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const zipPath = path.join(root, "dist", "serverstory.zip");

if (!fs.existsSync(zipPath)) throw new Error("dist/serverstory.zip does not exist. Run npm run build:release first.");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "serverstory-release-"));

function fail(message) {
  throw new Error(`release smoke failed: ${message}`);
}

function read(rel) {
  return fs.readFileSync(path.join(tmp, rel), "utf8");
}

try {
  const unzip = spawnSync("unzip", ["-q", zipPath, "-d", tmp], { encoding: "utf8" });
  if (unzip.status !== 0) {
    process.stdout.write(unzip.stdout || "");
    process.stderr.write(unzip.stderr || "");
    fail("could not extract release zip");
  }

  const visible = fs.readdirSync(path.join(tmp, "ServerStory")).sort();
  const expectedRoot = ["START_HIER.html", "serverstory-app"];
  if (JSON.stringify(visible) !== JSON.stringify(expectedRoot)) {
    fail(`visible root entries are ${visible.join(", ")}`);
  }

  const starter = read("ServerStory/START_HIER.html");
  if (!starter.includes("serverstory-app/index.html")) fail("START_HIER.html does not point to app index");
  if (/README|CHANGELOG|src\/|tests\/|scripts\//i.test(starter)) fail("START_HIER.html exposes developer paths");

  const appEntries = fs.readdirSync(path.join(tmp, "ServerStory", "serverstory-app")).sort();
  for (const required of ["LICENSE", "favicon.png", "fonts", "index.html", "serverstory-logo.png"]) {
    if (!appEntries.includes(required)) fail(`serverstory-app missing ${required}`);
  }

  const app = read("ServerStory/serverstory-app/index.html");
  if (!app.includes("Content-Security-Policy")) fail("app index missing CSP");
  if (!app.includes("connect-src 'none'")) fail("app index does not block network connections");
  if (!app.includes("Datei kurz prüfen")) fail("app index missing preflight button text");
  if (!app.includes("Jetzt auswerten")) fail("app index missing run button text");
  if (!app.includes("guided-box")) fail("app index missing guided diagnosis UI");
  if (app.includes("{{SCRIPT}}") || app.includes("{{STYLE}}")) fail("build placeholders leaked into app index");

  console.log("release smoke ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
