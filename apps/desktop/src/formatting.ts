// Comandos de formatação da Página Inicial, sem DOM: fonte, tamanho, cor,
// realce, sobrescrito/subscrito, maiúsculas, limpar formatação e parágrafo
// (alinhamento, recuo, entrelinhas, listas). Testados em formatting.test.ts.

import { blockText, isCollapsed, marksAt, ordered, segments, splitBlock, type Edit, type Selection } from "./model";
import type {
  BlockStyle,
  BlockView,
  DocView,
  ListKind,
  Mark,
  MarkKind,
  ParaAttr,
  ParaAttrs,
  Pos,
  TextCommand,
} from "./types";
import { MAX_INDENT } from "./types";

export const DEFAULT_ATTRS: ParaAttrs = {
  align: "left",
  indent: 0,
  lineSpacing: null,
  spaceBefore: null,
  spaceAfter: null,
  list: null,
  shading: null,
  pageBreakBefore: false,
  cell: null,
};

/** Fundo escuro o bastante para o texto automático ficar branco, como no Word. */
export function isDark(hex: string): boolean {
  const c = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return 0.299 * c(1) + 0.587 * c(3) + 0.114 * c(5) < 0.5;
}

/** Fonte do corpo do texto quando nenhuma marca `fontFamily` foi aplicada. */
export const DEFAULT_FONT = "Calibri";

/** Tamanho padrão (em pontos) de cada estilo, o mesmo do styles.css. */
export const STYLE_FONT_SIZE: Record<BlockStyle, number> = {
  paragraph: 11,
  heading1: 20,
  heading2: 16,
  heading3: 14,
  heading4: 12,
  heading5: 12,
  heading6: 12,
  quote: 11,
  code: 10,
};

/** Tamanhos da lista do Word; A+ e A- pulam entre eles. */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const wrap = (commands: TextCommand[]): TextCommand | null =>
  commands.length === 0 ? null : commands.length === 1 ? commands[0] : { type: "batch", commands };

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_'’-]/u.test(ch);

/** Palavra que contém a posição (só se o cursor estiver dentro dela, não na borda). */
export function wordAround(text: string, offset: number): [number, number] | null {
  if (!isWordChar(text[offset - 1]) || !isWordChar(text[offset])) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return [start, end];
}

/**
 * Onde um comando de fonte age: a seleção; ou, com o cursor parado dentro de
 * uma palavra, a palavra inteira (como no Word). `null` se o cursor está fora
 * de palavras: aí a formatação vale para o próximo texto digitado.
 */
export function formatTarget(doc: DocView, sel: Selection): Selection | null {
  if (!isCollapsed(sel)) return sel;
  const { block, offset } = sel.focus;
  const word = wordAround(blockText(doc.blocks[block]), offset);
  return word ? { anchor: { block, offset: word[0] }, focus: { block, offset: word[1] } } : null;
}

interface Piece {
  block: number;
  start: number;
  end: number;
  marks: Mark[];
  text: string;
}

/** Pedaços da seleção, cortados nas fronteiras dos trechos de formatação. */
export function pieces(doc: DocView, from: Pos, to: Pos): Piece[] {
  const out: Piece[] = [];
  for (const seg of segments(doc, from, to)) {
    let pos = 0;
    for (const span of doc.blocks[seg.block].spans) {
      const spanStart = pos;
      const spanEnd = pos + span.text.length;
      pos = spanEnd;
      const start = Math.max(spanStart, seg.start);
      const end = Math.min(spanEnd, seg.end);
      if (end > start) {
        out.push({
          block: seg.block,
          start,
          end,
          marks: span.marks,
          text: span.text.slice(start - spanStart, end - spanStart),
        });
      }
    }
  }
  return out;
}

/** Aplica uma marca com valor (fonte, tamanho, cor, realce…) em toda a seleção. */
export function setMark(doc: DocView, sel: Selection, mark: Mark): TextCommand | null {
  const [from, to] = ordered(sel);
  return wrap(
    segments(doc, from, to).map(({ block, start, end }) => ({
      type: "text.applyMark" as const,
      block,
      offset: start,
      len: end - start,
      mark,
    })),
  );
}

