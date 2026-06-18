const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const staging = path.join(dist, "ServerStory");
const zipPath = path.join(dist, "serverstory.zip");

const files = [
  "START_HIER.html",
  "index.html",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "favicon.png",
  "serverstory-logo.png",
  "screenshot.png",
  "fonts/OFL.txt",
  "fonts/ibm-plex-mono-400.woff2",
  "fonts/ibm-plex-mono-500.woff2"
];

function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function copyFile(rel) {
  const src = path.join(root, rel);
  const dst = path.join(staging, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

run("npm", ["run", "build"]);
fs.rmSync(staging, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.mkdirSync(staging, { recursive: true });
for (const file of files) copyFile(file);
run("zip", ["-qr", zipPath, "ServerStory"], dist);
console.log(`release built: ${path.relative(root, zipPath)}`);
