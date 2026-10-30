// Fluxos básicos do Microsoft Word aplicados ao Nova Text.
// status: ok | parcial (funciona com defeito/limitação) | falha (existe, mas quebrado) | ausente
const { core, zipList, zipRead } = require('./lib.cjs');

const OK = (obs = '') => ({ status: 'ok', obs });
const PARCIAL = (obs) => ({ status: 'parcial', obs });
const FALHA = (obs) => ({ status: 'falha', obs });
const AUSENTE = (obs) => ({ status: 'ausente', obs });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Igualdade de objetos sem depender da ordem das chaves (a ponte devolve em ordem alfabética). */
const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const same = (a, b) => eq(sorted(a), sorted(b));
/** Resposta de releases/latest do GitHub para o tauri-mock.js (vale depois de recarregar). */
const release = (tag, { prerelease = false } = {}) => JSON.stringify({
  tag_name: tag,
  html_url: `https://github.com/Acnaell/NovaOffice/releases/tag/${tag}`,
  draft: false,
  prerelease,
  body: `## O que mudou\r\n* Aba **Exibir** com zoom by @Acnaell in https://github.com/Acnaell/NovaOffice/pull/12\r\n* Painel de Navegação\r\n\r\n**Full Changelog**: https://github.com/Acnaell/NovaOffice/compare/v0.1.6...${tag}`,
  assets: [`NovaOffice_${tag.slice(1)}_x64-setup.exe`, `NovaOffice_${tag.slice(1)}_x64-setup.exe.sha256`].map((name) => ({
    name, size: 4200000, browser_download_url: `https://github.com/Acnaell/NovaOffice/releases/download/${tag}/${name}`,
  })),
});
/** Abre o app com a release simulada (e opções do mock); `fn` roda e o mock volta ao normal. */
const withRelease = async (h, mock, fn) => {
  await h.p.evaluate((m) => { for (const [k, v] of Object.entries(m)) sessionStorage.setItem(k, v); }, mock);
  try {
    return await fn();
  } finally {
    await h.p.evaluate(() => { ['mock.release', 'mock.windows', 'mock.download'].forEach((k) => sessionStorage.removeItem(k)); localStorage.removeItem('nova.update.notify'); });
    await h.reload();
  }
};
const updateBar = (h) => h.p.locator('.update-bar');
/** Textos sublinhados pelo corretor, depois de ele ter tempo de responder. */
const underlined = async (h, wait = 700) => {
  await h.settle(wait);
  return h.p.evaluate(() => {
    const hl = CSS.highlights.get('nova-spell');
    return hl ? [...hl].map((r) => r.toString()) : [];
  });
};

