// Aba Layout: tamanhos de papel, margens prontas e orientação, como no Word
// em português (inclui as margens da ABNT, comuns em trabalhos acadêmicos).

import type { PageSetup } from "./types";

/** Centímetros → twips. */
export const cm = (value: number) => Math.round((value / 2.54) * 1440);
export const toCm = (twips: number) => Math.round((twips / 1440) * 2.54 * 100) / 100;

export interface PaperSize {
  id: string;
  width: number;
  height: number;
}

/** Retrato; a orientação troca largura e altura. */
export const PAPER_SIZES: PaperSize[] = [
  { id: "a4", width: 11906, height: 16838 },
  { id: "letter", width: 12240, height: 15840 },
  { id: "legal", width: 12240, height: 20160 },
  { id: "a5", width: 8391, height: 11906 },
  { id: "a3", width: 16838, height: 23811 },
];

export interface MarginPreset {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const MARGIN_PRESETS: MarginPreset[] = [
  { id: "normal", top: cm(2.5), bottom: cm(2.5), left: cm(3), right: cm(3) },
  { id: "abnt", top: cm(3), bottom: cm(2), left: cm(3), right: cm(2) },
  { id: "narrow", top: cm(1.27), bottom: cm(1.27), left: cm(1.27), right: cm(1.27) },
  { id: "moderate", top: cm(2.54), bottom: cm(2.54), left: cm(1.91), right: cm(1.91) },
  { id: "wide", top: cm(2.54), bottom: cm(2.54), left: cm(5.08), right: cm(5.08) },
];

export const isLandscape = (p: PageSetup) => p.width > p.height;

/** Mesma página com outras margens (na paisagem elas não giram, como no Word). */
export function withMargins(p: PageSetup, m: Omit<MarginPreset, "id">): PageSetup {
  return { ...p, marginTop: m.top, marginBottom: m.bottom, marginLeft: m.left, marginRight: m.right };
}

export function withOrientation(p: PageSetup, landscape: boolean): PageSetup {
  if (isLandscape(p) === landscape) return p;
  return { ...p, width: p.height, height: p.width };
}

export function withPaper(p: PageSetup, paper: PaperSize): PageSetup {
  const landscape = isLandscape(p);
  return { ...p, width: landscape ? paper.height : paper.width, height: landscape ? paper.width : paper.height };
}

/** O papel da página, se for um dos conhecidos (com 2 twips de folga). */
export function paperOf(p: PageSetup): PaperSize | undefined {
  const [w, h] = isLandscape(p) ? [p.height, p.width] : [p.width, p.height];
  return PAPER_SIZES.find((s) => Math.abs(s.width - w) <= 2 && Math.abs(s.height - h) <= 2);
}

export function marginsOf(p: PageSetup): MarginPreset | undefined {
  return MARGIN_PRESETS.find(
    (m) =>
      Math.abs(m.top - p.marginTop) <= 2 &&
      Math.abs(m.bottom - p.marginBottom) <= 2 &&
      Math.abs(m.left - p.marginLeft) <= 2 &&
      Math.abs(m.right - p.marginRight) <= 2,
  );
}

/** Margens válidas: pelo menos 1 polegada de texto em cada direção (regra do núcleo). */
export function validPage(p: PageSetup): boolean {
  const values = [p.marginTop, p.marginBottom, p.marginLeft, p.marginRight];
  return values.every((v) => Number.isFinite(v) && v >= 0) && p.marginLeft + p.marginRight + 1440 <= p.width && p.marginTop + p.marginBottom + 1440 <= p.height;
}
