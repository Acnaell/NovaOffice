import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { caret } from "./model";
import { defaultProofing, hideTyping, matchAt, matchText, parseProofing, SpellCache } from "./spell";
import { DEFAULT_PAGE, type BlockView, type DocView } from "./types";

const p = (text: string): BlockView => ({
  style: "paragraph",
  attrs: { ...DEFAULT_ATTRS },
  spans: [{ text, marks: [] }],
});

function doc(...blocks: BlockView[]): DocView {
  return { blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE };
}

describe("idioma de revisão", () => {
  it("segue o idioma da interface", () => {
    expect(defaultProofing("pt-BR")).toBe("pt-BR");
    expect(defaultProofing("en")).toBe("en-US");
    expect(defaultProofing("es-MX")).toBe("es");
    expect(defaultProofing("fr")).toBe("pt-BR");
  });

  it("aceita só valores conhecidos do armazenamento", () => {
    expect(parseProofing("en-US")).toBe("en-US");
    expect(parseProofing("off")).toBe("off");
    expect(parseProofing("de-DE")).toBeNull();
    expect(parseProofing(null)).toBeNull();
  });
});

describe("cache por parágrafo", () => {
  it("só os parágrafos novos voltam ao núcleo", () => {
    const a = p("A excessão confirma");
    const b = p("tudo certo");
    const cache = new SpellCache();
    expect(cache.pending([a, b]).map((x) => x.index)).toEqual([0, 1]);
    cache.set(a, 0, [[2, 10]]);
    cache.set(b, 1, []);
    expect(cache.pending([a, b])).toEqual([]);

    // O remendo do núcleo troca só o objeto do parágrafo editado.
    const b2 = p("tudo certo!");
    expect(cache.pending([a, b2])).toEqual([{ block: b2, index: 1 }]);
    expect(cache.matches([a, b2])).toEqual([{ block: 0, start: 2, end: 10 }]);
  });

  it("enquanto o parágrafo editado não volta, mantém o que vem antes da edição", () => {
    const before = p("Uma excessão e um pobrema");
    const cache = new SpellCache();
    cache.set(before, 0, [
      [4, 12],
      [18, 25],
    ]);
    // Uma letra digitada entre as duas palavras: a primeira continua no lugar, a segunda andou.
    const after = p("Uma excessão ee um pobrema");
    expect(cache.matches([after])).toEqual([{ block: 0, start: 4, end: 12 }]);
  });

  it("sem resultado nenhum, não sublinha nada", () => {
    expect(new SpellCache().matches([p("excessão")])).toEqual([]);
  });
});

describe("palavras erradas", () => {
  const matches = [
    { block: 0, start: 2, end: 10 },
    { block: 1, start: 0, end: 7 },
  ];

  it("não sublinha a palavra que está sendo digitada", () => {
    expect(hideTyping(matches, caret({ block: 0, offset: 10 }))).toEqual([matches[1]]);
    // No meio da palavra (clique) ou com seleção, continua sublinhada.
    expect(hideTyping(matches, caret({ block: 0, offset: 5 }))).toEqual(matches);
    expect(hideTyping(matches, { anchor: { block: 0, offset: 2 }, focus: { block: 0, offset: 10 } })).toEqual(matches);
  });

  it("acha a palavra sob o clique, inclusive nas pontas", () => {
    expect(matchAt(matches, { block: 0, offset: 2 })).toBe(matches[0]);
    expect(matchAt(matches, { block: 0, offset: 10 })).toBe(matches[0]);
    expect(matchAt(matches, { block: 0, offset: 11 })).toBeNull();
    expect(matchAt(matches, { block: 1, offset: 3 })).toBe(matches[1]);
  });

  it("lê o texto da palavra no documento", () => {
    expect(matchText(doc(p("A excessão"), p("pobrema")), matches[0])).toBe("excessão");
  });
});
