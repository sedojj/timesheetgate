// Bundles the extension into dist/. Version = 0.<git commit count>.
const esbuild = require("esbuild");
const { execSync } = require("child_process");
const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/sidepanel", { recursive: true });

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = `0.${execSync("git rev-list --count HEAD").toString().trim()}`;
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
cpSync("src/sidepanel/sidepanel.html", "dist/sidepanel/sidepanel.html");
cpSync("src/sidepanel/sidepanel.css", "dist/sidepanel/sidepanel.css");

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    page: "src/page.ts",
    "sidepanel/index": "src/sidepanel/index.tsx",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome114",
  jsx: "automatic",
  jsxImportSource: "preact",
  logLevel: "info",
};

if (watch) esbuild.context(options).then((c) => c.watch());
else esbuild.build(options).catch(() => process.exit(1));
