import { describe, expect, it } from "vitest";
import {
  charLenAfter,
  charLenBefore,
  firstDifference,
  caret,
  clampSelection,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  insertText,
  markActive,
  marksAt,
  setStyle,
  splitBlock,
  toggleMark,
  toggledMarks,
  wordCount,
} from "./model";
import { DEFAULT_ATTRS } from "./formatting";
import type { BlockView, DocView, Mark } from "./types";
import { DEFAULT_PAGE } from "./types";

const bold: Mark = { mark: "bold" };

function doc(...blocks: BlockView[]): DocView {
  return { blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE };
}

const p = (...spans: [string, Mark[]?][]): BlockView => ({
  style: "paragraph",
  attrs: { ...DEFAULT_ATTRS },
  spans: spans.map(([text, marks = []]) => ({ text, marks })),
});

const at = (block: number, offset: number) => caret({ block, offset });
const range = (b1: number, o1: number, b2: number, o2: number) => ({
  anchor: { block: b1, offset: o1 },
  focus: { block: b2, offset: o2 },
});

describe("digitar e colar", () => {
  const d = doc(p(["abc"]));

  it("insere no cursor e avança", () => {
    expect(insertText(d, at(0, 1), "XY")).toEqual({
      command: { type: "text.insert", block: 0, offset: 1, text: "XY" },
      selection: at(0, 3),
    });
  });

  it("substitui a seleção num único passo", () => {
    const edit = insertText(d, range(0, 2, 0, 0), "Z");
    expect(edit.command).toEqual({
      type: "batch",
      commands: [
        { type: "text.delete", block: 0, offset: 0, len: 2 },
        { type: "text.insert", block: 0, offset: 0, text: "Z" },
      ],
    });
    expect(edit.selection).toEqual(at(0, 1));
  });

  it("substitui seleção que atravessa parágrafos", () => {
    const two = doc(p(["abc"]), p(["def"]));
    expect(insertText(two, range(0, 1, 1, 2), "X").command).toEqual({
      type: "batch",
      commands: [
        { type: "text.deleteRange", from: { block: 0, offset: 1 }, to: { block: 1, offset: 2 } },
        { type: "text.insert", block: 0, offset: 1, text: "X" },
      ],
    });
  });

  it("cola várias linhas como parágrafos", () => {
    const edit = insertText(d, at(0, 1), "um\r\ndois\ntres");
    expect(edit.command).toEqual({
      type: "batch",
      commands: [
        { type: "block.split", block: 0, offset: 1 },
        { type: "text.insert", block: 0, offset: 1, text: "um" },
        { type: "block.insert", index: 1, text: "dois" },
        { type: "text.insert", block: 2, offset: 0, text: "tres" },
      ],
    });
    expect(edit.selection).toEqual(at(2, 4));
  });

  it("repassa marcas pendentes", () => {
    const edit = insertText(d, at(0, 0), "x", [bold]);
    expect(edit.command).toMatchObject({ marks: [bold] });
  });
});

describe("Enter e exclusões", () => {
  const d = doc(p(["abc"]), p(["d😀e"]));

  it("Enter divide e leva o cursor ao novo parágrafo", () => {
    expect(splitBlock(d, at(0, 2))).toEqual({
      command: { type: "block.split", block: 0, offset: 2 },
      selection: at(1, 0),
    });
  });

  it("Backspace no início junta com o parágrafo anterior", () => {
    expect(deleteBackward(d, at(1, 0))).toEqual({
      command: { type: "text.deleteRange", from: { block: 0, offset: 3 }, to: { block: 1, offset: 0 } },
      selection: at(0, 3),
    });
  });

  it("Backspace dentro do parágrafo usa text.delete, que se agrupa no desfazer", () => {
    expect(deleteBackward(d, at(0, 2))).toEqual({
      command: { type: "text.delete", block: 0, offset: 1, len: 1 },
      selection: at(0, 1),
    });
  });

  it("Backspace e Delete apagam o emoji inteiro", () => {
    const emoji = { type: "text.delete", block: 1, offset: 1, len: 2 };
    expect(deleteBackward(d, at(1, 3)).command).toEqual(emoji);
    expect(deleteForward(d, at(1, 1)).command).toEqual(emoji);
  });

  it("Backspace no início do documento não faz nada", () => {
    expect(deleteBackward(d, at(0, 0)).command).toBeNull();
  });

  it("Delete no fim puxa o parágrafo seguinte", () => {
    expect(deleteForward(d, at(0, 3)).command).toEqual({
      type: "text.deleteRange",
      from: { block: 0, offset: 3 },
      to: { block: 1, offset: 0 },
    });
  });

  it("Ctrl+Backspace apaga a palavra anterior", () => {
    const words = doc(p(["olá mundo  "]));
    expect(deleteWordBackward(words, at(0, 11)).command).toEqual({
      type: "text.delete",
      block: 0,
      offset: 4,
      len: 7,
    });
  });
});

