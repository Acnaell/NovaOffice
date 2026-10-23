// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fragmentHtml, fragmentOf, fragmentText, insertFragment, nearestHighlight, parseHtml, plainFragment } from "./clipboard";
import { findAll, nextMatch, replaceAll } from "./find";
import { DEFAULT_ATTRS } from "./formatting";
import type { BlockView, DocView, Mark, ParaAttrs } from "./types";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE } from "./types";

const bold: Mark = { mark: "bold" };
const p = (spans: [string, Mark[]?][], attrs: Partial<ParaAttrs> = {}, style: BlockView["style"] = "paragraph"): BlockView => ({
  style,
  attrs: { ...DEFAULT_ATTRS, ...attrs },
  spans: spans.map(([text, marks = []]) => ({ text, marks })),
});
const doc = (...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER });
const sel = (b1: number, o1: number, b2 = b1, o2 = o1) => ({ anchor: { block: b1, offset: o1 }, focus: { block: b2, offset: o2 } });
const simple = (f: BlockView[]) => f.map((b) => [b.style, b.attrs.list ?? "", b.attrs.indent, b.spans.map((s) => [s.text, s.marks.map((m) => m.mark).join("+")])]);

describe("copiar", () => {
  const d = doc(p([["Título"]], {}, "heading1"), p([["um "], ["dois", [bold]], [" três"]], { list: "bullet" }));

  it("fragmento guarda estilo, lista e marcas, cortado na seleção", () => {
    const f = fragmentOf(d, sel(0, 2, 1, 6));
    expect(simple(f)).toEqual([
      ["heading1", "", 0, [["tulo", ""]]],
      ["paragraph", "bullet", 0, [["um ", ""], ["doi", "bold"]]],
    ]);
    expect(fragmentText(f)).toBe("tulo\num doi");
  });

  it("HTML que o Word e o navegador entendem", () => {
    const html = fragmentHtml(fragmentOf(d, sel(0, 0, 1, 12)));
    expect(html.replace(/<!--.*?-->/, "")).toBe('<meta charset="utf-8"><h1>Título</h1><ul><li>um <b>dois</b> três</li></ul>');
    const colored = doc(p([["x", [{ mark: "color", value: "#C00000" }, { mark: "highlight", value: "yellow" }, { mark: "vertAlign", value: "superscript" }]]], { align: "center" }));
    expect(fragmentHtml(fragmentOf(colored, sel(0, 0, 0, 1))).replace(/<!--.*?-->/, "")).toBe(
      '<meta charset="utf-8"><p style="text-align:center"><span style="color:#C00000;background:#ffff00"><sup>x</sup></span></p>',
    );
  });
});

describe("colar HTML de fora", () => {
  it("do Word: negrito, cor, tamanho, títulos e alinhamento", () => {
    const html = `<html><head><style>p{}</style></head><body>
      <h2>Seção</h2>
      <p style="text-align:center"><b>Forte</b> e <span style="color:rgb(192,0,0);font-size:14pt">vermelho</span></p>
      <p><span style="font-weight:700;font-family:'Arial',sans-serif">Arial</span> x<sup>2</sup></p>
    </body></html>`;
    const f = parseHtml(html);
    expect(simple(f)).toEqual([
      ["heading2", "", 0, [["Seção", ""]]],
      ["paragraph", "", 0, [["Forte", "bold"], [" e ", ""], ["vermelho", "color+fontSize"]]],
      ["paragraph", "", 0, [["Arial", "bold+fontFamily"], [" x", ""], ["2", "vertAlign"]]],
    ]);
    expect(f[1].attrs.align).toBe("center");
    expect(f[1].spans[2].marks).toContainEqual({ mark: "color", value: "#C00000" });
    expect(f[1].spans[2].marks).toContainEqual({ mark: "fontSize", halfPoints: 28 });
  });

  it("listas aninhadas, quebras de linha e tabelas", () => {
    const f = parseHtml("<ul><li>a<ol><li>b</li></ol></li><li>c</li></ul><p>linha 1<br>linha 2</p><table><tr><td>x</td><td>y</td></tr></table>");
    expect(simple(f)).toEqual([
      ["paragraph", "bullet", 0, [["a", ""]]],
      ["paragraph", "number", 1, [["b", ""]]],
      ["paragraph", "bullet", 0, [["c", ""]]],
      ["paragraph", "", 0, [["linha 1\u000Blinha 2", ""]]],
      ["paragraph", "", 0, [["x\ty", ""]]],
    ]);
  });

  it("realce vira a cor mais próxima do Word", () => {
    expect(nearestHighlight("#FFFF66")).toBe("yellow");
    expect(nearestHighlight("#00FF33")).toBe("green");
    expect(parseHtml('<p><span style="background-color:#ffff00">x</span></p>')[0].spans[0].marks).toEqual([
      { mark: "highlight", value: "yellow" },
    ]);
  });

  it("ida e volta: copiar do Nova e colar no Nova preserva tudo, até espaço no fim", () => {
    const d = doc(p([["Título"]], {}, "heading1"), p([["a "], ["b ", [bold]]], { list: "number", indent: 1 }));
    const html = fragmentHtml(fragmentOf(d, sel(0, 0, 1, 4)));
    expect(simple(parseHtml(html))).toEqual(simple(d.blocks));
    // Sem o comentário (HTML limpo, como o Word vê), o recuo e a lista também voltam.
    const clean = parseHtml(html.replace(/<!--.*?-->/, ""));
    expect(clean[1].attrs).toMatchObject({ list: "number", indent: 1 });
  });
});