/** Clique direito no meio de uma palavra sublinhada; devolve as sugestões do menu. */
const spellMenu = async (h, word) => {
  const at = await h.p.evaluate((w) => {
    const r = [...CSS.highlights.get('nova-spell')].find((x) => x.toString() === w);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, word);
  await h.p.mouse.click(at.x, at.y, { button: 'right' });
  await h.p.waitForSelector('.spell-menu .menu-item');
  await h.p.waitForFunction(() => !document.querySelector('.spell-menu')?.textContent.includes('Procurando'));
  return h.p.locator('.spell-menu .spell-suggestion').allInnerTexts();
};

const marksOf = (spans) => spans.map((s) => [s.text, s.marks.map((m) => m.mark).sort().join('+')]);

/** Atalho do Word que não existe no Nova: confere que não estraga o documento. */
const absentShortcut = (keys, what, setup = ['Texto de exemplo']) => async (h) => {
  await h.reset(setup);
  await h.select(0, 0, 0, 5);
  const before = JSON.stringify(await h.doc());
  await h.press(keys);
  const after = JSON.stringify(await h.doc());
  const harmless = before === after;
  return AUSENTE(`${what} não existe; ${keys} ${harmless ? 'não altera o documento' : 'ALTERA o documento de forma inesperada'}.`);
};

/** PNG 64×32 (azul com um círculo), gerado para os testes. */
const PNG_64x32 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAk0lEQVR42mPUqjjJMJQBE8MQB6MeGPXAqAdGPTCwgIV2Rh+WWYzMtX0SO2Q8gOZ0ZEGqe4OJPq4nUnbgPUCM+6jrByY6u57qfhgtRskNVGpFwmgMjHpg1ANUAqRWsdSqkkdjgKxApWKLiMoxQIzLqNueo34Swu8+qrdGadKchrhyCPcHaOri0VJo1AOjHhj1wKACAL2oJzHC/B0+AAAAAElFTkSuQmCC';

const flows = [
  // ───────────── Digitação e edição
  { area: 'Digitação', name: 'Digitar texto com acentos e cedilha', run: async (h) => {
    await h.reset(); await h.type('Ação, coração, pão, você, über, ñ.');
    const t = await h.texts();
    return eq(t, ['Ação, coração, pão, você, über, ñ.']) ? OK() : FALHA(`Resultado: ${JSON.stringify(t)}`);
  } },
  { area: 'Digitação', name: 'Acento por tecla morta / IME (composição)', run: async (h) => {
    await h.reset(['']);
    const cdp = await h.p.context().newCDPSession(h.p);
    await cdp.send('Input.imeSetComposition', { text: '´', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'á', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: 'á' });
    await h.settle(200);
    await h.type('gua');
    const t = await h.texts();
    return eq(t, ['água']) ? OK('Composição gera o caractere final uma única vez.') : FALHA(`Resultado: ${JSON.stringify(t)}`);
  } },
  { area: 'Digitação', name: 'Acento composto no meio de uma palavra existente (tecla morta)', run: async (h) => {
    await h.reset(['cao']); await h.select(0, 2);
    const cdp = await h.p.context().newCDPSession(h.p);
    await cdp.send('Input.imeSetComposition', { text: '~', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'ã', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: 'ã' });
    await h.settle(200);
    // o "a" original continua; o ã entra antes do "o"
    const t = await h.caretProbe();
    return eq(t, ['caã§o']) ? OK() : FALHA(`Resultado: ${JSON.stringify(t)}`);
  } },
  { area: 'Digitação', name: 'Acento composto sobre uma seleção', run: async (h) => {
    await h.reset(['trocar isto']); await h.select(0, 7, 0, 11);
    const cdp = await h.p.context().newCDPSession(h.p);
    await cdp.send('Input.imeSetComposition', { text: '´', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: 'é' });
    await h.settle(200);
    const t = await h.texts();
    return eq(t, ['trocar é']) ? OK() : FALHA(`Resultado: ${JSON.stringify(t)}`);
  } },
  { area: 'Digitação', name: 'Digitação rápida mantém a ordem das letras', run: async (h) => {
    await h.reset();
    const s = 'O rato roeu a roupa do rei de Roma 1234567890 vezes.';
    await h.p.keyboard.type(s, { delay: 0 }); await h.settle(800);
    const t = await h.texts();
    return eq(t, [s]) ? OK() : FALHA(`Resultado: ${JSON.stringify(t)}`);
  } },
  { area: 'Digitação', name: 'Enter cria novo parágrafo', run: async (h) => {
    await h.reset(); await h.type('Primeiro'); await h.press('Enter'); await h.type('Segundo');
    const t = await h.texts();
    return eq(t, ['Primeiro', 'Segundo']) ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Digitação', name: 'Enter no meio do parágrafo divide o texto', run: async (h) => {
    await h.reset(['metadeoutra']); await h.select(0, 6); await h.press('Enter');
    const t = await h.caretProbe();
    return eq(t, ['metade', '§outra']) ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Digitação', name: 'Shift+Enter: quebra de linha dentro do parágrafo', run: async (h) => {
    await h.reset(['linha um']); await h.select(0, 8); await h.press('Shift+Enter'); await h.type('linha dois');
    const t = await h.texts();
    if (t.length === 1 && t[0] === 'linha um\u000Blinha dois') return OK('Mesmo caractere de quebra de linha do Word (U+000B).');
    return PARCIAL(`Shift+Enter cria um parágrafo novo (${t.length} blocos), não uma quebra de linha; não há quebra de linha manual.`);
  } },
  { area: 'Digitação', name: 'Backspace e Delete', run: async (h) => {
    await h.reset(['abcdef']); await h.select(0, 3); await h.press('Backspace Delete');
    const t = await h.caretProbe();
    return eq(t, ['ab§ef']) ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Digitação', name: 'Backspace no início junta com o parágrafo anterior', run: async (h) => {
    await h.reset(['Um', 'Dois']); await h.select(1, 0); await h.press('Backspace');
    const t = await h.caretProbe();
    return eq(t, ['Um§Dois']) ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Digitação', name: 'Ctrl+Backspace / Ctrl+Delete apagam palavra', run: async (h) => {
    await h.reset(['uma duas três']); await h.select(0, 8); await h.press('Control+Backspace');
    const a = await h.texts();
    await h.press('Control+Delete');
    const b = await h.texts();
    return eq(a, ['uma  três']) && eq(b, ['uma ']) ? OK('Como no Word: apaga a palavra e mantém os espaços em volta.') : PARCIAL(`Depois de Ctrl+Backspace: ${JSON.stringify(a)}; depois de Ctrl+Delete: ${JSON.stringify(b)}`);
  } },
  { area: 'Digitação', name: 'Emoji composto (família, bandeira) apaga inteiro', run: async (h) => {
    await h.reset(['a👨‍👩‍👧🇧🇷']); await h.select(0, 'a👨‍👩‍👧🇧🇷'.length); await h.press('Backspace');
    const t1 = await h.texts();
    await h.press('Backspace');
    const t2 = await h.texts();
    if (eq(t1, ['a👨‍👩‍👧']) && eq(t2, ['a'])) return OK();
    return FALHA(`Backspace apaga só parte do emoji: depois de 1×: ${JSON.stringify(t1)}, 2×: ${JSON.stringify(t2)}`);
  } },
  { area: 'Digitação', name: 'Tab insere tabulação', run: async (h) => {
    await h.reset(['a']); await h.select(0, 1); await h.press('Tab');
    const t = await h.texts();
    return eq(t, ['a\t']) ? OK('Insere \\t; no início de um item de lista, muda o nível (como no Word).') : FALHA(JSON.stringify(t));
  } },

  // ───────────── Navegação
  { area: 'Navegação', name: 'Setas esquerda/direita e cima/baixo', run: async (h) => {
    await h.reset(['abc', 'def']); await h.select(0, 1); await h.press('ArrowRight ArrowDown');
    const t = await h.caretProbe();
    return eq(t, ['abc', 'de§f']) ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Navegação', name: 'Home / End', run: async (h) => {
    await h.reset(['meio da linha']); await h.select(0, 4); await h.press('End');
    let t = await h.caretProbe();
    await h.press('Home'); t = await h.caretProbe();
    return eq(t, ['§meio da linha§']) ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Navegação', name: 'Ctrl+Home / Ctrl+End', run: async (h) => {
    await h.reset(['um', 'dois', 'três']); await h.select(1, 2); await h.press('Control+End');
    await h.caretProbe(); await h.press('Control+Home');
    const t = await h.caretProbe();
    return eq(t, ['§um', 'dois', 'três§']) ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Navegação', name: 'Ctrl+setas pulam palavras', run: async (h) => {
    await h.reset(['uma duas três']); await h.select(0, 0); await h.press('Control+ArrowRight Control+ArrowRight');
    const t = await h.caretProbe();
    return t[0].startsWith('uma duas§') || t[0].startsWith('uma duas §') ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Navegação', name: 'Ctrl+↑/↓ vão ao parágrafo anterior/seguinte', run: async (h) => {
    await h.reset(['primeiro', 'segundo', 'terceiro']); await h.select(1, 3); await h.press('Control+ArrowDown');
    const t = await h.caretProbe();
    return eq(t, ['primeiro', 'segundo', '§terceiro']) ? OK() : PARCIAL(`No Word vai ao início do próximo parágrafo; aqui: ${JSON.stringify(t)}`);
  } },
  { area: 'Navegação', name: 'Page Up / Page Down', run: async (h) => {
    const many = Array.from({ length: 80 }, (_, i) => `Parágrafo ${i + 1}`);
    await h.reset(many); await h.select(0, 0); await h.press('PageDown');
    const t = await h.caretProbe();
    const idx = t.findIndex((x) => x.includes('§'));
    return idx > 5 ? OK(`Desceu até o parágrafo ${idx + 1}.`) : FALHA(`Cursor ficou no parágrafo ${idx + 1}.`);
  } },

  // ───────────── Seleção
  { area: 'Seleção', name: 'Shift+setas e Shift+End selecionam', run: async (h) => {
    await h.reset(['selecionar isto']); await h.select(0, 0); await h.press('Shift+End');
    const s = await h.domSelectionText();
    await h.type('X');
    const t = await h.texts();
    return s === 'selecionar isto' && eq(t, ['X']) ? OK() : FALHA(`Seleção "${s}", resultado ${JSON.stringify(t)}`);
  } },
  { area: 'Seleção', name: 'Ctrl+T seleciona tudo e Delete limpa o documento', run: async (h) => {
    await h.reset(['um', 'dois', 'três']); await h.press('Control+t');
    const s = await h.domSelectionText();
    await h.press('Delete');
    const d = await h.doc();
    const ok = d.blocks.length === 1 && d.blocks[0].spans.map((x) => x.text).join('') === '';
    return ok ? OK() : FALHA(`Seleção: ${JSON.stringify(s)}; depois: ${JSON.stringify(d.blocks.map((b) => b.spans.map((x) => x.text).join('')))}`);
  } },
  { area: 'Seleção', name: 'Duplo clique seleciona palavra; triplo, o parágrafo', run: async (h) => {
    await h.reset(['palavra outra coisa', 'segundo']);
    const box = await h.p.locator('[data-block="0"] span').first().boundingBox();
    await h.p.mouse.dblclick(box.x + 10, box.y + box.height / 2); await h.settle();
    const w = await h.domSelectionText();
    await h.p.mouse.click(box.x + 10, box.y + box.height / 2, { clickCount: 3 }); await h.settle();
    const para = await h.domSelectionText();
    await h.type('Z');
    const t = await h.texts();
    const wordOk = w.trim() === 'palavra';
    const paraOk = eq(t, ['Z', 'segundo']);
    if (wordOk && paraOk) return OK();
    return PARCIAL(`Duplo clique: "${w}". Triplo clique + digitar: ${JSON.stringify(t)} (Word: substitui só o parágrafo).`);
  } },
  { area: 'Seleção', name: 'Selecionar com o mouse (arrastar)', run: async (h) => {
    await h.reset(['arrastar para selecionar']);
    const box = await h.p.locator('[data-block="0"]').boundingBox();
    await h.p.mouse.move(box.x + 2, box.y + box.height / 2);
    await h.p.mouse.down(); await h.p.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 5 }); await h.p.mouse.up();
    await h.settle();
    const s = await h.domSelectionText();
    await h.type('Y');
    const t = await h.texts();
    return s.length > 0 && t[0].startsWith('Y') ? OK() : FALHA(`Seleção "${s}", resultado ${JSON.stringify(t)}`);
  } },
  { area: 'Seleção', name: 'Digitar sobre seleção que cruza parágrafos', run: async (h) => {
    await h.reset(['começo do um', 'meio', 'fim do três']); await h.select(0, 7, 2, 3); await h.type('+');
    const t = await h.caretProbe();
    return eq(t, ['começo +§ do três']) ? OK() : FALHA(JSON.stringify(t));
  } },

  // ───────────── Área de transferência
  { area: 'Área de transferência', name: 'Copiar e colar (Ctrl+C / Ctrl+V)', run: async (h) => {
    await h.reset(['copie isto ']); await h.select(0, 0, 0, 10); await h.press('Control+c');
    const clip = await h.readClipboard();
    await h.select(0, 11); await h.press('Control+v');
    const t = await h.texts();
    return eq(t, ['copie isto copie isto']) ? OK() : FALHA(`Área de transferência "${clip}", resultado ${JSON.stringify(t)}`);
  } },
  { area: 'Área de transferência', name: 'Recortar (Ctrl+X)', run: async (h) => {
    await h.reset(['recorte isto aqui']); await h.select(0, 8, 0, 13); await h.press('Control+x');
    const clip = await h.readClipboard();
    const t = await h.texts();
    return clip === 'isto ' && eq(t, ['recorte aqui']) ? OK() : FALHA(`Área de transferência "${clip}", resultado ${JSON.stringify(t)}`);
  } },
  { area: 'Área de transferência', name: 'Copiar vários parágrafos e colar', run: async (h) => {
    await h.reset(['alfa', 'beta', '']); await h.select(0, 0, 1, 4); await h.press('Control+c');
    const clip = await h.readClipboard();
    await h.select(2, 0); await h.press('Control+v');
    const t = await h.texts();
    return eq(t, ['alfa', 'beta', 'alfa', 'beta']) ? OK() : PARCIAL(`Copiado: ${JSON.stringify(clip)}; resultado ${JSON.stringify(t)}`);
  } },
  { area: 'Área de transferência', name: 'Colar mantendo a formatação (negrito vindo de outro app)', run: async (h) => {
    await h.reset(['']);
    await h.setClipboard({ text: 'Título forte', html: '<p><b>Título</b> forte</p>' });
    await h.press('Control+v');
    const sp = await h.spans(0);
    const bold = sp.some((s) => s.text.includes('Título') && s.marks.some((m) => m.mark === 'bold'));
    return bold ? OK() : FALHA(`Cola só o texto simples: ${JSON.stringify(marksOf(sp))}`);
  } },
  { area: 'Área de transferência', name: 'Copiar daqui com formatação para outro app', run: async (h) => {
    await h.reset(['negrito']);
    await core('dispatch', { command: { type: 'text.applyMark', block: 0, offset: 0, len: 7, mark: { mark: 'bold' } } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(0, 0, 0, 7); await h.press('Control+c');
    const html = await h.p.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const it of items) if (it.types.includes('text/html')) return (await it.getType('text/html')).text();
      return '';
    });
    const hasBold = /<b>negrito<\/b>/.test(html);
    return hasBold ? OK('Leva HTML limpo (Word, e-mail) e o formato próprio do Nova.') : FALHA('Copiar não leva formatação: ' + html.slice(0, 120));
  } },
  { area: 'Área de transferência', name: 'Colar ▾ Manter Somente Texto', run: async (h) => {
    await h.reset(['']); await h.setClipboard({ text: 'simples', html: '<b>simples</b>' });
    await h.p.locator('.paste-arrow').click();
    await h.p.locator('.popover .menu-item', { hasText: 'Manter Somente Texto' }).click(); await h.settle(300);
    const sp = await h.spans(0);
    return eq(marksOf(sp), [['simples', '']]) ? OK() : FALHA(JSON.stringify(marksOf(sp)));
  } },
  { area: 'Área de transferência', name: 'Botões Recortar, Copiar e Colar da faixa', run: async (h) => {
    await h.reset(['abc def']); await h.select(0, 0, 0, 4);
    await h.p.locator('button', { hasText: 'Recortar' }).click(); await h.settle();
    const a = await h.texts();
    await h.select(0, 3);
    await h.p.locator('.paste-main').click(); await h.settle(300);
    const b = await h.texts();
    return eq(a, ['def']) && eq(b, ['defabc ']) ? OK() : FALHA(`${JSON.stringify(a)} ${JSON.stringify(b)}`);
  } },

  // ───────────── Desfazer
  { area: 'Desfazer', name: 'Ctrl+Z / Ctrl+Y desfazem e refazem digitação', run: async (h) => {
    await h.reset(); await h.type('primeira'); await h.p.waitForTimeout(700); await h.press('Enter'); await h.type('segunda');
    await h.press('Control+z');
    const a = await h.texts();
    await h.press('Control+y');
    const b = await h.texts();
    return eq(b, ['primeira', 'segunda']) && !eq(a, b) ? OK(`Depois de Ctrl+Z: ${JSON.stringify(a)}`) : FALHA(`Ctrl+Z: ${JSON.stringify(a)}; Ctrl+Y: ${JSON.stringify(b)}`);
  } },
  { area: 'Desfazer', name: 'Desfazer devolve o cursor ao lugar da edição', run: async (h) => {
    await h.reset(['início', 'fim']); await h.select(0, 6); await h.type(' extra'); await h.select(1, 3);
    await h.press('Control+z');
    const t = await h.caretProbe();
    return eq(t, ['início§', 'fim']) ? OK() : PARCIAL(`Depois de desfazer, o cursor não volta ao trecho desfeito: ${JSON.stringify(t)}`);
  } },
  { area: 'Desfazer', name: 'Desfazer formatação e colagem', run: async (h) => {
    await h.reset(['texto']); await h.select(0, 0, 0, 5); await h.press('Control+n');
    await h.press('Control+z');
    const sp = await h.spans(0);
    return sp.every((s) => s.marks.length === 0) ? OK() : FALHA(JSON.stringify(marksOf(sp)));
  } },

  // ───────────── Formatação de caractere
  { area: 'Fonte', name: 'Negrito, itálico, sublinhado por atalho (Ctrl+N/I/S, Word em português)', run: async (h) => {
    await h.reset(['abc']); await h.select(0, 0, 0, 3); await h.press('Control+n Control+i Control+s');
    const sp = await h.spans(0);
    return eq(marksOf(sp), [['abc', 'bold+italic+underline']]) ? OK() : FALHA(JSON.stringify(marksOf(sp)));
  } },
  { area: 'Fonte', name: 'Tachado (botão)', run: async (h) => {
    await h.reset(['abc']); await h.select(0, 0, 0, 3); await h.clickRibbon('Tachado');
    const sp = await h.spans(0);
    return eq(marksOf(sp), [['abc', 'strike']]) ? OK('Atalho Alt+Shift+5 (não existe no Word por padrão).') : FALHA(JSON.stringify(marksOf(sp)));
  } },
  { area: 'Fonte', name: 'Negrito sem seleção vale para o que for digitado', run: async (h) => {
    await h.reset(['a']); await h.select(0, 1); await h.press('Control+n'); await h.type('B'); await h.press('Control+n'); await h.type('c');
    const sp = await h.spans(0);
    return eq(marksOf(sp), [['a', ''], ['B', 'bold'], ['c', '']]) ? OK() : FALHA(JSON.stringify(marksOf(sp)));
  } },
  { area: 'Fonte', name: 'Negrito no cursor dentro de uma palavra aplica à palavra inteira', run: async (h) => {
    await h.reset(['uma palavra aqui']); await h.select(0, 6); await h.press('Control+n');
    const sp = await h.spans(0);
    const ok = sp.some((s) => s.text === 'palavra' && s.marks.some((m) => m.mark === 'bold'));
    return ok ? OK() : FALHA('Ctrl+N com o cursor no meio de uma palavra deveria formatar a palavra inteira: ' + JSON.stringify(marksOf(sp)));
  } },
  { area: 'Fonte', name: 'Botões indicam a formatação sob o cursor', run: async (h) => {
    await h.reset(['normal negrito']);
    await core('dispatch', { command: { type: 'text.applyMark', block: 0, offset: 7, len: 7, mark: { mark: 'bold' } } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(0, 10);
    const pressed = await h.p.locator('button[aria-label="Negrito"]').getAttribute('aria-pressed');
    await h.select(0, 3);
    const pressed2 = await h.p.locator('button[aria-label="Negrito"]').getAttribute('aria-pressed');
    return pressed === 'true' && pressed2 === 'false' ? OK() : FALHA(`Dentro do negrito: ${pressed}; fora: ${pressed2}`);
  } },
  { area: 'Fonte', name: 'Escolher fonte (família) na lista', run: async (h) => {
    await h.reset(['texto em outra fonte']); await h.select(0, 0, 0, 5);
    await h.p.locator('.font-combo .combo-arrow').click();
    await h.p.locator('.font-item', { hasText: 'Times New Roman' }).click(); await h.settle();
    const sp = await h.spans(0);
    const shown = await h.p.locator('.font-combo input').inputValue();
    const ok = sp[0].text === 'texto' && sp[0].marks.some((m) => m.mark === 'fontFamily' && m.value === 'Times New Roman');
    return ok && shown === 'Times New Roman' ? OK() : FALHA(`${JSON.stringify(marksOf(sp))}; campo: ${shown}`);
  } },
  { area: 'Fonte', name: 'Digitar o nome da fonte e Enter', run: async (h) => {
    await h.reset(['abc']); await h.select(0, 0, 0, 3);
    await h.p.locator('.font-combo input').fill('Arial'); await h.p.keyboard.press('Enter'); await h.settle();
    const sp = await h.spans(0);
    const focused = await h.p.evaluate(() => document.activeElement?.classList.contains('page'));
    return sp[0].marks.some((m) => m.mark === 'fontFamily' && m.value === 'Arial') && focused ? OK('O foco volta ao documento.') : FALHA(`${JSON.stringify(sp)} foco no documento: ${focused}`);
  } },
  { area: 'Fonte', name: 'Tamanho da fonte: lista, digitar e Ctrl+Shift+> / <', run: async (h) => {
    await h.reset(['abc']); await h.select(0, 0, 0, 3);
    await h.p.locator('.size-combo input').fill('14'); await h.p.keyboard.press('Enter'); await h.settle();
    const a = (await h.spans(0))[0].marks.find((m) => m.mark === 'fontSize')?.halfPoints;
    await h.select(0, 0, 0, 3); await h.press('Control+Shift+Period');
    const b = (await h.spans(0))[0].marks.find((m) => m.mark === 'fontSize')?.halfPoints;
    await h.press('Control+BracketLeft Control+BracketLeft');
    const c = (await h.spans(0))[0].marks.find((m) => m.mark === 'fontSize')?.halfPoints;
    return a === 28 && b === 32 && c === 24 ? OK('14 → 16 → 14 → 12, a lista do Word.') : FALHA(`${a} ${b} ${c}`);
  } },
  { area: 'Fonte', name: 'Cor da fonte (paleta e botão repete a última cor)', run: async (h) => {
    await h.reset(['um dois']); await h.select(0, 0, 0, 2);
    await h.p.locator('.split-arrow').nth(1).click();
    await h.p.locator('.popover .swatch[aria-label="#0070C0"]').click(); await h.settle();
    await h.select(0, 3, 0, 7);
    await h.p.locator('.split-main').nth(1).click(); await h.settle();
    const sp = await h.spans(0);
    const colors = sp.map((x) => x.marks.find((m) => m.mark === 'color')?.value ?? null);
    return eq(colors, ['#0070C0', null, '#0070C0']) ? OK() : FALHA(JSON.stringify(marksOf(sp)) + JSON.stringify(colors));
  } },
  { area: 'Fonte', name: 'Realce (marca-texto) e Sem Cor', run: async (h) => {
    await h.reset(['realce aqui']); await h.select(0, 0, 0, 6);
    await h.p.locator('.split-arrow').nth(0).click();
    await h.p.locator('.popover .swatch[aria-label="Verde Brilhante"]').click(); await h.settle();
    const a = (await h.spans(0))[0].marks;
    await h.select(0, 0, 0, 6);
    await h.p.locator('.split-arrow').nth(0).click();
    await h.p.locator('.popover .menu-item', { hasText: 'Sem Cor' }).click(); await h.settle();
    const b = (await h.spans(0))[0].marks;
    return eq(a, [{ mark: 'highlight', value: 'green' }]) && b.length === 0 ? OK() : FALHA(`${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  } },
  { area: 'Fonte', name: 'Subscrito / sobrescrito (Ctrl+= / Ctrl+Shift+=)', run: async (h) => {
    await h.reset(['H2O x2']); await h.select(0, 1, 0, 2); await h.press('Control+Equal');
    await h.select(0, 5, 0, 6); await h.press('Control+Shift+Equal');
    const sp = await h.spans(0);
    const v = sp.map((x) => x.marks.find((m) => m.mark === 'vertAlign')?.value ?? '-');
    await h.select(0, 1, 0, 2); await h.press('Control+Equal');
    const off = (await h.spans(0)).find((x) => x.text.startsWith('H'))?.marks.length === 0;
    return eq(v, ['-', 'subscript', '-', 'superscript']) && off ? OK('Repetir o atalho desliga.') : FALHA(JSON.stringify(v));
  } },
  { area: 'Fonte', name: 'Limpar formatação (Ctrl+Espaço e botão)', run: async (h) => {
    await h.reset(['tudo formatado']);
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'text.applyMark', block: 0, offset: 0, len: 14, mark: { mark: 'bold' } },
      { type: 'text.applyMark', block: 0, offset: 0, len: 14, mark: { mark: 'color', value: '#FF0000' } },
      { type: 'text.applyMark', block: 0, offset: 0, len: 5, mark: { mark: 'fontSize', halfPoints: 40 } }] } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(0, 0, 0, 14); await h.press('Control+Space');
    const sp = await h.spans(0);
    return sp.every((x) => x.marks.length === 0) ? OK() : FALHA(JSON.stringify(marksOf(sp)));
  } },
  { area: 'Fonte', name: 'Maiúsculas e minúsculas (Shift+F3 e menu Aa)', run: async (h) => {
    await h.reset(['olá mundo']); await h.select(0, 0, 0, 9);
    await h.press('Shift+F3'); const a = (await h.texts())[0];
    await h.press('Shift+F3'); const b = (await h.texts())[0];
    await h.press('Shift+F3'); const c = (await h.texts())[0];
    await h.p.locator('.menu-button[aria-label="Maiúsculas e Minúsculas"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'Primeira letra da frase' }).click(); await h.settle();
    const d = (await h.texts())[0];
    return a === 'OLÁ MUNDO' && b === 'Olá Mundo' && c === 'olá mundo' && d === 'Olá mundo' ? OK() : FALHA(`${a} | ${b} | ${c} | ${d}`);
  } },
  { area: 'Fonte', name: 'Pincel de Formatação (clique e arraste)', run: async (h) => {
    await h.reset(['modelo destino']);
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'text.applyMark', block: 0, offset: 0, len: 6, mark: { mark: 'bold' } },
      { type: 'text.applyMark', block: 0, offset: 0, len: 6, mark: { mark: 'color', value: '#C00000' } }] } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(0, 2);
    await h.p.locator('button', { hasText: 'Pincel de Formatação' }).click(); await h.settle();
    const status = await h.p.locator('.statusbar').innerText();
    // arrasta sobre "destino"
    const box = await h.p.locator('[data-block="0"]').boundingBox();
    const sp0 = await h.p.locator('[data-block="0"] span').nth(1).boundingBox();
    await h.p.mouse.move(sp0.x + sp0.width - 2, box.y + box.height / 2);
    await h.p.mouse.down(); await h.p.mouse.move(sp0.x + 6, box.y + box.height / 2, { steps: 6 }); await h.p.mouse.up();
    await h.settle(300);
    const sp = await h.spans(0);
    const painted = sp.filter((x) => x.marks.length === 2).map((x) => x.text).join('');
    const off = !(await h.p.locator('.app.painting').count());
    return painted.includes('destin') && off ? OK(`Barra de status: "${status.split('\n').pop()}"`) : FALHA(`${JSON.stringify(marksOf(sp))}; pincel desligou: ${off}`);
  } },
  { area: 'Fonte', name: 'Copiar/colar formatação (Ctrl+Shift+C / Ctrl+Shift+V)', run: async (h) => {
    await h.reset(['fonte alvo']);
    await core('dispatch', { command: { type: 'text.applyMark', block: 0, offset: 0, len: 5, mark: { mark: 'italic' } } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(0, 2); await h.press('Control+Shift+c');
    await h.select(0, 6, 0, 10); await h.press('Control+Shift+v');
    const sp = await h.spans(0);
    return sp.some((x) => x.text === 'alvo' && x.marks.some((m) => m.mark === 'italic')) ? OK() : FALHA(JSON.stringify(marksOf(sp)));
  } },
  { area: 'Parágrafo', name: 'Estilos de título por atalho (Ctrl+Alt+1)', run: async (h) => {
    await h.reset(['Título']); await h.select(0, 2); await h.press('Control+Alt+Digit1');
    const s = await h.styles();
    return eq(s, ['heading1']) ? OK() : FALHA(JSON.stringify(s));
  } },
  { area: 'Parágrafo', name: 'Estilos pela galeria da faixa de opções', run: async (h) => {
    await h.reset(['a', 'b']); await h.select(0, 0, 1, 1);
    await h.p.locator('.gallery button', { hasText: 'Citação' }).first().click(); await h.settle();
    const s = await h.styles();
    return eq(s, ['quote', 'quote']) ? OK() : FALHA(JSON.stringify(s));
  } },
  { area: 'Parágrafo', name: 'Enter no fim de um título volta ao texto normal', run: async (h) => {
    await h.reset(['Título']); await core('dispatch', { command: { type: 'block.setStyle', block: 0, style: 'heading1' } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(0, 6); await h.press('Enter');
    const s = await h.styles();
    return eq(s, ['heading1', 'paragraph']) ? OK() : FALHA(JSON.stringify(s));
  } },
  { area: 'Parágrafo', name: 'Alinhamento (Ctrl+Q / E / G / J, Word em português)', run: async (h) => {
    await h.reset(['a', 'b', 'c', 'd']);
    await h.select(0, 0); await h.press('Control+e');
    await h.select(1, 0); await h.press('Control+g');
    await h.select(2, 0); await h.press('Control+j');
    await h.select(3, 0); await h.press('Control+e Control+q');
    const d = await h.doc();
    const aligns = d.blocks.map((b) => b.attrs.align);
    const css = await h.p.locator('[data-block="0"]').evaluate((el) => getComputedStyle(el).textAlign);
    return eq(aligns, ['center', 'right', 'justify', 'left']) && css === 'center' ? OK() : FALHA(`${JSON.stringify(aligns)} css=${css}`);
  } },
  { area: 'Parágrafo', name: 'Lista com marcadores (botão e Ctrl+Shift+L)', run: async (h) => {
    await h.reset(['um', 'dois']); await h.select(0, 0, 1, 1);
    await h.clickRibbon('Marcadores');
    const d = await h.doc();
    const marker = await h.p.locator('[data-block="0"]').getAttribute('data-marker');
    await h.press('Control+Shift+l');
    const off = (await h.doc()).blocks.every((b) => b.attrs.list === null);
    return d.blocks.every((b) => b.attrs.list === 'bullet') && marker === '•' && off ? OK('O atalho desliga de novo.') : FALHA(`${JSON.stringify(d.blocks.map((b) => b.attrs.list))} marker=${marker} off=${off}`);
  } },
  { area: 'Parágrafo', name: 'Lista numerada: Enter continua, Enter no item vazio sai', run: async (h) => {
    await h.reset(['primeiro']); await h.select(0, 8);
    await h.clickRibbon('Numeração');
    await h.press('Enter'); await h.type('segundo'); await h.press('Enter'); await h.press('Enter'); await h.type('fora');
    const d = await h.doc();
    const markers = await h.p.locator('[data-block]').evaluateAll((els) => els.map((e) => e.getAttribute('data-marker')));
    const lists = d.blocks.map((b) => b.attrs.list);
    return eq(markers, ['1.', '2.', null]) && eq(lists, ['number', 'number', null]) ? OK() : FALHA(`${JSON.stringify(markers)} ${JSON.stringify(lists)} ${JSON.stringify(await h.texts())}`);
  } },
  { area: 'Parágrafo', name: 'Tab / Shift+Tab mudam o nível do item', run: async (h) => {
    await h.reset(['a', 'b']);
    await core('dispatch', { command: { type: 'batch', commands: [0, 1].map((block) => ({ type: 'block.setAttr', block, attr: 'list', value: 'number' })) } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(1, 0); await h.press('Tab');
    const m1 = await h.p.locator('[data-block="1"]').getAttribute('data-marker');
    await h.press('Shift+Tab');
    const m2 = await h.p.locator('[data-block="1"]').getAttribute('data-marker');
    return m1 === 'a.' && m2 === '2.' ? OK() : FALHA(`${m1} ${m2}`);
  } },
  { area: 'Parágrafo', name: 'Backspace no início do item tira o marcador', run: async (h) => {
    await h.reset(['item']);
    await core('dispatch', { command: { type: 'block.setAttr', block: 0, attr: 'list', value: 'bullet' } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.select(0, 0); await h.press('Backspace');
    const d = await h.doc();
    return d.blocks[0].attrs.list === null && (await h.texts())[0] === 'item' ? OK() : FALHA(JSON.stringify(d.blocks[0]));
  } },
  { area: 'Parágrafo', name: 'Lista automática ao digitar "- " ou "1. "', run: async (h) => {
    await h.reset(); await h.type('- item'); await h.press('Enter'); await h.press('Enter'); await h.type('1. passo');
    const d = await h.doc();
    const lists = d.blocks.map((b) => b.attrs.list);
    const t = await h.texts();
    await h.press('Control+z');
    return eq(lists, ['bullet', 'number']) && eq(t, ['item', 'passo']) ? OK() : FALHA(`${JSON.stringify(lists)} ${JSON.stringify(t)}`);
  } },
  { area: 'Parágrafo', name: 'Aumentar/diminuir recuo (Ctrl+M / Ctrl+Shift+M)', run: async (h) => {
    await h.reset(['recuado']); await h.select(0, 3); await h.press('Control+m Control+m');
    const a = (await h.doc()).blocks[0].attrs.indent;
    const ml = await h.p.locator('[data-block="0"]').evaluate((el) => getComputedStyle(el).marginLeft);
    await h.press('Control+Shift+m');
    const b = (await h.doc()).blocks[0].attrs.indent;
    return a === 2 && b === 1 && parseFloat(ml) > 90 ? OK(`2 níveis = ${ml}`) : FALHA(`${a} ${b} ${ml}`);
  } },
  { area: 'Parágrafo', name: 'Espaçamento entre linhas (Ctrl+1/2/5 e menu) e antes/depois', run: async (h) => {
    await h.reset(['linhas']); await h.select(0, 2); await h.press('Control+2');
    const a = (await h.doc()).blocks[0].attrs.lineSpacing;
    await h.press('Control+5');
    const b = (await h.doc()).blocks[0].attrs.lineSpacing;
    await h.p.locator('.menu-button[aria-label="Espaçamento de Linha e Parágrafo"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'Adicionar Espaço Antes' }).click(); await h.settle();
    const d = (await h.doc()).blocks[0].attrs;
    await h.press('Control+1');
    const c = (await h.doc()).blocks[0].attrs.lineSpacing;
    return a === 200 && b === 150 && c === null && d.spaceBefore === 12 ? OK() : FALHA(`${a} ${b} ${c} ${JSON.stringify(d)}`);
  } },
  { area: 'Parágrafo', name: 'Sombreamento do parágrafo', run: async (h) => {
    await h.reset(['fundo escuro', 'normal']);
    await h.select(0, 2);
    await h.p.locator('button[aria-label="Sombreamento: opções"]').click();
    await h.p.locator('.popover .swatch[title="#C00000"]').click(); await h.settle(150);
    const d = await h.doc();
    const css = await h.p.evaluate(() => { const el = document.querySelector('[data-block="0"]'); const s = getComputedStyle(el); return [s.backgroundColor, s.color]; });
    const ok = d.blocks[0].attrs.shading === '#C00000' && d.blocks[1].attrs.shading === null && css[1] === 'rgb(255, 255, 255)';
    return ok ? OK('Texto automático fica branco sobre fundo escuro, como no Word.') : FALHA(`${JSON.stringify(d.blocks.map((b) => b.attrs.shading))} ${css}`);
  } },
  { area: 'Parágrafo', name: 'Mostrar Tudo ¶ (Ctrl+Shift+8)', run: async (h) => {
    await h.reset(['a b\tc']); await h.select(0, 1); await h.press('Control+Shift+Digit8');
    const shown = await h.p.locator('[data-block="0"]').innerText();
    const after = await h.p.locator('[data-block="0"]').evaluate((el) => getComputedStyle(el, '::after').content);
    await h.type('X');
    const t = await h.texts();
    await h.press('Control+Shift+Digit8');
    return shown.startsWith('a·b→c') && after.includes('¶') && eq(t, ['aX b\tc']) ? OK('Espaços (·), tabulações (→) e ¶ aparecem sem entrar no texto.') : FALHA(`${JSON.stringify(shown)} ${after} ${JSON.stringify(t)}`);
  } },


  // ───────────── Revisão e ferramentas
  { area: 'Ferramentas', name: 'Localizar (Ctrl+L): painel, resultados e destaque', run: async (h) => {
    await h.reset(['Casa e casa', 'outra Casa']); await h.select(0, 0);
    await h.press('Control+l'); await h.p.keyboard.type('casa'); await h.p.keyboard.press('Enter'); await h.settle();
    const status = await h.p.locator('.find-status').innerText();
    const results = await h.p.locator('.find-results li').count();
    const highlighted = await h.p.evaluate(() => (CSS.highlights?.get('nova-find')?.size ?? -1));
    await h.p.keyboard.press('Enter'); await h.p.keyboard.press('Escape'); await h.settle();
    await h.type('X');
    const t = await h.texts();
    return /Resultado 1 de 3/.test(status) && results === 3 && highlighted === 3 && eq(t, ['Casa e X', 'outra Casa']) ? OK('Enter vai para o próximo; Esc volta ao texto com a ocorrência selecionada.') : FALHA(`${status} ${results} ${highlighted} ${JSON.stringify(t)}`);
  } },
  { area: 'Ferramentas', name: 'Substituir e Substituir Tudo (Ctrl+U)', run: async (h) => {
    await h.reset(['um dois um', 'um']); await h.select(0, 0);
    await h.press('Control+u'); await h.p.keyboard.type('um');
    await h.p.locator('.replace-box input').fill('1');
    await h.p.locator('.find-panel button', { hasText: /^Substituir$/ }).click(); await h.settle(200);
    await h.p.locator('.find-panel button', { hasText: /^Substituir$/ }).click(); await h.settle(200);
    const a = await h.texts();
    await h.p.locator('.find-panel button', { hasText: 'Substituir Tudo' }).click(); await h.settle(200);
    const b = await h.texts();
    const notice = await h.p.locator('.find-status').innerText();
    await h.press('Control+z');
    const c = await h.texts();
    return eq(a, ['1 dois um', 'um']) && eq(b, ['1 dois 1', '1']) && eq(c, ['1 dois um', 'um']) ? OK(`"${notice}"; Ctrl+Z desfaz o Substituir Tudo de uma vez.`) : FALHA(`${JSON.stringify(a)} ${JSON.stringify(b)} ${JSON.stringify(c)} ${notice}`);
  } },
  { area: 'Ortografia', name: 'Sublinhar palavras erradas enquanto digita', run: async (h) => {
    await h.reset(['']);
    await h.type('A excessão confirma a regra, mas o guarda-chuva da ONU está em https://exemplo.com.');
    const u = await underlined(h);
    const native = await h.p.locator('.page').getAttribute('spellcheck');
    if (native !== 'false') return FALHA('O corretor do WebView continua ligado (sublinhado duplo).');
    return eq(u, ['excessão']) ? OK('Dicionários do LibreOffice (nova-spell); ignora siglas, URLs e números, como o Word.') : FALHA(`Sublinhadas: ${JSON.stringify(u)}`);
  } },
  { area: 'Ortografia', name: 'A palavra em digitação só é marcada ao sair dela', run: async (h) => {
    await h.reset(['']);
    await h.type('Um pobrema');
    const typing = await underlined(h);
    await h.type(' ');
    const after = await underlined(h);
    return eq(typing, []) && eq(after, ['pobrema']) ? OK() : FALHA(`Digitando: ${JSON.stringify(typing)}; depois do espaço: ${JSON.stringify(after)}`);
  } },
  { area: 'Ortografia', name: 'Sugestões no clique direito', run: async (h) => {
    await h.reset(['A excessão confirma a regra']);
    await underlined(h);
    const suggestions = await spellMenu(h, 'excessão');
    if (suggestions[0] !== 'exceção') return FALHA(`Sugestões: ${JSON.stringify(suggestions)}`);
    await h.p.locator('.spell-menu .spell-suggestion', { hasText: 'exceção' }).click();
    await h.settle();
    const fixed = await h.texts();
    const u = await underlined(h);
    await h.press('Control+z');
    const undone = await h.texts();
    return eq(fixed, ['A exceção confirma a regra']) && eq(u, []) && eq(undone, ['A excessão confirma a regra'])
      ? OK(`${suggestions.length} sugestões, a melhor primeiro; Ctrl+Z desfaz a troca.`)
      : FALHA(`${JSON.stringify(fixed)} ${JSON.stringify(u)} ${JSON.stringify(undone)}`);
  } },
  { area: 'Ortografia', name: 'Ignorar Tudo e Adicionar ao Dicionário', run: async (h) => {
    await h.reset(['Zorblax e Quixtrel, de novo Zorblax']);
    const before = await underlined(h);
    await spellMenu(h, 'Quixtrel');
    await h.p.locator('.spell-menu .menu-item', { hasText: 'Ignorar Tudo' }).click();
    const ignored = await underlined(h);
    await spellMenu(h, 'Zorblax');
    await h.p.locator('.spell-menu .menu-item', { hasText: 'Adicionar ao Dicionário' }).click();
    const added = await underlined(h);
    return eq(before, ['Zorblax', 'Quixtrel', 'Zorblax']) && eq(ignored, ['Zorblax', 'Zorblax']) && eq(added, [])
      ? OK('Todas as ocorrências deixam de ser marcadas; o dicionário do usuário vale para todos os idiomas.')
      : FALHA(`${JSON.stringify(before)} → ${JSON.stringify(ignored)} → ${JSON.stringify(added)}`);
  } },
  { area: 'Ortografia', name: 'Idioma de revisão na barra de status', run: async (h) => {
    await h.reset(['the house é bonita']);
    const proofing = h.p.locator('.statusbar .proofing');
    const pt = await underlined(h);
    await proofing.selectOption('en-US');
    const en = await underlined(h);
    await proofing.selectOption('off');
    const off = await underlined(h);
    await proofing.selectOption('pt-BR');
    return pt.includes('house') && !pt.includes('bonita') && en.includes('bonita') && !en.includes('house') && eq(off, [])
      ? OK('Português (VERO), inglês (SCOWL), espanhol (RLA-ES) ou desligado; a escolha fica salva.')
      : FALHA(`pt ${JSON.stringify(pt)} en ${JSON.stringify(en)} off ${JSON.stringify(off)}`);
  } },
  { area: 'Ortografia', name: 'Idioma de revisão na aba Revisão (pt-BR, en-US, es-ES)', run: async (h) => {
    await h.reset(['the house é bonita, la casa es bonita']);
    await h.p.locator('.tab', { hasText: 'Revisão' }).click();
    const pick = async (name) => {
      await h.p.locator('.review-language').click();
      await h.p.locator('.menu-item', { hasText: name }).click();
      return underlined(h);
    };
    const pt = await underlined(h);
    const es = await pick('Espanhol (Espanha)');
    const status = await h.p.locator('.statusbar .proofing').inputValue();
    const en = await pick('Inglês (EUA)');
    await pick('Português (Brasil)');
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    return pt.includes('house') && !es.includes('casa') && es.includes('house') && status === 'es-ES' && !en.includes('house') && en.includes('casa')
      ? OK('Revisão › Idioma; a barra de status acompanha a escolha.')
      : FALHA(`pt ${JSON.stringify(pt)} es ${JSON.stringify(es)} (${status}) en ${JSON.stringify(en)}`);
  } },
  { area: 'Ortografia', name: 'Ortografia e Gramática (F7): painel percorre os erros um a um', run: async (h) => {
    await h.reset(['Um pobrema e outro pobrema.', 'A excessão confirma a regra. Plimbrox.']);
    await underlined(h);
    const pane = h.p.locator('.proof-pane');
    const word = async () => { await h.settle(500); return pane.locator('.proof-context mark').innerText(); };
    const click = (name) => pane.locator('button', { hasText: name }).first().click();
    await h.press('F7');
    await pane.waitFor();
    const seen = [await word()];
    await click('Alterar');                 // pobrema → problema
    seen.push(await word());
    await click('Ignorar uma vez');         // o segundo pobrema fica
    seen.push(await word());
    await click('Alterar');                 // excessão → exceção
    seen.push(await word());
    // (o dicionário do usuário da ponte é o mesmo em todos os fluxos: palavra nova aqui)
    await click('Ignorar Tudo');            // Plimbrox
    await h.settle(800);
    const done = await pane.locator('.proof-done').innerText().catch(() => '');
    const t = await h.texts();
    await pane.locator('.proof-done button').click();
    const closed = await pane.count();
    return eq(seen, ['pobrema', 'pobrema', 'excessão', 'Plimbrox']) && /concluída/.test(done) && closed === 0
      && eq(t, ['Um problema e outro pobrema.', 'A exceção confirma a regra. Plimbrox.'])
      ? OK('Alterar, Ignorar uma vez e Ignorar Tudo, do cursor em diante; termina com "A verificação ortográfica foi concluída".')
      : FALHA(`${JSON.stringify(seen)} ${JSON.stringify(t)} "${done}" painel=${closed}`);
  } },
  { area: 'Ortografia', name: 'Ortografia e Gramática: Alterar Todas e a aba Revisão', run: async (h) => {
    await h.reset(['pobrema, pobrema e pobrema']);
    await underlined(h);
    await h.p.locator('.tab', { hasText: 'Revisão' }).click();
    await h.p.locator('.big-button', { hasText: 'Ortografia e Gramática' }).click();
    const pane = h.p.locator('.proof-pane');
    await pane.locator('.proof-suggestions button').first().waitFor();
    await pane.locator('button', { hasText: 'Alterar Todas' }).click();
    await h.settle(900);
    const t = await h.texts();
    const done = await pane.locator('.proof-done').count();
    await h.press('Escape');
    const closed = await pane.count();
    await h.p.locator('.page').focus();
    await h.press('Control+z');
    const undone = await h.texts();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    return eq(t, ['problema, problema e problema']) && done === 1 && closed === 0 && eq(undone, ['pobrema, pobrema e pobrema'])
      ? OK('Troca todas as ocorrências num único passo de desfazer; Esc fecha o painel.')
      : FALHA(`${JSON.stringify(t)} concluído=${done} painel=${closed} desfeito=${JSON.stringify(undone)}`);
  } },
  { area: 'Ferramentas', name: 'AutoCorreção: aspas inteligentes, travessão e substituições', run: async (h) => {
    await h.reset(); await h.type('Ele disse "oi" -- e saiu (c) ');
    await h.settle(200);
    const t = await h.texts();
    return eq(t, ['Ele disse “oi” — e saiu © '])
      ? OK('Aspas “ ”, -- vira — e a lista de substituições do Word ((c) → ©, ... → …).')
      : FALHA(JSON.stringify(t));
  } },
  { area: 'Ferramentas', name: 'Opções de AutoCorreção (Revisão › AutoCorreção)', run: async (h) => {
    await h.reset();
    await h.p.locator('.tab', { hasText: 'Revisão' }).click();
    await h.p.locator('.big-button', { hasText: 'AutoCorreção' }).click();
    const dialog = h.p.locator('.modal.autocorrect');
    await dialog.locator('label', { hasText: 'Primeira letra' }).locator('input').uncheck();
    await dialog.locator('input[aria-label="Substituir"]').fill('nao');
    await dialog.locator('input[aria-label="Por"]').fill('não');
    await dialog.locator('button', { hasText: 'Adicionar' }).click();
    await dialog.locator('button', { hasText: 'OK' }).click();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    await h.p.locator('.page').focus();
    await h.type('eu nao sei ');
    await h.settle(200);
    const t = await h.texts();
    // Volta ao padrão para os outros fluxos.
    await h.p.evaluate(() => localStorage.removeItem('nova.autocorrect'));
    await h.reload();
    return eq(t, ['eu não sei ']) ? OK('Cada correção liga e desliga; a lista Substituir/Por é editável e fica salva.') : FALHA(JSON.stringify(t));
  } },
  { area: 'Ferramentas', name: 'Contar Palavras (Revisão, Ctrl+Shift+G): páginas, palavras, caracteres, parágrafos e linhas', run: async (h) => {
    const long = 'palavra '.repeat(40).trim();
    await h.reset(['Olá, mundo!', '', long]);
    const read = async () => {
      const rows = await h.p.locator('.word-count tr').allInnerTexts();
      return Object.fromEntries(rows.map((r) => r.split('	')).map(([k, v]) => [k.trim(), Number(v.replace(/\D/g, ''))]));
    };
    await h.p.locator('.tab', { hasText: 'Revisão' }).click();
    await h.p.locator('.big-button', { hasText: 'Contar Palavras' }).click();
    const all = await read();
    await h.press('Escape');
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    await h.select(0, 0, 0, 4);
    await h.press('Control+Shift+g');
    const part = await h.p.locator('.word-count-scope').innerText();
    const sel = await read();
    await h.p.locator('.word-count button', { hasText: 'Fechar' }).click();
    const closed = await h.p.locator('.word-count').count();
    const ok = all['Páginas'] === 1 && all['Palavras'] === 42 && all['Caracteres (sem espaços)'] === 10 + 280
      && all['Caracteres (com espaços)'] === 11 + 319 && all['Parágrafos'] === 2 && all['Linhas'] >= 3
      && /seleção/.test(part) && sel['Palavras'] === 1 && sel['Caracteres (com espaços)'] === 4 && closed === 0;
    return ok
      ? OK(`${all['Linhas']} linhas medidas na tela; com seleção, conta só o trecho. Páginas estimadas pela altura (ainda sem paginação).`)
      : FALHA(`${JSON.stringify(all)} | ${part} ${JSON.stringify(sel)} fechou=${closed === 0}`);
  } },
  { area: 'Ferramentas', name: 'Contagem de palavras', run: async (h) => {
    await h.reset(['uma duas', 'três']);
    const status = await h.p.locator('.statusbar').innerText();
    return /3 palavras · 2 parágrafos/.test(status) ? OK(status.replace(/\n/g, ' · ')) : FALHA(status);
  } },
  { area: 'Ferramentas', name: 'Contagem de palavras com 1 parágrafo (plural)', run: async (h) => {
    await h.reset(['uma']);
    const status = await h.p.locator('.statusbar').innerText();
    return /1 palavra · 1 parágrafo/.test(status) ? OK() : FALHA(`Plural: "${status.replace(/\n/g, ' · ')}"`);
  } },
  { area: 'Ferramentas', name: 'Autocorreção (maiúscula no início da frase)', run: async (h) => {
    await h.reset(); await h.type('frase. outra ');
    await h.settle(200);
    const t = await h.texts();
    await h.press('Control+z');
    const undone = await h.texts();
    return t[0] === 'Frase. Outra ' && undone[0] === 'Frase. outra '
      ? OK('Ao digitar o espaço depois da palavra, como no Word; Ctrl+Z logo depois desfaz só a correção.')
      : FALHA(`${JSON.stringify(t)} → ${JSON.stringify(undone)}`);
  } },

  // ───────────── Arquivo
  { area: 'Arquivo', name: 'Salvar (.docx padrão), fechar e reabrir preserva texto e formatação', run: async (h) => {
    await h.reset(['Título do doc', 'corpo com negrito']);
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'block.setStyle', block: 0, style: 'heading1' },
      { type: 'text.applyMark', block: 1, offset: 10, len: 7, mark: { mark: 'bold' } }] } });
    await h.reload();
    await h.p.evaluate(() => { window.__calls = []; window.__dialog.save = '/tmp/nova-flows/ciclo.docx'; });
    await h.press('Control+b'); await h.settle(200);
    const asked = await h.lastDialog('save');
    if (!asked?.defaultPath?.endsWith('.docx') || asked.filters[0].extensions[0] !== 'docx') return FALHA(`Janela Salvar: ${JSON.stringify(asked)}`);
    await h.reset();
    await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/ciclo.docx'; });
    await h.press('Control+a'); await h.settle(150);
    await h.p.locator('.bs-big', { hasText: 'Procurar' }).click(); await h.settle(300);
    const back = await h.doc();
    const title = await h.p.evaluate(() => window.__title);
    const ok = back.blocks[0].style === 'heading1' && JSON.stringify(back.blocks[1].spans).includes('bold') && !back.dirty && back.format === 'docx';
    return ok ? OK(`Sugere "${asked.defaultPath}" com "${asked.filters[0].name}" primeiro; título da janela: "${title}"`) : FALHA(`Reaberto: ${JSON.stringify(back)}`);
  } },
  { area: 'Arquivo', name: 'Salvar como em cada formato (tela Arquivo)', run: async (h) => {
    const fs = require('fs');
    const got = [];
    for (const [ext, label] of [['odt', 'Texto OpenDocument'], ['nova', 'Documento NovaOffice'], ['md', 'Markdown'], ['txt', 'Texto sem formatação'], ['html', 'Página da Web'], ['docx', 'Documento do Word']]) {
      await h.reset(['Relatório', 'com texto']);
      const path = `/tmp/nova-flows/como.${ext}`;
      try { fs.unlinkSync(path); } catch {}
      await h.p.evaluate((p) => { window.__dialog.save = p; }, path);
      await h.p.locator('.tab-file').click();
      await h.p.locator('.bs-nav', { hasText: 'Salvar como' }).click();
      await h.p.locator('.bs-formats button', { hasText: label }).first().click(); await h.settle(250);
      const d = await h.doc();
      got.push(`${ext}:${fs.existsSync(path) && d.format === ext && !d.dirty ? 'ok' : 'falhou'}`);
    }
    const reopen = await core('open_document', { path: '/tmp/nova-flows/como.odt' });
    const fine = got.every((g) => g.endsWith(':ok')) && reopen.blocks.length === 2;
    return fine ? OK(got.join(' · ')) : FALHA(got.join(' · '));
  } },
  { area: 'Arquivo', name: 'Ctrl+B num documento novo pede onde salvar', run: async (h) => {
    await h.reset(['x']); await h.p.evaluate(() => { window.__calls = []; window.__dialog.save = '/tmp/nova-flows/novo.docx'; });
    await h.press('Control+b'); await h.settle(200);
    const calls = await h.p.evaluate(() => window.__calls.map((c) => c.cmd));
    const d = await h.doc();
    return calls.includes('plugin:dialog|save') && !d.dirty ? OK() : FALHA(JSON.stringify(calls));
  } },
  { area: 'Arquivo', name: 'Novo documento com alterações pergunta Salvar / Não Salvar / Cancelar', run: async (h) => {
    await h.reset(); await h.type('Não salvo');
    await h.press('Control+o'); await h.settle(150);
    if (!(await h.modalVisible())) return FALHA('Não perguntou.');
    await h.p.locator('.modal button', { hasText: 'Cancelar' }).click(); await h.settle(150);
    const kept = await h.texts();
    await h.press('Control+o'); await h.settle(150);
    await h.p.locator('.modal button', { hasText: 'Não Salvar' }).click(); await h.settle(200);
    const after = await h.texts();
    return eq(kept, ['Não salvo']) && eq(after, ['']) ? OK() : FALHA(`${JSON.stringify(kept)} → ${JSON.stringify(after)}`);
  } },
  { area: 'Arquivo', name: 'Fechar a janela com alterações não salvas', run: async (h) => {
    await h.reset(); await h.type('importante');
    await h.p.evaluate(() => { window.__destroyed = false; window.__dialog.save = '/tmp/nova-flows/fechar.docx'; });
    try { require('fs').unlinkSync('/tmp/nova-flows/fechar.docx'); } catch {}
    await h.p.evaluate(() => window.__requestClose()); await h.settle(200);
    if (!(await h.modalVisible())) return FALHA('Fechou sem perguntar.');
    await h.p.locator('.modal button', { hasText: 'Cancelar' }).click(); await h.settle(150);
    const stayed = !(await h.p.evaluate(() => window.__destroyed));
    await h.p.evaluate(() => window.__requestClose()); await h.settle(200);
    await h.p.locator('.modal button', { hasText: /^Salvar$/ }).click(); await h.settle(300);
    const closed = await h.p.evaluate(() => window.__destroyed);
    const saved = require('fs').existsSync('/tmp/nova-flows/fechar.docx');
    return stayed && closed && saved ? OK('Cancelar mantém a janela; Salvar grava e fecha.') : FALHA(`ficou=${stayed} fechou=${closed} salvou=${saved}`);
  } },
  { area: 'Arquivo', name: 'Abrir arquivo .docx do Word', run: async (h) => {
    await core('new_document');
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'text.insert', block: 0, offset: 0, text: 'Lista' },
      { type: 'block.insert', index: 1, text: 'item um' },
      { type: 'block.setAttr', block: 1, attr: 'list', value: 'number' },
      { type: 'block.setAttr', block: 0, attr: 'align', value: 'center' }] } });
    await core('save_document', { path: '/tmp/nova-flows/word.docx' });
    await h.reset();
    await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/word.docx'; });
    await h.press('Control+a'); await h.settle(100);
    await h.p.locator('.bs-big', { hasText: 'Procurar' }).click(); await h.settle(300);
    const d = await h.doc();
    const filters = (await h.lastDialog('open'))?.filters ?? [];
    const ok = d.blocks[0].attrs.align === 'center' && d.blocks[1].attrs.list === 'number' && /Todos os documentos/.test(filters[0]?.name);
    return ok ? OK(`Filtro: "${filters[0].name}". Arquivos do Word e do LibreOffice validados à parte (testes do núcleo).`) : FALHA(JSON.stringify(d.blocks));
  } },
  { area: 'Arquivo', name: 'Abrir .txt / .md', run: async (h) => {
    require('fs').writeFileSync('/tmp/nova-flows/notas.md', '# Título\n\nTexto com **negrito**\n- item');
    await h.reset(); await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/notas.md'; });
    await h.press('Control+a'); await h.settle(100);
    await h.p.locator('.bs-big', { hasText: 'Procurar' }).click(); await h.settle(300);
    const d = await h.doc();
    const ok = d.blocks[0].style === 'heading1' && JSON.stringify(d.blocks[1].spans).includes('bold') && d.blocks[2].attrs.list === 'bullet';
    return ok ? OK('Markdown vira títulos, negrito e listas.') : FALHA(JSON.stringify(d.blocks));
  } },
  { area: 'Arquivo', name: 'Documentos recentes', run: async (h) => {
    await core('open_document', { path: '/tmp/nova-flows/notas.md' });
    await h.reset();
    await h.p.locator('.tab-file').click();
    await h.p.locator('.bs-nav', { hasText: 'Abrir' }).click(); await h.settle(150);
    const names = await h.p.locator('.bs-file strong').allInnerTexts();
    if (!names.includes('notas.md')) return FALHA(`Recentes: ${JSON.stringify(names)}`);
    await h.p.locator('.bs-file', { hasText: 'notas.md' }).click(); await h.settle(300);
    const d = await h.doc();
    return d.path?.endsWith('notas.md') ? OK(`${names.length} na lista; um clique reabre.`) : FALHA(JSON.stringify(d.path));
  } },
  { area: 'Arquivo', name: 'Exportar uma cópia (.html) sem mudar o arquivo atual', run: async (h) => {
    await h.reset(['Exportar isto']);
    await h.p.evaluate(() => { window.__dialog.save = '/tmp/nova-flows/copia.html'; });
    await h.p.locator('.tab-file').click();
    await h.p.locator('.bs-nav', { hasText: 'Exportar' }).click();
    await h.p.locator('.bs-formats button', { hasText: 'Página da Web' }).click(); await h.settle(250);
    const html = require('fs').readFileSync('/tmp/nova-flows/copia.html', 'utf8');
    const d = await h.doc();
    return html.includes('Exportar isto') && d.path === null ? OK() : FALHA(`path=${d.path}`);
  } },
  { area: 'Arquivo', name: 'Exportar para PDF', run: async (h) => {
    await h.reset(['Relatório final', 'Texto do corpo com uma nota.']);
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'block.setStyle', block: 0, style: 'heading1' },
      { type: 'text.insert', block: 1, offset: 27, text: '\uE000', marks: [{ mark: 'footnote', id: 'p1' }] },
      { type: 'footnote.set', id: 'p1', text: 'Fonte da nota.' },
      { type: 'headerFooter.set', value: { header: { text: 'Cabeçalho Nova', align: 'left' }, footer: { text: 'Página {PAGE} de {NUMPAGES}', align: 'center' }, differentFirst: false } },
      { type: 'watermark.set', value: { text: 'RASCUNHO', color: '#C0C0C0', semitransparent: true, layout: 'diagonal' } },
    ] } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.settle(400);
    const path = '/tmp/nova-flows/exportado.pdf';
    require('fs').rmSync(path, { force: true });
    await h.p.evaluate(() => { window.__printed = 0; window.__dialog.save = '/tmp/nova-flows/exportado.pdf'; });
    await h.p.locator('.tab-file').click();
    await h.p.locator('.bs-nav', { hasText: 'Exportar' }).click();
    await h.p.locator('.bs-big', { hasText: 'Criar PDF' }).click();
    for (let i = 0; i < 40 && !require('fs').existsSync(path); i++) await h.settle(250);
    await h.settle(300);
    const printed = await h.p.evaluate(() => window.__printed);
    let text = '';
    try { text = require('child_process').execFileSync('pdftotext', ['-raw', path, '-']).toString(); } catch (e) { text = `sem pdftotext: ${e.message}`; }
    const status = await h.p.locator('.statusbar').innerText();
    const has = (s) => text.includes(s);
    const ok = !printed && has('Relatório final') && has('Fonte da nota.') && has('Cabeçalho Nova') && has('Página 1 de 1') && text.replace(/\s/g, '').includes('RASCUNHO') && /Exportado para/.test(status);
    return ok ? OK('Arquivo → Exportar → Criar PDF grava o .pdf sem a janela de impressão (WebView2 PrintToPdf no Windows; WebKitGTK no Linux), com cabeçalho, rodapé, nota e marca d\'água.') : FALHA(JSON.stringify({ printed, text: text.slice(0, 300), status }));
  } },
  { area: 'Arquivo', name: 'Imprimir (Ctrl+P)', run: async (h) => {
    await h.reset(['x']);
    await h.p.evaluate(() => { window.__printed = 0; });
    await h.press('Control+p'); await h.settle(150);
    await h.p.locator('.bs-big', { hasText: 'Imprimir' }).click(); await h.settle(200);
    const printed = await h.p.evaluate(() => window.__printed);
    const hidden = await h.p.evaluate(() => {
      const rule = [...document.styleSheets].flatMap((s) => [...s.cssRules]).find((r) => r.media && r.media.mediaText === 'print');
      return !!rule;
    });
    return printed && hidden ? OK('Tela Imprimir → janela de impressão do sistema; só a página sai no papel.') : FALHA(`printed=${printed} css=${hidden}`);
  } },
  { area: 'Arquivo', name: 'Salvamento automático / recuperação', run: async (h) => {
    await h.reset(); await h.type('Texto que quase se perdeu');
    const saved = await core('autosave');
    await core('restart'); // o app fecha sem salvar
    await h.p.reload(); await h.p.waitForSelector('.backstage'); await h.settle(150);
    const banner = await h.p.locator('.bs-recovery').count();
    if (!saved || !banner) return FALHA(`autosave=${saved} aviso=${banner}`);
    await h.p.locator('.bs-recovery button', { hasText: 'Recuperar' }).click(); await h.settle(300);
    const d = await h.doc();
    return eq(await h.texts(), ['Texto que quase se perdeu']) && d.dirty ? OK('Cópia a cada minuto; ao abrir de novo, a tela inicial oferece Recuperar.') : FALHA(JSON.stringify(await h.texts()));
  } },

  // ───────────── NovaOffice
  { area: 'NovaOffice', name: 'Tela inicial ao abrir o programa', run: async (h) => {
    await core('new_document');
    await h.p.reload(); await h.p.waitForSelector('.backstage'); await h.settle(100);
    const apps = await h.p.locator('.bs-app').count();
    const title = await h.p.evaluate(() => window.__title);
    await h.p.locator('.bs-tile').first().click(); await h.settle(150);
    const gone = !(await h.p.locator('.backstage').count());
    return apps === 8 && gone ? OK(`8 aplicativos (com Nova Mail e Nova Drive), Novo e Recentes; título "${title}".`) : FALHA(`apps=${apps} fechou=${gone}`);
  } },
  { area: 'NovaOffice', name: 'Menu de aplicativos (grade ao lado do logo)', run: async (h) => {
    await h.reset(['x']);
    await h.p.locator('.launcher-button').click(); await h.settle(100);
    const names = await h.p.locator('.launcher-name').allInnerTexts();
    const current = await h.p.locator('.launcher-app[aria-current="true"] .launcher-name').innerText();
    const soon = await h.p.locator('.launcher-app:disabled').count();
    await h.press('Escape');
    const closed = !(await h.p.locator('.launcher').count());
    const ok = names.length === 8 && current === 'Nova Text' && soon === 7 && closed;
    return ok ? OK(`${names.join(', ')}; os outros 7 aparecem como "Em breve"; Esc fecha.`) : FALHA(`${names} atual=${current} breve=${soon} fechou=${closed}`);
  } },

  // ───────────── Inserir
  { area: 'Inserir', name: 'Quebra de Página (Ctrl+Enter)', run: async (h) => {
    await h.reset(['antes depois']);
    await h.select(0, 6);
    await h.press('Control+Enter');
    const d = await h.doc();
    const marked = await h.p.locator('.block.page-break').count();
    await h.press('Backspace');
    const after = await h.doc();
    const ok = eq(d.blocks.map((b) => [b.spans.map((s) => s.text).join(''), b.attrs.pageBreakBefore]), [['antes ', false], ['depois', true]]) && marked === 1 && !after.blocks[1].attrs.pageBreakBefore;
    return ok ? OK('Linha "Quebra de Página" na tela, página nova ao imprimir e no .docx/.odt; Backspace apaga a quebra.') : FALHA(JSON.stringify(d.blocks.map((b) => b.attrs)));
  } },
  { area: 'Inserir', name: 'Link no texto selecionado (Ctrl+K) e Ctrl+clique', run: async (h) => {
    await h.reset(['veja o site hoje']);
    await h.select(0, 7, 0, 11);
    await h.press('Control+k');
    if (!(await h.modalVisible())) return FALHA('Ctrl+K não abriu a caixa.');
    await h.p.locator('.dialog input').nth(1).fill('exemplo.com');
    await h.p.keyboard.press('Enter'); await h.settle(200);
    const spans = await h.spans(0);
    const linked = spans.find((s) => s.marks.some((m) => m.mark === 'link'));
    await h.p.evaluate(() => { window.__opened = null; });
    await h.p.locator('.page .link').click({ modifiers: ['Control'] }); await h.settle(100);
    const opened = await h.p.evaluate(() => window.__opened);
    await h.select(0, 16); await h.type(' fim');
    const last = (await h.spans(0)).at(-1);
    const ok = linked?.text === 'site' && linked.marks.find((m) => m.mark === 'link').href === 'https://exemplo.com' && opened === 'https://exemplo.com' && !last.marks.some((m) => m.mark === 'link');
    return ok ? OK('"exemplo.com" vira https://exemplo.com; Ctrl+clique abre no navegador.') : FALHA(`${JSON.stringify(spans)} aberto=${opened}`);
  } },
  { area: 'Inserir', name: 'Link sem seleção, editar e remover', run: async (h) => {
    await h.reset(['']);
    await h.press('Control+k');
    await h.p.locator('.dialog input').nth(0).fill('Fale conosco');
    await h.p.locator('.dialog input').nth(1).fill('contato@empresa.com.br');
    await h.p.keyboard.press('Enter'); await h.settle(200);
    const made = await h.spans(0);
    await h.select(0, 3);
    await h.press('Control+k');
    const address = await h.p.locator('.dialog input').nth(1).inputValue();
    await h.p.locator('.modal button', { hasText: 'Remover Link' }).click(); await h.settle(200);
    const removed = await h.spans(0);
    const ok = made[0]?.text === 'Fale conosco' && made[0].marks[0]?.href === 'mailto:contato@empresa.com.br' && address === 'mailto:contato@empresa.com.br' && removed.every((s) => !s.marks.length);
    return ok ? OK() : FALHA(`${JSON.stringify(made)} → ${address} → ${JSON.stringify(removed)}`);
  } },
  { area: 'Inserir', name: 'Endereço digitado vira link (AutoFormatação)', run: async (h) => {
    await h.reset(['']);
    await h.type('acesse www.gov.br hoje');
    const spans = await h.spans(0);
    const link = spans.find((s) => s.marks.some((m) => m.mark === 'link'));
    return link?.text === 'www.gov.br' ? OK() : FALHA(JSON.stringify(spans));
  } },
  { area: 'Inserir', name: 'Data e Hora', run: async (h) => {
    await h.reset(['']);
    await h.p.locator('.tab', { hasText: 'Inserir' }).click();
    await h.p.locator('button', { hasText: 'Data e Hora' }).click(); await h.settle(100);
    const options = await h.p.locator('.dialog option').count();
    await h.p.locator('.modal button', { hasText: 'OK' }).click(); await h.settle(200);
    const t = await h.texts();
    await h.press('Alt+Shift+D');
    const t2 = await h.texts();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    return /^\d{2}\/\d{2}\/\d{4}$/.test(t[0]) && t2[0].length === 20 ? OK(`${options} formatos; Alt+Shift+D insere a data.`) : FALHA(JSON.stringify([t, t2]));
  } },
  { area: 'Inserir', name: 'Símbolo', run: async (h) => {
    await h.reset(['x']);
    await h.select(0, 1);
    await h.p.locator('.tab', { hasText: 'Inserir' }).click();
    await h.p.locator('button[aria-label="Símbolo"]').click();
    await h.p.locator('.popover .symbol', { hasText: '©' }).click(); await h.settle(150);
    const t = await h.texts();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    return t[0] === 'x©' ? OK() : FALHA(JSON.stringify(t));
  } },
  { area: 'Inserir', name: 'Tabela: inserir pela grade, digitar e Tab entre células', run: async (h) => {
    await h.reset(['antes', '']);
    await h.select(1, 0);
    await h.p.locator('.tab', { hasText: 'Inserir' }).click();
    await h.p.locator('button[aria-label="Tabela"]').click();
    await h.p.locator('.table-picker-grid button[aria-label="Tabela 3x2"]').click(); await h.settle(200);
    await h.type('Nome'); await h.press('Tab'); await h.type('Idade');
    await h.press('Tab'); await h.type('Ana'); await h.press('Tab'); await h.type('30');
    await h.press('Tab'); await h.type('Beto');
    const d = await h.doc();
    const cells = d.blocks.filter((b) => b.attrs.cell).map((b) => [b.attrs.cell.row, b.attrs.cell.col, b.spans.map((s) => s.text).join('')]);
    const tds = await h.p.locator('.nova-table td').count();
    const contextual = await h.p.locator('.tab', { hasText: 'Layout da Tabela' }).count();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = eq(cells.slice(0, 5), [[0, 0, 'Nome'], [0, 1, 'Idade'], [0, 2, 'Ana'], [1, 0, '30'], [1, 1, 'Beto']]) && tds === 6 && contextual === 1 && !d.blocks.at(-1).attrs.cell;
    return ok ? OK('Grade de 10×8 como no Word; aba Layout da Tabela aparece com o cursor na tabela.') : FALHA(`${JSON.stringify(cells)} td=${tds} aba=${contextual}`);
  } },
  { area: 'Inserir', name: 'Tabela: Tab na última célula cria linha; inserir e excluir linhas e colunas', run: async (h) => {
    await h.reset(['']);
    await h.p.locator('.tab', { hasText: 'Inserir' }).click();
    await h.p.locator('button[aria-label="Tabela"]').click();
    await h.p.locator('.table-picker-grid button[aria-label="Tabela 2x2"]').click(); await h.settle(200);
    for (const t of ['a', 'b', 'c', 'd']) { await h.type(t); await h.press('Tab'); }
    const rows = async () => { const d = await h.doc(); return 1 + Math.max(...d.blocks.filter((b) => b.attrs.cell).map((b) => b.attrs.cell.row)); };
    const cols = async () => { const d = await h.doc(); return 1 + Math.max(...d.blocks.filter((b) => b.attrs.cell).map((b) => b.attrs.cell.col)); };
    const afterTab = await rows();
    await h.p.locator('.tab', { hasText: 'Layout da Tabela' }).click();
    await h.p.locator('button', { hasText: 'Inserir à Direita' }).click(); await h.settle(150);
    const wider = await cols();
    await h.p.locator('button', { hasText: 'Inserir Acima' }).click(); await h.settle(150);
    const taller = await rows();
    await h.p.locator('button[aria-label="Excluir"]').click();
    await h.p.locator('.popover button', { hasText: 'Excluir Linhas' }).click(); await h.settle(150);
    const shorter = await rows();
    await h.p.locator('button[aria-label="Excluir"]').click();
    await h.p.locator('.popover button', { hasText: 'Excluir Tabela' }).click(); await h.settle(150);
    const d = await h.doc();
    const gone = d.blocks.every((b) => !b.attrs.cell);
    const ok = afterTab === 3 && wider === 3 && taller === 4 && shorter === 3 && gone;
    return ok ? OK() : FALHA(`linhas após Tab=${afterTab} colunas=${wider} acima=${taller} excluir=${shorter} tabela some=${gone}`);
  } },
  { area: 'Inserir', name: 'Tabela: Backspace não junta células e .docx abre como tabela', run: async (h) => {
    const fs = require('fs');
    await core('new_document');
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'text.insert', block: 0, offset: 0, text: 'x' },
      { type: 'block.setAttr', block: 0, attr: 'cell', value: { table: 'tt', row: 0, col: 0 } },
      { type: 'block.insert', index: 1, text: 'y' },
      { type: 'block.setAttr', block: 1, attr: 'cell', value: { table: 'tt', row: 0, col: 1 } },
      { type: 'block.insert', index: 2, text: 'fim' }] } });
    await core('save_document', { path: '/tmp/nova-flows/tabela.docx' });
    await h.reset();
    await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/tabela.docx'; });
    await h.press('Control+a'); await h.settle(100);
    await h.p.locator('.bs-big', { hasText: 'Procurar' }).click(); await h.settle(300);
    const tds = await h.p.locator('.nova-table td').count();
    await h.select(1, 0); await h.press('Backspace');
    const t = await h.texts();
    return tds === 2 && eq(t, ['x', 'y', 'fim']) && fs.existsSync('/tmp/nova-flows/tabela.docx') ? OK('Tabelas do Word e do LibreOffice validadas à parte (testes do núcleo).') : FALHA(`td=${tds} ${JSON.stringify(t)}`);
  } },
  { area: 'Inserir', name: 'Imagem do computador (Inserir → Imagens), tamanho e alinhamento', run: async (h) => {
    require('fs').writeFileSync('/tmp/nova-flows/foto.png', Buffer.from(PNG_64x32, 'base64'));
    await h.reset(['antes', '']);
    await h.select(1, 0);
    await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/foto.png'; });
    await h.p.locator('.tab', { hasText: 'Inserir' }).click();
    await h.p.locator('button', { hasText: 'Imagens' }).click(); await h.settle(400);
    const d = await h.doc();
    const image = d.blocks[1].attrs.image;
    const shown = await h.p.locator('.embedded-image img').count();
    const contextual = await h.p.locator('.tab', { hasText: 'Formato da Imagem' }).count();
    await h.p.locator('.tab', { hasText: 'Formato da Imagem' }).click();
    await h.p.locator('button', { hasText: '50%' }).click(); await h.settle(150);
    await h.p.locator('button', { hasText: 'Centralizar' }).click(); await h.settle(150);
    const after = (await h.doc()).blocks[1].attrs;
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = image && image.width === 48 && image.height === 24 && shown === 1 && contextual === 1 && after.image.width === 241 && after.image.height === 121 && after.align === 'center';
    return ok ? OK('64×32 px entra com 48×24 pt (96 ppp, como o Word); aba Formato da Imagem com tamanho e alinhamento.') : FALHA(`${JSON.stringify(image)} img=${shown} aba=${contextual} depois=${JSON.stringify(after)}`);
  } },
  { area: 'Inserir', name: 'Colar imagem (captura de tela) e mudar o tamanho com o mouse', run: async (h) => {
    await h.reset(['']);
    await h.p.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'captura.png', { type: 'image/png' }));
      document.querySelector('.page').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_64x32);
    await h.settle(500);
    const pasted = (await h.doc()).blocks[0].attrs.image;
    await h.p.locator('.embedded-image').click(); await h.settle(150);
    const handle = h.p.locator('.image-handle');
    const box = await handle.boundingBox();
    await h.p.mouse.move(box.x + 5, box.y + 5);
    await h.p.mouse.down();
    await h.p.mouse.move(box.x + 69, box.y + 30, { steps: 4 });
    await h.p.mouse.up(); await h.settle(200);
    const resized = (await h.doc()).blocks[0].attrs.image;
    await h.press('Backspace');
    const removed = (await h.doc()).blocks[0].attrs.image;
    const ok = pasted && resized && resized.width > pasted.width && Math.abs(resized.width / resized.height - 2) < 0.1 && removed === null;
    return ok ? OK('A alça no canto mantém a proporção; Backspace apaga a imagem.') : FALHA(`${JSON.stringify(pasted)} → ${JSON.stringify(resized)} → ${JSON.stringify(removed)}`);
  } },
  { area: 'Inserir', name: 'Imagem salva em .docx e reaberta', run: async (h) => {
    require('fs').writeFileSync('/tmp/nova-flows/foto.png', Buffer.from(PNG_64x32, 'base64'));
    await core('new_document');
    const image = await core('add_image_file', { path: '/tmp/nova-flows/foto.png' });
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'text.insert', block: 0, offset: 0, text: 'legenda' },
      { type: 'block.insert', index: 0, text: '' },
      { type: 'block.setAttr', block: 0, attr: 'image', value: image }] } });
    await core('save_document', { path: '/tmp/nova-flows/imagem.docx' });
    await h.reset();
    await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/imagem.docx'; });
    await h.press('Control+a'); await h.settle(100);
    await h.p.locator('.bs-big', { hasText: 'Procurar' }).click(); await h.settle(500);
    const back = await h.doc();
    const loaded = await h.p.locator('.embedded-image img').evaluate((img) => img.complete && img.naturalWidth);
    return back.blocks[0].attrs.image?.width === image.width && loaded === 64 ? OK('Imagens do Word e do LibreOffice validadas à parte (testes do núcleo).') : FALHA(`${JSON.stringify(back.blocks[0].attrs)} carregou=${loaded}`);
  } },
  { area: 'Inserir', name: 'Comentários', run: async () => AUSENTE('Não há comentários.') },

  // ───────────── Referências
  { area: 'Referências', name: 'Sumário automático com páginas, atualizar e Ctrl+clique', run: async (h) => {
    await h.reset(['']);
    const cmds = [];
    let k = 1;
    for (const [t, lvl] of [['Introdução', 1], ['Contexto', 2], ['Metodologia', 1], ['Conclusão', 1]]) {
      cmds.push({ type: 'block.insert', index: k, text: t, style: `heading${lvl}` });
      if (lvl === 1 && k > 1) cmds.push({ type: 'block.setAttr', block: k, attr: 'pageBreakBefore', value: true });
      k++;
      cmds.push({ type: 'block.insert', index: k++, text: 'Texto da seção.' });
    }
    await core('dispatch', { command: { type: 'batch', commands: cmds } });
    await h.reload();
    await h.select(0, 0);
    await h.p.locator('.tab', { hasText: 'Referências' }).click();
    await h.p.locator('.big-button', { hasText: 'Sumário' }).first().click();
    await h.p.locator('.popover .menu-item', { hasText: 'Sumário Automático' }).click(); await h.settle(300);
    const entries = async () => h.p.evaluate(() => [...document.querySelectorAll('.toc-entry')].map((e) => `${e.textContent}:${e.dataset.page}`));
    const first = await entries();
    const doc = await h.doc();
    const cached = doc.blocks.filter((b) => b.attrs.toc).map((b) => b.attrs.toc.page);
    // Título novo: o sumário fica igual até Atualizar Sumário (como no Word).
    const end = doc.blocks.length;
    await core('dispatch', { command: { type: 'block.insert', index: end, text: 'Anexo', style: 'heading1' } });
    await h.reload();
    await h.p.locator('.tab', { hasText: 'Referências' }).click();
    await h.p.locator('.big-button', { hasText: 'Atualizar Sumário' }).click(); await h.settle(300);
    const updated = await entries();
    await h.press('Control+z');
    const undone = (await entries()).length;
    // Ctrl+clique na entrada vai para o título.
    await h.p.locator('.toc-entry', { hasText: 'Metodologia' }).click({ modifiers: ['Control'] }); await h.settle(150);
    const caretText = await h.p.evaluate(() => document.querySelector('.statusbar, footer')?.textContent ?? '');
    const ok = first.join('|') === 'Introdução:1|Contexto:1|Metodologia:2|Conclusão:3' && cached.join(',') === '0,1,1,2,3'
      && updated.length === 5 && updated[4] === 'Anexo:3' && undone === 4 && /Página 2 de 3/.test(caretText) && /Título 1/.test(caretText);
    return ok ? OK('Títulos 1 a 3 com pontilhado e páginas reais; Atualizar refaz; Ctrl+clique leva ao título; vai para .docx/.odt como campo TOC.') : FALHA(`${first} cache=${cached} atualizado=${updated} desfeito=${undone} cursor=${caretText}`);
  } },
  { area: 'Referências', name: 'Nota de rodapé (Ctrl+Alt+F): número no texto e nota no pé da página', run: async (h) => {
    await h.reset(['Texto principal do trabalho', 'Segundo parágrafo']);
    await h.select(0, 15);
    await h.press('Control+Alt+F'); await h.settle(250);
    const focused = await h.p.evaluate(() => document.activeElement?.classList.contains('fn-text'));
    await h.p.keyboard.type('Fonte: IBGE, 2026.');
    await h.press('Enter'); await h.settle(250);
    const back = await h.p.evaluate(() => document.activeElement?.classList.contains('page'));
    // Segunda nota pela faixa de opções, antes da primeira: a numeração muda sozinha.
    await h.select(0, 5);
    await h.p.locator('.tab', { hasText: 'Referências' }).click();
    await h.p.locator('.big-button', { hasText: 'Inserir Nota de Rodapé' }).click(); await h.settle(250);
    await h.p.keyboard.type('Nota anterior.');
    await h.press('Escape'); await h.settle(250);
    const doc = await h.doc();
    const numbers = await h.p.evaluate(() => [...document.querySelectorAll('.fn-ref')].map((e) => e.dataset.n).join(','));
    const area = await h.p.locator('.fn-area').innerText();
    const texts = Object.values(doc.footnotes).sort();
    // Desfazer: primeiro o texto digitado na nota, depois a nota inteira (chamada e nota).
    await h.press('Control+z'); await h.settle(200);
    const u1 = Object.values((await h.doc()).footnotes).sort().join('|');
    await h.press('Control+z'); await h.settle(200);
    const afterUndo = await h.p.locator('.fn-ref').count();
    const ok = focused && back && numbers === '1,2' && /1\s*Nota anterior\.\s*2\s*Fonte: IBGE, 2026\./.test(area)
      && texts.join('|') === 'Fonte: IBGE, 2026.|Nota anterior.' && u1 === '|Fonte: IBGE, 2026.' && afterUndo === 1;
    return ok ? OK('Ctrl+Alt+F põe a chamada e o cursor na nota; Enter/Esc voltam ao texto; numeração automática; desfazer em dois passos (texto, nota).') : FALHA(JSON.stringify({ focused, back, numbers, area, texts, u1, afterUndo }));
  } },
  { area: 'Revisão', name: 'Comentários (Ctrl+Alt+M): balão, resposta, resolver e excluir', run: async (h) => {
    await h.reset(['Texto principal do trabalho final', 'Segundo parágrafo']);
    await h.select(0, 6, 0, 15);
    await h.press('Control+Alt+M'); await h.settle(250);
    if (await h.p.locator('.cm-name').count()) await h.p.locator('.cm-name').fill('Ana Souza');
    await h.p.locator('.cm-card.active .cm-input').fill('Rever este termo.');
    await h.p.locator('.cm-card.active .cm-input').press('Control+Enter'); await h.settle(300);
    let doc = await h.doc();
    const [id, first] = Object.entries(doc.comments)[0] ?? [];
    const marked = doc.blocks[0].spans.filter((s) => s.marks.some((m) => m.mark === 'comment')).map((s) => s.text).join('');
    // Resposta no balão.
    await h.p.locator('.cm-card').first().click(); await h.settle(150);
    await h.p.locator('.cm-card.active .cm-input').fill('Troquei por "central".');
    await h.p.locator('.cm-card.active .cm-btn.primary').click(); await h.settle(300);
    doc = await h.doc();
    const reply = Object.values(doc.comments).find((c) => c.parent === id);
    // Resolver e desfazer.
    await h.p.locator('.cm-card.active .cm-tool').first().click(); await h.settle(250);
    const done = (await h.doc()).comments[id]?.done;
    await h.p.locator('.page').focus();
    await h.press('Control+z'); await h.settle(250);
    const undone = (await h.doc()).comments[id]?.done;
    // Excluir pela faixa de opções: comentário, resposta e destaque somem.
    await h.select(0, 8);
    await h.p.locator('.tab', { hasText: 'Revisão' }).click();
    await h.p.locator('.menu-button', { hasText: 'Excluir' }).click();
    await h.p.locator('.menu-item', { hasText: /^Excluir$/ }).click(); await h.settle(300);
    doc = await h.doc();
    const left = Object.keys(doc.comments).length + doc.blocks[0].spans.filter((s) => s.marks.some((m) => m.mark === 'comment')).length;
    const ok = first?.author === 'Ana Souza' && first?.text === 'Rever este termo.' && marked === 'principal' && reply?.text === 'Troquei por "central".'
      && done === true && undone === false && left === 0;
    return ok ? OK('Novo Comentário no trecho selecionado, resposta, Resolver (com desfazer) e Excluir pela faixa.') : FALHA(JSON.stringify({ first, marked, reply, done, undone, left }));
  } },
  { area: 'Revisão', name: 'Comentários salvos no .docx e no .odt', run: async () => {
    await core('new_document');
    const c = (text, extra = {}) => ({ author: 'Ana Souza', initials: 'AS', date: '2026-10-30T14:45:00Z', text, done: false, ...extra });
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'text.insert', block: 0, offset: 0, text: 'O relatório ficou pronto.' },
      { type: 'text.applyMark', block: 0, offset: 2, len: 9, mark: { mark: 'comment', id: 'a1' } },
      { type: 'comment.set', id: 'a1', value: c('Conferir os números.') },
      { type: 'comment.set', id: 'r1', value: c('Conferi.', { parent: 'a1', author: 'Bruno Lima', initials: 'BL' }) },
      { type: 'text.applyMark', block: 0, offset: 18, len: 6, mark: { mark: 'comment', id: 'b1' } },
      { type: 'comment.set', id: 'b1', value: c('Quando?', { done: true }) },
    ] } });
    const out = [];
    for (const ext of ['docx', 'odt']) {
      await core('save_document', { path: `/tmp/nova-flows/comentarios.${ext}` });
      await core('new_document');
      const back = await core('open_document', { path: `/tmp/nova-flows/comentarios.${ext}` });
      const list = Object.values(back.comments);
      const root = Object.entries(back.comments).find(([, v]) => v.text === 'Conferir os números.');
      const marked = back.blocks[0].spans.filter((s) => s.marks.some((m) => m.mark === 'comment')).map((s) => s.text).join('|');
      out.push(`${list.length} ${marked} ${list.find((v) => v.text === 'Conferi.')?.parent === root?.[0]} ${list.find((v) => v.text === 'Quando?')?.done}`);
    }
    const files = zipList('/tmp/nova-flows/comentarios.docx').join(' ');
    const ok = out.every((o) => o === '3 relatório|pronto true true') && /comments\.xml/.test(files) && /commentsExtended\.xml/.test(files);
    return ok ? OK('word/comments.xml + commentsExtended.xml (respostas e resolvido) e office:annotation do .odt; validado no LibreOffice.') : FALHA(JSON.stringify(out));
  } },
  { area: 'Referências', name: 'Notas de rodapé salvas no .docx e no .odt', run: async () => {
    await core('new_document');
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'text.insert', block: 0, offset: 0, text: 'Afirmação.' },
      { type: 'text.insert', block: 0, offset: 10, text: '\uE000', marks: [{ mark: 'footnote', id: 'a1' }] },
      { type: 'footnote.set', id: 'a1', text: 'Fonte: IBGE, 2026.' },
    ] } });
    const out = [];
    for (const ext of ['docx', 'odt']) {
      await core('save_document', { path: `/tmp/nova-flows/notas.${ext}` });
      await core('new_document');
      const back = await core('open_document', { path: `/tmp/nova-flows/notas.${ext}` });
      out.push(`${back.blocks[0].spans.map((s) => s.text).join('')}=${Object.values(back.footnotes).join('')}`);
    }
    const files = zipList('/tmp/nova-flows/notas.docx').join(' ');
    const ok = out.every((o) => o === 'Afirmação.\uE000=Fonte: IBGE, 2026.') && /footnotes\.xml/.test(files);
    return ok ? OK('word/footnotes.xml (w:footnoteReference) e text:note do .odt; validado no LibreOffice.') : FALHA(JSON.stringify(out));
  } },
  { area: 'Referências', name: 'Sumário salvo no .docx e no .odt', run: async () => {
    await core('new_document');
    const cmds = [
      { type: 'text.insert', block: 0, offset: 0, text: 'Sumário' },
      { type: 'block.setAttr', block: 0, attr: 'toc', value: { level: 0, page: 0 } },
      { type: 'block.insert', index: 1, text: 'Introdução' },
      { type: 'block.setAttr', block: 1, attr: 'toc', value: { level: 1, page: 2 } },
      { type: 'block.insert', index: 2, text: 'Introdução', style: 'heading1' },
    ];
    await core('dispatch', { command: { type: 'batch', commands: cmds } });
    const out = [];
    for (const ext of ['docx', 'odt']) {
      await core('save_document', { path: `/tmp/nova-flows/sumario.${ext}` });
      await core('new_document');
      const back = await core('open_document', { path: `/tmp/nova-flows/sumario.${ext}` });
      out.push(back.blocks.slice(0, 2).map((b) => JSON.stringify(b.attrs.toc)).join(','));
    }
    const xml = zipRead('/tmp/nova-flows/sumario.docx', 'word/document.xml');
    const ok = out.every((o) => o === '{"level":0,"page":0},{"level":1,"page":2}') && /TOC \\o/.test(xml);
    return ok ? OK('Campo TOC do Word (estilos Sumário 1…) e índice do LibreOffice (text:table-of-content); validado no LibreOffice.') : FALHA(`${out} toc=${/TOC/.test(xml)}`);
  } },

  // ───────────── Exibição
  { area: 'Exibição', name: 'Página com tamanho A4 e margens; várias páginas', run: async (h) => {
    const many = Array.from({ length: 120 }, (_, i) => `Parágrafo ${i + 1} com algum texto para ocupar espaço na página.`);
    await h.reset(many);
    const sheets = await h.p.locator('.sheet').count();
    const sheet = await h.p.locator('.sheet').first().boundingBox();
    // Nenhum parágrafo pode atravessar o fim da área de texto de uma folha.
    const crossing = await h.p.evaluate(() => {
      const page = document.querySelector('.page');
      const stride = document.querySelector('.sheet').offsetHeight + 24;
      const end = (k) => k * stride + document.querySelector('.sheet').offsetHeight - parseFloat(getComputedStyle(page).paddingBottom);
      return Array.from(page.children).filter((b) => {
        const k = Math.floor(b.offsetTop / stride);
        return b.offsetTop + b.offsetHeight > end(k) + 1;
      }).length;
    });
    const status = await h.p.locator('.statusbar').innerText();
    const ok = sheets > 1 && Math.abs(sheet.width - 794) < 2 && Math.abs(sheet.height - 1123) < 2 && crossing === 0 && new RegExp(`Página 1 de ${sheets}`).test(status);
    return ok ? OK(`${sheets} folhas A4 (21 × 29,7 cm); nenhum parágrafo atravessa a margem de baixo; "Página 1 de ${sheets}" na barra de status.`) : FALHA(`folhas=${sheets} ${JSON.stringify(sheet)} atravessam=${crossing} ${status}`);
  } },
  { area: 'Exibição', name: 'Zoom (Ctrl + roda / controle de zoom)', run: async () => AUSENTE('Não há controle de zoom no app.') },
  { area: 'Exibição', name: 'Tema claro/escuro', run: async (h) => {
    await h.reset(['x']);
    await h.p.locator('.tab', { hasText: 'Exibir' }).click();
    await h.p.locator('[role=radio]', { hasText: 'Escuro' }).click(); await h.settle();
    const theme = await h.p.evaluate(() => document.documentElement.dataset.theme);
    await h.p.locator('[role=radio]', { hasText: 'Sistema' }).click();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    return theme === 'dark' ? OK('Recurso que o Word não tem nesta forma.') : FALHA(`data-theme=${theme}`);
  } },
  { area: 'Exibição', name: 'Régua', run: async () => AUSENTE('Não há régua.') },

  // ───────────── Design
  { area: 'Design', name: 'Cor da Página: cores do tema, Mais Cores e Sem Cor', run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Design' }).click();
    const pick = async (fn) => { await h.p.locator('button[aria-label="Cor da Página"]').click(); await fn(); await h.settle(200); return (await h.doc()).page.background ?? null; };
    const theme = await pick(() => h.p.locator('.popover .swatch-grid.theme .swatch').nth(13).click());
    const sheetBg = await h.p.locator('.sheet').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const more = await pick(() => h.p.locator('.popover .hidden-color').evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '#ddebf7');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }));
    const none = await pick(() => h.p.locator('.popover .menu-item', { hasText: 'Sem Cor' }).click());
    await h.press('Control+z'); await h.settle(200);
    const undone = (await h.doc()).page.background ?? null;
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = /^#[0-9A-F]{6}$/.test(theme) && sheetBg !== 'rgb(255, 255, 255)' && more === '#DDEBF7' && none === null && undone === '#DDEBF7';
    return ok ? OK('Grade de Cores do Tema, Cores Padrão, Mais Cores… e Sem Cor, como no Word; Ctrl+Z desfaz.') : FALHA(`tema=${theme} folha=${sheetBg} mais=${more} sem=${none} desfeito=${undone}`);
  } },
  { area: 'Design', name: "Marca d'Água da galeria em todas as folhas, atrás do texto", run: async (h) => {
    const many = Array.from({ length: 90 }, (_, i) => `Parágrafo ${i + 1} com algum texto para ocupar espaço na página.`);
    await h.reset(many);
    await h.p.locator('.tab', { hasText: 'Design' }).click();
    await h.p.locator("button[aria-label=\"Marca d'Água\"]").click();
    await h.p.locator('.popover .watermark-tile[aria-label="CONFIDENCIAL (Diagonal)"]').click(); await h.settle(300);
    const wm = (await h.doc()).watermark;
    const layout = await h.p.evaluate(() => {
      const sheets = document.querySelectorAll('.sheet').length;
      const marks = [...document.querySelectorAll('.sheet .watermark-text')];
      const r = marks[0].getBoundingClientRect();
      // O texto do documento fica por cima: as folhas vêm antes do texto e, no centro da marca d'água, o ponto é do texto.
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const sheetsEl = document.querySelector('.sheets');
      const behind = marks.every((m) => sheetsEl.contains(m)) && !!(sheetsEl.compareDocumentPosition(document.querySelector('.page')) & Node.DOCUMENT_POSITION_FOLLOWING) && !!top?.closest('.page');
      return { sheets, marks: marks.length, rotate: marks[0].style.transform, onTop: behind, text: marks[0].textContent };
    });
    await h.press('Control+z'); await h.settle(200);
    const undone = (await h.doc()).watermark ?? null;
    const left = await h.p.locator('.sheet .watermark-text').count();
    await h.press('Control+y'); await h.settle(200);
    const redone = (await h.doc()).watermark?.text;
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = wm?.text === 'CONFIDENCIAL' && wm.layout === 'diagonal' && wm.semitransparent && wm.color === '#C0C0C0'
      && layout.sheets > 1 && layout.marks === layout.sheets && /rotate\(-45deg\)/.test(layout.rotate) && layout.onTop && undone === null && left === 0 && redone === 'CONFIDENCIAL';
    return ok ? OK(`Prata semitransparente na diagonal em ${layout.sheets} folhas, atrás do texto; Ctrl+Z / Ctrl+Y.`) : FALHA(`${JSON.stringify(wm)} ${JSON.stringify(layout)} desfeito=${JSON.stringify(undone)} sobrou=${left} refeito=${redone}`);
  } },
  { area: 'Design', name: "Marca d'Água Personalizada: texto, cor, transparência e horizontal; Remover", run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Design' }).click();
    await h.p.locator("button[aria-label=\"Marca d'Água\"]").click();
    await h.p.locator('.popover .menu-item', { hasText: "Marca d'Água Personalizada" }).click();
    const dialog = h.p.locator('.watermark-dialog');
    await dialog.locator('label', { hasText: "Marca d'água de texto" }).locator('input').check();
    await dialog.locator('input[list="watermark-texts"]').fill('USO INTERNO');
    await dialog.locator('input[type="color"]').fill('#c00000');
    await dialog.locator('label', { hasText: 'Semitransparente' }).locator('input').uncheck();
    await dialog.locator('label', { hasText: 'Horizontal' }).locator('input').check();
    await dialog.locator('button', { hasText: 'OK' }).click(); await h.settle(200);
    const wm = (await h.doc()).watermark;
    const svg = await h.p.locator('.sheet .watermark-text').first().evaluate((el) => ({ t: el.style.transform, fill: el.querySelector('text').getAttribute('fill'), op: el.querySelector('text').getAttribute('fill-opacity') }));
    // Texto em branco não vale (como no Word, o OK fica sem efeito e avisa).
    await h.p.locator("button[aria-label=\"Marca d'Água\"]").click();
    await h.p.locator('.popover .menu-item', { hasText: "Marca d'Água Personalizada" }).click();
    await dialog.locator('input[list="watermark-texts"]').fill('   ');
    await dialog.locator('button', { hasText: 'OK' }).click();
    const warned = await dialog.locator('.dialog-error').count();
    await h.p.keyboard.press('Escape');
    await h.p.locator("button[aria-label=\"Marca d'Água\"]").click();
    await h.p.locator('.popover .menu-item', { hasText: "Remover Marca d'Água" }).click(); await h.settle(200);
    const removed = (await h.doc()).watermark ?? null;
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = same(wm, { text: 'USO INTERNO', color: '#C00000', semitransparent: false, layout: 'horizontal' }) && !/rotate/.test(svg.t) && svg.fill === '#C00000' && svg.op === '1' && warned === 1 && removed === null;
    return ok ? OK("Caixa Marca d'Água como a do Word (Sem marca d'água / Marca d'água de texto, Aplicar)."): FALHA(`${JSON.stringify(wm)} ${JSON.stringify(svg)} aviso=${warned} removida=${JSON.stringify(removed)}`);
  } },
  { area: 'Design', name: 'Bordas da Página: caixa, sombra e dupla, com cor e largura', run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Design' }).click();
    const choose = async (setting, color, width) => {
      await h.p.locator('.big-button', { hasText: 'Bordas da Página' }).click();
      const d = h.p.locator('.borders-dialog');
      await d.locator('.border-setting', { hasText: setting }).click();
      if (color) await d.locator('input[type="color"]').fill(color);
      if (width) await d.locator('select').selectOption({ label: width });
      await d.locator('button', { hasText: 'OK' }).click(); await h.settle(200);
      const css = await h.p.locator('.sheet').first().evaluate((s) => {
        const b = s.querySelector('.sheet-border');
        if (!b) return null;
        const c = getComputedStyle(b);
        return { style: c.borderTopStyle, width: c.borderTopWidth, color: c.borderTopColor, shadow: c.boxShadow, top: b.offsetTop };
      });
      return { border: (await h.doc()).page.border ?? null, css };
    };
    const box = await choose('Caixa', '#2f5496', '1 ½ pt');
    const shadow = await choose('Sombra');
    const dbl = await choose('Dupla', null, '½ pt');
    const none = await choose('Nenhuma');
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = same(box.border, { style: 'single', color: '#2F5496', width: 12 }) && box.css.style === 'solid' && box.css.width === '2px' && box.css.top === 32 && box.css.shadow === 'none'
      && shadow.border?.style === 'shadow' && shadow.css.shadow !== 'none'
      && same(dbl.border, { style: 'double', color: '#2F5496', width: 4 }) && dbl.css.style === 'double'
      && none.border === null && none.css === null;
    return ok ? OK('A 24 pt da beira do papel, como o padrão do Word; Nenhuma remove.') : FALHA(JSON.stringify({ box, shadow, dbl, none }));
  } },
  { area: 'Design', name: "Imprimir/PDF com cor da página, borda e marca d'água", run: async (h) => {
    const many = Array.from({ length: 60 }, (_, i) => `Parágrafo ${i + 1} com algum texto para ocupar espaço na página.`);
    await h.reset(many);
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'page.set', page: { width: 11906, height: 16838, marginTop: 1417, marginBottom: 1417, marginLeft: 1417, marginRight: 1417, background: '#FFF2CC', border: { style: 'single', color: '#2F5496', width: 12 } } },
      { type: 'watermark.set', value: { text: 'CONFIDENCIAL', color: '#C0C0C0', semitransparent: true, layout: 'diagonal' } },
      { type: 'headerFooter.set', value: { header: { text: 'Relatório', align: 'center' }, footer: { text: '', align: 'left' }, differentFirst: false } },
    ] } });
    await h.reload();
    // PDF como "Gráficos de fundo" desligado: a cor precisa sair mesmo assim.
    const pdf = await h.p.pdf({ preferCSSPageSize: true, printBackground: false });
    const zlib = require('zlib');
    const raw = pdf.toString('latin1');
    const pages = (raw.match(/\/Type\s*\/Page\b/g) || []).length;
    let streams = '';
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      try { streams += zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* fonte ou imagem */ }
    }
    const fills = (rgb) => (streams.match(new RegExp(`${rgb} (rg|sc)`, 'g')) || []).length;
    const paper = fills('1 \\.949 \\.8');
    // A borda são gradientes (linear-gradient) nas caixas de margem: /Shading com a cor no dicionário.
    const line = (raw.match(/\.1843 \.3294 \.5882/g) || []).length;
    const gray = fills('\\.7529 \\.7529 \\.7529');
    const alpha = /\/ca\s+\.5/.test(raw);
    await core('new_document'); await h.reload();
    const ok = pages > 1 && paper >= pages && line >= pages && gray >= pages && alpha;
    return ok ? OK(`${pages} páginas: cor no papel inteiro (print-color-adjust: exact), borda nas caixas de margem do @page e marca d'água semitransparente em cada página.`) : FALHA(`páginas=${pages} papel=${paper} borda=${line} marca=${gray} alfa=${alpha}`);
  } },
  { area: 'Design', name: 'Cor, borda e marca d\'água salvas no .docx e no .odt', run: async () => {
    await core('new_document');
    const page = { width: 11906, height: 16838, marginTop: 1417, marginBottom: 1417, marginLeft: 1417, marginRight: 1417, background: '#E2EFDA', border: { style: 'double', color: '#C00000', width: 6 } };
    const watermark = { text: 'RASCUNHO', color: '#808080', semitransparent: false, layout: 'horizontal' };
    await core('dispatch', { command: { type: 'batch', commands: [{ type: 'page.set', page }, { type: 'watermark.set', value: watermark }] } });
    const out = [];
    for (const ext of ['docx', 'odt']) {
      await core('save_document', { path: `/tmp/nova-flows/design.${ext}` });
      await core('new_document');
      const back = await core('open_document', { path: `/tmp/nova-flows/design.${ext}` });
      const close = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].every((k) => Math.abs(back.page[k] - page[k]) <= 2);
      out.push(close && back.page.background === page.background && same(back.page.border, page.border) && same(back.watermark, watermark) ? 'ok' : JSON.stringify([back.page, back.watermark]));
    }
    return out.every((o) => o === 'ok') ? OK("w:background, w:pgBorders e v:textpath no cabeçalho (.docx); fo:background-color, fo:border e draw:custom-shape (.odt). Validado no LibreOffice (testes do núcleo).") : FALHA(out.join(' | '));
  } },

  // ───────────── Layout
  { area: 'Layout', name: 'Margens prontas (Normal, ABNT…) e personalizadas', run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Layout' }).click();
    await h.p.locator('button[aria-label="Margens"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'ABNT' }).click(); await h.settle(200);
    const abnt = (await h.doc()).page;
    await h.p.locator('button[aria-label="Margens"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'Margens Personalizadas' }).click();
    const inputs = h.p.locator('.dialog input');
    await inputs.nth(0).fill('2'); await inputs.nth(2).fill('2,5');
    await h.p.keyboard.press('Enter'); await h.settle(200);
    const custom = (await h.doc()).page;
    const padding = await h.p.locator('.page').evaluate((el) => getComputedStyle(el).paddingLeft);
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const cm = (t) => Math.round((t / 1440) * 2.54 * 100) / 100;
    const ok = cm(abnt.marginTop) === 3 && cm(abnt.marginLeft) === 3 && cm(abnt.marginRight) === 2 && cm(abnt.marginBottom) === 2 && cm(custom.marginTop) === 2 && cm(custom.marginLeft) === 2.5 && Math.abs(parseFloat(padding) - 94.5) < 1;
    return ok ? OK('Inclui ABNT (3 cm em cima e à esquerda, 2 cm embaixo e à direita).') : FALHA(`${JSON.stringify(abnt)} ${JSON.stringify(custom)} padding=${padding}`);
  } },
  { area: 'Layout', name: 'Orientação paisagem e tamanho do papel', run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Layout' }).click();
    await h.p.locator('button[aria-label="Orientação"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'Paisagem' }).click(); await h.settle(200);
    const landscape = await h.p.locator('.sheet').first().boundingBox();
    await h.p.locator('button[aria-label="Tamanho"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'Ofício' }).click(); await h.settle(200);
    const legal = (await h.doc()).page;
    await h.press('Control+z');
    const undone = (await h.doc()).page;
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = Math.abs(landscape.width - 1123) < 2 && legal.width === 20160 && legal.height === 12240 && undone.width === 16838;
    return ok ? OK('Ofício em paisagem; Ctrl+Z desfaz a mudança de página.') : FALHA(`${JSON.stringify(landscape)} ${JSON.stringify(legal)} ${JSON.stringify(undone)}`);
  } },
  { area: 'Layout', name: 'Papel e margens salvos no .docx', run: async (h) => {
    await core('new_document');
    await core('dispatch', { command: { type: 'page.set', page: { width: 16838, height: 11906, marginTop: 1701, marginBottom: 1134, marginLeft: 1701, marginRight: 1134 } } });
    await core('save_document', { path: '/tmp/nova-flows/pagina.docx' });
    await core('new_document');
    const back = await core('open_document', { path: '/tmp/nova-flows/pagina.docx' });
    const xml = zipRead('/tmp/nova-flows/pagina.docx', 'word/document.xml');
    const ok = back.page.width === 16838 && back.page.marginLeft === 1701 && /w:orient="landscape"/.test(xml);
    return ok ? OK('w:pgSz e w:pgMar como no Word.') : FALHA(JSON.stringify(back.page));
  } },

  // ───────────── Atualização (resposta do GitHub simulada no tauri-mock.js)
  { area: 'Atualização', name: 'Aviso de versão nova ao abrir o app, com as Novidades', run: async (h) => withRelease(h, { 'mock.release': release('v0.2.0') }, async () => {
    await h.reload();
    await updateBar(h).waitFor({ timeout: 5000 });
    const text = await updateBar(h).innerText();
    await updateBar(h).getByRole('button', { name: 'Novidades' }).click();
    const notes = h.p.locator('.release-notes');
    await notes.waitFor();
    const title = await notes.locator('h2').innerText();
    const heading = await notes.locator('h3').innerText();
    const items = await notes.locator('li').count();
    const bold = await notes.locator('li strong').first().innerText();
    await notes.locator('a', { hasText: '/pull/12' }).click();
    const opened = await h.p.evaluate(() => window.__opened);
    await h.press('Escape');
    const closed = (await notes.count()) === 0;
    await updateBar(h).getByRole('button', { name: 'Depois' }).click();
    const gone = (await updateBar(h).count()) === 0;
    const ok = /Nova versão 0\.2\.0 disponível — Novidades · Baixar e instalar · Depois/.test(text.replace(/\s+/g, ' ')) && title === 'Novidades da versão 0.2.0' && heading === 'O que mudou' && items === 2 && bold === 'Exibir' && opened === 'https://github.com/Acnaell/NovaOffice/pull/12' && closed && gone;
    return ok ? OK('Faixa abaixo da faixa de opções; notas em Markdown numa caixa; links no navegador.') : FALHA(JSON.stringify({ text, title, heading, items, bold, opened, closed, gone }));
  }) },
  { area: 'Atualização', name: 'Mesma versão ou pré-lançamento: sem aviso', run: async (h) => {
    const same = await withRelease(h, { 'mock.release': release('v0.1.6') }, async () => {
      await h.reload(); await h.settle(400);
      return updateBar(h).count();
    });
    const pre = await withRelease(h, { 'mock.release': release('v0.3.0-beta.1', { prerelease: true }) }, async () => {
      await h.reload(); await h.settle(400);
      const calls = await h.p.evaluate(() => window.__calls.filter((c) => c.cmd === 'check_update').length);
      return { bar: await updateBar(h).count(), calls };
    });
    const ok = same === 0 && pre.bar === 0 && pre.calls === 1;
    return ok ? OK('Consulta ao abrir; 0.1.6 e 0.3.0-beta.1 não aparecem.') : FALHA(JSON.stringify({ same, pre }));
  } },
  { area: 'Atualização', name: 'Baixar e instalar (Windows): progresso, "Salvar alterações?" e instalador', run: async (h) => withRelease(h, { 'mock.release': release('v0.2.0') }, async () => {
    await h.reset(['']);
    await h.type('rascunho');
    await updateBar(h).getByRole('button', { name: 'Baixar e instalar' }).click();
    await h.p.locator('.update-progress').waitFor({ timeout: 3000 });
    const progress = await updateBar(h).innerText();
    // Cancelar: não instala, e a faixa oferece instalar depois.
    await h.p.locator('.modal[role="alertdialog"]').waitFor({ timeout: 5000 });
    await h.p.getByRole('button', { name: 'Cancelar' }).click(); await h.settle(200);
    const afterCancel = await h.p.evaluate(() => window.__installed);
    const ready = await updateBar(h).innerText();
    await updateBar(h).getByRole('button', { name: 'Instalar agora' }).click();
    await h.p.locator('.modal[role="alertdialog"]').waitFor({ timeout: 3000 });
    await h.p.getByRole('button', { name: 'Não Salvar' }).click(); await h.settle(200);
    const installed = await h.p.evaluate(() => window.__installed);
    const ok = /Baixando a versão 0\.2\.0… \d+%/.test(progress) && afterCancel === 0 && /baixada e conferida/.test(ready) && installed === 1;
    return ok ? OK('Download com barra, pergunta antes de fechar e roda o instalador (/P no app).') : FALHA(JSON.stringify({ progress, afterCancel, ready, installed }));
  }) },
  { area: 'Atualização', name: 'Instalador que não confere (SHA-256) não é instalado', run: async (h) => withRelease(h, { 'mock.release': release('v0.2.0'), 'mock.download': 'fail' }, async () => {
    await h.reload();
    await updateBar(h).getByRole('button', { name: 'Baixar e instalar' }).click();
    await h.p.locator('.update-error').waitFor({ timeout: 5000 });
    const text = await updateBar(h).innerText();
    const installed = await h.p.evaluate(() => window.__installed);
    const ok = /Não foi possível atualizar: .*não confere/.test(text) && /Tentar de novo/.test(text) && installed === 0;
    return ok ? OK() : FALHA(JSON.stringify({ text, installed }));
  }) },
  { area: 'Atualização', name: 'macOS e Linux: Baixar abre a página da release', run: async (h) => withRelease(h, { 'mock.release': release('v0.2.0'), 'mock.windows': '0' }, async () => {
    await h.reload();
    await updateBar(h).getByRole('button', { name: 'Baixar e instalar' }).click(); await h.settle();
    const opened = await h.p.evaluate(() => window.__opened);
    const downloads = await h.p.evaluate(() => window.__calls.filter((c) => c.cmd === 'download_update').length);
    const ok = opened === 'https://github.com/Acnaell/NovaOffice/releases/tag/v0.2.0' && downloads === 0;
    return ok ? OK() : FALHA(JSON.stringify({ opened, downloads }));
  }) },
  { area: 'Atualização', name: 'Arquivo → Sobre: versão, Procurar atualizações e Avisar sobre atualizações', run: async (h) => withRelease(h, { 'mock.release': release('v0.1.6') }, async () => {
    await h.reload();
    await h.p.locator('.tab-file').click();
    await h.p.locator('.bs-nav', { hasText: 'Sobre' }).click();
    const version = await h.p.locator('.about-version').innerText();
    await h.p.locator('.bs-big', { hasText: 'Procurar atualizações' }).click();
    await h.p.locator('.about-result', { hasText: 'mais recente' }).waitFor({ timeout: 3000 });
    // Agora sai a 0.2.0, e o usuário desliga o aviso: ao abrir de novo, nem consulta.
    await h.p.locator('.about-notify input').uncheck();
    const stored = await h.p.evaluate(() => localStorage.getItem('nova.update.notify'));
    await h.p.evaluate((r) => sessionStorage.setItem('mock.release', r), release('v0.2.0'));
    await h.reload(); await h.settle(300);
    const silent = await h.p.evaluate(() => window.__calls.filter((c) => c.cmd === 'check_update').length);
    // Procurar à mão ainda funciona e mostra a faixa.
    await h.p.locator('.tab-file').click();
    await h.p.locator('.bs-nav', { hasText: 'Sobre' }).click();
    await h.p.locator('.bs-big', { hasText: 'Procurar atualizações' }).click();
    await h.p.locator('.about-found').waitFor({ timeout: 3000 });
    await h.press('Escape');
    const bar = await updateBar(h).count();
    const ok = version === 'Versão 0.1.6' && stored === 'off' && silent === 0 && bar === 1;
    return ok ? OK('Preferência guardada em localStorage.') : FALHA(JSON.stringify({ version, stored, silent, bar }));
  }) },

  { area: 'Inserir', name: 'Cabeçalho e rodapé com número de página', run: async (h) => {
    const many = Array.from({ length: 90 }, (_, i) => `Parágrafo ${i + 1} com algum texto para ocupar espaço na página.`);
    await h.reset(many);
    await h.p.locator('.tab', { hasText: 'Inserir' }).click();
    await h.p.locator('button[aria-label="Número de Página"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'Página X de Y' }).click(); await h.settle(300);
    await h.p.locator('.tab', { hasText: 'Inserir' }).click();
    await h.p.locator('.big-button', { hasText: 'Cabeçalho' }).click(); await h.settle(200);
    const tab = await h.p.locator('.tab', { hasText: 'Cabeçalho e Rodapé' }).count();
    await h.p.keyboard.type('Relatório anual');
    await h.p.locator('.big-button', { hasText: 'nº da página' }).click();
    await h.p.locator('.big-button', { hasText: 'Fechar Cabeçalho e Rodapé' }).click(); await h.settle(300);
    const hf = (await h.doc()).headerFooter;
    const sheets = await h.p.locator('.sheet').count();
    const second = await h.p.locator('.hf-footer').nth(1).innerText();
    const header2 = await h.p.locator('.hf-header').nth(1).innerText();
    // Duplo clique no cabeçalho volta à edição; Esc sai.
    await h.p.locator('.hf-header').first().dblclick(); await h.settle(150);
    const editing = await h.p.locator('#hf-editor').count();
    await h.p.keyboard.press('Escape'); await h.settle(150);
    await h.press('Control+z');
    const undone = (await h.doc()).headerFooter.header.text;
    const ok = tab === 1 && hf.header.text === 'Relatório anual{PAGE}' && hf.footer.text === 'Página {PAGE} de {NUMPAGES}' && hf.footer.align === 'right' && second === `Página 2 de ${sheets}` && header2 === 'Relatório anual2' && editing === 1 && undone === '';
    return ok ? OK(`Aba contextual, campos de página, duplo clique para editar; na impressão vai nas margens da página.`) : FALHA(`${JSON.stringify(hf)} folhas=${sheets} rodapé2=${second} cab2=${header2} editando=${editing} desfeito=${undone}`);
  } },
  { area: 'Inserir', name: 'Cabeçalho e rodapé salvos no .docx', run: async (h) => {
    await core('new_document');
    await core('dispatch', { command: { type: 'headerFooter.set', value: { header: { text: 'Topo', align: 'center' }, footer: { text: '{PAGE}', align: 'right' }, differentFirst: true } } });
    await core('save_document', { path: '/tmp/nova-flows/cabecalho.docx' });
    await core('new_document');
    const back = await core('open_document', { path: '/tmp/nova-flows/cabecalho.docx' });
    const files = zipList('/tmp/nova-flows/cabecalho.docx').join(' ');
    const ok = back.headerFooter.header.text === 'Topo' && back.headerFooter.footer.text === '{PAGE}' && back.headerFooter.differentFirst && /header1\.xml/.test(files);
    return ok ? OK('word/header1.xml e footer1.xml com o campo PAGE e "Primeira Página Diferente"; também em .odt.') : FALHA(JSON.stringify(back.headerFooter));
  } },

  // ───────────── Exibir
  { area: 'Exibir', name: 'Zoom na barra de status (−/+, porcentagem e Ctrl + roda) sem mudar as páginas', run: async (h) => {
    const long = Array.from({ length: 60 }, (_, i) => `Parágrafo ${i + 1}: o rato roeu a roupa do rei de Roma e a rainha remendou com linha e agulha.`);
    await h.reset(long);
    const measure = () => h.p.evaluate(() => ({
      zoom: getComputedStyle(document.querySelector('.paper')).zoom,
      page: document.querySelector('.page').offsetHeight,
      status: document.querySelector('.statusbar').textContent.match(/Página \d+ de \d+/)[0],
      level: document.querySelector('.zoom-level').value,
    }));
    const before = await measure();
    await h.p.locator('.zoom-step[aria-label^="Ampliar"]').click(); await h.settle();
    await h.p.locator('.zoom-step[aria-label^="Ampliar"]').click(); await h.settle();
    const plus = await measure();
    await h.p.locator('.zoom-step[aria-label^="Reduzir"]').click(); await h.settle();
    const minus = await measure();
    await h.p.locator('.zoom-level').selectOption('50'); await h.settle(200);
    const half = await measure();
    const box = await h.p.locator('.scroller').boundingBox();
    await h.p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await h.p.keyboard.down('Control');
    await h.p.mouse.wheel(0, -120); await h.settle(150);
    await h.p.keyboard.up('Control');
    const wheel = await measure();
    await h.p.locator('.zoom-level').selectOption('200'); await h.settle(200);
    const big = await measure();
    // Digitar com zoom continua indo para o lugar certo.
    await h.select(3, 0);
    await h.type('§');
    const typed = (await h.texts())[3].startsWith('§Parágrafo 4');
    await h.reload();
    const after = await measure();
    const ok = before.zoom === '1' && plus.level === '120' && plus.zoom === '1.2' && minus.level === '110' && half.zoom === '0.5' && wheel.level === '60'
      && big.zoom === '2' && [plus, minus, half, wheel, big].every((m) => m.page === before.page && m.status === before.status) && typed && after.level === '100';
    return ok ? OK(`Páginas iguais em todos os níveis (${before.status}); o zoom não fica salvo.`) : FALHA(JSON.stringify({ before, plus, minus, half, wheel, big, typed, after }));
  } },
  { area: 'Exibir', name: '100%, Uma Página e Largura da Página', run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Exibir' }).click();
    const fits = () => h.p.evaluate(() => {
      const s = document.querySelector('.scroller').getBoundingClientRect();
      const sheet = document.querySelector('.sheet').getBoundingClientRect();
      return { level: document.querySelector('.zoom-level').value, sheetH: sheet.height, sheetW: sheet.width, viewH: s.height, viewW: s.width };
    });
    await h.p.locator('.big-button', { hasText: 'Uma Página' }).click(); await h.settle(200);
    const page = await fits();
    await h.p.locator('.big-button', { hasText: 'Largura da Página' }).click(); await h.settle(200);
    const width = await fits();
    await h.p.locator('.big-button', { hasText: '100%' }).click(); await h.settle(200);
    const full = await fits();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = page.sheetH <= page.viewH && page.sheetH > page.viewH * 0.8 && width.sheetW <= width.viewW && width.sheetW > width.viewW * 0.9 && full.level === '100' && Math.abs(full.sheetW - 793.7) < 1;
    return ok ? OK(`Uma Página ${page.level}%, Largura da Página ${width.level}%.`) : FALHA(JSON.stringify({ page, width, full }));
  } },
  { area: 'Exibir', name: 'Régua com as margens da página', run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Exibir' }).click();
    await h.p.locator('.view-check', { hasText: 'Régua' }).locator('input').check(); await h.settle();
    const geometry = () => h.p.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const ruler = r('.ruler'), sheet = r('.sheet'), left = r('.ruler-margin[data-side="left"]'), right = r('.ruler-margin[data-side="right"]');
      const text = document.querySelector('[data-block="0"]').getBoundingClientRect();
      return { dx: Math.abs(ruler.left - sheet.left), dw: Math.abs(ruler.width - sheet.width), margin: Math.abs(left.right - text.left), right: right.width };
    });
    const normal = await geometry();
    // Margens ABNT (3 cm à esquerda, 2 cm à direita): a régua acompanha.
    await h.p.locator('.tab', { hasText: 'Layout' }).click();
    await h.p.locator('button[aria-label="Margens"]').click();
    await h.p.locator('.popover .menu-item', { hasText: 'ABNT' }).click(); await h.settle(200);
    const abnt = await geometry();
    await h.p.locator('.zoom-level').selectOption('150'); await h.settle(200);
    const zoomed = await geometry();
    await h.reload();
    const kept = await h.p.locator('.ruler').count();
    await h.p.locator('.tab', { hasText: 'Exibir' }).click();
    await h.p.locator('.view-check', { hasText: 'Régua' }).locator('input').uncheck(); await h.settle();
    const off = await h.p.locator('.ruler').count();
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const cm = 96 / 2.54;
    const ok = [normal, abnt, zoomed].every((g) => g.dx < 1.5 && g.dw < 1.5 && g.margin < 1.5) && Math.abs(abnt.right - 2 * cm) < 1.5 && Math.abs(zoomed.right - 3 * cm) < 1.5 && kept === 1 && off === 0;
    return ok ? OK('Alinhada ao papel e à margem, em qualquer zoom; fica ligada ao reabrir.') : FALHA(JSON.stringify({ normal, abnt, zoomed, kept, off }));
  } },
  { area: 'Exibir', name: 'Painel de Navegação: títulos e clique leva o cursor', run: async (h) => {
    const paras = ['Introdução', 'texto', 'Objetivos', 'mais texto', 'Detalhes', ...Array.from({ length: 40 }, (_, i) => `linha ${i}`), 'Conclusão', 'fim'];
    await h.reset(paras);
    const style = { 0: 'heading1', 2: 'heading2', 4: 'heading3', 45: 'heading1' };
    await core('dispatch', { command: { type: 'batch', commands: Object.entries(style).map(([b, s]) => ({ type: 'block.setStyle', block: Number(b), style: s })) } });
    await h.reload();
    await h.p.locator('.tab', { hasText: 'Exibir' }).click();
    await h.p.locator('.view-check', { hasText: 'Painel de Navegação' }).locator('input').check(); await h.settle();
    const items = await h.p.locator('.nav-heading').evaluateAll((els) => els.map((e) => `${e.className.match(/level-(\d)/)[1]}:${e.textContent}`));
    await h.p.locator('.nav-heading', { hasText: 'Conclusão' }).click(); await h.settle(300);
    const current = await h.p.locator('.nav-heading[aria-current]').innerText();
    const visible = await h.p.evaluate(() => {
      const r = document.querySelector('[data-block="45"]').getBoundingClientRect();
      const s = document.querySelector('.scroller').getBoundingClientRect();
      return r.top >= s.top && r.bottom <= s.bottom;
    });
    const t = await h.caretProbe();
    await h.reload();
    const kept = await h.p.locator('.nav-pane').count();
    await h.p.locator('.nav-pane-close').click(); await h.settle();
    const closed = await h.p.locator('.nav-pane').count();
    const ok = items.join('|') === '1:Introdução|2:Objetivos|3:Detalhes|1:Conclusão' && current === 'Conclusão' && visible && t[45] === '§Conclusão' && kept === 1 && closed === 0;
    return ok ? OK('Título 1 a 3, com a seção do cursor marcada.') : FALHA(JSON.stringify({ items, current, visible, t45: t[45], kept, closed }));
  } },
  { area: 'Exibir', name: 'Modo de Foco em tela inteira; Esc volta', run: async (h) => {
    await h.reset(['texto']);
    await h.p.locator('.tab', { hasText: 'Exibir' }).click();
    await h.p.locator('.big-button', { hasText: 'Modo de Foco' }).click(); await h.settle(200);
    const hidden = await h.p.evaluate(() => ['.chrome', '.statusbar'].map((s) => getComputedStyle(document.querySelector(s)).display));
    const full = await h.p.evaluate(() => window.__calls.filter((c) => c.cmd === 'plugin:window|set_fullscreen').map((c) => c.args.value));
    await h.select(0, 5);
    await h.type('!');
    const typed = (await h.texts())[0];
    await h.press('Escape');
    const back = await h.p.evaluate(() => getComputedStyle(document.querySelector('.chrome')).display);
    const after = await h.p.evaluate(() => window.__calls.filter((c) => c.cmd === 'plugin:window|set_fullscreen').map((c) => c.args.value));
    await h.p.locator('.tab', { hasText: 'Página inicial' }).click();
    const ok = hidden.every((d) => d === 'none') && full.join() === 'true' && typed === 'texto!' && back !== 'none' && after.join() === 'true,false';
    return ok ? OK('Esconde a faixa de opções e a barra de status; o documento continua editável.') : FALHA(JSON.stringify({ hidden, full, typed, back, after }));
  } },

  // ───────────── Desempenho
  { area: 'Desempenho', name: 'Digitar num documento longo (≈300 parágrafos)', run: async (h) => {
    const many = Array.from({ length: 300 }, (_, i) => `Parágrafo ${i + 1}: o rato roeu a roupa do rei de Roma e a rainha remendou.`);
    await h.reset(many); await h.select(150, 5);
    const t0 = Date.now();
    await h.p.keyboard.type('abcdefghij', { delay: 0 });
    await h.p.waitForFunction(() => document.querySelector('[data-block="150"]').textContent.includes('abcdefghij'), null, { timeout: 20000 });
    const ms = (Date.now() - t0) / 10;
    const t = await h.texts();
    const ok = t[150].startsWith('Parágabcdefghijrafo 151');
    if (!ok) return FALHA(`Texto ficou ${JSON.stringify(t[150])}`);
    return ms < 50 ? OK(`${ms.toFixed(0)} ms por tecla.`) : PARCIAL(`${ms.toFixed(0)} ms por tecla: o documento inteiro é redesenhado a cada tecla.`);
  } },
  { area: 'Desempenho', name: 'Digitar num documento muito longo (≈2.000 parágrafos)', run: async (h) => {
    const many = Array.from({ length: 2000 }, (_, i) => `Parágrafo ${i + 1}: o rato roeu a roupa do rei de Roma e a rainha remendou.`);
    await h.reset(many); await h.select(1000, 5);
    const t0 = Date.now();
    await h.p.keyboard.type('abcde', { delay: 0 });
    await h.p.waitForFunction(() => document.querySelector('[data-block="1000"]').textContent.includes('abcde'), null, { timeout: 60000 });
    const ms = (Date.now() - t0) / 5;
    return ms < 50 ? OK(`${ms.toFixed(0)} ms por tecla.`) : PARCIAL(`${ms.toFixed(0)} ms por tecla: lento em documentos grandes (o DOM é recriado a cada tecla).`);
  } },
];

module.exports = { flows };