/** Remove marcas de um tipo (ou todas, com `"all"`) da seleção. */
export function removeMarks(doc: DocView, sel: Selection, kinds: MarkKind[] | "all"): TextCommand | null {
  const [from, to] = ordered(sel);
  const commands: TextCommand[] = [];
  for (const piece of pieces(doc, from, to)) {
    for (const m of piece.marks) {
      if (kinds !== "all" && !kinds.includes(m.mark)) continue;
      commands.push({
        type: "text.removeMark",
        block: piece.block,
        offset: piece.start,
        len: piece.end - piece.start,
        kind: m.mark,
      });
    }
  }
  return wrap(commands);
}

/** Valor de uma marca no trecho, se for o mesmo em toda a seleção; `undefined` se misturado. */
export function commonMark<K extends MarkKind>(
  doc: DocView,
  sel: Selection,
  kind: K,
  atCaret: Mark[],
): Extract<Mark, { mark: K }> | null | undefined {
  const find = (marks: Mark[]) =>
    (marks.find((m) => m.mark === kind) as Extract<Mark, { mark: K }> | undefined) ?? null;
  if (isCollapsed(sel)) return find(atCaret);
  const [from, to] = ordered(sel);
  const values = pieces(doc, from, to).map((p) => find(p.marks));
  if (values.length === 0) return find(atCaret);
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? values[0] : undefined;
}

/** Tamanho efetivo em pontos de um trecho: a marca, ou o padrão do estilo. */
export function effectiveSize(marks: Mark[], style: BlockStyle): number {
  const size = marks.find((m) => m.mark === "fontSize");
  return size && size.mark === "fontSize" ? size.halfPoints / 2 : STYLE_FONT_SIZE[style];
}

/** Próximo tamanho da lista do Word (A+ / A-); fora da lista, anda 1 pt. */
export function stepSize(size: number, direction: 1 | -1): number {
  if (direction > 0) return FONT_SIZES.find((s) => s > size) ?? Math.min(size + 1, 1638);
  return [...FONT_SIZES].reverse().find((s) => s < size) ?? Math.max(size - 1, 1);
}

const halfPoints = (pt: number) => Math.round(pt * 2);

/** A+ / A-: cada trecho anda um passo a partir do próprio tamanho. */
export function growFont(doc: DocView, sel: Selection, direction: 1 | -1): TextCommand | null {
  const [from, to] = ordered(sel);
  return wrap(
    pieces(doc, from, to).map((p) => ({
      type: "text.applyMark" as const,
      block: p.block,
      offset: p.start,
      len: p.end - p.start,
      mark: {
        mark: "fontSize" as const,
        halfPoints: halfPoints(stepSize(effectiveSize(p.marks, doc.blocks[p.block].style), direction)),
      },
    })),
  );
}

export type CaseMode = "sentence" | "lower" | "upper" | "title" | "toggle";

function changeText(text: string, mode: CaseMode, sentenceStart: boolean, locale: string): string {
  switch (mode) {
    case "lower":
      return text.toLocaleLowerCase(locale);
    case "upper":
      return text.toLocaleUpperCase(locale);
    case "toggle":
      return [...text]
        .map((c) => (c === c.toLocaleUpperCase(locale) ? c.toLocaleLowerCase(locale) : c.toLocaleUpperCase(locale)))
        .join("");
    case "title":
      return text
        .toLocaleLowerCase(locale)
        .replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase(locale));
    case "sentence": {
      let atStart = sentenceStart;
      return [...text.toLocaleLowerCase(locale)]
        .map((c) => {
          if (atStart && /\p{L}/u.test(c)) {
            atStart = false;
            return c.toLocaleUpperCase(locale);
          }
          if (/[.!?]/.test(c)) atStart = true;
          return c;
        })
        .join("");
    }
  }
}

/** Shift+F3 percorre minúsculas → MAIÚSCULAS → Primeira Letra Maiúscula, como no Word. */
export function nextCaseMode(text: string, locale: string): CaseMode {
  if (text === text.toLocaleLowerCase(locale)) return "upper";
  if (text === text.toLocaleUpperCase(locale)) return "title";
  return "lower";
}

/**
 * Troca maiúsculas/minúsculas mantendo a formatação de cada trecho. Devolve
 * os comandos e a nova seleção (o comprimento pode mudar: "ß" vira "SS").
 */
