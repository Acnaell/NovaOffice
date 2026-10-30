import { describe, expect, it } from "vitest";
import {
  accessDate,
  citationText,
  findBibliography,
  insertBibliography,
  insertCitation,
  referencePieces,
  referenceText,
  removeBibliography,
  sortedSources,
  updateBibliography,
} from "./citations";
import { DEFAULT_ATTRS } from "./formatting";
import { caret, type Selection } from "./model";
import type { BlockStyle, BlockView, DocView, Source, TextCommand } from "./types";
import { CITATION_CHAR, DEFAULT_HEADER_FOOTER, DEFAULT_PAGE } from "./types";

const doc = (sources: Record<string, Source>, ...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, footnotes: {}, comments: {}, sources });
const p = (text: string, style: BlockStyle = "paragraph"): BlockView => ({ style, attrs: { ...DEFAULT_ATTRS }, spans: text ? [{ text, marks: [] }] : [] });
const at = (block: number, offset = 0): Selection => caret({ block, offset });
const labels = { title: "REFERÊNCIAS", empty: "Nenhuma fonte no documento." };

/** Aplica os comandos como o núcleo faria (só os que a bibliografia usa). */
function apply(d: DocView, command: TextCommand | null): DocView {
  const blocks = d.blocks.map((b) => ({ ...b, attrs: { ...b.attrs }, spans: b.spans.slice() }));
  const run = (c: TextCommand) => {
    switch (c.type) {
      case "batch":
        return c.commands.forEach(run);
      case "block.insert":
        return blocks.splice(c.index, 0, p(c.text, c.style ?? "paragraph"));
      case "block.remove":
        return blocks.splice(c.block, 1);
      case "text.insert":
        return void blocks[c.block].spans.push({ text: c.text, marks: c.marks ?? [] });
      case "block.setAttr":
        return void ((blocks[c.block].attrs as unknown as Record<string, unknown>)[c.attr] = c.value);
      default:
        throw new Error(`comando não simulado: ${c.type}`);
    }
  };
  if (command) run(command);
  return { ...d, blocks };
}

const text = (b: BlockView) => b.spans.map((s) => s.text).join("");
const summary = (d: DocView) => d.blocks.map((b) => `${b.attrs.bibliography ? `[${b.attrs.bibliography}] ` : ""}${text(b)}`);

const livro: Source = {
  kind: "book",
  authors: [{ last: "Silva", first: "João" }],
  title: "Metodologia científica: um guia prático",
  year: "2026",
  publisher: "Atlas",
  place: "São Paulo",
  edition: "2",
};

describe("chamada autor-data (NBR 10520)", () => {
  it("autor, ano e página, como o núcleo", () => {
    expect(citationText(livro)).toBe("(SILVA, 2026)");
    expect(citationText(livro, "12")).toBe("(SILVA, 2026, p. 12)");
    expect(citationText({ ...livro, authors: [{ last: "Silva", first: "" }, { last: "Souza", first: "" }] })).toBe("(SILVA; SOUZA, 2026)");
    const quatro = ["Lima", "b", "c", "d"].map((last) => ({ last, first: "" }));
    expect(citationText({ ...livro, authors: quatro, year: "" })).toBe("(LIMA et al., [s. d.])");
    expect(citationText({ ...livro, authors: [] })).toBe("(METODOLOGIA..., 2026)");
    expect(citationText(undefined)).toBe("(?)");
  });

  it("insere o caractere da chamada com a marca no fim da seleção", () => {
    const edit = insertCitation({ anchor: { block: 0, offset: 2 }, focus: { block: 0, offset: 5 } }, "s1", " 12 ");
    expect(edit.command).toEqual({ type: "text.insert", block: 0, offset: 5, text: CITATION_CHAR, marks: [{ mark: "citation", id: "s1", page: "12" }] });
    expect(edit.selection.focus).toEqual({ block: 0, offset: 6 });
    expect((insertCitation(at(0), "s1").command as { marks: unknown[] }).marks).toEqual([{ mark: "citation", id: "s1" }]);
  });
});

