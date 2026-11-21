import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { caret } from "./model";
import { spellText } from "./spell";
import { nextRevision, resolveCommands, resolveEdit, revisions, revisionsIn, trackedCommand, trackedSelection } from "./tracking";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, type BlockView, type DocView, type Span, type TextCommand } from "./types";

const t = (text: string): Span => ({ text, marks: [] });
const ins = (text: string, author = "Ana", date = "d1"): Span => ({ text, marks: [{ mark: "ins", author, date }] });
const del = (text: string, author = "Ana", date = "d1"): Span => ({ text, marks: [{ mark: "del", author, date }] });
const p = (...spans: Span[]): BlockView => ({ style: "paragraph", attrs: { ...DEFAULT_ATTRS }, spans });
const doc = (...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, footnotes: {}, comments: {}, tracking: true });

describe("Controlar Alterações", () => {
  it("embrulha só as edições de texto", () => {
    const insert: TextCommand = { type: "text.insert", block: 0, offset: 1, text: "x" };
    expect(trackedCommand(insert, "Ana", "d")).toEqual({ type: "tracked", author: "Ana", date: "d", commands: [insert] });
    const commands: TextCommand[] = [{ type: "text.deleteRange", from: { block: 0, offset: 0 }, to: { block: 0, offset: 2 } }, insert];
    expect(trackedCommand({ type: "batch", commands }, "Ana", "d")).toEqual({ type: "tracked", author: "Ana", date: "d", commands });
    const style: TextCommand = { type: "block.setStyle", block: 0, style: "heading1" };
    expect(trackedCommand(style, "Ana", "d")).toBe(style);
    expect(trackedCommand({ type: "history.undo" }, "Ana", "d")).toEqual({ type: "history.undo" });
  });

  it("junta trechos vizinhos da mesma alteração e acha a do cursor", () => {
    const d = doc(p(t("ab"), del("cd"), ins("ef"), ins("g", "Bia")), p(ins("h")));
    const list = revisions(d.blocks);
    expect(list.map((r) => [r.block, r.offset, r.len, r.insert, r.author])).toEqual([
      [0, 2, 2, false, "Ana"],
      [0, 4, 2, true, "Ana"],
      [0, 6, 1, true, "Bia"],
      [1, 0, 1, true, "Ana"],
    ]);
    expect(revisionsIn(list, caret({ block: 0, offset: 3 })).length).toBe(1);
    expect(revisionsIn(list, { anchor: { block: 0, offset: 3 }, focus: { block: 0, offset: 7 } }).length).toBe(3);
  });

  it("aceitar e rejeitar viram comandos comuns, de trás para a frente", () => {
    const list = revisions(doc(p(t("a"), ins("bc"), del("d"))).blocks);
    expect(resolveCommands(list, true)).toEqual([
      { type: "text.delete", block: 0, offset: 3, len: 1 },
      { type: "text.removeMark", block: 0, offset: 1, len: 2, kind: "ins" },
    ]);
    expect(resolveCommands(list, false)).toEqual([
      { type: "text.removeMark", block: 0, offset: 3, len: 1, kind: "del" },
      { type: "text.delete", block: 0, offset: 1, len: 2 },
    ]);
    const all = resolveEdit(doc(p(t("a"), ins("bc"))), caret({ block: 0, offset: 0 }), true, { all: true });
    expect(all?.untracked).toBe(true);
  });

  it("Anterior e Próxima selecionam a alteração", () => {
    const list = revisions(doc(p(t("ab"), ins("c"), t("d"), del("e"))).blocks);
    expect(nextRevision(list, caret({ block: 0, offset: 0 }))?.offset).toBe(2);
    expect(nextRevision(list, { anchor: { block: 0, offset: 2 }, focus: { block: 0, offset: 3 } })?.offset).toBe(4);
    expect(nextRevision(list, caret({ block: 0, offset: 5 }))).toBeNull();
    expect(nextRevision(list, caret({ block: 0, offset: 5 }), true)?.offset).toBe(4);
  });

  it("o cursor vai para depois do texto inserido", () => {
    expect(trackedSelection([{ type: "markApplied" }, { type: "textInserted", block: 2, offset: 9, len: 1 }], caret({ block: 2, offset: 5 }))).toEqual(caret({ block: 2, offset: 10 }));
    expect(trackedSelection([{ type: "blockSplit", block: 0, offset: 1 }], caret({ block: 1, offset: 0 }))).toEqual(caret({ block: 1, offset: 0 }));
  });

  it("o corretor não vê o texto excluído", () => {
    expect(spellText(p(t("em "), del("três"), ins("quatro")))).toBe("em     quatro");
  });
});