export function changeCase(
  doc: DocView,
  sel: Selection,
  mode: CaseMode,
  locale = "pt-BR",
): { command: TextCommand | null; selection: Selection } {
  const [from, to] = ordered(sel);
  const commands: TextCommand[] = [];
  // De trás para frente, para os offsets dos pedaços anteriores não mudarem.
  const list = pieces(doc, from, to);
  let toOffsetShift = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    const before = blockText(doc.blocks[p.block]).slice(0, p.start);
    const sentenceStart = /(^|[.!?])\s*$/.test(before);
    const changed = changeText(p.text, mode, sentenceStart, locale);
    if (changed === p.text) continue;
    commands.push({ type: "text.insert", block: p.block, offset: p.end, text: changed, marks: p.marks });
    commands.push({ type: "text.delete", block: p.block, offset: p.start, len: p.end - p.start });
    if (p.block === to.block) toOffsetShift += changed.length - p.text.length;
  }
  const end = { block: to.block, offset: to.offset + toOffsetShift };
  return { command: wrap(commands), selection: { anchor: from, focus: end } };
}

// ---------- Parágrafo ----------

/** Índices dos parágrafos tocados pela seleção. */
export function selectedBlocks(sel: Selection): number[] {
  const [from, to] = ordered(sel);
  const out: number[] = [];
  for (let b = from.block; b <= to.block; b++) out.push(b);
  return out;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Aplica o atributo em cada parágrafo da seleção que ainda não o tem. */
export function setParaAttr(doc: DocView, sel: Selection, change: ParaAttr): TextCommand | null {
  return wrap(
    selectedBlocks(sel)
      .filter((b) => !sameValue(doc.blocks[b].attrs[change.attr], change.value))
      .map((block) => ({ type: "block.setAttr", block, ...change }) as TextCommand),
  );
}

/** Valor comum do atributo nos parágrafos da seleção, ou `undefined` se misturado. */
export function commonAttr<K extends keyof ParaAttrs>(doc: DocView, sel: Selection, key: K): ParaAttrs[K] | undefined {
  const values = selectedBlocks(sel).map((b) => doc.blocks[b].attrs[key]);
  return values.every((v) => sameValue(v, values[0])) ? values[0] : undefined;
}

/** Marcadores/numeração: liga em todos, ou desliga se todos já são desse tipo. */
export function toggleList(doc: DocView, sel: Selection, kind: ListKind): TextCommand | null {
  const all = selectedBlocks(sel).every((b) => doc.blocks[b].attrs.list === kind);
  return setParaAttr(doc, sel, { attr: "list", value: all ? null : kind });
}

/** Aumentar/diminuir recuo (Ctrl+M / Ctrl+Shift+M). */
export function changeIndent(doc: DocView, sel: Selection, delta: 1 | -1): TextCommand | null {
  return wrap(
    selectedBlocks(sel).flatMap((block) => {
      const current = doc.blocks[block].attrs.indent;
      const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
      return next === current ? [] : [{ type: "block.setAttr" as const, block, attr: "indent" as const, value: next }];
    }),
  );
}

/**
 * AutoFormatação ao digitar: "- " ou "* " no início vira lista com marcadores;
 * "1. " ou "1) ", lista numerada. Devolve o comando que troca o prefixo pela lista.
 */
export function autoList(doc: DocView, sel: Selection, typed: string): TextCommand | null {
  if (typed !== " " || !isCollapsed(sel)) return null;
  const { block, offset } = sel.focus;
  const b = doc.blocks[block];
  if (b.attrs.list || b.style !== "paragraph") return null;
  const prefix = blockText(b).slice(0, offset);
  if (offset !== prefix.length) return null;
  const kind: ListKind | null = /^[-*•]$/.test(prefix) ? "bullet" : /^1[.)]$/.test(prefix) ? "number" : null;
  if (!kind) return null;
  return {
    type: "batch",
    commands: [
      { type: "text.delete", block, offset: 0, len: prefix.length },
      { type: "block.setAttr", block, attr: "list", value: kind },
    ],
  };
}

const BULLETS = ["•", "◦", "▪"];

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [value, letters] of table) {
    while (n >= value) {
      out += letters;
      n -= value;
    }
  }
  return out;
}

