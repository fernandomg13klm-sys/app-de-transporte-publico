// Junta toda la app en un solo archivo HTML (dist/MueveT.html) que se abre con doble clic.
// Uso: node tools/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pub = (f) => readFileSync(path.join(root, "public", f), "utf8");

let html = pub("index.html")
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replace(/\s*<link rel="icon"[^>]*>/, "")
  .replace('<link rel="stylesheet" href="css/styles.css">', () => `<style>\n${pub("css/styles.css")}</style>`)
  .replace(/<script src="(js\/[\w.]+)"><\/script>/g, (_, f) => `<script>\n${pub(f).replace(/<\/script/gi, "<\\/script")}</script>`);

if (/src="js\/|href="css\//.test(html)) throw new Error("Quedó un archivo sin incluir");
mkdirSync(path.join(root, "dist"), { recursive: true });
writeFileSync(path.join(root, "dist", "MueveT.html"), html);
console.log(`dist/MueveT.html listo (${(html.length / 1024).toFixed(0)} KB)`);
