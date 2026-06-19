const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

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
  console.warn("visual smoke skipped: no Chromium/Chrome binary found");
  process.exit(0);
}

function parsePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error(`${file}: not a PNG`);
  }
  let offset = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`${file}: unsupported PNG format`);
  }
  return { width, height, colorType, data: zlib.inflateSync(Buffer.concat(idat)) };
}

function assertNonBlank(file, expectedWidth, expectedHeight) {
  const png = parsePng(file);
  if (png.width !== expectedWidth || png.height !== expectedHeight) {
    throw new Error(`${file}: expected ${expectedWidth}x${expectedHeight}, got ${png.width}x${png.height}`);
  }
  const channels = png.colorType === 6 ? 4 : 3;
  const stride = 1 + png.width * channels;
  let colored = 0, nonWhite = 0, samples = 0, sum = 0, sumSq = 0;
  for (let y = 0; y < png.height; y += 8) {
    const row = y * stride;
    for (let x = 0; x < png.width; x += 8) {
      const i = row + 1 + x * channels;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      const lum = (r + g + b) / 3;
      samples++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 8) colored++;
      if (lum < 245) nonWhite++;
      sum += lum;
      sumSq += lum * lum;
    }
  }
  const coloredShare = colored / samples;
  const nonWhiteShare = nonWhite / samples;
  const mean = sum / samples;
  const variance = Math.max(0, sumSq / samples - mean * mean);
  if (nonWhiteShare < 0.03 || variance < 80 || coloredShare < 0.003) {
    throw new Error(`${file}: screenshot looks blank (colored=${coloredShare.toFixed(3)}, nonWhite=${nonWhiteShare.toFixed(3)}, variance=${variance.toFixed(1)})`);
  }
}

function screenshot(name, width, height) {
  const out = path.join(os.tmpdir(), `serverstory-${name}.png`);
  const url = `file://${path.join(root, "index.html")}`;
  const result = spawnSync(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--allow-file-access-from-files",
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
    url
  ], { cwd: root, encoding: "utf8" });
  if (result.error && result.error.code === "EPERM") {
    console.warn("visual smoke skipped: Chromium child process is blocked by this sandbox");
    process.exit(0);
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`visual smoke failed with status ${result.status}`);
  }
  if (!fs.existsSync(out)) throw new Error(`visual smoke failed: ${out} was not created`);
  assertNonBlank(out, width, height);
  fs.rmSync(out, { force: true });
}

screenshot("desktop", 1366, 900);
screenshot("mobile", 390, 844);
console.log("visual smoke ok");
