const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");
const srcDir = path.join(root, "src");
const scriptPath = path.join(srcDir, "app.js");
const stylePath = path.join(srcDir, "styles.css");
const templatePath = path.join(srcDir, "index.template.html");

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

const template = fs.readFileSync(templatePath, "utf8");
if (!template.includes("{{STYLE}}") || !template.includes("{{SCRIPT}}")) throw new Error("Build template is missing placeholders.");
let next = template
  .replace("{{STYLE}}", () => fs.readFileSync(stylePath, "utf8"))
  .replace("{{SCRIPT}}", () => fs.readFileSync(scriptPath, "utf8"));
fs.writeFileSync(indexPath, next);
console.log("built index.html from src/");
