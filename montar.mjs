// Monta a estrutura de pastas que o Netlify espera a partir dos arquivos na raiz do repositório.
// Assim o projeto funciona mesmo quando o envio pelo navegador não preserva as pastas.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

const MAPA = {
  "index.html": "public/index.html",
  "app.js": "public/app.js",
  "comum.js": "public/comum.js",
  "estilo.css": "public/estilo.css",
  "sw.js": "public/sw.js",
  "manifest.webmanifest": "public/manifest.webmanifest",
  "logo.png": "public/logo.png",
  "icone-192.png": "public/icone-192.png",
  "icone-512.png": "public/icone-512.png",
  "coordenacao.html": "public/coordenacao/index.html",
  "coord.js": "public/coordenacao/coord.js",
  "jspdf.umd.min.js": "public/vendor/jspdf.umd.min.js",
  "jspdf.plugin.autotable.min.js": "public/vendor/jspdf.plugin.autotable.min.js",
  "fn-api.mjs": "netlify/functions/api.mjs",
  "fn-lembretes.mjs": "netlify/functions/lembretes.mjs",
  "auth.mjs": "netlify/lib/auth.mjs",
  "extrato.mjs": "netlify/lib/extrato.mjs",
  "util.mjs": "netlify/lib/util.mjs",
  "estrutura.mjs": "netlify/lib/estrutura.mjs",
  "db.mjs": "netlify/lib/db.mjs",
  "rotas-coord.mjs": "netlify/lib/rotas-coord.mjs",
  "regras.mjs": "netlify/lib/regras.mjs",
  "rotas-cuidadora.mjs": "netlify/lib/rotas-cuidadora.mjs",
  "push.mjs": "netlify/lib/push.mjs"
};

const faltando = [];
for (const [origem, destino] of Object.entries(MAPA)) {
  if (existsSync(origem)) {
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(origem, destino);
  } else if (!existsSync(destino)) {
    faltando.push(origem);
  }
}
if (faltando.length) {
  console.error("Arquivos que faltam no repositório: " + faltando.join(", "));
  process.exit(1);
}
console.log("Estrutura montada com " + Object.keys(MAPA).length + " arquivos.");
