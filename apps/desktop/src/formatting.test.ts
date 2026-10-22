import { describe, expect, it } from "vitest";
import {
  autoList,
  changeCase,
  changeIndent,
  commonAttr,
  commonMark,
  DEFAULT_ATTRS,
  formatTarget,
  growFont,
  listMarkers,
  nextCaseMode,
  removeMarks,
  setMark,
  setParaAttr,
  stepSize,
  toggleList,
  wordAround,
} from "./formatting";
import { caret, deleteBackward } from "./model";
import type { BlockView, DocView, Mark, ParaAttrs } from "./types";

const bold: Mark = { mark: "bold" };
const size = (pt: number): Mark => ({ mark: "fontSize", halfPoints: pt * 2 });

const doc = (...blocks: BlockView[]): DocView => ({
  blocks,
  canUndo: false,
  canRedo: false,
  path: null,
  title: "t",
  dirty: false,
});

const p = (spans: [string, Mark[]?][], attrs: Partial<ParaAttrs> = {}, style: BlockView["style"] = "paragraph"): BlockView => ({
  style,
  attrs: { ...DEFAULT_ATTRS, ...attrs },
  spans: spans.map(([text, marks = []]) => ({ text, marks })),
});

const sel = (b1: number, o1: number, b2 = b1, o2 = o1) => ({
  anchor: { block: b1, offset: o1 },
  focus: { block: b2, offset: o2 },
});

describe("alvo da formatação", () => {
  it("cursor dentro de uma palavra pega a palavra inteira", () => {
    expect(wordAround("uma palavra aqui", 6)).toEqual([4, 11]);
    expect(wordAround("uma palavra", 4)).toBeNull(); // na borda
    expect(wordAround("ação é", 2)).toEqual([0, 4]);
    const d = doc(p([["uma palavra aqui"]]));
    expect(formatTarget(d, sel(0, 6))).toEqual(sel(0, 4, 0, 11));
    expect(formatTarget(d, sel(0, 3))).toBeNull();
    expect(formatTarget(d, sel(0, 0, 0, 2))).toEqual(sel(0, 0, 0, 2));
  });
});

describe("marcas com valor", () => {
  it("aplica fonte em vários parágrafos", () => {
    const d = doc(p([["abc"]]), p([["def"]]));
    expect(setMark(d, sel(0, 1, 1, 2), { mark: "fontFamily", value: "Arial" })).toEqual({
      type: "batch",
      commands: [
        { type: "text.applyMark", block: 0, offset: 1, len: 2, mark: { mark: "fontFamily", value: "Arial" } },
        { type: "text.applyMark", block: 1, offset: 0, len: 2, mark: { mark: "fontFamily", value: "Arial" } },
      ],
    });
  });

  it("limpar formatação remove todas as marcas de cada trecho", () => {
    const d = doc(p([["ab", [bold, size(14)]], ["cd"]]));
    expect(removeMarks(d, sel(0, 1, 0, 4), "all")).toEqual({
      type: "batch",
      commands: [
        { type: "text.removeMark", block: 0, offset: 1, len: 1, kind: "bold" },
        { type: "text.removeMark", block: 0, offset: 1, len: 1, kind: "fontSize" },
      ],
    });
  });

  it("valor comum: igual, misturado ou ausente", () => {
    const d = doc(p([["ab", [size(14)]], ["cd", [size(12)]]]));
    expect(commonMark(d, sel(0, 0, 0, 2), "fontSize", [])).toEqual(size(14));
    expect(commonMark(d, sel(0, 0, 0, 4), "fontSize", [])).toBeUndefined();
    expect(commonMark(d, sel(0, 0, 0, 2), "color", [])).toBeNull();
  });
});

describe("tamanho da fonte", () => {
  it("A+ e A- seguem a lista do Word", () => {
    expect(stepSize(11, 1)).toBe(12);
    expect(stepSize(12, 1)).toBe(14);
    expect(stepSize(28, 1)).toBe(36);
    expect(stepSize(11, -1)).toBe(10.5);
    expect(stepSize(72, 1)).toBe(73);
    expect(stepSize(8, -1)).toBe(7);
  });

  it("cada trecho cresce a partir do próprio tamanho, inclusive o padrão do estilo", () => {
    const d = doc(p([["a", [size(14)]], ["b"]]), p([["T"]], {}, "heading1"));
    expect(growFont(d, sel(0, 0, 1, 1), 1)).toEqual({
      type: "batch",
      commands: [
        { type: "text.applyMark", block: 0, offset: 0, len: 1, mark: size(16) },
        { type: "text.applyMark", block: 0, offset: 1, len: 1, mark: size(12) },
        { type: "text.applyMark", block: 1, offset: 0, len: 1, mark: size(22) },
      ],
    });
  });
});

