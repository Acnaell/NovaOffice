import { describe, expect, it } from "vitest";
import { addComment, commentAt, commentOrder, commentRanges, commentTarget, deleteComment, initialsOf, nextComment, nowIso, repliesOf } from "./comments";
import { DEFAULT_ATTRS } from "./formatting";
import { caret } from "./model";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, type BlockView, type Comment, type DocView, type Span } from "./types";

const t = (text: string): Span => ({ text, marks: [] });
const c = (text: string, id: string): Span => ({ text, marks: [{ mark: "comment", id }] });
const p = (...spans: Span[]): BlockView => ({ style: "paragraph", attrs: { ...DEFAULT_ATTRS }, spans });
const cm = (text: string, extra: Partial<Comment> = {}): Comment => ({ author: "Ana", initials: "A", date: "2026-10-30T10:00:00Z", text, done: false, ...extra });
const doc = (blocks: BlockView[], comments: Record<string, Comment> = {}): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, footnotes: {}, comments });

describe("comentários", () => {
  it("acha os trechos, mesmo atravessando parágrafos", () => {
    const d = doc([p(t("ab"), c("cd", "x")), p(c("ef", "x"), t("g"))], { x: cm("oi") });
    expect(commentRanges(d.blocks, "x")).toEqual([
      { block: 0, offset: 2, len: 2 },
      { block: 1, offset: 0, len: 2 },
    ]);
    expect(commentAt(d, { block: 0, offset: 3 })).toBe("x");
    expect(commentAt(d, { block: 1, offset: 2 })).toBe("x");
    expect(commentAt(d, { block: 0, offset: 1 })).toBeNull();
  });

  it("ordena pelo texto e ignora respostas e comentários apagados", () => {
    const d = doc([p(c("a", "z"), t(" "), c("b", "y"), c("c", "gone"))], { y: cm("1"), z: cm("2"), r: cm("3", { parent: "z" }) });
    expect(commentOrder(d.blocks, d.comments)).toEqual(["z", "y"]);
    expect(repliesOf(d.comments, "z").map(([id]) => id)).toEqual(["r"]);
  });

  it("sem seleção, comenta a palavra do cursor", () => {
    const d = doc([p(t("uma frase curta"))]);
    expect(commentTarget(d, caret({ block: 0, offset: 6 }))).toEqual({ anchor: { block: 0, offset: 4 }, focus: { block: 0, offset: 9 } });
    expect(commentTarget(d, caret({ block: 0, offset: 15 }))).toEqual({ anchor: { block: 0, offset: 10 }, focus: { block: 0, offset: 15 } });
    expect(commentTarget(doc([p()]), caret({ block: 0, offset: 0 }))).toBeNull();
  });

  it("criar e excluir são um passo de desfazer cada", () => {
    const d = doc([p(t("abc")), p(t("def"))]);
    const add = addComment(d, { anchor: { block: 0, offset: 1 }, focus: { block: 1, offset: 2 } }, "k", cm("oi"));
    expect(add?.command).toEqual({
      type: "batch",
      commands: [
        { type: "text.applyMark", block: 0, offset: 1, len: 2, mark: { mark: "comment", id: "k" } },
        { type: "text.applyMark", block: 1, offset: 0, len: 2, mark: { mark: "comment", id: "k" } },
        { type: "comment.set", id: "k", value: cm("oi") },
      ],
    });
    const withIt = doc([p(t("a"), c("bc", "k"))], { k: cm("oi"), r: cm("re", { parent: "k" }) });
    expect(deleteComment(withIt, caret({ block: 0, offset: 0 }), "k").command).toEqual({
      type: "batch",
      commands: [
        { type: "text.removeMark", block: 0, offset: 1, len: 2, kind: "comment" },
        { type: "comment.set", id: "r", value: null },
        { type: "comment.set", id: "k", value: null },
      ],
    });
  });

  it("Anterior e Próximo andam pelos trechos", () => {
    const d = doc([p(t("ab"), c("c", "x"), t("d")), p(c("e", "y"))], { x: cm("1"), y: cm("2") });
    expect(nextComment(d, caret({ block: 0, offset: 0 }))?.id).toBe("x");
    expect(nextComment(d, caret({ block: 0, offset: 2 }))?.id).toBe("y");
    expect(nextComment(d, caret({ block: 1, offset: 0 }))).toBeNull();
    expect(nextComment(d, caret({ block: 1, offset: 0 }), true)?.id).toBe("x");
  });

  it("iniciais e data", () => {
    expect(initialsOf("ana maria souza lima")).toBe("AMS");
    expect(nowIso(new Date(Date.UTC(2026, 9, 30, 14, 45, 7, 123)))).toBe("2026-10-30T14:45:07Z");
  });
});
