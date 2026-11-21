// Legendas, Índice de Ilustrações e Referência Cruzada (Referências → Legendas).
// A legenda é um parágrafo com o estilo Legenda: "Figura " + o caractere
// SEQ_CHAR com a marca `seq {label}` + " – descrição" (o travessão da ABNT). O
// número não fica gravado: é a ordem da legenda entre as do mesmo rótulo,
// calculada aqui e no núcleo. A referência cruzada é o caractere XREF_CHAR com
// a marca `xref`, que aponta para o marcador (`bookmark`) do parágrafo da
// legenda ou do título. O Índice de Ilustrações são parágrafos marcados com
// `figureIndex`, atualizados como o Sumário (toc.ts).

import { blockText, caret, ordered, type Edit, type Selection } from "./model";
import { headingLevel } from "./toc";
import { SEQ_CHAR, XREF_CHAR, type BlockView, type DocView, type FigureEntry, type Mark, type RefShow, type TextCommand } from "./types";

/** Rótulos do Nova (como Figura e Tabela no Word); o usuário pode criar outros. */
export const CAPTION_LABELS = ["Figura", "Tabela", "Quadro", "Gráfico", "Equação"];

/** Separador entre o número e a descrição, como pede a ABNT (NBR 14724). */
export const CAPTION_SEPARATOR = " – ";

/** Mesmo aviso do Word (e do núcleo) para uma referência cujo alvo sumiu. */
export const MISSING_REF = "Erro! Fonte de referência não encontrada.";

/** Rótulo válido (igual ao núcleo): de 1 a 32 letras, dígitos, espaços ou hífens. */
export function isCaptionLabel(label: string): boolean {
  return label.length > 0 && [...label].length <= 32 && label.trim() === label && /^[\p{L}\p{N} -]+$/u.test(label);
}

export function seqOf(marks: Mark[]): string | null {
  for (const m of marks) if (m.mark === "seq") return m.label;
  return null;
}

export function xrefOf(marks: Mark[]): { target: string; show: RefShow; page?: number } | null {
  for (const m of marks) if (m.mark === "xref") return { target: m.target, show: m.show, page: m.page };
  return null;
}

/** Rótulo da legenda do parágrafo (o do primeiro número), ou null se não for legenda. */
export function captionLabel(block: BlockView): string | null {
  for (const s of block.spans) {
    const label = seqOf(s.marks);
    if (label && s.text.includes(SEQ_CHAR)) return label;
  }
  return null;
}

export interface CaptionFields {
  /** Número de cada SEQ_CHAR, na ordem do documento. */
  numbers: number[];
  /** Primeiro número de cada parágrafo (índice em `numbers`). */
  firstOf: Map<number, number>;
  /** Alvo de cada marcador: o texto da referência ("Figura 3" ou o título) e o parágrafo. */
  targets: Map<string, { text: string; block: number }>;
}

const isFieldChar = (c: string) => c >= "" && c <= "";

/** Números das legendas e textos dos alvos (a mesma regra do núcleo, CaptionFields). */
export function captionFields(blocks: BlockView[]): CaptionFields {
  const counters = new Map<string, number>();
  const out: CaptionFields = { numbers: [], firstOf: new Map(), targets: new Map() };
  blocks.forEach((b, index) => {
    const first = out.numbers.length;
    out.firstOf.set(index, first);
    for (const s of b.spans) {
      const label = seqOf(s.marks);
      for (const c of s.text) {
        if (c !== SEQ_CHAR) continue;
        const n = label ? (counters.get(label) ?? 0) + 1 : 0;
        if (label) counters.set(label, n);
        out.numbers.push(n);
      }
    }
    const id = b.attrs.bookmark;
    if (!id || out.targets.has(id)) return;
    // Legenda: o texto até o número ("Figura 3"); título: o texto inteiro.
    let text = "";
    let k = first;
    for (const c of blockText(b)) {
      if (c === SEQ_CHAR) {
        text += String(out.numbers[k++] ?? 0);
        break;
      }
      if (c === "\u000b" || c === "\t") text += " ";
      else if (!isFieldChar(c)) text += c;
    }
    out.targets.set(id, { text: text.trim(), block: index });
  });
  return out;
}

/** Texto de uma referência cruzada; a página vem da tela (`pageOf`) ou da gravada. */
export function xrefText(fields: CaptionFields, ref: { target: string; show: RefShow; page?: number }, pageOf?: (block: number) => number): string {
  const target = fields.targets.get(ref.target);
  if (!target) return MISSING_REF;
  if (ref.show === "label") return target.text;
  const page = pageOf?.(target.block) || ref.page;
  return page ? String(page) : "?";
}

