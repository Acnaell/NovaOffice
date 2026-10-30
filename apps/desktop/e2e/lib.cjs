// Utilitários para dirigir o Nova Text como um usuário: teclado, mouse,
// área de transferência, com o núcleo real por trás (ponte em 127.0.0.1:1430).
const API = 'http://127.0.0.1:1430/';

async function core(cmd, args = {}) {
  const r = await fetch(API + cmd, { method: 'POST', body: JSON.stringify(args) });
  const j = await r.json();
  if ('err' in j) throw new Error(j.err);
  return j.ok;
}

const blockText = (b) => b.spans.map((s) => s.text).join('');

// Lê um .docx/.odt (zip) sem o `unzip` do sistema, que não existe no Windows:
// percorre o diretório central e descomprime com o zlib do Node.
function zipEntries(path) {
  const buf = require('fs').readFileSync(path);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${path} não é um zip`);
  const entries = new Map();
  let at = buf.readUInt32LE(end + 16);
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : require('zlib').inflateRawSync(data);
    });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return entries;
}

/** Nomes das partes do zip (como `unzip -l`). */
const zipList = (path) => [...zipEntries(path).keys()];

/** Texto de uma parte do zip (como `unzip -p`). */
function zipRead(path, name) {
  const read = zipEntries(path).get(name);
  if (!read) throw new Error(`${name} não está em ${path}`);
  return read().toString('utf8');
}

function makeHelpers(p) {
  const h = {
    p,
    async doc() { return core('snapshot'); },
    async texts() { return (await core('snapshot')).blocks.map(blockText); },
    async styles() { return (await core('snapshot')).blocks.map((b) => b.style); },
    async settle(ms = 120) {
      // Espera a fila de comandos do app esvaziar.
      await p.waitForTimeout(ms);
    },
    /** Documento novo, opcionalmente com parágrafos, e a página recarregada. */
    async reset(paragraphs = null) {
      await core('new_document');
      if (paragraphs) {
        const cmds = [];
        paragraphs.forEach((t, i) => {
          if (i === 0) { if (t) cmds.push({ type: 'text.insert', block: 0, offset: 0, text: t }); }
          else cmds.push({ type: 'block.insert', index: i, text: t });
        });
        if (cmds.length) await core('dispatch', { command: { type: 'batch', commands: cmds } });
      }
      await h.reload();
    },
    /** Recarrega a interface; na tela inicial (documento vazio), entra no documento em branco. */
    async reload() {
      await p.reload();
      await p.waitForSelector('.page');
      await h.settle(60);
      if (await p.locator('.backstage').count()) {
        await p.locator('.bs-tile').first().click();
        await p.waitForSelector('.backstage', { state: 'detached' });
      }
      await p.focus('.page');
      await h.settle(80);
    },
    /** Último pedido feito a uma janela de diálogo (abrir/salvar). */
    async lastDialog(kind) {
      return p.evaluate((k) => [...window.__calls].reverse().find((c) => c.cmd === 'plugin:dialog|' + k)?.args.options, kind);
    },
    async modalVisible() { return (await p.locator('.modal').count()) > 0; },
    /** Põe o cursor (ou seleção) por posição de modelo, como um clique faria. */
    async select(b1, o1, b2 = b1, o2 = o1) {
      await p.evaluate(([b1, o1, b2, o2]) => {
        const point = (b, o) => {
          const el = document.querySelector(`[data-block="${b}"]`);
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let n, left = o;
          while ((n = walker.nextNode())) {
            if (left <= n.length) return [n, left];
            left -= n.length;
          }
          return [el, 0];
        };
        const [n1, x1] = point(b1, o1);
        const [n2, x2] = point(b2, o2);
        document.querySelector('.page').focus();
        const s = window.getSelection();
        s.setBaseAndExtent(n1, x1, n2, x2);
      }, [b1, o1, b2, o2]);
      await h.settle(60);
    },
    async type(text) { await p.keyboard.type(text); await h.idle(); },
    /** Espera o documento parar de mudar (a fila de edições do app esvaziar). */
    async idle(max = 3000) {
      await h.settle(60);
      let last = JSON.stringify(await core('snapshot'));
      for (let waited = 0; waited < max; waited += 80) {
        await p.waitForTimeout(80);
        const now = JSON.stringify(await core('snapshot'));
        if (now === last) return;
        last = now;
      }
    },
    async press(keys) { for (const k of keys.split(' ')) await p.keyboard.press(k); await h.settle(); },
    /** Digita um marcador para descobrir onde o cursor está; devolve os textos. */
    async caretProbe() { await p.keyboard.type('§'); await h.settle(); return h.texts(); },
    /** Texto e marcas por trecho de um bloco. */
    async spans(block = 0) { return (await core('snapshot')).blocks[block].spans; },
    async clickRibbon(label) {
      const btn = p.locator(`button[aria-label="${label}"], button[title^="${label}"]`).first();
      await btn.click();
      await h.settle();
    },
    async domSelectionText() { return p.evaluate(() => window.getSelection().toString()); },
    async setClipboard({ text, html }) {
      await p.evaluate(async ({ text, html }) => {
        const items = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
        if (html) items['text/html'] = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem(items)]);
      }, { text, html });
    },
    async readClipboard() { return p.evaluate(() => navigator.clipboard.readText()); },
  };
  return h;
}

module.exports = { core, makeHelpers, blockText, zipList, zipRead };
