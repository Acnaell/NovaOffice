import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { caret, type Selection } from "./model";
import { findToc, insertToc, removeToc, tocItems, tocTargets, updateToc } from "./toc";
import type { BlockStyle, BlockView, DocView, TextCommand, TocEntry } from "./types";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE } from "./types";

const doc = (...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, footnotes: {}, comments: {} });
const p = (text: string, style: BlockStyle = "paragraph", toc: TocEntry | null = null): BlockView => ({
  style,
  attrs: { ...DEFAULT_ATTRS, toc },
  spans: text ? [{ text, marks: [] }] : [],
});
const at = (block: number, offset = 0): Selection => caret({ block, offset });
const labels = { title: "Sumário", empty: "Nenhuma entrada de sumário encontrada." };

/** Aplica os comandos como o núcleo faria (inserir, remover, atributos). */
function apply(d: DocView, command: TextCommand | null): DocView {
  const blocks = d.blocks.map((b) => ({ ...b, attrs: { ...b.attrs } }));
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
      default:
        throw new Error(`comando não simulado: ${c.type}`);
    }
  };
  if (command) run(command);
  return { ...d, blocks };
}

const text = (b: BlockView) => b.spans.map((s) => s.text).join("");
const summary = (d: DocView) => d.blocks.map((b) => `${b.attrs.toc ? `[${b.attrs.toc.level}:${b.attrs.toc.page}] ` : ""}${text(b)}`);

const tcc = () =>
  doc(
    p(""),
    p("Introdução", "heading1"),
    p("texto"),
    p("Objetivos", "heading2"),
    p("Detalhe", "heading4"),
    p("Conclusão", "heading1"),
  );

describe("sumário", () => {
  it("lista os títulos 1 a 3, sem tabelas nem o próprio sumário", () => {
    expect(tocItems(tcc().blocks).map((i) => [i.level, i.text])).toEqual([
      [1, "Introdução"],
      [2, "Objetivos"],
      [1, "Conclusão"],
    ]);
  });

  it("insere no cursor com título, entradas e páginas", () => {
    const d = tcc();
    const pages = new Map([[1, 2], [3, 2], [5, 4]]);
    const edit = insertToc(d, at(0), (b) => pages.get(b) ?? 0, labels);
    const after = apply(d, edit.command);
    expect(summary(after).slice(0, 5)).toEqual(["[0:0] Sumário", "[1:2] Introdução", "[2:2] Objetivos", "[1:4] Conclusão", ""]);
    expect(edit.selection.focus.block).toBe(4);
    expect(findToc(after.blocks)).toEqual({ start: 0, end: 4 });
  });

  it("sem títulos, mostra a mensagem do Word", () => {
    const d = doc(p("só texto"));
    const after = apply(d, insertToc(d, at(0, 3), () => 1, labels).command);
    expect(summary(after)).toEqual(["só texto", "[0:0] Sumário", `[1:0] ${labels.empty}`, ""]);
  });

  it("atualiza com os títulos e as páginas atuais, mantendo o título do sumário", () => {
    const d = apply(tcc(), insertToc(tcc(), at(0), () => 1, labels).command);
    // Um título novo depois do sumário e um renomeado.
    const changed = doc(...d.blocks.slice(0, 4), p("Metodologia", "heading1"), ...d.blocks.slice(4));
    const edit = updateToc(changed, at(6, 2), (b) => b, labels)!;
    const after = apply(changed, edit.command);
    expect(summary(after).slice(0, 6)).toEqual(["[0:0] Sumário", "[1:4] Metodologia", "[1:6] Introdução", "[2:8] Objetivos", "[1:10] Conclusão", "Metodologia"]);
    // O cursor que estava depois do sumário anda junto com o texto.
    expect(edit.selection.focus).toEqual({ block: 7, offset: 2 });
    expect(text(after.blocks[7])).toBe("Introdução");
  });

  it("insere de novo quando já há sumário: atualiza o existente", () => {
    const d = apply(tcc(), insertToc(tcc(), at(0), () => 1, labels).command);
    const again = apply(d, insertToc(d, at(6), () => 3, labels).command);
    expect(again.blocks.filter((b) => b.attrs.toc).length).toBe(4);
  });

  it("liga cada entrada ao título pelo texto, mesmo desatualizado", () => {
    const d = doc(
      p("Sumário", "paragraph", { level: 0, page: 0 }),
      p("Introdução", "paragraph", { level: 1, page: 1 }),
      p("Removido", "paragraph", { level: 1, page: 1 }),
      p("Conclusão", "paragraph", { level: 1, page: 1 }),
      p("Introdução", "heading1"),
      p("Conclusão", "heading1"),
    );
    expect([...tocTargets(d.blocks)]).toEqual([
      [1, 4],
      [3, 5],
    ]);
  });

  it("remove o sumário inteiro", () => {
    const d = apply(tcc(), insertToc(tcc(), at(0), () => 1, labels).command);
    const after = apply(d, removeToc(d, at(2))!.command);
    expect(summary(after)).toEqual(summary(tcc()));
  });
});