function toLetters(n: number): string {
  let out = "";
  while (n > 0) {
    n--;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/**
 * Marcador de cada parágrafo de lista (`null` fora de listas). Numeração do
 * Word por nível: 1. → a. → i. → 1. … ; marcadores • → ◦ → ▪ … Uma lista
 * recomeça quando aparece um parágrafo fora de lista.
 */
export function listMarkers(blocks: BlockView[]): (string | null)[] {
  let counters = new Array<number>(MAX_INDENT + 1).fill(0);
  return blocks.map(({ attrs }) => {
    if (!attrs.list) {
      counters = counters.fill(0);
      return null;
    }
    const level = Math.min(attrs.indent, MAX_INDENT);
    for (let l = level + 1; l <= MAX_INDENT; l++) counters[l] = 0;
    if (attrs.list === "bullet") return BULLETS[level % BULLETS.length];
    counters[level] += 1;
    const n = counters[level];
    const formatted = [String(n), toLetters(n), toRoman(n)][level % 3];
    return `${formatted}.`;
  });
}

// ---------- Inserir ----------

/** Esquemas aceitos em links (os mesmos do núcleo). */
const LINK_SCHEMES = ["http://", "https://", "mailto:", "tel:", "ftp://", "file://"];

/**
 * Endereço digitado pela pessoa → link aceito, como o Word faz:
 * "exemplo.com" → "https://exemplo.com", "fulano@x.com" → "mailto:fulano@x.com".
 */
export function normalizeHref(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;
  const lower = raw.toLowerCase();
  if (LINK_SCHEMES.some((s) => lower.startsWith(s))) return raw;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(raw)) return `mailto:${raw}`;
  if (/^(www\.)?[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?([/?#].*)?$/u.test(raw)) return `https://${raw}`;
  return null;
}

/** O link do trecho, se houver. */
export const linkOf = (marks: Mark[]): string | null => {
  const m = marks.find((x) => x.mark === "link");
  return m && m.mark === "link" ? m.href : null;
};

/** Trecho contínuo com o mesmo link em volta da posição (para editar ou remover o link). */
export function linkRangeAt(doc: DocView, pos: { block: number; offset: number }): { from: number; to: number; href: string } | null {
  const block = doc.blocks[pos.block];
  if (!block) return null;
  let start = 0;
  const ranges: { from: number; to: number; href: string | null }[] = [];
  for (const span of block.spans) {
    ranges.push({ from: start, to: start + span.text.length, href: linkOf(span.marks) });
    start += span.text.length;
  }
  const i = ranges.findIndex((r) => r.href && pos.offset >= r.from && pos.offset <= r.to && (pos.offset < r.to || r.to > r.from));
  if (i < 0) return null;
  const href = ranges[i].href!;
  let from = ranges[i].from;
  let to = ranges[i].to;
  for (let j = i - 1; j >= 0 && ranges[j].href === href; j--) from = ranges[j].from;
  for (let j = i + 1; j < ranges.length && ranges[j].href === href; j++) to = ranges[j].to;
  return { from, to, href };
}

/**
 * AutoFormatação ao digitar espaço ou Enter: um endereço da Web ou e-mail
 * logo antes do cursor vira link, como no Word.
 */
export function autoLink(doc: DocView, sel: Selection): TextCommand | null {
  if (!isCollapsed(sel)) return null;
  const { block, offset } = sel.focus;
  const text = blockText(doc.blocks[block]).slice(0, offset);
  const match = /(?:^|[\s(])((?:https?:\/\/|www\.)[^\s]+|[^\s@()]+@[^\s@()]+\.[a-z]{2,})$/i.exec(text);
  if (!match) return null;
  const word = match[1].replace(/[.,;:!?)]+$/, "");
  const href = normalizeHref(word);
  const from = text.length - match[1].length;
  if (!href || linkOf(marksAt(doc, { block, offset: from + 1 }))) return null;
  return { type: "text.applyMark", block, offset: from, len: word.length, mark: { mark: "link", href } };
}

/** Ctrl+Enter: divide o parágrafo e o novo começa na página seguinte. */
export function insertPageBreak(doc: DocView, sel: Selection): Edit {
  const split = splitBlock(doc, sel);
  const at = split.selection.focus.block;
  const commands = [split.command, { type: "block.setAttr", block: at, attr: "pageBreakBefore", value: true } as TextCommand].filter(
    (c): c is TextCommand => !!c,
  );
  return { command: { type: "batch", commands: commands.flatMap((c) => (c.type === "batch" ? c.commands : [c])) }, selection: split.selection };
}

/** Datas e horas do Inserir → Data e Hora, nos formatos do Word para o idioma. */
export function dateTimeFormats(now: Date, locale: string): string[] {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, o).format(now);
  const list = [
    f({ day: "2-digit", month: "2-digit", year: "numeric" }),
    f({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    f({ day: "numeric", month: "long", year: "numeric" }),
    f({ day: "2-digit", month: "2-digit", year: "2-digit" }),
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    f({ month: "long", year: "numeric" }),
    f({ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    f({ hour: "2-digit", minute: "2-digit" }),
    f({ hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  ];
  return [...new Set(list)];
}