describe("formatação", () => {
  const d = doc(p(["um "], ["dois", [bold]]), p(["tres", [bold]]));

  it("marca ativa segue o caractere à esquerda", () => {
    expect(marksAt(d, { block: 0, offset: 3 })).toEqual([]);
    expect(marksAt(d, { block: 0, offset: 4 })).toEqual([bold]);
    expect(markActive(d, range(0, 3, 1, 4), "bold")).toBe(true);
    expect(markActive(d, range(0, 0, 1, 4), "bold")).toBe(false);
  });

  it("alternar liga em toda a seleção quando falta em parte dela", () => {
    expect(toggleMark(d, range(0, 0, 1, 2), "bold")).toEqual({
      type: "batch",
      commands: [
        { type: "text.applyMark", block: 0, offset: 0, len: 7, mark: bold },
        { type: "text.applyMark", block: 1, offset: 0, len: 2, mark: bold },
      ],
    });
  });

  it("alternar desliga quando a seleção inteira já tem a marca", () => {
    expect(toggleMark(d, range(0, 3, 0, 7), "bold")).toEqual({
      type: "text.removeMark",
      block: 0,
      offset: 3,
      len: 4,
      kind: "bold",
    });
  });

  it("marcas pendentes alternam sem seleção", () => {
    expect(toggledMarks([bold], "bold")).toEqual([]);
    expect(toggledMarks([], "italic")).toEqual([{ mark: "italic" }]);
  });

  it("estilo vale para todos os parágrafos da seleção", () => {
    expect(setStyle(d, range(1, 0, 0, 1), "heading2")).toEqual({
      type: "batch",
      commands: [
        { type: "block.setStyle", block: 0, style: "heading2" },
        { type: "block.setStyle", block: 1, style: "heading2" },
      ],
    });
  });
});

describe("utilitários", () => {
  it("limita a seleção ao documento depois de desfazer", () => {
    expect(clampSelection(doc(p(["ab"])), range(3, 9, 0, 1))).toEqual(range(0, 2, 0, 1));
  });

  it("conta palavras", () => {
    expect(wordCount(doc(p(["um dois"]), p([""]), p([" tres "])))).toBe(3);
  });
});

describe("caracteres visíveis", () => {
  it("emoji de família, bandeira e acento combinado contam como um", () => {
    const text = "a👨‍👩‍👧🇧🇷e\u0301";
    expect(charLenBefore(text, text.length)).toBe(2); // e + acento
    expect(charLenBefore(text, text.length - 2)).toBe(4); // 🇧🇷
    expect(charLenBefore(text, 1 + "👨‍👩‍👧".length)).toBe("👨‍👩‍👧".length);
    expect(charLenAfter(text, 1)).toBe("👨‍👩‍👧".length);
    expect(charLenAfter(text, 0)).toBe(1);
  });
});

describe("desfazer leva o cursor", () => {
  it("para onde o texto mudou", () => {
    const before = doc(p(["início extra"]), p(["fim"]));
    const after = doc(p(["início"]), p(["fim"]));
    expect(firstDifference(before, after)).toEqual({ block: 0, offset: 6 });
    expect(firstDifference(after, after)).toBeNull();
    expect(firstDifference(doc(p(["a"]), p(["b"])), doc(p(["a"])))).toEqual({ block: 0, offset: 1 });
  });
});
