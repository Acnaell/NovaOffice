// Desenho da aba Design: borda e marca d'água em cada folha na tela e, na
// impressão/PDF, numa camada fixa que o navegador repete em todas as páginas.

import { createPortal } from "react-dom";
import { BORDER_SPACE_PT, borderStyle, watermarkSize } from "./design";
import type { PageSetup, Watermark } from "./types";

/** Texto esticado até a caixa (como o `fitshape` do Word), girado 45° na diagonal. */
export function WatermarkText({ value, page }: { value: Watermark; page: PageSetup }) {
  const { width, height } = watermarkSize(value, page);
  return (
    <svg
      className="watermark-text"
      width={`${width}pt`}
      height={`${height}pt`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ transform: `translate(-50%, -50%)${value.layout === "diagonal" ? " rotate(-45deg)" : ""}` }}
      aria-hidden="true"
    >
      {/* Maiúsculas da Calibri têm ~0,64 em: a fonte de 1,47× a altura enche a caixa. */}
      <text
        x="0"
        y={height * 0.96}
        fontSize={height * 1.47}
        textLength={width}
        lengthAdjust="spacingAndGlyphs"
        fill={value.color}
        fillOpacity={value.semitransparent ? 0.5 : 1}
      >
        {value.text}
      </text>
    </svg>
  );
}

/** Borda e marca d'água de uma folha na tela, atrás do texto. */
export function SheetDesign({ page, watermark }: { page: PageSetup; watermark: Watermark | null | undefined }) {
  if (!page.border && !watermark) return null;
  const pt = (twips: number) => `${twips / 20}pt`;
  return (
    <>
      {page.border && <div className="sheet-border" style={{ inset: `${BORDER_SPACE_PT}pt`, ...borderStyle(page.border) }} />}
      {watermark && (
        <div
          className="sheet-watermark"
          style={{
            left: pt(page.marginLeft + (page.width - page.marginLeft - page.marginRight) / 2),
            top: pt(page.marginTop + (page.height - page.marginTop - page.marginBottom) / 2),
          }}
        >
          <WatermarkText value={watermark} page={page} />
        </div>
      )}
    </>
  );
}

/**
 * Na impressão, elementos `position: fixed` se repetem em cada página, no
 * centro da área de texto (dentro das margens do @page): a marca d'água fica
 * aí. A cor e a borda vão nas caixas de margem (`printMarginBoxes`).
 */
export function PrintDesign({ page, watermark }: { page: PageSetup; watermark: Watermark | null | undefined }) {
  if (!watermark) return null;
  return createPortal(
    <div className="print-design" aria-hidden="true">
      <div className="print-watermark">
        <WatermarkText value={watermark} page={page} />
      </div>
    </div>,
    document.body,
  );
}
