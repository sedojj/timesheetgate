// Renders icons/icon.svg to the PNG sizes Chrome needs. Run: node icons/render.js
const { Resvg } = require("@resvg/resvg-js");
const { readFileSync, writeFileSync } = require("fs");
const svg = readFileSync(__dirname + "/icon.svg", "utf8");
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(`${__dirname}/icon-${size}.png`, png);
}
console.log("ok");
