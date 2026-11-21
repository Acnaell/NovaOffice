import { describe, expect, it } from "vitest";
import {
  captionFields,
  captionLabel,
  captionLinkTarget,
  findFigureIndexes,
  figureTargets,
  insertCaption,
  insertCrossRef,
  insertFigureIndex,
  isCaptionLabel,
  MISSING_REF,
  nextNumber,
  refItems,
  updateFigureIndexes,
  xrefText,
  HEADING_KIND,
} from "./captions";
import { DEFAULT_ATTRS } from "./formatting";
import { caret, type Selection } from "./model";
import type { BlockStyle, BlockView, DocView, FigureEntry, Mark, Span, TextCommand } from "./types";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, SEQ_CHAR, XREF_CHAR } from "./types";

const doc = (...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, footnotes: {}, comments: {} });
const block = (spans: Span[], style: BlockStyle = "paragraph", extra: Partial<BlockView["attrs"]> = {}): BlockView => ({ style, attrs: { ...DEFAULT_ATTRS, ...extra }, spans });
const p = (text: string, style: BlockStyle = "paragraph", extra: Partial<BlockView["attrs"]> = {}) => block(text ? [{ text, marks: [] }] : [], style, extra);
const caption = (label: string, desc: string, bookmark: string | null = null) =>
  block(
    [
      { text: `${label} `, marks: [] },
      { text: SEQ_CHAR, marks: [{ mark: "seq", label }] },
      { text: ` – ${desc}`, marks: [] },
    ],
    "caption",
    { bookmark },
  );
const at = (block: number, offset = 0): Selection => caret({ block, offset });
const labels = { title: (l: string) => `LISTA DE ${l.toUpperCase()}S`, empty: "Nenhuma entrada." };

/** Aplica os comandos como o núcleo faria. */
function apply(d: DocView, command: TextCommand | null): DocView {
  const blocks = d.blocks.map((b) => ({ ...b, attrs: { ...b.attrs }, spans: b.spans.map((s) => ({ ...s })) }));
  const run = (c: TextCommand) => {
    switch (c.type) {
      case "batch":
        return c.commands.forEach(run);
      case "block.insert":
        return blocks.splice(c.index, 0, p(c.text, c.style ?? "paragraph"));
      case "block.remove":
        return blocks.splice(c.block, 1);
      case "block.setAttr":
        return void ((blocks[c.block].attrs as unknown as Record<string, unknown>)[c.attr] = c.value);
      case "text.insert": {
        // Simplificado: o texto entra como trecho próprio no fim ou no começo do parágrafo.
        const b = blocks[c.block];
        const len = b.spans.reduce((n, s) => n + s.text.length, 0);
        const span = { text: c.text, marks: (c.marks ?? []) as Mark[] };
        if (c.offset === len) b.spans.push(span);
        else if (c.offset === 0) b.spans.unshift(span);
        else throw new Error("text.insert no meio não simulado");
        return;
      }
      default:
        throw new Error(`comando não simulado: ${c.type}`);
    }
  };
  if (command) run(command);
  return { ...d, blocks };
}

const text = (b: BlockView) => b.spans.map((s) => s.text).join("");
const entry = (e: FigureEntry | null | undefined) => (e ? (e.title ? `[${e.label}] ` : `[${e.label}:${e.page}] `) : "");
const summary = (d: DocView) => d.blocks.map((b) => `${entry(b.attrs.figureIndex)}${text(b).replace(//g, "#").replace(//g, "@")}`);

describe("numeração", () => {
  it("numera cada rótulo separadamente, na ordem do documento", () => {
    const blocks = [caption("Figura", "Mapa"), caption("Tabela", "Dados", "t1"), p("texto"), caption("Figura", "Gráfico", "f2")];
    const f = captionFields(blocks);
    expect(f.numbers).toEqual([1, 1, 2]);
    expect(f.targets.get("f2")).toEqual({ text: "Figura 2", block: 3 });
    expect(f.targets.get("t1")?.text).toBe("Tabela 1");
    expect(captionLabel(blocks[1])).toBe("Tabela");
    expect(captionLabel(blocks[2])).toBeNull();
    expect(nextNumber(blocks, "Figura", 3)).toBe(2);
    expect(nextNumber(blocks, "Figura", 4)).toBe(3);
  });

  it("referência ao rótulo e número, ao título e à página", () => {
    const blocks = [p("Introdução", "heading1", { bookmark: "intro" }), caption("Figura", "Mapa", "f1")];
    const f = captionFields(blocks);
    expect(xrefText(f, { target: "f1", show: "label" })).toBe("Figura 1");
    expect(xrefText(f, { target: "intro", show: "label" })).toBe("Introdução");
    expect(xrefText(f, { target: "f1", show: "page", page: 4 })).toBe("4");
    expect(xrefText(f, { target: "f1", show: "page", page: 4 }, () => 7)).toBe("7");
    expect(xrefText(f, { target: "sumiu", show: "label" })).toBe(MISSING_REF);
  });

  it("rótulos válidos como no núcleo", () => {
    expect(isCaptionLabel("Figura")).toBe(true);
    expect(isCaptionLabel("Mapa de Risco")).toBe(true);
    expect(isCaptionLabel("a:b")).toBe(false);
    expect(isCaptionLabel(" Figura")).toBe(false);
    expect(isCaptionLabel("x".repeat(33))).toBe(false);
  });
});

