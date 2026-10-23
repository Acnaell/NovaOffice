// Sumário (Referências → Sumário). Como no Word, o sumário são parágrafos
// comuns marcados com `toc`: o título (nível 0) e uma entrada por título do
// documento, com o texto do título. A página guardada em cada entrada é a da
// última atualização (vai para o .docx/.odt); na tela, o número é calculado na
// hora a partir das páginas reais.

import { blockText, caret, type Edit, type Selection } from "./model";
import type { BlockStyle, BlockView, DocView, TextCommand, TocEntry } from "./types";

/** Títulos que entram no sumário por padrão (Título 1 a 3, como o Word). */
export const DEFAULT_TOC_LEVELS = 3;

const HEADING_LEVEL: Partial<Record<BlockStyle, number>> = {
  heading1: 1,
  heading2: 2,
  heading3: 3,
  heading4: 4,
  heading5: 5,
  heading6: 6,
};

export function headingLevel(block: BlockView): number | null {
  return HEADING_LEVEL[block.style] ?? null;
}

export interface TocItem {
  /** Parágrafo do título no documento. */
  block: number;
  level: number;
  text: string;
}

/** Títulos que vão para o sumário, na ordem do documento (fora do próprio sumário e das tabelas). */
export function tocItems(blocks: BlockView[], levels = DEFAULT_TOC_LEVELS): TocItem[] {
  const items: TocItem[] = [];
  blocks.forEach((b, block) => {
    const level = headingLevel(b);
    if (level === null || level > levels || b.attrs.toc || b.attrs.cell) return;
    const text = blockText(b).replace(/[\u000b\n]+/g, " ").trim();
    if (text) items.push({ block, level, text });
  });
  return items;
}

/** Primeiro sumário do documento: parágrafos seguidos com `toc`, [start, end). */
export function findToc(blocks: BlockView[]): { start: number; end: number } | null {
  const start = blocks.findIndex((b) => b.attrs.toc);
  if (start < 0) return null;
  let end = start + 1;
  while (end < blocks.length && blocks[end].attrs.toc) end++;
  return { start, end };
}

/**
 * Para cada entrada do sumário, o título a que ela se refere: o próximo título
 * com o mesmo texto depois do da entrada anterior (o sumário pode estar
 * desatualizado; entradas sem título correspondente ficam de fora).
 */
export function tocTargets(blocks: BlockView[]): Map<number, number> {
  const headings = tocItems(blocks, 6);
  const out = new Map<number, number>();
  let from = 0;
  blocks.forEach((b, i) => {
    if (!b.attrs.toc || b.attrs.toc.level === 0) return;
    const text = blockText(b).trim();
    let k = from;
    while (k < headings.length && headings[k].text !== text) k++;
    if (k < headings.length) {
      out.set(i, headings[k].block);
      from = k + 1;
    }
  });
  return out;
}

function entryCommands(index: number, text: string, toc: TocEntry): TextCommand[] {
  return [
    { type: "block.insert", index, text, style: "paragraph" },
    { type: "block.setAttr", block: index, attr: "toc", value: toc },
  ];
}

/** Comandos que inserem as entradas a partir de `index` (com a mensagem do Word se não houver títulos). */
function entries(items: TocItem[], index: number, pageOf: (block: number) => number, empty: string): TextCommand[] {
  if (!items.length) return entryCommands(index, empty, { level: 1, page: 0 });
  return items.flatMap((item, k) =>
    entryCommands(index + k, item.text, { level: item.level, page: Math.max(0, Math.min(65535, pageOf(item.block))) }),
  );
}

export interface TocLabels {
  title: string;
  empty: string;
}

/**
 * Insere um sumário no parágrafo do cursor (antes dele, se o cursor está no
 * começo; depois, se não). Se já há um, atualiza o existente.
 */
