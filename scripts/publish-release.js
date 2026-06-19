const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tag = process.argv[2] || process.env.RELEASE_TAG;
const zipPath = path.join(root, "dist", "serverstory.zip");
const manifestPath = path.join(root, "dist", "serverstory-release-manifest.json");

if (!tag) {
  console.error("Usage: npm run publish:release -- v1.0.1");
  process.exit(1);
}
if (!fs.existsSync(zipPath) || !fs.existsSync(manifestPath)) {
  console.error("Run npm run build:release before publishing.");
  process.exit(1);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status || 1);
}

run("npm", ["run", "audit:release"]);
run("npm", ["run", "smoke:release"]);

const notes = [
  "ServerStory Nutzer-ZIP.",
  "",
  "Download fuer normale Nutzer: serverstory.zip",
  "Pruefdatei: serverstory-release-manifest.json enthaelt SHA256 und ZIP-Groesse."
].join("\n");

const view = spawnSync("gh", ["release", "view", tag], { cwd: root, stdio: "ignore" });
if (view.status !== 0) {
  run("gh", ["release", "create", tag, "--title", `ServerStory ${tag}`, "--notes", notes]);
}

run("gh", ["release", "upload", tag, zipPath, manifestPath, "--clobber"]);
console.log(`published release assets for ${tag}`);
