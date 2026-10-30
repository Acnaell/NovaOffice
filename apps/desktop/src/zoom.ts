// Aba Exibir: zoom, régua e Painel de Navegação, sem tocar no documento nem
// na paginação. O zoom é CSS no elemento .paper; as contas ficam aqui.

import type { DocView, PageSetup } from "./types";

/** Limites do Word: de 10% a 500%. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
/** Porcentagens do menu de zoom. */
export const ZOOM_PRESETS = [500, 200, 150, 125, 100, 75, 50, 25];

/** twips (1/1440 pol.) → px de CSS (1/96 pol.), como no Editor. */
export const twipsToPx = (twips: number) => twips / 15;
/** 1 cm em px de CSS. */
export const CM_PX = 96 / 2.54;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

/** −/+ e Ctrl + roda do mouse: de 10 em 10%, parando nos múltiplos de 10. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const percent = Math.round(zoom * 100);
  const next = direction > 0 ? Math.floor(percent / 10) * 10 + 10 : Math.ceil(percent / 10) * 10 - 10;
  return clampZoom(next / 100);
}

/** Área visível para o papel (sem o espaçamento em volta), em px. */
export interface Viewport {
  width: number;
  height: number;
}

/** Largura da Página: o papel ocupa a largura da janela. */
export const fitWidth = (page: PageSetup, view: Viewport) => clampZoom(Math.floor((view.width / twipsToPx(page.width)) * 100) / 100);

/** Uma Página: a folha inteira cabe na janela. */
export const fitPage = (page: PageSetup, view: Viewport) =>
  clampZoom(Math.floor(Math.min(view.width / twipsToPx(page.width), view.height / twipsToPx(page.height)) * 100) / 100);

export interface Heading {
  block: number;
  level: 1 | 2 | 3;
  text: string;
}

const LEVELS: Record<string, 1 | 2 | 3> = { heading1: 1, heading2: 2, heading3: 3 };

/** Títulos 1 a 3 do documento, na ordem, para o Painel de Navegação. */
export function headings(view: DocView): Heading[] {
  const out: Heading[] = [];
  view.blocks.forEach((block, index) => {
    const level = LEVELS[block.style];
    if (!level || block.attrs.cell) return;
    const text = block.spans.map((s) => s.text).join("").replace(/\s+/g, " ").trim();
    if (text) out.push({ block: index, level, text });
  });
  return out;
}

/** O título da seção onde está o cursor (o último antes dele). */
export function currentHeading(list: Heading[], caretBlock: number): number | null {
  let found: number | null = null;
  for (const h of list) {
    if (h.block > caretBlock) break;
    found = h.block;
  }
  return found;
}

export interface Tick {
  /** Distância da borda esquerda do papel, em px sem zoom. */
  x: number;
  kind: "cm" | "half" | "quarter";
  /** Número mostrado nos centímetros inteiros (contado a partir da margem, como no Word). */
  label?: number;
}

/** Marcas da régua: a cada 0,25 cm, com números nos centímetros a partir da margem esquerda. */
export function rulerTicks(page: PageSetup): Tick[] {
  const width = twipsToPx(page.width);
  const origin = twipsToPx(page.marginLeft);
  const ticks: Tick[] = [];
  const first = -Math.floor((origin / CM_PX) * 4);
  for (let q = first; origin + (q * CM_PX) / 4 <= width + 0.01; q++) {
    const x = origin + (q * CM_PX) / 4;
    if (x < -0.01) continue;
    if (q % 4 === 0) ticks.push({ x, kind: "cm", label: q === 0 ? undefined : Math.abs(q / 4) });
    else ticks.push({ x, kind: q % 2 === 0 ? "half" : "quarter" });
  }
  return ticks;
}