/** Texto de uma legenda com os números no lugar dos caracteres: "Figura 2 – Mapa". */
export function captionText(blocks: BlockView[], fields: CaptionFields, block: number): string {
  let k = fields.firstOf.get(block) ?? 0;
  let text = "";
  for (const c of blockText(blocks[block])) {
    if (c === SEQ_CHAR) text += String(fields.numbers[k++] ?? 0);
    else if (c === "\u000b" || c === "\t") text += " ";
    else if (!isFieldChar(c)) text += c;
  }
  return text.trim();
}

/** Rótulos usados nas legendas do documento, na ordem em que aparecem. */
export function documentLabels(blocks: BlockView[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const label = captionLabel(b);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Próximo número de um rótulo depois do parágrafo `block` (para a prévia da caixa). */
export function nextNumber(blocks: BlockView[], label: string, before: number): number {
  let n = 1;
  for (let i = 0; i < before && i < blocks.length; i++) for (const s of blocks[i].spans) if (seqOf(s.marks) === label) n += [...s.text].filter((c) => c === SEQ_CHAR).length;
  return n;
}

export function newBookmarkId(): string {
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// ---------------------------------------------------------------- Inserir Legenda

export type CaptionPosition = "above" | "below";

/** Parágrafos do item onde está o cursor: a tabela inteira ou o parágrafo. */
function itemRange(doc: DocView, block: number): [number, number] {
  const table = doc.blocks[block]?.attrs.cell?.table;
  if (!table) return [block, block + 1];
  let start = block;
  while (start > 0 && doc.blocks[start - 1].attrs.cell?.table === table) start--;
  let end = block;
  while (end < doc.blocks.length && doc.blocks[end].attrs.cell?.table === table) end++;
  return [start, end];
}

/**
 * Insere uma legenda acima ou abaixo do item do cursor (a imagem, a tabela ou o
 * parágrafo): "Figura " + número + " – " + descrição, no estilo Legenda. O
 * cursor vai para o fim da legenda, para continuar a descrição.
 */
export function insertCaption(doc: DocView, sel: Selection, label: string, position: CaptionPosition, description: string): Edit {
  const [start, end] = itemRange(doc, ordered(sel)[0].block);
  const index = position === "above" ? start : end;
  const prefix = `${label} `;
  const rest = description.trim() ? `${CAPTION_SEPARATOR}${description.trim()}` : "";
  const commands: TextCommand[] = [
    { type: "block.insert", index, text: prefix, style: "caption" },
    { type: "text.insert", block: index, offset: prefix.length, text: SEQ_CHAR, marks: [{ mark: "seq", label }] },
  ];
  if (rest) commands.push({ type: "text.insert", block: index, offset: prefix.length + 1, text: rest, marks: [] });
  return { command: { type: "batch", commands }, selection: caret({ block: index, offset: prefix.length + 1 + rest.length }) };
}

// ---------------------------------------------------------------- Índice de Ilustrações

/** Índices de ilustrações do documento: [start, end) e o rótulo (título opcional + entradas). */
export function findFigureIndexes(blocks: BlockView[]): { start: number; end: number; label: string; hasTitle: boolean }[] {
  const out: { start: number; end: number; label: string; hasTitle: boolean }[] = [];
  let i = 0;
  while (i < blocks.length) {
    const e = blocks[i].attrs.figureIndex;
    if (!e) {
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < blocks.length) {
      const n = blocks[i].attrs.figureIndex;
      if (!n || n.title || n.label !== e.label) break;
      i++;
    }
    out.push({ start, end: i, label: e.label, hasTitle: e.title });
  }
  return out;
}

export interface FigureIndexLabels {
  /** Título do índice de um rótulo ("LISTA DE FIGURAS"). */
  title: (label: string) => string;
  /** Texto da entrada quando não há legendas do rótulo. */
  empty: string;
}

function entryCommands(blocks: BlockView[], label: string, index: number, pageOf: (block: number) => number, empty: string): TextCommand[] {
  const fields = captionFields(blocks);
  const items = blocks.map((b, i) => (captionLabel(b) === label && !b.attrs.figureIndex ? i : -1)).filter((i) => i >= 0);
  const entry = (k: number, text: string, page: number): TextCommand[] => [
    { type: "block.insert", index: index + k, text, style: "paragraph" },
    { type: "block.setAttr", block: index + k, attr: "figureIndex", value: { label, title: false, page: Math.max(0, Math.min(65535, page)) } },
  ];
  if (!items.length) return entry(0, empty, 0);
  return items.flatMap((b, k) => entry(k, captionText(blocks, fields, b), pageOf(b)));
}

/** Insere o Índice de Ilustrações de um rótulo no cursor; se já existe um, atualiza os índices. */
export function insertFigureIndex(doc: DocView, sel: Selection, label: string, pageOf: (block: number) => number, labels: FigureIndexLabels): Edit {
  if (findFigureIndexes(doc.blocks).some((r) => r.label === label)) return updateFigureIndexes(doc, sel, pageOf, labels) ?? { command: null, selection: sel };
  const at = sel.focus.block;
  const [, cellEnd] = itemRange(doc, at);
  const index = doc.blocks[at]?.attrs.cell ? cellEnd : sel.focus.offset === 0 ? at : at + 1;
  const title: FigureEntry = { label, title: true, page: 0 };
  const commands: TextCommand[] = [
    { type: "block.insert", index, text: labels.title(label), style: "paragraph" },
    { type: "block.setAttr", block: index, attr: "figureIndex", value: title },
    ...entryCommands(doc.blocks, label, index + 1, pageOf, labels.empty),
  ];
  const inserted = commands.filter((c) => c.type === "block.insert").length;
  if (index >= doc.blocks.length) commands.push({ type: "block.insert", index: index + inserted, text: "" });
  return { command: { type: "batch", commands }, selection: caret({ block: index + inserted, offset: 0 }) };
}

/** Atualiza todos os índices de ilustrações (como Atualizar Tabela no Word): entradas e páginas. */
export function updateFigureIndexes(doc: DocView, sel: Selection, pageOf: (block: number) => number, labels: FigureIndexLabels): Edit | null {
  const ranges = findFigureIndexes(doc.blocks);
  if (!ranges.length) return null;
  const commands: TextCommand[] = [];
  let shift = 0;
  // De baixo para cima: os índices de cima continuam valendo; o texto e as páginas são os de antes.
  for (const r of [...ranges].reverse()) {
    const first = r.hasTitle ? r.start + 1 : r.start;
    for (let b = r.end - 1; b >= first; b--) commands.push({ type: "block.remove", block: b });
    const entries = entryCommands(doc.blocks, r.label, first, pageOf, labels.empty);
    commands.push(...entries);
    const added = entries.filter((c) => c.type === "block.insert").length;
    if (sel.focus.block >= r.end) shift += added - (r.end - first);
  }
  const inside = ranges.find((r) => sel.focus.block >= r.start && sel.focus.block < r.end);
  const selection = inside
    ? caret({ block: inside.start, offset: 0 })
    : { anchor: { ...sel.anchor, block: sel.anchor.block + shift }, focus: { ...sel.focus, block: sel.focus.block + shift } };
  return { command: { type: "batch", commands }, selection };
}

/** Para cada entrada do índice, a legenda a que ela se refere (pelo texto, como o Sumário). */
export function figureTargets(blocks: BlockView[]): Map<number, number> {
  const fields = captionFields(blocks);
  const captions = new Map<string, number[]>();
  blocks.forEach((b, i) => {
    const label = captionLabel(b);
    if (!label || b.attrs.figureIndex) return;
    const list = captions.get(label) ?? [];
    list.push(i);
    captions.set(label, list);
  });
  const out = new Map<number, number>();
  const from = new Map<string, number>();
  blocks.forEach((b, i) => {
    const e = b.attrs.figureIndex;
    if (!e || e.title) return;
    const list = captions.get(e.label) ?? [];
    const text = blockText(b).trim();
    let k = from.get(e.label) ?? 0;
    while (k < list.length && captionText(blocks, fields, list[k]) !== text) k++;
    if (k < list.length) {
      out.set(i, list[k]);
      from.set(e.label, k + 1);
    }
  });
  return out;
}

// ---------------------------------------------------------------- Referência Cruzada

/** Tipo de alvo de uma referência: um rótulo de legenda ou "heading" (os títulos). */
export type RefKind = string;
export const HEADING_KIND = "heading";

export interface RefItem {
  block: number;
  text: string;
}

/** Itens que podem ser referenciados: as legendas de um rótulo ou os títulos. */
export function refItems(blocks: BlockView[], kind: RefKind): RefItem[] {
  const fields = captionFields(blocks);
  const out: RefItem[] = [];
  blocks.forEach((b, block) => {
    if (b.attrs.toc || b.attrs.figureIndex) return;
    if (kind === HEADING_KIND) {
      const text = blockText(b).replace(/[\u000b\n\t]+/g, " ").trim();
      if (headingLevel(b) !== null && text) out.push({ block, text });
    } else if (captionLabel(b) === kind) out.push({ block, text: captionText(blocks, fields, block) });
  });
  return out;
}

/**
 * Insere uma referência cruzada no cursor ("Figura 3" ou a página). O alvo
 * ganha um marcador se ainda não tem; a página da tela fica guardada para os
 * arquivos (a tela sempre mostra a atual).
 */
export function insertCrossRef(doc: DocView, sel: Selection, target: number, show: RefShow, page: number, newId: () => string): Edit {
  const [from] = ordered(sel);
  const commands: TextCommand[] = [];
  let id = doc.blocks[target]?.attrs.bookmark ?? null;
  if (!id) {
    id = newId();
    commands.push({ type: "block.setAttr", block: target, attr: "bookmark", value: id });
  }
  const mark: Mark = show === "page" && page > 0 ? { mark: "xref", target: id, show, page: Math.min(65535, page) } : { mark: "xref", target: id, show };
  commands.push({ type: "text.insert", block: from.block, offset: from.offset, text: XREF_CHAR, marks: [mark] });
  return { command: { type: "batch", commands }, selection: caret({ block: from.block, offset: from.offset + 1 }) };
}

// ---------------------------------------------------------------- Na tela

/** Classe do trecho: número de legenda ou referência cruzada. */
export function fieldClass(marks: Mark[]): string {
  return seqOf(marks) ? "seq-ref" : xrefOf(marks) ? "xref-ref" : "";
}

/** Atributos do trecho de uma referência cruzada: alvo, o que mostra e a página gravada. */
export function fieldAttrs(marks: Mark[]): Record<string, string | undefined> | undefined {
  const ref = xrefOf(marks);
  if (!ref) return undefined;
  return { "data-xref": ref.target, "data-show": ref.show, "data-page": ref.page ? String(ref.page) : undefined };
}

/** Classes do parágrafo do índice de ilustrações: título ou entrada. */
export function figureIndexClass(block: BlockView): string {
  const e = block.attrs.figureIndex;
  if (!e) return "";
  return e.title ? " fig-title" : " fig-entry";
}

/** Põe o texto gerado no trecho (o caractere some e o texto aparece), no tamanho da letra em volta. */
function show(el: HTMLElement, text: string) {
  if (el.dataset.text !== text) el.dataset.text = text;
  const size = el.style.fontSize || (el.parentElement ? getComputedStyle(el.parentElement).fontSize : "");
  if (size && el.style.getPropertyValue("--field-size") !== size) el.style.setProperty("--field-size", size);
}

/**
 * Números das legendas e textos das referências, antes de paginar (ocupam
 * espaço na linha). Com `pageOf`, depois de paginar: as referências de página
 * e as páginas das entradas do índice.
 */
export function paintCaptionFields(root: HTMLElement, blocks: BlockView[], pageOf?: (block: number) => number) {
  const seqs = root.querySelectorAll<HTMLElement>(".seq-ref");
  const xrefs = root.querySelectorAll<HTMLElement>(".xref-ref");
  const entries = root.querySelectorAll<HTMLElement>(".fig-entry");
  if (!seqs.length && !xrefs.length && !entries.length) return;
  const fields = captionFields(blocks);
  if (!pageOf) {
    let k = 0;
    seqs.forEach((el) => {
      const n = [...(el.textContent ?? "")].filter((c) => c === SEQ_CHAR).length || 1;
      show(el, fields.numbers.slice(k, k + n).join(""));
      k += n;
    });
  }
  xrefs.forEach((el) => {
    const ref = { target: el.dataset.xref ?? "", show: (el.dataset.show as RefShow) ?? "label", page: Number(el.dataset.page) || undefined };
    if (ref.show === "page" && !pageOf) return;
    show(el, xrefText(fields, ref, pageOf));
  });
  if (pageOf) {
    const targets = figureTargets(blocks);
    entries.forEach((el) => {
      const target = targets.get(Number(el.dataset.block));
      const page = target === undefined ? "" : String(pageOf(target));
      if (el.dataset.page !== page) el.dataset.page = page;
    });
  }
}

/** Ctrl+clique numa referência cruzada ou numa entrada do índice: o parágrafo do alvo. */
export function captionLinkTarget(el: HTMLElement | null, blocks: BlockView[]): number | undefined {
  const ref = el?.closest<HTMLElement>(".xref-ref");
  if (ref) return captionFields(blocks).targets.get(ref.dataset.xref ?? "")?.block;
  const entry = el?.closest<HTMLElement>(".fig-entry");
  return entry ? figureTargets(blocks).get(Number(entry.dataset.block)) : undefined;
}
