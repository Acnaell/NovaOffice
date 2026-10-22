import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { insertImage, resizeImage } from "./images";
import { caret, deleteBackward, deleteForward } from "./model";
import type { BlockView, DocView, ImageRef } from "./types";
import { DEFAULT_PAGE } from "./types";

const doc = (...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE });
const p = (text: string, attrs: Partial<BlockView["attrs"]> = {}): BlockView => ({
  style: "paragraph",
  attrs: { ...DEFAULT_ATTRS, ...attrs },
  spans: text ? [{ text, marks: [] }] : [],
});
const image: ImageRef = { id: "m1", width: 300, height: 150 };

describe("imagens", () => {
  it("entra no parágrafo vazio ou num parágrafo novo depois do cursor", () => {
    expect(insertImage(doc(p("")), caret({ block: 0, offset: 0 }), image)).toEqual({
      command: { type: "block.setAttr", block: 0, attr: "image", value: image },
      selection: caret({ block: 0, offset: 0 }),
    });
    expect(insertImage(doc(p("texto")), caret({ block: 0, offset: 2 }), image).command).toEqual({
      type: "batch",
      commands: [
        { type: "block.insert", index: 1, text: "" },
        { type: "block.setAttr", block: 1, attr: "image", value: image },
      ],
    });
  });

  it("muda o tamanho mantendo a proporção", () => {
    expect(resizeImage(image, 150)).toEqual({ id: "m1", width: 150, height: 75 });
    expect(resizeImage(image, 1).width).toBe(8);
  });

  it("Backspace no começo e Delete antes da imagem apagam a imagem", () => {
    const d = doc(p("antes"), p("", { image }));
    expect(deleteBackward(d, caret({ block: 1, offset: 0 })).command).toEqual({ type: "block.setAttr", block: 1, attr: "image", value: null });
    expect(deleteForward(d, caret({ block: 0, offset: 5 })).command).toEqual({ type: "block.setAttr", block: 1, attr: "image", value: null });
  });
});
