const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const candidates = [
  process.env.CHROME_BIN,
  "/home/emilian/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
  "/home/emilian/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome"
].filter(Boolean);

const chrome = candidates.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.warn("browser e2e skipped: no Chromium/Chrome binary found");
  process.exit(0);
}

const harness = `file://${path.join(root, "tests", "browser-e2e.html")}`;
const result = spawnSync(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--allow-file-access-from-files",
  "--dump-dom",
  "--virtual-time-budget=8000",
  harness
], { cwd: root, encoding: "utf8" });

if (result.error && result.error.code === "EPERM") {
  console.warn("browser e2e skipped: Chromium child process is blocked by this sandbox");
  process.exit(0);
}
if (result.status !== 0) {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  throw new Error(`browser e2e failed with status ${result.status}`);
}
if (!result.stdout.includes("SERVERSTORY_E2E_PASS")) {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  throw new Error("browser e2e did not report PASS");
}

console.log("browser e2e ok");
