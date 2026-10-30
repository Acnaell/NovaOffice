import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { caret } from "./model";
import { footnoteOrder, insertFootnote, nextFootnote } from "./footnotes";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, FOOTNOTE_CHAR, type BlockView, type DocView, type Span } from "./types";

const ref = (id: string): Span => ({ text: FOOTNOTE_CHAR, marks: [{ mark: "footnote", id }] });
const t = (text: string): Span => ({ text, marks: [] });
const p = (...spans: Span[]): BlockView => ({ style: "paragraph", attrs: { ...DEFAULT_ATTRS }, spans });
const doc = (...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, footnotes: {}, comments: {} });

describe("notas de rodapé", () => {
  it("numera pela ordem da primeira chamada", () => {
    const d = doc(p(t("a"), ref("z"), t("b")), p(ref("y"), t("c"), ref("z")));
    expect(footnoteOrder(d.blocks)).toEqual(["z", "y"]);
  });

  it("insere a chamada no fim da seleção e cria a nota no mesmo passo", () => {
    const edit = insertFootnote({ anchor: { block: 0, offset: 5 }, focus: { block: 0, offset: 2 } }, "k1");
    expect(edit.command).toEqual({
      type: "batch",
      commands: [
        { type: "text.insert", block: 0, offset: 5, text: FOOTNOTE_CHAR, marks: [{ mark: "footnote", id: "k1" }] },
        { type: "footnote.set", id: "k1", text: "" },
      ],
    });
    expect(edit.selection).toEqual(caret({ block: 0, offset: 6 }));
  });

  it("Próxima Nota leva o cursor para depois da chamada seguinte", () => {
    const d = doc(p(t("ab"), ref("a"), t("cd")), p(t("x"), ref("b")));
    expect(nextFootnote(d, caret({ block: 0, offset: 0 }))?.selection).toEqual(caret({ block: 0, offset: 3 }));
    expect(nextFootnote(d, caret({ block: 0, offset: 3 }))?.selection).toEqual(caret({ block: 1, offset: 2 }));
    expect(nextFootnote(d, caret({ block: 1, offset: 2 }))).toBeNull();
    expect(nextFootnote(d, caret({ block: 1, offset: 2 }), true)?.selection).toEqual(caret({ block: 0, offset: 3 }));
  });
});
