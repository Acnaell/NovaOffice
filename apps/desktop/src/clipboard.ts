// Área de transferência com formatação. Copiar gera três formatos: o do Nova
// (JSON, sem perdas), HTML (para Word, navegador, e-mail) e texto simples.
// Colar aceita qualquer um dos três; o HTML de fora vira parágrafos e marcas.

import { DEFAULT_ATTRS, pieces } from "./formatting";
import { blockText, caret, ordered, type Edit, type Selection } from "./model";
import type { Align, BlockStyle, BlockView, DocView, HighlightColor, Mark, ParaAttrs, TextCommand } from "./types";

export const NOVA_MIME = "application/x-nova-fragment";

/** Trecho copiado: parágrafos com estilo, atributos e marcas. */
export type Fragment = BlockView[];

export function fragmentOf(doc: DocView, sel: Selection): Fragment {
  const [from, to] = ordered(sel);
  const out: Fragment = [];
  for (let b = from.block; b <= to.block; b++) {
    const block = doc.blocks[b];
    const start = b === from.block ? from.offset : 0;
    const end = b === to.block ? to.offset : blockText(block).length;
    const spans = pieces(doc, { block: b, offset: start }, { block: b, offset: end }).map((p) => ({
      text: p.text,
      marks: p.marks,
    }));
    out.push({ style: block.style, attrs: block.attrs, spans });
  }
  return out;
}

export const fragmentText = (fragment: Fragment): string =>
  fragment.map((b) => b.spans.map((s) => s.text).join("").replace(/\u000B/g, "\n")).join("\n");

// ---------- HTML de saída ----------

export const HIGHLIGHT_CSS: Record<HighlightColor, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TAG: Record<BlockStyle, string> = {
  paragraph: "p",
  heading1: "h1",
  heading2: "h2",
  heading3: "h3",
  heading4: "h4",
  heading5: "h5",
  heading6: "h6",
  quote: "blockquote",
  code: "pre",
};

function spanHtml(text: string, marks: Mark[]): string {
  let html = escapeHtml(text).replace(/\u000B/g, "<br>");
  const css: string[] = [];
  for (const m of marks) {
    switch (m.mark) {
      case "bold":
        html = `<b>${html}</b>`;
        break;
      case "italic":
        html = `<i>${html}</i>`;
        break;
      case "underline":
        html = `<u>${html}</u>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "vertAlign":
        html = m.value === "superscript" ? `<sup>${html}</sup>` : `<sub>${html}</sub>`;
        break;
      case "fontFamily":
        css.push(`font-family:'${m.value.replace(/'/g, "")}'`);
        break;
      case "fontSize":
        css.push(`font-size:${m.halfPoints / 2}pt`);
        break;
      case "color":
        css.push(`color:${m.value}`);
        break;
      case "highlight":
        css.push(`background:${HIGHLIGHT_CSS[m.value]}`);
        break;
    }
  }
  return css.length ? `<span style="${css.join(";")}">${html}</span>` : html;
}

export function fragmentHtml(fragment: Fragment): string {
  const out: string[] = [];
  let openList: string | null = null;
  for (const block of fragment) {
    const inner = block.spans.map((s) => spanHtml(s.text, s.marks)).join("") || "<br>";
    const css: string[] = [];
    if (block.attrs.align !== "left") css.push(`text-align:${block.attrs.align}`);
    if (block.attrs.indent && !block.attrs.list) css.push(`margin-left:${block.attrs.indent * 36}pt`);
    if (block.attrs.shading) css.push(`background:${block.attrs.shading}`);
    const style = css.length ? ` style="${css.join(";")}"` : "";
    const listTag = block.attrs.list === "bullet" ? "ul" : block.attrs.list === "number" ? "ol" : null;
    if (openList && openList !== listTag) {
      out.push(`</${openList}>`);
      openList = null;
    }
    if (listTag) {
      if (!openList) {
        out.push(`<${listTag}>`);
        openList = listTag;
      }
      const level = block.attrs.indent ? ` style="margin-left:${block.attrs.indent * 36}pt"` : "";
      out.push(`<li${level}>${inner}</li>`);
    } else {
      const tag = TAG[block.style];
      out.push(`<${tag}${style}>${inner}</${tag}>`);
    }
  }
  if (openList) out.push(`</${openList}>`);
  // O fragmento do Nova vai junto num comentário: colar no Nova (por qualquer
  // caminho, inclusive o botão Colar) recupera tudo sem perdas.
  return `<meta charset="utf-8"><!--nova-fragment:${encodeURIComponent(JSON.stringify(fragment))}-->${out.join("")}`;
}

