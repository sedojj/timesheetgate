// Builds the demo page and saves the store screenshots (1280×800 JPEG, no alpha) to
// docs/store/. Run from extension/: node demo/shoot.js
const esbuild = require("esbuild");
const { execFileSync } = require("child_process");
const { mkdirSync } = require("fs");
const { join } = require("path");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = join(__dirname, "..", "..", "docs", "store");
mkdirSync(out, { recursive: true });

esbuild.buildSync({
  entryPoints: [join(__dirname, "demo.tsx")], bundle: true, outfile: join(__dirname, "out", "demo.js"),
  format: "iife", target: "chrome114", jsx: "automatic", jsxImportSource: "preact", logLevel: "warning",
});

for (const scene of ["week", "meetings"]) {
  const png = join(__dirname, "out", `${scene}.png`);
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1280,800",
    "--virtual-time-budget=3000", `--screenshot=${png}`, `file://${join(__dirname, "demo.html")}?scene=${scene}`,
  ], { stdio: "pipe", env: { ...process.env, TZ: "Europe/Prague" } });
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", png, "--out", join(out, `screenshot-${scene}.jpg`)], { stdio: "pipe" });
  console.log(join("docs", "store", `screenshot-${scene}.jpg`));
}
