const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const staging = path.join(dist, "ServerStory");
const appDir = path.join(staging, "serverstory-app");
const zipPath = path.join(dist, "serverstory.zip");

const appFiles = [
  "index.html",
  "LICENSE",
  "favicon.png",
  "serverstory-logo.png",
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
  const dst = path.join(appDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function writeStarter() {
  fs.writeFileSync(path.join(staging, "START_HIER.html"), `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=serverstory-app/index.html">
    <title>ServerStory starten</title>
    <style>
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f6f4ef;
        color: #171717;
      }
      main {
        max-width: 36rem;
        padding: 2rem;
      }
      a {
        color: #0f5f73;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>ServerStory wird gestartet</h1>
      <p>Falls nichts passiert, öffne <a href="serverstory-app/index.html">ServerStory manuell</a>.</p>
    </main>
  </body>
</html>
`);
}

run("npm", ["run", "build"]);
fs.rmSync(staging, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.mkdirSync(staging, { recursive: true });
writeStarter();
for (const file of appFiles) copyFile(file);
run("zip", ["-qr", zipPath, "ServerStory"], dist);
console.log(`release built: ${path.relative(root, zipPath)}`);
