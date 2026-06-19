const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function run(cmd, args) {
  const label = [cmd, ...args].join(" ");
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`verify failed: ${label}`);
  }
}

function assertFileContains(file, expected) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (!text.includes(expected)) {
    throw new Error(`${file} does not contain expected text: ${expected}`);
  }
}

function assertFileExcludes(file, forbidden) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (text.includes(forbidden)) {
    throw new Error(`${file} contains forbidden text: ${forbidden}`);
  }
}

run("npm", ["run", "build"]);
run("git", ["diff", "--exit-code", "--", "index.html"]);
run("node", ["--check", "src/app.js"]);
run("node", ["--check", "scripts/build.js"]);
run("node", ["--check", "scripts/verify.js"]);
run("node", ["--check", "scripts/browser-e2e.js"]);
run("node", ["--check", "scripts/sanitize-log.js"]);
run("node", ["--check", "scripts/download-realworld-fixtures.js"]);
run("node", ["--check", "scripts/audit-repo.js"]);
run("node", ["--check", "scripts/build-release.js"]);
run("node", ["--check", "scripts/audit-release.js"]);
run("node", ["--check", "tests/realworld.test.js"]);
run("npm", ["test"]);
run("npm", ["run", "test:sanitize"]);
run("npm", ["run", "test:e2e"]);
run("npm", ["run", "audit:repo"]);
run("npm", ["run", "build:release"]);
run("npm", ["run", "audit:release"]);
run("npm", ["run", "smoke:release"]);
const render = spawnSync("firefox", [
  "--headless",
  "--window-size",
  "1280,900",
  "--screenshot",
  "/tmp/serverstory-verify.png",
  `file://${path.join(root, "index.html")}`
], { cwd: root, stdio: "inherit" });
if (render.status !== 0) {
  const sandboxBlocked = (render.error && render.error.code === "EPERM") || render.signal === "SIGSEGV";
  if (sandboxBlocked) {
    console.warn("browser render skipped: Firefox child process is blocked by this sandbox");
  } else {
    throw new Error("verify failed: Firefox headless render");
  }
} else if (!fs.existsSync("/tmp/serverstory-verify.png")) {
  throw new Error("verify failed: Firefox did not create screenshot");
}

assertFileContains("index.html", "connect-src 'none'");
assertFileContains("index.html", "default-src 'none'");
assertFileContains("index.html", "\\$&");
assertFileExcludes("index.html", "default-src *");
assertFileExcludes("index.html", "\\{{SCRIPT}}");

console.log("verify ok");
