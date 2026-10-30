import { describe, expect, it } from "vitest";
import { borderStyle, borderWidthLabel, BORDER_WIDTHS, DEFAULT_WATERMARK, paperStyle, printDesignCss, validWatermark, watermarkSize } from "./design";
import { applyPatch, DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, type DocView, type ViewPatch } from "./types";

describe("aba Design", () => {
  it("valida a marca d'água como o núcleo", () => {
    expect(validWatermark(DEFAULT_WATERMARK)).toBe(true);
    expect(validWatermark({ ...DEFAULT_WATERMARK, text: "  " })).toBe(false);
    expect(validWatermark({ ...DEFAULT_WATERMARK, text: "a\nb" })).toBe(false);
    expect(validWatermark({ ...DEFAULT_WATERMARK, text: "x".repeat(201) })).toBe(false);
    expect(validWatermark({ ...DEFAULT_WATERMARK, color: "silver" })).toBe(false);
  });

  it("caixa da marca d'água igual à do núcleo (A4, margens de 2,5 cm)", () => {
    // Mesmos números de watermark_size em nova-app/src/design.rs.
    const diagonal = watermarkSize(DEFAULT_WATERMARK, DEFAULT_PAGE);
    expect(diagonal.width).toBeCloseTo(542.29, 2);
    expect(diagonal.height).toBeCloseTo(82.16, 2);
    const horizontal = watermarkSize({ ...DEFAULT_WATERMARK, layout: "horizontal", text: "RASCUNHO" }, DEFAULT_PAGE);
    expect(horizontal.width).toBeCloseTo(453.6, 2);
    expect(horizontal.height).toBeCloseTo(103.09, 2);
  });

  it("larguras da borda com os nomes do Word", () => {
    expect(BORDER_WIDTHS.map(borderWidthLabel)).toEqual(["¼ pt", "½ pt", "¾ pt", "1 pt", "1 ½ pt", "2 ¼ pt", "3 pt", "4 ½ pt", "6 pt"]);
    expect(borderStyle({ style: "double", color: "#2F5496", width: 4 })).toMatchObject({ borderStyle: "double", borderWidth: "2.25pt" });
    expect(borderStyle({ style: "shadow", color: "#000000", width: 8 }).boxShadow).toBe("2pt 2pt 0 0 #000000");
  });

  it("cor da página e texto legível sobre ela", () => {
    expect(paperStyle(DEFAULT_PAGE)).toEqual({});
    expect(paperStyle({ ...DEFAULT_PAGE, background: "#FFF2CC" })).toEqual({ "--page-bg": "#FFF2CC", "--page-text": "#1d1d1b" });
    expect(paperStyle({ ...DEFAULT_PAGE, background: "#002060" })).toMatchObject({ "--page-text": "#f2f2f2" });
  });

  it("impressão: cor exata no papel e fundos da janela transparentes", () => {
    expect(printDesignCss(DEFAULT_PAGE, null)).toBe("");
    const css = printDesignCss({ ...DEFAULT_PAGE, background: "#DDEBF7" }, null);
    expect(css).toContain("html { background: #DDEBF7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;");
    expect(printDesignCss(DEFAULT_PAGE, DEFAULT_WATERMARK)).toContain("background: #fff");
  });

  it("o remendo da visão traz e tira a marca d'água", () => {
    const view: DocView = { blocks: [], canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, watermark: null, footnotes: {}, comments: {} };
    const patch: ViewPatch = { format: null, start: 0, deleteCount: 0, blocks: [], blockCount: 0, canUndo: true, canRedo: false, path: null, title: "t", dirty: true };
    expect(applyPatch(view, { ...patch, watermark: DEFAULT_WATERMARK })?.watermark).toEqual(DEFAULT_WATERMARK);
    const on = { ...view, watermark: DEFAULT_WATERMARK };
    expect(applyPatch(on, patch)?.watermark).toEqual(DEFAULT_WATERMARK);
    expect(applyPatch(on, { ...patch, watermark: null })?.watermark).toBeNull();
  });
});
