import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE, type BlockView, type DocView } from "./types";
import { clampZoom, currentHeading, fitPage, fitWidth, headings, rulerTicks, stepZoom, twipsToPx } from "./zoom";

const block = (style: string, text: string, cell = false): BlockView =>
  ({ style, spans: [{ text, marks: [] }], attrs: { cell: cell ? { table: "t", row: 0, col: 0 } : null } }) as unknown as BlockView;
const doc = (blocks: BlockView[]) => ({ blocks, page: DEFAULT_PAGE }) as unknown as DocView;

describe("zoom", () => {
  it("−/+ de 10 em 10%, entre 10% e 500%", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.75, 1)).toBe(0.8);
    expect(stepZoom(0.75, -1)).toBe(0.7);
    expect(stepZoom(0.1, -1)).toBe(0.1);
    expect(stepZoom(5, 1)).toBe(5);
    expect(clampZoom(0.333)).toBe(0.33);
  });

  it("Uma Página e Largura da Página cabem na janela", () => {
    // A4: 794 × 1123 px a 100%.
    const a4 = DEFAULT_PAGE;
    expect(Math.round(twipsToPx(a4.width))).toBe(794);
    const wide = { width: 1200, height: 700 };
    const page = fitPage(a4, wide);
    expect(twipsToPx(a4.height) * page).toBeLessThanOrEqual(700);
    expect(twipsToPx(a4.height) * (page + 0.01)).toBeGreaterThan(700);
    const width = fitWidth(a4, wide);
    expect(twipsToPx(a4.width) * width).toBeLessThanOrEqual(1200);
    expect(width).toBeGreaterThan(1.4);
  });
});

describe("Painel de Navegação", () => {
  const view = doc([
    block("heading1", "Introdução"),
    block("paragraph", "texto"),
    block("heading2", "  Objetivos   gerais "),
    block("heading3", ""),
    block("heading2", "Na tabela", true),
    block("heading4", "Fundo demais"),
    block("heading3", "Detalhe"),
  ]);

  it("lista Título 1 a 3, sem vazios nem células", () => {
    expect(headings(view)).toEqual([
      { block: 0, level: 1, text: "Introdução" },
      { block: 2, level: 2, text: "Objetivos gerais" },
      { block: 6, level: 3, text: "Detalhe" },
    ]);
  });

  it("marca a seção do cursor", () => {
    const list = headings(view);
    expect(currentHeading(list, 1)).toBe(0);
    expect(currentHeading(list, 2)).toBe(2);
    expect(currentHeading(list, 5)).toBe(2);
    expect(currentHeading([], 3)).toBe(null);
    expect(currentHeading(headings(doc([block("paragraph", "a"), block("heading1", "b")])), 0)).toBe(null);
  });
});

describe("régua", () => {
  it("centímetros contados a partir da margem esquerda", () => {
    const page = { ...DEFAULT_PAGE, marginLeft: 1701 }; // 3 cm
    const ticks = rulerTicks(page);
    const origin = twipsToPx(1701);
    const zero = ticks.find((t) => Math.abs(t.x - origin) < 0.01);
    expect(zero).toEqual({ x: origin, kind: "cm" });
    const labels = ticks.filter((t) => t.label !== undefined);
    expect(labels.slice(0, 3).map((t) => t.label)).toEqual([3, 2, 1]);
    expect(ticks.every((t) => t.x >= 0 && t.x <= twipsToPx(page.width) + 0.01)).toBe(true);
    // A4 tem 21 cm: depois da margem de 3 cm, o último número é 18.
    expect(labels.at(-1)!.label).toBe(18);
  });
});
