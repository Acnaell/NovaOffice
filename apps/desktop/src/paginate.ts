// Páginas na tela. O texto continua num único elemento editável; depois de
// cada desenho, cada parágrafo (ou tabela) que passaria do fim da área de texto
// de uma página é empurrado para o começo da seguinte, com uma margem extra.
// As folhas brancas são desenhadas atrás, uma por página. Assim cursor,
// seleção e digitação continuam iguais, e só a posição vertical muda.
//
// Parágrafos maiores que uma página inteira não são divididos (ficam como estão).

export interface Geometry {
  /** Altura do papel, intervalo entre folhas e margens de cima e de baixo, em px. */
  pageHeight: number;
  gap: number;
  marginTop: number;
  marginBottom: number;
}

export interface PageInfo {
  pages: number;
  /** Página (a partir de 1) do parágrafo do cursor. */
  current: number;
}

const PUSHED = "pushed";

/** Desfaz os empurrões da paginação anterior (para medir de novo ou imprimir). */
export function unpaginate(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`[data-${PUSHED}]`).forEach((el) => {
    el.style.marginTop = el.dataset.mt ?? "";
    delete el.dataset.pushed;
    delete el.dataset.mt;
  });
}

export function paginate(root: HTMLElement, g: Geometry, caretBlock: number): PageInfo {
  unpaginate(root);
  const stride = g.pageHeight + g.gap;
  const start = (k: number) => k * stride + g.marginTop;
  const end = (k: number) => k * stride + g.pageHeight - g.marginBottom;
  const content = g.pageHeight - g.marginTop - g.marginBottom;

  const units = Array.from(root.children) as HTMLElement[];
  // Mede tudo de uma vez (um único cálculo de layout) e só depois escreve.
  const tops = units.map((u) => u.offsetTop);
  const heights = units.map((u) => u.offsetHeight);

  const writes: [HTMLElement, number][] = [];
  let shift = 0;
  let page = 0;
  let current = 1;
  let lastBottom = g.marginTop;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    let top = tops[i] + shift;
    const height = heights[i];
    page = Math.max(page, Math.floor(top / stride));
    const atPageStart = top <= start(page) + 1;
    const forced = i > 0 && unit.classList.contains("page-break") && !atPageStart;
    const inGap = top > end(page);
    const overflows = top + height > end(page) + 0.5 && height <= content && !atPageStart;
    if (forced || inGap || overflows) {
      const target = start(page + 1);
      const delta = target - top;
      // Espaço que já havia acima (com margens colapsadas) mais o empurrão.
      const prevBottom = i === 0 ? g.marginTop : tops[i - 1] + heights[i - 1];
      writes.push([unit, tops[i] - prevBottom + delta]);
      shift += delta;
      top = target;
      page += 1;
    }
    lastBottom = top + height;
    const holds =
      unit.dataset.block === String(caretBlock) || !!unit.querySelector(`[data-block="${caretBlock}"]`);
    if (holds) current = page + 1;
  }
  for (const [unit, margin] of writes) {
    unit.dataset.mt = unit.style.marginTop;
    unit.dataset.pushed = "1";
    unit.style.marginTop = `${margin}px`;
  }
  const pages = Math.max(1, Math.floor(Math.max(lastBottom - 1, 0) / stride) + 1);
  root.style.minHeight = `${pages * stride - g.gap}px`;
  // Para quem precisa saber a página de um parágrafo (Sumário).
  root.dataset.stride = String(stride);
  return { pages, current };
}
