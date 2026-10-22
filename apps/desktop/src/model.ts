// Lógica do editor sem DOM: transforma ações do usuário em comandos do núcleo
// e calcula onde o cursor fica depois. Testada em model.test.ts.

import type {
  BlockStyle,
  BlockView,
  DocView,
  Mark,
  MarkKind,
  Pos,
  TextCommand,
  ToggleMark,
} from "./types";

export interface Selection {
  anchor: Pos;
  focus: Pos;
}

/** Comando a enviar (ou nenhum) e a seleção depois dele. */
export interface Edit {
  command: TextCommand | null;
  selection: Selection;
}

export const caret = (pos: Pos): Selection => ({ anchor: pos, focus: pos });

export const blockText = (block: BlockView): string => block.spans.map((s) => s.text).join("");

export const comparePos = (a: Pos, b: Pos): number => a.block - b.block || a.offset - b.offset;

export const isCollapsed = (sel: Selection): boolean => comparePos(sel.anchor, sel.focus) === 0;

/** Início e fim da seleção, em ordem de documento. */
export function ordered(sel: Selection): [Pos, Pos] {
  return comparePos(sel.anchor, sel.focus) <= 0 ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
}

/** Garante que a seleção aponta para posições que existem no documento. */
export function clampSelection(doc: DocView, sel: Selection): Selection {
  const clamp = (pos: Pos): Pos => {
    const block = Math.min(Math.max(pos.block, 0), doc.blocks.length - 1);
    const len = blockText(doc.blocks[block]).length;
    return { block, offset: Math.min(Math.max(pos.offset, 0), len) };
  };
  return { anchor: clamp(sel.anchor), focus: clamp(sel.focus) };
}

/** Marcas do caractere à esquerda da posição (no início do bloco, do primeiro). */
export function marksAt(doc: DocView, pos: Pos): Mark[] {
  const spans = doc.blocks[pos.block]?.spans ?? [];
  let start = 0;
  for (const span of spans) {
    const end = start + span.text.length;
    if (pos.offset > start && pos.offset <= end) return span.marks;
    start = end;
  }
  return spans[0]?.marks ?? [];
}

interface Segment {
  block: number;
  start: number;
  end: number;
}

/** Trechos não vazios de cada bloco entre `from` e `to`. */
export function segments(doc: DocView, from: Pos, to: Pos): Segment[] {
  const out: Segment[] = [];
  for (let block = from.block; block <= to.block; block++) {
    const len = blockText(doc.blocks[block]).length;
    const start = block === from.block ? from.offset : 0;
    const end = block === to.block ? to.offset : len;
    if (end > start) out.push({ block, start, end });
  }
  return out;
}

/** `true` se todo o texto entre `from` e `to` tem a marca. */
export function rangeHasMark(doc: DocView, from: Pos, to: Pos, kind: MarkKind): boolean {
  const segs = segments(doc, from, to);
  if (segs.length === 0) return false;
  return segs.every((seg) => {
    let pos = 0;
    for (const span of doc.blocks[seg.block].spans) {
      const spanStart = pos;
      pos += span.text.length;
      if (pos <= seg.start || spanStart >= seg.end) continue;
      if (!span.marks.some((m) => m.mark === kind)) return false;
    }
    return true;
  });
}

/** Se a marca aparece ligada na barra de ferramentas para esta seleção. */
export function markActive(doc: DocView, sel: Selection, kind: MarkKind): boolean {
  if (isCollapsed(sel)) return marksAt(doc, sel.focus).some((m) => m.mark === kind);
  const [from, to] = ordered(sel);
  return rangeHasMark(doc, from, to, kind);
}

/** Liga a marca em toda a seleção, ou desliga se ela já cobre tudo. */
export function toggleMark(doc: DocView, sel: Selection, kind: ToggleMark): TextCommand | null {
  const [from, to] = ordered(sel);
  const on = rangeHasMark(doc, from, to, kind);
  const commands: TextCommand[] = segments(doc, from, to).map(({ block, start, end }) =>
    on
      ? { type: "text.removeMark", block, offset: start, len: end - start, kind }
      : { type: "text.applyMark", block, offset: start, len: end - start, mark: { mark: kind } },
  );
  return wrap(commands);
}

