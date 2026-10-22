// Fluxos básicos do Microsoft Word aplicados ao Nova Text.
// status: ok | parcial (funciona com defeito/limitação) | falha (existe, mas quebrado) | ausente
const { core } = require('./lib.cjs');

const OK = (obs = '') => ({ status: 'ok', obs });
const PARCIAL = (obs) => ({ status: 'parcial', obs });
const FALHA = (obs) => ({ status: 'falha', obs });
const AUSENTE = (obs) => ({ status: 'ausente', obs });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
  { area: 'Parágrafo', name: 'Quebra de página (Ctrl+Enter)', run: async (h) => {
    await h.reset(['antes']); await h.select(0, 5); await h.press('Control+Enter'); await h.type('depois');
    const t = await h.texts();
    return AUSENTE(`Fica para a fase Layout (páginas reais); Ctrl+Enter ${t.length === 2 ? 'cria um parágrafo comum' : 'resulta em ' + JSON.stringify(t)}.`);
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

  // ───────────── Inserir
  { area: 'Inserir', name: 'Tabela', run: async () => AUSENTE('Não há tabelas (roadmap).') },
  { area: 'Inserir', name: 'Imagem', run: async (h) => {
    await h.reset(['']);
    await h.p.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }));
      document.querySelector('.page').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await h.settle();
    const t = await h.texts();
    return AUSENTE(`Não há imagens (roadmap); colar uma imagem ${eq(t, ['']) ? 'é ignorado sem erro' : 'produz ' + JSON.stringify(t)}.`);
  } },
  { area: 'Inserir', name: 'Hiperlink (Ctrl+K)', run: absentShortcut('Control+k', 'Hiperlink') },
  { area: 'Inserir', name: 'Links digitados viram clicáveis', run: async () => AUSENTE('Endereços como https://… ficam como texto comum.') },
  { area: 'Inserir', name: 'Símbolos e caracteres especiais', run: async () => AUSENTE('Não há janela de símbolos (dá para colar ou usar o teclado do sistema).') },
  { area: 'Inserir', name: 'Cabeçalho, rodapé e número de página', run: async () => AUSENTE('Não há cabeçalho/rodapé nem paginação.') },
  { area: 'Inserir', name: 'Comentários', run: async () => AUSENTE('Não há comentários.') },

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
  { area: 'Ferramentas', name: 'Verificação ortográfica', run: async (h) => {
    await h.reset(['']);
    const spell = await h.p.locator('.page').getAttribute('spellcheck');
    return spell === 'true' ? PARCIAL('Usa o corretor do sistema/WebView (sublinhado vermelho); o idioma não acompanha o documento e não há verificação gramatical. Precisa ser confirmado no app instalado (WebView2/WebKit).') : AUSENTE('spellcheck desligado.');
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
    await h.reset(); await h.type('frase. outra');
    const t = await h.texts();
    return t[0] === 'Frase. Outra' ? OK() : AUSENTE('Não há autocorreção (maiúscula inicial, aspas inteligentes, -- → —).');
  } },

  // ───────────── Arquivo
  { area: 'Arquivo', name: 'Salvar, fechar e reabrir (.nova) preserva texto e formatação', run: async (h) => {
    await h.reset(['Título do doc', 'corpo com negrito']);
    await core('dispatch', { command: { type: 'batch', commands: [
      { type: 'block.setStyle', block: 0, style: 'heading1' },
      { type: 'text.applyMark', block: 1, offset: 10, len: 7, mark: { mark: 'bold' } }] } });
    await h.p.reload(); await h.p.waitForSelector('.page'); await h.p.focus('.page');
    await h.p.evaluate(() => { window.__dialog.save = '/tmp/nova-flows/ciclo.nova'; });
    await h.press('Control+b');
    const saved = await h.doc();
    await core('new_document');
    await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/ciclo.nova'; });
    await h.press('Control+a'); await h.settle(300);
    const back = await h.doc();
    const title = await h.p.evaluate(() => window.__title);
    const ok = back.blocks[0].style === 'heading1' && JSON.stringify(back.blocks[1].spans).includes('bold') && !back.dirty;
    return ok ? OK(`Título da janela: "${title}"`) : FALHA(`Salvo: ${saved.path}; reaberto: ${JSON.stringify(back.blocks)}`);
  } },
  { area: 'Arquivo', name: 'Ctrl+B num documento novo pede onde salvar', run: async (h) => {
    await h.reset(['x']); await h.p.evaluate(() => { window.__calls = []; window.__dialog.save = '/tmp/nova-flows/novo.nova'; });
    await h.press('Control+b'); await h.settle(200);
    const calls = await h.p.evaluate(() => window.__calls.map((c) => c.cmd));
    const d = await h.doc();
    return calls.includes('plugin:dialog|save') && !d.dirty ? OK() : FALHA(JSON.stringify(calls));
  } },
  { area: 'Arquivo', name: 'Novo documento com alterações pergunta antes de descartar', run: async (h) => {
    await h.reset(); await h.type('não salvo'); await h.p.evaluate(() => { window.__calls = []; window.__dialog.ask = false; });
    await h.press('Control+o'); await h.settle(200);
    const calls = await h.p.evaluate(() => window.__calls.map((c) => c.cmd));
    const t = await h.texts();
    await h.p.evaluate(() => { window.__dialog.ask = true; });
    return calls.some((c) => /dialog\|(ask|message)/.test(c)) && eq(t, ['não salvo']) ? OK() : FALHA(`${JSON.stringify(calls)} → ${JSON.stringify(t)}`);
  } },
  { area: 'Arquivo', name: 'Fechar a janela com alterações não salvas', run: async () => AUSENTE('Fechar a janela não pergunta (limitação já conhecida); o trabalho se perde.') },
  { area: 'Arquivo', name: 'Abrir arquivo .docx do Word', run: async (h) => {
    await h.reset();
    return AUSENTE('Só abre .nova, .txt e .md. Importar/exportar .docx está no roadmap (plugins de formato).');
  } },
  { area: 'Arquivo', name: 'Abrir .txt / .md', run: async (h) => {
    require('fs').writeFileSync('/tmp/nova-flows/notas.md', '# Título\n\nTexto com **negrito**\n- item');
    await h.reset(); await h.p.evaluate(() => { window.__dialog.open = '/tmp/nova-flows/notas.md'; });
    await h.press('Control+a'); await h.settle(300);
    const d = await h.doc();
    const t = d.blocks.map((b) => b.spans.map((s) => s.text).join(''));
    const parsed = d.blocks[0].style === 'heading1';
    return parsed ? OK() : PARCIAL(`Markdown é aberto como texto puro (sem converter # e **): ${JSON.stringify(t)}`);
  } },
  { area: 'Arquivo', name: 'Exportar para PDF', run: async () => AUSENTE('Só exporta Markdown.') },
  { area: 'Arquivo', name: 'Imprimir (Ctrl+P)', run: absentShortcut('Control+p', 'Imprimir') },
  { area: 'Arquivo', name: 'Salvamento automático / recuperação', run: async () => AUSENTE('Não há salvamento automático nem recuperação após travamento.') },
  { area: 'Arquivo', name: 'Documentos recentes', run: async () => AUSENTE('Não há lista de recentes.') },

  // ───────────── Exibição
  { area: 'Exibição', name: 'Página com tamanho A4 e margens; várias páginas', run: async (h) => {
    const many = Array.from({ length: 120 }, (_, i) => `Parágrafo ${i + 1} com algum texto para ocupar espaço na página.`);
    await h.reset(many);
    const pages = await h.p.locator('.page').count();
    const box = await h.p.locator('.page').boundingBox();
    return pages > 1 ? OK() : PARCIAL(`Uma única "folha" contínua de ${Math.round(box.height)} px de altura: sem paginação, tamanho de papel ou margens configuráveis.`);
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