/** Fragmento do Nova embutido no HTML copiado por ele, se houver. */
export function embeddedFragment(html: string): Fragment | null {
  const m = html.match(/<!--nova-fragment:([^\s>]*?)-->/);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1])) as Fragment;
  } catch {
    return null;
  }
}

// ---------- HTML de entrada ----------

const BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR", "TABLE",
  "UL", "OL", "SECTION", "ARTICLE", "HEADER", "FOOTER", "DD", "DT",
]);

function cssColorToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return `#${h.toUpperCase()}`;
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  const named: Record<string, string> = { black: "#000000", red: "#FF0000", blue: "#0000FF", green: "#008000", white: "#FFFFFF" };
  return named[v] ?? null;
}

/** Cor de fundo mais próxima entre as do realce do Word. */
export function nearestHighlight(hex: string): HighlightColor {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best: HighlightColor = "yellow";
  let bestDist = Infinity;
  for (const [name, css] of Object.entries(HIGHLIGHT_CSS) as [HighlightColor, string][]) {
    const [r2, g2, b2] = rgb(css);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

function sizeToHalfPoints(value: string): number | null {
  const m = value.trim().match(/^([\d.]+)(pt|px)$/);
  if (!m) return null;
  const pt = m[2] === "pt" ? Number(m[1]) : Number(m[1]) * 0.75;
  return pt > 0 ? Math.round(pt * 2) : null;
}

/** Marcas que um elemento HTML acrescenta às herdadas. */
function marksFromElement(el: HTMLElement, inherited: Mark[]): Mark[] {
  const marks = new Map<string, Mark>(inherited.map((m) => [m.mark, m]));
  const set = (m: Mark) => marks.set(m.mark, m);
  switch (el.tagName) {
    case "B":
    case "STRONG":
      set({ mark: "bold" });
      break;
    case "I":
    case "EM":
      set({ mark: "italic" });
      break;
    case "U":
    case "INS":
      set({ mark: "underline" });
      break;
    case "S":
    case "STRIKE":
    case "DEL":
      set({ mark: "strike" });
      break;
    case "SUP":
      set({ mark: "vertAlign", value: "superscript" });
      break;
    case "SUB":
      set({ mark: "vertAlign", value: "subscript" });
      break;
    case "MARK":
      set({ mark: "highlight", value: "yellow" });
      break;
  }
  const s = el.style;
  const weight = s.fontWeight;
  if (weight === "bold" || Number(weight) >= 600) set({ mark: "bold" });
  else if (weight === "normal" || (weight && Number(weight) < 600)) marks.delete("bold");
  if (s.fontStyle === "italic") set({ mark: "italic" });
  else if (s.fontStyle === "normal") marks.delete("italic");
  const deco = `${s.textDecoration} ${s.textDecorationLine}`;
  if (deco.includes("underline")) set({ mark: "underline" });
  if (deco.includes("line-through")) set({ mark: "strike" });
  if (s.verticalAlign === "super") set({ mark: "vertAlign", value: "superscript" });
  if (s.verticalAlign === "sub") set({ mark: "vertAlign", value: "subscript" });
  const color = s.color && cssColorToHex(s.color);
  if (color && color !== "#000000") set({ mark: "color", value: color });
  const bg = (s.backgroundColor && cssColorToHex(s.backgroundColor)) || null;
  if (bg && bg !== "#FFFFFF") set({ mark: "highlight", value: nearestHighlight(bg) });
  const size = s.fontSize && sizeToHalfPoints(s.fontSize);
  if (size && size >= 2 && size <= 3276) set({ mark: "fontSize", halfPoints: size });
  const family = s.fontFamily?.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  if (family && !/^(inherit|initial|serif|sans-serif|monospace|system-ui)$/i.test(family)) {
    set({ mark: "fontFamily", value: family });
  }
  if (el.tagName === "FONT") {
    const c = el.getAttribute("color");
    const hex = c && cssColorToHex(c);
    if (hex) set({ mark: "color", value: hex });
    const face = el.getAttribute("face");
    if (face) set({ mark: "fontFamily", value: face.split(",")[0].trim() });
  }
  return [...marks.values()];
}

function styleOf(tag: string): BlockStyle {
  const heading = tag.match(/^H([1-6])$/);
  if (heading) return `heading${heading[1]}` as BlockStyle;
  if (tag === "BLOCKQUOTE") return "quote";
  if (tag === "PRE") return "code";
  return "paragraph";
}

/** Converte HTML colado (Word, navegador, Google Docs, e-mail) em parágrafos com marcas. */
export function parseHtml(html: string): Fragment {
  const embedded = embeddedFragment(html);
  if (embedded) return embedded;
  const dom = new DOMParser().parseFromString(html, "text/html");
  dom.querySelectorAll("script, style, meta, title, head, template, noscript").forEach((n) => n.remove());
  const out: Fragment = [];
  let current: BlockView | null = null;

  const startBlock = (style: BlockStyle, attrs: ParaAttrs) => {
    current = { style, attrs, spans: [] };
    out.push(current);
  };
  const ensureBlock = (ctx: Ctx) => {
    if (!current) startBlock(ctx.style, ctx.attrs);
    return current!;
  };

  interface Ctx {
    marks: Mark[];
    style: BlockStyle;
    attrs: ParaAttrs;
    pre: boolean;
    listLevel: number;
    listKind: "bullet" | "number" | null;
  }

  const addText = (text: string, ctx: Ctx) => {
    if (!ctx.pre) text = text.replace(/[\r\n\t ]+/g, " ");
    if (!text) return;
    // Espaço solto entre tags de bloco (indentação do HTML) não abre parágrafo.
    if (!ctx.pre && !current && text === " ") return;
    const lines = ctx.pre ? text.split("\n") : [text];
    lines.forEach((line, i) => {
      if (i > 0) startBlock(ctx.style, ctx.attrs);
      if (!line) return;
      const block = ensureBlock(ctx);
      // Espaços no começo do parágrafo vindos da indentação do HTML não contam.
      if (!ctx.pre && block.spans.length === 0) line = line.replace(/^ +/, "");
      if (!line) return;
      const last = block.spans[block.spans.length - 1];
      if (last && JSON.stringify(last.marks) === JSON.stringify(ctx.marks)) last.text += line;
      else block.spans.push({ text: line, marks: ctx.marks });
    });
  };

  const walk = (node: Node, ctx: Ctx) => {
    if (node.nodeType === Node.TEXT_NODE) {
      addText(node.textContent ?? "", ctx);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    if (tag === "BR") {
      // <br> é quebra de linha dentro do parágrafo, como Shift+Enter no Word.
      addText("\u000B", { ...ctx, pre: true });
      return;
    }
    if (tag === "IMG") return;
    const isBlock = BLOCK_TAGS.has(tag);
    let next: Ctx = { ...ctx, marks: marksFromElement(node, ctx.marks) };
    if (tag === "UL" || tag === "OL") {
      next = { ...next, listKind: tag === "UL" ? "bullet" : "number", listLevel: ctx.listKind ? ctx.listLevel + 1 : 0 };
    }
    if (isBlock && !["UL", "OL", "TABLE", "TR"].includes(tag)) {
      const align = node.style.textAlign || node.getAttribute("align") || "";
      const attrs: ParaAttrs = {
        ...DEFAULT_ATTRS,
        align: (["center", "right", "justify"].includes(align) ? align : "left") as Align,
      };
      // Recuo pela margem esquerda (36 pt por nível, como o Word grava).
      const margin = node.style.marginLeft && sizeToHalfPoints(node.style.marginLeft);
      const marginLevels = margin ? Math.round(margin / 2 / 36) : 0;
      if (tag === "LI" && next.listKind) {
        attrs.list = next.listKind;
        attrs.indent = Math.min(next.listLevel + marginLevels, 8);
      } else {
        attrs.indent = Math.min(marginLevels, 8);
      }
      const style = tag === "LI" || tag === "DIV" ? ctx.style : styleOf(tag);
      next = { ...next, style, attrs, pre: ctx.pre || tag === "PRE" };
      startBlock(next.style, next.attrs);
    } else if (tag === "TR") {
      startBlock(ctx.style, ctx.attrs);
    }
    let firstCell = true;
    for (const child of node.childNodes) {
      if (tag === "TR" && child instanceof HTMLElement && (child.tagName === "TD" || child.tagName === "TH")) {
        if (!firstCell) addText("\t", { ...next, pre: true });
        firstCell = false;
      }
      walk(child, next);
    }
    if (isBlock) current = null;
  };

  walk(dom.body, {
    marks: [],
    style: "paragraph",
    attrs: { ...DEFAULT_ATTRS },
    pre: false,
    listLevel: 0,
    listKind: null,
  });

  // Tira parágrafos vazios das pontas e espaços no fim de cada um.
  for (const b of out) {
    const last = b.spans[b.spans.length - 1];
    if (last) last.text = last.text.replace(/ +$/, "");
    b.spans = b.spans.filter((s) => s.text);
  }
  const isEmpty = (b: BlockView) => b.spans.length === 0;
  while (out.length && isEmpty(out[0])) out.shift();
  while (out.length && isEmpty(out[out.length - 1])) out.pop();
  // Vários vazios seguidos (div dentro de div) viram um só.
  return out.filter((b, i) => !(isEmpty(b) && i > 0 && isEmpty(out[i - 1])));
}

/** Texto simples como fragmento: uma linha por parágrafo, sem marcas. */
export function plainFragment(text: string, marks: Mark[] = []): Fragment {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => ({ style: "paragraph" as BlockStyle, attrs: { ...DEFAULT_ATTRS }, spans: line ? [{ text: line, marks }] : [] }));
}

/**
 * Cola um fragmento no lugar da seleção. O primeiro parágrafo colado se junta
 * ao parágrafo do cursor (mantém o estilo dele) e o último se junta ao resto
 * do texto, como no Word; os do meio entram com estilo e atributos próprios.
 */
export function insertFragment(doc: DocView, sel: Selection, fragment: Fragment): Edit {
  const [from, to] = ordered(sel);
  const commands: TextCommand[] = [];
  if (from.block === to.block && from.offset !== to.offset) {
    commands.push({ type: "text.delete", block: from.block, offset: from.offset, len: to.offset - from.offset });
  } else if (from.block !== to.block) {
    commands.push({ type: "text.deleteRange", from, to });
  }
  if (fragment.length === 0) {
    return { command: commands.length ? wrapAll(commands) : null, selection: caret(from) };
  }

  const insertSpans = (block: number, offset: number, spans: BlockView["spans"]) => {
    let at = offset;
    for (const span of spans) {
      if (!span.text) continue;
      commands.push({ type: "text.insert", block, offset: at, text: span.text, marks: span.marks });
      at += span.text.length;
    }
    return at;
  };

  if (fragment.length === 1) {
    const end = insertSpans(from.block, from.offset, fragment[0].spans);
    return { command: wrapAll(commands), selection: caret({ block: from.block, offset: end }) };
  }

  commands.push({ type: "block.split", block: from.block, offset: from.offset });
  insertSpans(from.block, from.offset, fragment[0].spans);
  // Atributos do primeiro parágrafo (lista, alinhamento) valem se ele estava vazio antes.
  if (from.offset === 0) pushAttrs(commands, from.block, doc.blocks[from.block]?.attrs, fragment[0].attrs, doc.blocks[from.block]?.style, fragment[0].style);

  for (let i = 1; i < fragment.length - 1; i++) {
    const index = from.block + i;
    const b = fragment[i];
    commands.push({ type: "block.insert", index, text: "", style: b.style });
    insertSpans(index, 0, b.spans);
    pushAttrs(commands, index, DEFAULT_ATTRS, b.attrs);
  }
  const lastIndex = from.block + fragment.length - 1;
  const last = fragment[fragment.length - 1];
  const end = insertSpans(lastIndex, 0, last.spans);
  return { command: wrapAll(commands), selection: caret({ block: lastIndex, offset: end }) };
}

function pushAttrs(
  commands: TextCommand[],
  block: number,
  current: ParaAttrs | undefined,
  wanted: ParaAttrs,
  currentStyle?: BlockStyle,
  wantedStyle?: BlockStyle,
) {
  if (currentStyle && wantedStyle && currentStyle !== wantedStyle) {
    commands.push({ type: "block.setStyle", block, style: wantedStyle });
  }
  const base = current ?? DEFAULT_ATTRS;
  for (const key of Object.keys(wanted) as (keyof ParaAttrs)[]) {
    if (JSON.stringify(base[key]) !== JSON.stringify(wanted[key])) {
      commands.push({ type: "block.setAttr", block, attr: key, value: wanted[key] } as TextCommand);
    }
  }
}

function wrapAll(commands: TextCommand[]): TextCommand | null {
  if (commands.length === 0) return null;
  return commands.length === 1 ? commands[0] : { type: "batch", commands };
}