describe("colar no documento", () => {
  it("um parágrafo: entra no cursor com as marcas", () => {
    const d = doc(p([["ab"]]));
    const edit = insertFragment(d, sel(0, 1), [p([["X", [bold]], ["y"]])]);
    expect(edit.command).toEqual({
      type: "batch",
      commands: [
        { type: "text.insert", block: 0, offset: 1, text: "X", marks: [bold] },
        { type: "text.insert", block: 0, offset: 2, text: "y", marks: [] },
      ],
    });
    expect(edit.selection).toEqual(sel(0, 3));
  });

  it("vários parágrafos: o do meio mantém estilo e lista; o último se junta ao resto", () => {
    const d = doc(p([["início fim"]]));
    const edit = insertFragment(d, sel(0, 7), [p([["A"]]), p([["B"]], { list: "bullet" }, "paragraph"), p([["C"]])]);
    expect(edit.command).toEqual({
      type: "batch",
      commands: [
        { type: "block.split", block: 0, offset: 7 },
        { type: "text.insert", block: 0, offset: 7, text: "A", marks: [] },
        { type: "block.insert", index: 1, text: "", style: "paragraph" },
        { type: "text.insert", block: 1, offset: 0, text: "B", marks: [] },
        { type: "block.setAttr", block: 1, attr: "list", value: "bullet" },
        { type: "text.insert", block: 2, offset: 0, text: "C", marks: [] },
      ],
    });
    expect(edit.selection).toEqual(sel(2, 1));
  });

  it("substitui a seleção", () => {
    const d = doc(p([["abc"]]), p([["def"]]));
    const edit = insertFragment(d, sel(0, 1, 1, 2), plainFragment("Z"));
    expect(edit.command).toEqual({
      type: "batch",
      commands: [
        { type: "text.deleteRange", from: { block: 0, offset: 1 }, to: { block: 1, offset: 2 } },
        { type: "text.insert", block: 0, offset: 1, text: "Z", marks: [] },
      ],
    });
  });
});

describe("localizar e substituir", () => {
  const d = doc(p([["Casa casa casamento"]]), p([["Na CASA"]]));

  it("diferencia maiúsculas e palavras inteiras", () => {
    expect(findAll(d, "casa", { matchCase: false, wholeWord: false })).toHaveLength(4);
    expect(findAll(d, "casa", { matchCase: true, wholeWord: false })).toHaveLength(2);
    expect(findAll(d, "casa", { matchCase: false, wholeWord: true })).toEqual([
      { block: 0, start: 0, end: 4 },
      { block: 0, start: 5, end: 9 },
      { block: 1, start: 3, end: 7 },
    ]);
    expect(findAll(d, "a.b", { matchCase: false, wholeWord: false })).toEqual([]);
  });

  it("próxima ocorrência dá a volta", () => {
    const m = findAll(d, "casa", { matchCase: false, wholeWord: true });
    expect(nextMatch(m, { block: 0, offset: 1 })).toBe(1);
    expect(nextMatch(m, { block: 1, offset: 5 })).toBe(0);
    expect(nextMatch(m, { block: 0, offset: 5 }, true)).toBe(0);
  });

  it("substituir tudo de trás para frente, mantendo a formatação", () => {
    const f = doc(p([["um ", []], ["dois", [bold]], [" um"]]));
    const { command, count } = replaceAll(f, "um", "1", { matchCase: false, wholeWord: true });
    expect(count).toBe(2);
    expect(command).toEqual({
      type: "batch",
      commands: [
        { type: "text.insert", block: 0, offset: 10, text: "1", marks: [] },
        { type: "text.delete", block: 0, offset: 8, len: 2 },
        { type: "text.insert", block: 0, offset: 2, text: "1", marks: [] },
        { type: "text.delete", block: 0, offset: 0, len: 2 },
      ],
    });
  });
});
