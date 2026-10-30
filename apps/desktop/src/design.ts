// Aba Design: cor da página, marca d'água e bordas da página. Contas e CSS
// comuns à tela (folhas do Editor) e à impressão/PDF; os desenhos ficam em
// pagedesign.tsx e os botões em DesignTab.tsx.

import type { CSSProperties } from "react";
import { isDark } from "./formatting";
import type { PageBorder, PageSetup, Watermark } from "./types";

/** Marcas d'água prontas da galeria, como no Word (cada uma na diagonal e na horizontal). */
export const WATERMARK_PRESETS: { group: "confidential" | "disclaimers"; text: string }[] = [
  { group: "confidential", text: "CONFIDENCIAL" },
  { group: "confidential", text: "NÃO COPIE" },
  { group: "disclaimers", text: "RASCUNHO" },
];

/** Prata semitransparente na diagonal, o padrão do Word. */
export const DEFAULT_WATERMARK: Watermark = { text: "CONFIDENCIAL", color: "#C0C0C0", semitransparent: true, layout: "diagonal" };

/** Mesmo limite do núcleo (`MAX_WATERMARK_CHARS`). */
export const MAX_WATERMARK_CHARS = 200;

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function validWatermark(w: Watermark): boolean {
  const length = [...w.text.trim()].length;
  // eslint-disable-next-line no-control-regex
  return length >= 1 && length <= MAX_WATERMARK_CHARS && !/[\u0000-\u001F\u007F-\u009F]/.test(w.text) && HEX.test(w.color);
}

/** Espessuras do Word, em oitavos de ponto: ¼, ½, ¾, 1, 1½, 2¼, 3, 4½ e 6 pt. */
export const BORDER_WIDTHS = [2, 4, 6, 8, 12, 18, 24, 36, 48];

export const DEFAULT_BORDER: PageBorder = { style: "single", color: "#000000", width: 4 };

/** Distância da borda à beira do papel, em pt (o padrão do Word). */
export const BORDER_SPACE_PT = 24;

const FRACTIONS: Record<number, string> = { 2: "¼", 4: "½", 6: "¾" };

/** "½ pt", "1 ½ pt", "2 ¼ pt"… como na lista Largura do Word. */
export function borderWidthLabel(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const rest = FRACTIONS[eighths % 8] ?? "";
  return `${[whole || "", rest].filter(Boolean).join(" ")} pt`;
}

/**
 * Tamanho da caixa da marca d'água, em pt. É a mesma conta do núcleo
 * (`watermark_size` em nova-app/src/design.rs), para a tela, a impressão e o
 * arquivo terem a mesma proporção: as letras esticam até a caixa, como no Word.
 */
export function watermarkSize(w: Watermark, page: PageSetup): { width: number; height: number } {
  const textW = Math.max(0, page.width - page.marginLeft - page.marginRight) / 20;
  const textH = Math.max(0, page.height - page.marginTop - page.marginBottom) / 20;
  const chars = Math.min(Math.max([...w.text].length, 1), MAX_WATERMARK_CHARS);
  const width = w.layout === "diagonal" ? Math.min(Math.hypot(textW, textH) * 0.65, textH) : textW;
  const height = Math.min(width / (chars * 0.55), width / 2, textH / 3);
  return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
}

/** Cor do papel nas folhas (e no fundo do pontilhado do sumário), com o texto legível sobre ela. */
export function paperStyle(page: PageSetup): CSSProperties {
  if (!page.background) return {};
  return { "--page-bg": page.background, "--page-text": isDark(page.background) ? "#f2f2f2" : "#1d1d1b" } as CSSProperties;
}

/** Traço da borda: dupla é linha, espaço, linha (3× a espessura); sombra é deslocada para baixo e à direita. */
export function borderStyle(border: PageBorder): CSSProperties {
  const line = border.width / 8;
  const shadow = Math.max(line * 2, 1.5);
  return {
    borderStyle: border.style === "double" ? "double" : "solid",
    borderWidth: `${border.style === "double" ? Math.max(line * 3, 2.25) : line}pt`,
    borderColor: border.color,
    boxShadow: border.style === "shadow" ? `${shadow}pt ${shadow}pt 0 0 ${border.color}` : undefined,
  };
}