describe("referências (NBR 6023)", () => {
  it("livro: autor, título em negrito sem o subtítulo, edição, local, editora e ano", () => {
    expect(referencePieces(livro)).toEqual([
      { text: "SILVA, João. ", bold: false },
      { text: "Metodologia científica", bold: true },
      { text: ": um guia prático. 2. ed. São Paulo: Atlas, 2026.", bold: false },
    ]);
    // Prenome abreviado já termina em ponto; sem local nem editora: [S. l.: s. n.].
    expect(referenceText({ kind: "book", authors: [{ last: "Silva", first: "J." }], title: "Livro" })).toBe("SILVA, J. Livro. [S. l.: s. n.], [s. d.].");
  });

  it("artigo: título sem destaque e o periódico em negrito", () => {
    const artigo: Source = { kind: "article", authors: [{ last: "Lima", first: "Ana" }, { last: "Souza", first: "Rui" }], title: "Leitura digital", journal: "Revista Brasileira de Educação", place: "Rio de Janeiro", volume: "29", issue: "2", pages: "15-30", year: "2024" };
    expect(referencePieces(artigo)).toEqual([
      { text: "LIMA, Ana; SOUZA, Rui. Leitura digital. ", bold: false },
      { text: "Revista Brasileira de Educação", bold: true },
      { text: ", Rio de Janeiro, v. 29, n. 2, p. 15-30, 2024.", bold: false },
    ]);
  });

  it("site com entidade, endereço e data de acesso", () => {
    const site: Source = { kind: "web", authors: [{ last: "Instituto Brasileiro de Geografia e Estatística", first: "" }], title: "Censo 2022", year: "2023", url: "https://www.ibge.gov.br/censo", accessed: "2026-10-30" };
    expect(referenceText(site)).toBe("INSTITUTO BRASILEIRO DE GEOGRAFIA E ESTATÍSTICA. Censo 2022. 2023. Disponível em: https://www.ibge.gov.br/censo. Acesso em: 30 out. 2026.");
    expect(accessDate("2026-05-03")).toBe("3 maio 2026");
  });

  it("tese e obra sem autor (entrada pelo título)", () => {
    const tese: Source = { kind: "thesis", authors: [{ last: "Araujo", first: "Maria" }], title: "Máscaras", year: "2020", degree: "Tese (Doutorado em Educação)", institution: "Universidade de São Paulo", place: "São Paulo" };
    expect(referenceText(tese)).toBe("ARAUJO, Maria. Máscaras. 2020. Tese (Doutorado em Educação) – Universidade de São Paulo, São Paulo, 2020.");
    const anonimo = referencePieces({ ...livro, authors: [] });
    expect(anonimo.every((piece) => !piece.bold)).toBe(true);
    expect(anonimo[0].text.startsWith("METODOLOGIA científica: um guia prático.")).toBe(true);
  });

  it("ordem alfabética pela entrada, ignorando acentos e caixa", () => {
    const order = sortedSources({ b: { ...livro, authors: [{ last: "Ávila", first: "B" }] }, a: { ...livro, authors: [{ last: "Souza", first: "A" }] }, c: livro });
    expect(order.map(([id]) => id)).toEqual(["b", "c", "a"]);
  });
});

describe("bibliografia", () => {
  const sources = { s1: livro, s2: { ...livro, authors: [{ last: "Almeida", first: "Rui" }], title: "Outro" } };

  it("insere título e entradas em ordem, atualiza e remove", () => {
    let d = doc(sources, p("Texto."), p("Fim"));
    const edit = insertBibliography(d, at(1, 3), labels);
    d = apply(d, edit.command);
    expect(summary(d)).toEqual([
      "Texto.",
      "Fim",
      "[title] REFERÊNCIAS",
      "[entry] ALMEIDA, Rui. Outro. 2. ed. São Paulo: Atlas, 2026.",
      "[entry] SILVA, João. Metodologia científica: um guia prático. 2. ed. São Paulo: Atlas, 2026.",
      "",
    ]);
    expect(d.blocks[2].style).toBe("heading1");
    expect(d.blocks[2].attrs.align).toBe("center");
    expect(d.blocks[3].attrs.spaceAfter).toBe(12);
    expect(edit.selection.focus).toEqual({ block: 5, offset: 0 });
    expect(findBibliography(d.blocks)).toEqual({ start: 2, end: 5 });

    // Uma fonte a menos: Atualizar refaz as entradas e mantém o título.
    d = { ...d, sources: { s1: livro } };
    d = apply(d, updateBibliography(d, at(5), labels)!.command);
    expect(summary(d).slice(2)).toEqual(["[title] REFERÊNCIAS", "[entry] SILVA, João. Metodologia científica: um guia prático. 2. ed. São Paulo: Atlas, 2026.", ""]);
    // Inserir de novo com uma já existente só atualiza.
    expect(summary(apply(d, insertBibliography(d, at(0), labels).command))).toEqual(summary(d));

    d = apply(d, removeBibliography(d, at(3))!.command);
    expect(summary(d)).toEqual(["Texto.", "Fim", ""]);
    expect(updateBibliography(d, at(0), labels)).toBeNull();
  });

  it("sem fontes, a entrada avisa", () => {
    const d = apply(doc({}, p("x")), insertBibliography(doc({}, p("x")), at(0, 0), labels).command);
    expect(summary(d).slice(0, 2)).toEqual(["[title] REFERÊNCIAS", "[entry] Nenhuma fonte no documento."]);
  });
});
