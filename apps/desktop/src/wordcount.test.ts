import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { caret } from "./model";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, type BlockView, type DocView } from "./types";
import { countedTexts, textStats } from "./wordcount";

const p = (text: string): BlockView => ({
  style: "paragraph",
  attrs: { ...DEFAULT_ATTRS },
  spans: [{ text, marks: [] }],
});

const doc = (...texts: string[]): DocView => ({
  blocks: texts.map(p),
  canUndo: false,
  canRedo: false,
  path: null,
  title: "t",
  dirty: false,
  format: null,
  page: DEFAULT_PAGE,
  headerFooter: DEFAULT_HEADER_FOOTER,
  footnotes: {},
});

describe("textStats", () => {
  it("conta como o Word", () => {
    expect(textStats(["Olá, mundo!", "", "Segunda linha\tcom tab"])).toEqual({
      words: 6,
      charsNoSpaces: 28,
      chars: 32,
      paragraphs: 2,
    });
  });

  it("emoji e acento combinado contam um caractere", () => {
    expect(textStats(["👨‍👩‍👧 é"]).chars).toBe(3);
    expect(textStats(["🇧🇷"]).charsNoSpaces).toBe(1);
  });

  it("quebra de linha manual separa palavras e não conta", () => {
    expect(textStats(["um\u000bdois"])).toEqual({ words: 2, charsNoSpaces: 6, chars: 6, paragraphs: 1 });
  });

  it("documento vazio", () => {
    expect(textStats([""])).toEqual({ words: 0, charsNoSpaces: 0, chars: 0, paragraphs: 0 });
  });
});

describe("countedTexts", () => {
  const d = doc("primeiro parágrafo", "segundo", "terceiro");

  it("sem seleção, o documento inteiro", () => {
    expect(countedTexts(d, caret({ block: 1, offset: 2 }))).toEqual(["primeiro parágrafo", "segundo", "terceiro"]);
  });

  it("com seleção, só o trecho (em qualquer direção)", () => {
    expect(countedTexts(d, { anchor: { block: 0, offset: 9 }, focus: { block: 1, offset: 3 } })).toEqual(["parágrafo", "seg"]);
    expect(countedTexts(d, { anchor: { block: 2, offset: 4 }, focus: { block: 2, offset: 0 } })).toEqual(["terc"]);
  });
});