/** Marcas que o próximo texto digitado deve receber depois de alternar uma
 *  marca com o cursor parado (sem seleção). */
export function toggledMarks(current: Mark[], kind: ToggleMark): Mark[] {
  return current.some((m) => m.mark === kind)
    ? current.filter((m) => m.mark !== kind)
    : [...current, { mark: kind }];
}

export function setStyle(doc: DocView, sel: Selection, style: BlockStyle): TextCommand | null {
  const [from, to] = ordered(sel);
  const commands: TextCommand[] = [];
  for (let block = from.block; block <= to.block; block++) {
    if (doc.blocks[block].style !== style) commands.push({ type: "block.setStyle", block, style });
  }
  return wrap(commands);
}

/** Digitar ou colar: substitui a seleção; quebras de linha viram parágrafos. */
export function insertText(_doc: DocView, sel: Selection, text: string, marks?: Mark[]): Edit {
  const [from, to] = ordered(sel);
  const commands: TextCommand[] = [];
  const removal = deleteRange(from, to).command;
  if (removal) commands.push(removal);

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const insert = (pos: Pos, value: string): TextCommand => ({
    type: "text.insert",
    block: pos.block,
    offset: pos.offset,
    text: value,
    ...(marks ? { marks } : {}),
  });

  if (lines.length === 1) {
    if (lines[0]) commands.push(insert(from, lines[0]));
    return { command: wrap(commands), selection: caret({ block: from.block, offset: from.offset + lines[0].length }) };
  }

  commands.push({ type: "block.split", block: from.block, offset: from.offset });
  if (lines[0]) commands.push(insert(from, lines[0]));
  for (let i = 1; i < lines.length - 1; i++) {
    commands.push({ type: "block.insert", index: from.block + i, text: lines[i] });
  }
  const last = lines[lines.length - 1];
  const lastBlock = from.block + lines.length - 1;
  if (last) commands.push(insert({ block: lastBlock, offset: 0 }, last));
  return { command: wrap(commands), selection: caret({ block: lastBlock, offset: last.length }) };
}

/** Enter. */
export function splitBlock(_doc: DocView, sel: Selection): Edit {
  const [from, to] = ordered(sel);
  const commands: TextCommand[] = [];
  const removal = deleteRange(from, to).command;
  if (removal) commands.push(removal);
  commands.push({ type: "block.split", block: from.block, offset: from.offset });
  return { command: wrap(commands), selection: caret({ block: from.block + 1, offset: 0 }) };
}

/** Dentro de um parágrafo usa `text.delete`, que se agrupa com a digitação no
 *  desfazer; entre parágrafos, `text.deleteRange`, que é um passo próprio. */
export function deleteRange(from: Pos, to: Pos): Edit {
  if (comparePos(from, to) === 0) return { command: null, selection: caret(from) };
  const command: TextCommand =
    from.block === to.block
      ? { type: "text.delete", block: from.block, offset: from.offset, len: to.offset - from.offset }
      : { type: "text.deleteRange", from, to };
  return { command, selection: caret(from) };
}

/** Backspace. No início de um parágrafo, junta com o anterior. */
export function deleteBackward(doc: DocView, sel: Selection): Edit {
  if (!isCollapsed(sel)) return deleteRange(...ordered(sel));
  const { block, offset } = sel.focus;
  if (offset > 0) {
    const len = charLenBefore(blockText(doc.blocks[block]), offset);
    return deleteRange({ block, offset: offset - len }, sel.focus);
  }
  // No início de um item de lista, o primeiro Backspace tira o marcador (Word).
  if (doc.blocks[block].attrs?.list) {
    return { command: { type: "block.setAttr", block, attr: "list", value: null }, selection: sel };
  }
  if (block > 0) {
    const prevLen = blockText(doc.blocks[block - 1]).length;
    return deleteRange({ block: block - 1, offset: prevLen }, sel.focus);
  }
  return { command: null, selection: sel };
}

