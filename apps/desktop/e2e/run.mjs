// Roda os fluxos do Word (flows.cjs) no Nova Text de verdade: sobe a ponte com
// o núcleo Rust e o build de produção da interface, abre no Chromium e grava
// RESULTADOS.md. Sai com erro se algum fluxo falhar ("ausente" não é falha).
//
//   npm run build && npm run e2e            todos os fluxos
//   npm run e2e -- "Fonte|Parágrafo"        só os que combinam com o filtro
//
// CHROMIUM_PATH aponta para um Chromium já instalado (senão, o do Playwright).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const { chromium } = require("playwright");
const { makeHelpers } = require("./lib.cjs");
const { flows } = require("./flows.cjs");

const URL = "http://localhost:1421";
const children = [];
const start = (cmd, args, opts = {}) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"], ...opts });
  children.push(child);
  return child;
};
const stopAll = () => children.forEach((c) => c.kill());
process.on("exit", stopAll);

async function waitFor(url, init) {
  for (let i = 0; i < 600; i++) {
    try {
      const r = await fetch(url, init);
      if (r.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} não respondeu`);
}

// Os fluxos usam /tmp/nova-flows para os arquivos de abrir e salvar (Linux e macOS).
mkdirSync("/tmp/nova-flows", { recursive: true });
start("cargo", ["run", "--quiet", "--release", "--manifest-path", join(here, "bridge", "Cargo.toml")]);
start("npx", ["vite", "preview", "--port", "1421", "--strictPort"], { cwd: desktop, shell: process.platform === "win32" });
await waitFor("http://127.0.0.1:1430/snapshot", { method: "POST" });
await waitFor(URL);

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "pt-BR" });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript({ path: join(here, "tauri-mock.js") });
// Exportar PDF: o app no Windows usa o PrintToPdf do WebView2 (Chromium); aqui, o mesmo motor pelo Playwright.
await page.exposeBinding("__renderPdf", async ({ page }, path) => {
  await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
});
await page.goto(URL);
await page.waitForSelector(".page");
const h = makeHelpers(page);

const results = [];
for (const f of flows) {
  if (only && !only.test(f.name) && !only.test(f.area)) continue;
  const before = errors.length;
  let r;
  try {
    r = await Promise.race([f.run(h), new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), 90000))]);
  } catch (e) {
    r = { status: "falha", obs: "Erro no teste: " + String(e.message).split("\n")[0] };
  }
  if (errors.length > before) {
    r = { status: "falha", obs: `${r.obs} [erro de JavaScript na página: ${errors.slice(before).join(" | ")}]` };
  }
  results.push({ area: f.area, name: f.name, ...r });
  console.log(`${r.status.padEnd(8)} ${f.area} — ${f.name}${r.obs ? "  :: " + r.obs : ""}`);
}
await browser.close();

const count = (s) => results.filter((r) => r.status === s).length;
const icon = { ok: "✅", parcial: "🟡", falha: "❌", ausente: "⬜" };
const md = [
  "# Fluxos do Word no Nova Text",
  "",
  "Gerado por `npm run e2e` (apps/desktop/e2e). Cada fluxo dirige a interface real com o núcleo Rust real.",
  "",
  `**${count("ok")} funcionam · ${count("parcial")} parciais · ${count("falha")} com falha · ${count("ausente")} ainda não existem**`,
  "",
  "| | Área | Fluxo | Observação |",
  "| --- | --- | --- | --- |",
  ...results.map((r) => `| ${icon[r.status]} | ${r.area} | ${r.name} | ${(r.obs || "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
  "",
].join("\n");
if (!only) writeFileSync(join(here, "RESULTADOS.md"), md);
console.log(`\n${count("ok")} ok · ${count("parcial")} parciais · ${count("falha")} falhas · ${count("ausente")} ausentes`);
stopAll();
process.exit(count("falha") > 0 ? 1 : 0);