describe("Inserir Legenda", () => {
  it("acima do parágrafo, com o separador da ABNT e o cursor no fim", () => {
    const d = doc(p("antes"), p("imagem"));
    const edit = insertCaption(d, at(1, 2), "Figura", "above", " Mapa ");
    const after = apply(d, edit.command);
    expect(summary(after)).toEqual(["antes", "Figura # – Mapa", "imagem"]);
    expect(after.blocks[1].style).toBe("caption");
    expect(after.blocks[1].spans[1].marks).toEqual([{ mark: "seq", label: "Figura" }]);
    expect(edit.selection).toEqual(at(1, "Figura # – Mapa".length));
  });

  it("abaixo de uma tabela inteira; sem descrição, só o rótulo e o número", () => {
    const cell = (row: number) => ({ cell: { table: "t", row, col: 0 } });
    const d = doc(p("a", "paragraph", cell(0)), p("b", "paragraph", cell(1)), p("depois"));
    const after = apply(d, insertCaption(d, at(0), "Tabela", "below", "").command);
    expect(summary(after)).toEqual(["a", "b", "Tabela #", "depois"]);
  });
});

describe("Índice de Ilustrações", () => {
  const base = () => doc(p(""), caption("Figura", "Mapa"), caption("Tabela", "Dados"), caption("Figura", "Gráfico"));
  const pages = (b: number) => b;

  it("lista as legendas do rótulo com as páginas", () => {
    const d = base();
    const after = apply(d, insertFigureIndex(d, at(0), "Figura", pages, labels).command);
    expect(summary(after).slice(0, 3)).toEqual(["[Figura] LISTA DE FIGURAS", "[Figura:1] Figura 1 – Mapa", "[Figura:3] Figura 2 – Gráfico"]);
    expect(findFigureIndexes(after.blocks)).toEqual([{ start: 0, end: 3, label: "Figura", hasTitle: true }]);
    // Cada entrada aponta para a legenda (Ctrl+clique e página na tela).
    expect([...figureTargets(after.blocks)]).toEqual([
      [1, 4],
      [2, 6],
    ]);
  });

  it("sem legendas, a mensagem do Word", () => {
    const d = doc(p(""));
    const after = apply(d, insertFigureIndex(d, at(0), "Quadro", pages, labels).command);
    expect(summary(after)).toEqual(["[Quadro] LISTA DE QUADROS", "[Quadro:0] Nenhuma entrada.", ""]);
  });

  it("Atualizar Índice refaz as entradas de todos os índices e mantém os títulos", () => {
    let d = base();
    d = apply(d, insertFigureIndex(d, at(0), "Figura", pages, labels).command);
    d = apply(d, insertFigureIndex(d, at(3), "Tabela", pages, labels).command);
    expect(summary(d).slice(0, 5)).toEqual(["[Figura] LISTA DE FIGURAS", "[Figura:1] Figura 1 – Mapa", "[Figura:3] Figura 2 – Gráfico", "[Tabela] LISTA DE TABELAS", "[Tabela:5] Tabela 1 – Dados"]);
    // Uma legenda nova no começo: as entradas e os números mudam.
    d = { ...d, blocks: [...d.blocks.slice(0, 5), caption("Figura", "Nova"), ...d.blocks.slice(5)] };
    const edit = updateFigureIndexes(d, at(9), (b) => b + 10, labels)!;
    const after = apply(d, edit.command);
    expect(summary(after).slice(0, 7)).toEqual([
      "[Figura] LISTA DE FIGURAS",
      "[Figura:15] Figura 1 – Nova",
      "[Figura:17] Figura 2 – Mapa",
      "[Figura:19] Figura 3 – Gráfico",
      "[Tabela] LISTA DE TABELAS",
      "[Tabela:18] Tabela 1 – Dados",
      "Figura # – Nova",
    ]);
    // O cursor depois dos índices anda junto com o texto.
    expect(edit.selection).toEqual(at(10));
  });
});

describe("Referência Cruzada", () => {
  it("lista legendas de um rótulo e títulos", () => {
    const blocks = [p("Introdução", "heading1"), caption("Figura", "Mapa"), p("Fim", "heading2")];
    expect(refItems(blocks, "Figura")).toEqual([{ block: 1, text: "Figura 1 – Mapa" }]);
    expect(refItems(blocks, HEADING_KIND).map((i) => i.text)).toEqual(["Introdução", "Fim"]);
  });

  it("dá um marcador ao alvo e insere o caractere com a página da tela", () => {
    const d = doc(p("Veja "), caption("Figura", "Mapa"));
    const edit = insertCrossRef(d, at(0, 5), 1, "page", 3, () => "r1");
    const after = apply(d, edit.command);
    expect(after.blocks[1].attrs.bookmark).toBe("r1");
    expect(after.blocks[0].spans[1]).toEqual({ text: XREF_CHAR, marks: [{ mark: "xref", target: "r1", show: "page", page: 3 }] });
    expect(edit.selection).toEqual(at(0, 6));
    // Alvo que já tem marcador: usa o mesmo.
    const again = insertCrossRef(after, at(0, 6), 1, "label", 3, () => "outro");
    expect(again.command).toEqual({ type: "batch", commands: [{ type: "text.insert", block: 0, offset: 6, text: XREF_CHAR, marks: [{ mark: "xref", target: "r1", show: "label" }] }] });
  });

  it("Ctrl+clique na referência vai para o alvo", () => {
    const blocks = [p("Veja"), caption("Figura", "Mapa", "f1")];
    // Sem DOM nos testes: um elemento falso que só responde a closest().
    const el = (xref: string) => ({ closest: (sel: string) => (sel === ".xref-ref" ? { dataset: { xref } } : null) }) as unknown as HTMLElement;
    expect(captionLinkTarget(el("f1"), blocks)).toBe(1);
    expect(captionLinkTarget(el("sumiu"), blocks)).toBeUndefined();
  });
});