/** Delete. No fim de um parágrafo, puxa o seguinte. */
export function deleteForward(doc: DocView, sel: Selection): Edit {
  if (!isCollapsed(sel)) return deleteRange(...ordered(sel));
  const { block, offset } = sel.focus;
  const text = blockText(doc.blocks[block]);
  if (offset < text.length) {
    return deleteRange(sel.focus, { block, offset: offset + charLenAfter(text, offset) });
  }
  if (block < doc.blocks.length - 1) return deleteRange(sel.focus, { block: block + 1, offset: 0 });
  return { command: null, selection: sel };
}

/** Ctrl+Backspace. */
export function deleteWordBackward(doc: DocView, sel: Selection): Edit {
  if (!isCollapsed(sel) || sel.focus.offset === 0) return deleteBackward(doc, sel);
  const start = wordStart(blockText(doc.blocks[sel.focus.block]), sel.focus.offset);
  return deleteRange({ block: sel.focus.block, offset: start }, sel.focus);
}

/** Ctrl+Delete. */
export function deleteWordForward(doc: DocView, sel: Selection): Edit {
  const text = blockText(doc.blocks[sel.focus.block]);
  if (!isCollapsed(sel) || sel.focus.offset === text.length) return deleteForward(doc, sel);
  return deleteRange(sel.focus, { block: sel.focus.block, offset: wordEnd(text, sel.focus.offset) });
}

/** Apaga até o início (`backward`) ou o fim do parágrafo. */
export function deleteToBlockEdge(doc: DocView, sel: Selection, backward: boolean): Edit {
  if (!isCollapsed(sel)) return deleteRange(...ordered(sel));
  const { block } = sel.focus;
  const edge = { block, offset: backward ? 0 : blockText(doc.blocks[block]).length };
  return backward ? deleteRange(edge, sel.focus) : deleteRange(sel.focus, edge);
}

export function wordStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

export function wordEnd(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

export function wordCount(doc: DocView): number {
  return doc.blocks.reduce((n, b) => n + (blockText(b).match(/\S+/g)?.length ?? 0), 0);
}

// Fronteiras de caractere como o usuário as vê (grafemas): um emoji de família
// (👨‍👩‍👧, vários pontos de código unidos por ZWJ), uma bandeira (🇧🇷, dois
// indicadores regionais) ou uma letra com acento combinado contam como um só.
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Tamanho (UTF-16) do caractere visível que termina em `offset`. */
export function charLenBefore(text: string, offset: number): number {
  if (segmenter) {
    let last = 0;
    for (const { index } of segmenter.segment(text.slice(0, offset))) last = index;
    return offset - last || 1;
  }
  return offset >= 2 && isLow(text.charCodeAt(offset - 1)) && isHigh(text.charCodeAt(offset - 2)) ? 2 : 1;
}

/** Tamanho (UTF-16) do caractere visível que começa em `offset`. */
export function charLenAfter(text: string, offset: number): number {
  if (segmenter) {
    const first = segmenter.segment(text.slice(offset))[Symbol.iterator]().next();
    return first.done ? 1 : first.value.segment.length;
  }
  return offset + 1 < text.length && isHigh(text.charCodeAt(offset)) && isLow(text.charCodeAt(offset + 1)) ? 2 : 1;
}

/**
 * Onde as duas visões começam a diferir: depois de desfazer ou refazer, o
 * cursor vai para lá, como no Word.
 */
export function firstDifference(before: DocView, after: DocView): Pos | null {
  const n = Math.min(before.blocks.length, after.blocks.length);
  for (let block = 0; block < n; block++) {
    const a = blockText(before.blocks[block]);
    const b = blockText(after.blocks[block]);
    if (a === b && JSON.stringify(before.blocks[block]) === JSON.stringify(after.blocks[block])) continue;
    let offset = 0;
    while (offset < a.length && offset < b.length && a[offset] === b[offset]) offset++;
    return { block, offset: Math.min(offset, b.length) };
  }
  if (before.blocks.length !== after.blocks.length) {
    const block = Math.min(n, after.blocks.length - 1);
    return { block, offset: block < n ? blockText(after.blocks[block]).length : 0 };
  }
  return null;
}

function wrap(commands: TextCommand[]): TextCommand | null {
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0] : { type: "batch", commands };
}