export function insertToc(doc: DocView, sel: Selection, pageOf: (block: number) => number, labels: TocLabels): Edit {
  if (findToc(doc.blocks)) return updateToc(doc, sel, pageOf, labels) ?? { command: null, selection: sel };
  const at = sel.focus.block;
  const current = doc.blocks[at];
  const cellEnd = (() => {
    // Dentro de uma tabela, o sumário vai depois dela.
    const table = current.attrs.cell?.table;
    if (!table) return null;
    let end = at;
    while (end < doc.blocks.length && doc.blocks[end].attrs.cell?.table === table) end++;
    return end;
  })();
  const index = cellEnd ?? (sel.focus.offset === 0 ? at : at + 1);
  const items = tocItems(doc.blocks);
  // Os títulos depois do ponto de inserção andam para baixo; as páginas são as de antes.
  const commands: TextCommand[] = [
    ...entryCommands(index, labels.title, { level: 0, page: 0 }),
    ...entries(items, index + 1, pageOf, labels.empty),
  ];
  const inserted = 1 + Math.max(1, items.length);
  // Depois do sumário, o texto continua num parágrafo comum.
  if (index >= doc.blocks.length) commands.push({ type: "block.insert", index: index + inserted, text: "" });
  return { command: { type: "batch", commands }, selection: caret({ block: index + inserted, offset: 0 }) };
}

/** Atualiza o sumário inteiro (Atualizar Sumário): refaz as entradas com os títulos e as páginas atuais. */
export function updateToc(doc: DocView, sel: Selection, pageOf: (block: number) => number, labels: TocLabels): Edit | null {
  const range = findToc(doc.blocks);
  if (!range) return null;
  const hasTitle = doc.blocks[range.start].attrs.toc?.level === 0;
  const first = hasTitle ? range.start + 1 : range.start;
  const commands: TextCommand[] = [];
  for (let b = range.end - 1; b >= first; b--) commands.push({ type: "block.remove", block: b });
  const removed = range.end - first;
  const items = tocItems(doc.blocks);
  // Índices dos títulos depois da remoção das entradas antigas (os títulos vêm depois do sumário ou antes dele).
  const shift = (block: number) => (block >= range.end ? block - removed : block);
  const shifted = items.map((item) => ({ ...item, block: shift(item.block) }));
  const back = new Map(items.map((item) => [shift(item.block), item.block]));
  commands.push(...entries(shifted, first, (b) => pageOf(back.get(b) ?? b), labels.empty));
  const added = Math.max(1, items.length);
  // O cursor que estava no sumário vai para o começo dele; o de depois anda junto com o texto.
  const move = (block: number) => (block < range.start ? block : block >= range.end ? block - removed + added : range.start);
  const focus = sel.focus.block >= range.start && sel.focus.block < range.end ? caret({ block: range.start, offset: 0 }) : {
    anchor: { ...sel.anchor, block: move(sel.anchor.block) },
    focus: { ...sel.focus, block: move(sel.focus.block) },
  };
  return { command: { type: "batch", commands }, selection: focus };
}

/** Remove o sumário (Referências → Sumário → Remover Sumário). */
export function removeToc(doc: DocView, sel: Selection): Edit | null {
  const range = findToc(doc.blocks);
  if (!range) return null;
  const commands: TextCommand[] = [];
  for (let b = range.end - 1; b >= range.start; b--) commands.push({ type: "block.remove", block: b });
  const removed = range.end - range.start;
  // O documento nunca fica sem parágrafos.
  if (removed === doc.blocks.length) commands.push({ type: "block.insert", index: 0, text: "" });
  const at = Math.min(range.start, Math.max(0, doc.blocks.length - removed - 1));
  const after = sel.focus.block >= range.end ? sel.focus.block - removed : at;
  return { command: { type: "batch", commands }, selection: caret({ block: Math.max(0, after), offset: 0 }) };
}

/**
 * Página de cada título na tela, a partir das posições depois da paginação
 * (`data-stride` é a altura de uma folha mais o intervalo, gravada pela paginação).
 */
export function screenPages(root: HTMLElement | null): (block: number) => number {
  const stride = Number(root?.dataset.stride) || 0;
  return (block) => {
    const el = root?.querySelector<HTMLElement>(`[data-block="${block}"]`);
    if (!el || !stride) return 0;
    let top = 0;
    for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
    return Math.floor(top / stride) + 1;
  };
}
