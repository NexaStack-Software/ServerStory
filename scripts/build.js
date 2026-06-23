const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");
const srcDir = path.join(root, "src");
const modulesDir = path.join(srcDir, "modules");
const scriptPath = path.join(srcDir, "app.js");
const stylePath = path.join(srcDir, "styles.css");
const templatePath = path.join(srcDir, "index.template.html");
const moduleFiles = [
  "01-core.js",
  "02-ga4.js",
  "04-parser-aggregator.js",
  "03-preflight.js",
  "05-worker.js",
  "06-claims.js",
  "07-render.js"
];

function parseModuleContract(file, text) {
  const header = text.slice(0, 1200);
  const provides = [];
  const requires = [];
  for (const match of header.matchAll(/\/\/\s*@(provides|requires)\s+([^\n]+)/g)) {
    const target = match[1] === "provides" ? provides : requires;
    target.push(...match[2].split(",").map((item) => item.trim()).filter(Boolean));
  }
  if (!provides.length) throw new Error(`${file} is missing // @provides module metadata`);
  return { provides, requires };
}

function validateModuleContracts(modules) {
  const allProvided = new Set(modules.flatMap((module) => module.contract.provides));
  for (const module of modules) {
    const missing = module.contract.requires.filter((name) => !allProvided.has(name));
    if (missing.length) throw new Error(`${module.file} requires unknown globals: ${missing.join(", ")}`);
  }
  const providedSoFar = new Set();
  for (const module of modules) {
    const outOfOrder = module.contract.requires.filter((name) => !providedSoFar.has(name));
    if (outOfOrder.length) throw new Error(`${module.file} is ordered before required globals: ${outOfOrder.join(", ")}`);
    for (const name of module.contract.provides) {
      if (providedSoFar.has(name)) throw new Error(`${module.file} provides duplicate global: ${name}`);
      providedSoFar.add(name);
    }
  }
}

function extractBetween(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Marker not found: ${start}`);
  return text.slice(a + start.length, b);
}

function replaceBetween(text, start, end, value) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Marker not found: ${start}`);
  return text.slice(0, a + start.length) + value + text.slice(b);
}

fs.mkdirSync(srcDir, { recursive: true });
const html = fs.readFileSync(indexPath, "utf8");

if (process.argv.includes("--extract")) {
  const style = extractBetween(html, "<style>", "</style>");
  const script = extractBetween(html, "<script>", "</script>");
  fs.writeFileSync(stylePath, style);
  fs.writeFileSync(scriptPath, script);
  let template = replaceBetween(html, "<style>", "</style>", "\n{{STYLE}}\n    ");
  template = replaceBetween(template, "<script>", "</script>", "\n{{SCRIPT}}\n    ");
  fs.writeFileSync(templatePath, template);
  console.log("extracted src/index.template.html, src/styles.css and src/app.js");
  process.exit(0);
}

if (!fs.existsSync(templatePath) || !fs.existsSync(stylePath) || !fs.existsSync(scriptPath)) {
  throw new Error("Missing src files. Run: node scripts/build.js --extract");
}

if (fs.existsSync(modulesDir)) {
  const missing = moduleFiles.filter((file) => !fs.existsSync(path.join(modulesDir, file)));
  if (missing.length) throw new Error(`Missing src/modules files: ${missing.join(", ")}`);
  const modules = moduleFiles.map((file) => {
    const text = fs.readFileSync(path.join(modulesDir, file), "utf8").replace(/\s+$/g, "");
    return { file, text, contract: parseModuleContract(file, text) };
  });
  validateModuleContracts(modules);
  const bundledScript = modules.map((module) => module.text).join("\n\n");
  fs.writeFileSync(scriptPath, bundledScript + "\n");
}

const template = fs.readFileSync(templatePath, "utf8");
if (!template.includes("{{STYLE}}") || !template.includes("{{SCRIPT}}")) throw new Error("Build template is missing placeholders.");
let next = template
  .replace("{{STYLE}}", () => fs.readFileSync(stylePath, "utf8"))
  .replace("{{SCRIPT}}", () => fs.readFileSync(scriptPath, "utf8"));
fs.writeFileSync(indexPath, next);
console.log("built index.html from src/");
