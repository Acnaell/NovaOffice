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
      await p.reload();
      await p.waitForSelector('.page');
      await p.focus('.page');
      await h.settle(80);
    },
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
    async type(text) { await p.keyboard.type(text); await h.settle(); },
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

module.exports = { core, makeHelpers, blockText };