/** Caixas de margem do @page, nos lados do papel em que cada uma fica (cantos em dois). */
const MARGIN_BOXES: [string, ("top" | "bottom" | "left" | "right")[]][] = [
  ["top-left-corner", ["top", "left"]],
  ["top-left", ["top"]],
  ["top-center", ["top"]],
  ["top-right", ["top"]],
  ["top-right-corner", ["top", "right"]],
  ["right-top", ["right"]],
  ["right-middle", ["right"]],
  ["right-bottom", ["right"]],
  ["bottom-right-corner", ["bottom", "right"]],
  ["bottom-right", ["bottom"]],
  ["bottom-center", ["bottom"]],
  ["bottom-left", ["bottom"]],
  ["bottom-left-corner", ["bottom", "left"]],
  ["left-bottom", ["left"]],
  ["left-middle", ["left"]],
  ["left-top", ["left"]],
];

/**
 * Linhas da borda dentro de uma caixa de margem, como camadas de fundo: (distância
 * da beira do papel, espessura) em pt. Dupla: duas linhas com um espaço igual
 * entre elas; sombra: uma faixa a mais para fora, embaixo e à direita.
 */
function borderLines(border: PageBorder, side: "top" | "bottom" | "left" | "right"): [number, number][] {
  const line = border.width / 8;
  const lines: [number, number][] = [[BORDER_SPACE_PT, line]];
  if (border.style === "double") lines.push([BORDER_SPACE_PT + line * 2, line]);
  const shadow = Math.max(line * 2, 1.5);
  if (border.style === "shadow" && (side === "bottom" || side === "right")) lines.push([BORDER_SPACE_PT - shadow, shadow]);
  return lines;
}

/** Camadas de uma caixa: linhas inteiras nos lados; nos cantos, só a partir da borda. */
function boxLayers(border: PageBorder, name: string, sides: ("top" | "bottom" | "left" | "right")[]): string[] {
  const corner = sides.length === 2;
  const S = BORDER_SPACE_PT;
  const layers: string[] = [];
  for (const side of sides) {
    for (const [d, t] of borderLines(border, side)) {
      const fill = `linear-gradient(${border.color}, ${border.color})`;
      if (side === "top" || side === "bottom") {
        // Linha horizontal; no canto, começa (ou termina) onde a borda vertical está.
        const from = !corner ? "left 0" : name.endsWith("left-corner") ? `left ${S}pt` : "left 0";
        const len = corner ? `calc(100% - ${S}pt)` : "100%";
        layers.push(`${fill} ${from} ${side} ${d}pt / ${len} ${t}pt no-repeat`);
      } else {
        const from = !corner ? "top 0" : name.startsWith("top") ? `top ${S}pt` : "top 0";
        const len = corner ? `calc(100% - ${S}pt)` : "100%";
        layers.push(`${fill} ${side} ${d}pt ${from} / ${t}pt ${len} no-repeat`);
      }
    }
  }
  return layers;
}

/**
 * Cor e borda da página na impressão, nas caixas de margem do @page (vão antes
 * das do cabeçalho e rodapé, que trocam só o `content`). O Chromium não pinta o
 * fundo do próprio @page quando ele tem borda ou contorno, nem deixa uma camada
 * fixa sair da área de texto; as caixas de margem cobrem a margem inteira.
 */
export function printMarginBoxes(page: PageSetup): string {
  if (!page.background && !page.border) return "";
  const exact = "-webkit-print-color-adjust: exact; print-color-adjust: exact;";
  return MARGIN_BOXES.map(([name, sides]) => {
    const layers = page.border ? boxLayers(page.border, name, sides) : [];
    const background = [...layers, page.background ?? "transparent"].join(", ");
    return `@${name} { content: ""; background: ${background}; ${exact} }`;
  }).join(" ");
}

/**
 * CSS de impressão da aba Design para a área de texto: a cor pinta o fundo (com
 * `print-color-adjust: exact`, senão o navegador a omite) e os fundos brancos da
 * janela ficam transparentes para a marca d'água, que fica atrás do texto.
 */
export function printDesignCss(page: PageSetup, watermark: Watermark | null | undefined): string {
  if (!page.background && !page.border && !watermark) return "";
  const exact = "-webkit-print-color-adjust: exact; print-color-adjust: exact;";
  return ` @media print { html { background: ${page.background ?? "#fff"} !important; ${exact} } body, #root, .app, .workspace, .scroller { background: transparent !important; } }`;
}