describe("maiúsculas e minúsculas", () => {
  const d = doc(p([["olá "], ["Mundo", [bold]], [". tudo bem?"]]));
  const all = sel(0, 0, 0, 20);

  it("MAIÚSCULAS mantém a formatação de cada trecho", () => {
    const { command, selection } = changeCase(d, all, "upper");
    expect(command).toEqual({
      type: "batch",
      commands: [
        { type: "text.insert", block: 0, offset: 20, text: ". TUDO BEM?", marks: [] },
        { type: "text.delete", block: 0, offset: 9, len: 11 },
        { type: "text.insert", block: 0, offset: 9, text: "MUNDO", marks: [bold] },
        { type: "text.delete", block: 0, offset: 4, len: 5 },
        { type: "text.insert", block: 0, offset: 4, text: "OLÁ ", marks: [] },
        { type: "text.delete", block: 0, offset: 0, len: 4 },
      ],
    });
    expect(selection).toEqual(all);
  });

  it("frase, título e alternar", () => {
    const one = doc(p([["oLÁ mundo. tudo bem"]]));
    const text = (mode: Parameters<typeof changeCase>[2]) =>
      (changeCase(one, sel(0, 0, 0, 19), mode).command as { commands: { text?: string }[] }).commands[0].text;
    expect(text("sentence")).toBe("Olá mundo. Tudo bem");
    expect(text("title")).toBe("Olá Mundo. Tudo Bem");
    expect(text("toggle")).toBe("Olá MUNDO. TUDO BEM");
    expect(text("lower")).toBe("olá mundo. tudo bem");
  });

  it("ß vira SS e a seleção acompanha", () => {
    const d2 = doc(p([["straße"]]));
    expect(changeCase(d2, sel(0, 0, 0, 6), "upper", "de").selection).toEqual(sel(0, 0, 0, 7));
  });

  it("Shift+F3 percorre minúsculas → MAIÚSCULAS → Título → minúsculas", () => {
    expect(nextCaseMode("olá mundo", "pt-BR")).toBe("upper");
    expect(nextCaseMode("OLÁ MUNDO", "pt-BR")).toBe("title");
    expect(nextCaseMode("Olá Mundo", "pt-BR")).toBe("lower");
  });
});

describe("parágrafo", () => {
  it("alinhamento só nos parágrafos que mudam", () => {
    const d = doc(p([["a"]], { align: "center" }), p([["b"]]));
    expect(setParaAttr(d, sel(0, 0, 1, 1), { attr: "align", value: "center" })).toEqual({
      type: "block.setAttr",
      block: 1,
      attr: "align",
      value: "center",
    });
    expect(commonAttr(d, sel(0, 0, 1, 1), "align")).toBeUndefined();
    expect(commonAttr(d, sel(1, 0), "align")).toBe("left");
  });

  it("marcadores ligam em todos ou desligam se todos já têm", () => {
    const d = doc(p([["a"]], { list: "bullet" }), p([["b"]]));
    expect(toggleList(d, sel(0, 0, 1, 0), "bullet")).toEqual({
      type: "block.setAttr",
      block: 1,
      attr: "list",
      value: "bullet",
    });
    const both = doc(p([["a"]], { list: "bullet" }), p([["b"]], { list: "bullet" }));
    expect(toggleList(both, sel(0, 0, 1, 0), "bullet")).toEqual({
      type: "batch",
      commands: [
        { type: "block.setAttr", block: 0, attr: "list", value: null },
        { type: "block.setAttr", block: 1, attr: "list", value: null },
      ],
    });
  });

  it("recuo fica entre 0 e 8", () => {
    const d = doc(p([["a"]]), p([["b"]], { indent: 8 }));
    expect(changeIndent(d, sel(0, 0, 1, 0), 1)).toEqual({ type: "block.setAttr", block: 0, attr: "indent", value: 1 });
    expect(changeIndent(d, sel(0, 0), -1)).toBeNull();
  });

  it("Backspace no início de um item tira o marcador", () => {
    const d = doc(p([["x"]]), p([["item"]], { list: "bullet" }));
    expect(deleteBackward(d, caret({ block: 1, offset: 0 })).command).toEqual({
      type: "block.setAttr",
      block: 1,
      attr: "list",
      value: null,
    });
  });

  it('"- " e "1. " no início viram lista', () => {
    expect(autoList(doc(p([["-"]])), sel(0, 1), " ")).toEqual({
      type: "batch",
      commands: [
        { type: "text.delete", block: 0, offset: 0, len: 1 },
        { type: "block.setAttr", block: 0, attr: "list", value: "bullet" },
      ],
    });
    expect((autoList(doc(p([["1."]])), sel(0, 2), " ") as { commands: unknown[] }).commands[1]).toEqual({
      type: "block.setAttr",
      block: 0,
      attr: "list",
      value: "number",
    });
    expect(autoList(doc(p([["a-"]])), sel(0, 2), " ")).toBeNull();
    expect(autoList(doc(p([["-"]], {}, "heading1")), sel(0, 1), " ")).toBeNull();
  });

  it("numeração por nível e recomeço depois de texto comum", () => {
    const n = (indent = 0): BlockView => p([["x"]], { list: "number", indent });
    const b = (indent = 0): BlockView => p([["x"]], { list: "bullet", indent });
    expect(listMarkers([n(), n(), n(1), n(1), n(2), n(), p([["fim"]]), n(), b(), b(1), b(2), b(3)])).toEqual([
      "1.", "2.", "a.", "b.", "i.", "3.", null, "1.", "•", "◦", "▪", "•",
    ]);
  });
});
