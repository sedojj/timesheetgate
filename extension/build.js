// Bundles the extension into dist/ (load unpacked). Version = 0.<git commit count>.
// --store: into dist-store/ without the "key" (the Chrome Web Store assigns its own ID), then
// timesheetgate-<version>.zip for upload. dist/ keeps the fixed ID of the unpacked install.
const esbuild = require("esbuild");
const { execSync } = require("child_process");
const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");

const watch = process.argv.includes("--watch");
const store = process.argv.includes("--store");
const out = store ? "dist-store" : "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/sidepanel`, { recursive: true });

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = `0.${execSync("git rev-list --count HEAD").toString().trim()}`;
if (store) delete manifest.key;
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
cpSync("src/sidepanel/sidepanel.html", `${out}/sidepanel/sidepanel.html`);
cpSync("src/sidepanel/sidepanel.css", `${out}/sidepanel/sidepanel.css`);
mkdirSync(`${out}/icons`, { recursive: true });
for (const size of [16, 32, 48, 128]) cpSync(`icons/icon-${size}.png`, `${out}/icons/icon-${size}.png`);

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    page: "src/page.ts",
    "sidepanel/index": "src/sidepanel/index.tsx",
  },
  bundle: true,
  outdir: out,
  format: "iife",
  target: "chrome114",
  jsx: "automatic",
  jsxImportSource: "preact",
  logLevel: "info",
};

function zipForStore() {
  const zip = `timesheetgate-${manifest.version}.zip`;
  rmSync(zip, { force: true });
  execSync(`cd ${out} && zip -qr ../${zip} .`); // manifest.json at the zip's root, as the store wants
  console.log(zip);
}

if (watch) esbuild.context(options).then((c) => c.watch());
else esbuild.build(options).then(() => store && zipForStore()).catch(() => process.exit(1));
