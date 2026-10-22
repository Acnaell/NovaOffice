// Contar Palavras (Revisão › Contar Palavras, Ctrl+Shift+G), como a caixa do
// Word: páginas, palavras, caracteres com e sem espaços, parágrafos e linhas.
// Com texto selecionado, conta só a seleção (as páginas são sempre do
// documento, da paginação na tela). Linhas vêm do desenho na tela.

import { useEffect, useMemo, useRef } from "react";
import { posToDom } from "./dom";
import { useI18n } from "./i18n";
import { isCollapsed, ordered, type Selection } from "./model";
import type { DocView } from "./types";
import { countedTexts, textStats } from "./wordcount";

interface Props {
  view: DocView;
  selection: Selection;
  /** Páginas do documento, as mesmas da barra de status. */
  pages: number;
  onClose: () => void;
}

export function WordCountDialog({ view, selection, pages, onClose }: Props) {
  const { t, locale } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  const selected = !isCollapsed(selection);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const stats = useMemo(() => {
    const text = textStats(countedTexts(view, selection));
    const root = document.querySelector<HTMLElement>(".page");
    return { ...text, pages, lines: root ? countLines(root, view, selection) : text.paragraphs };
  }, [view, selection, pages]);

  const number = new Intl.NumberFormat(locale);
  const rows: [string, number][] = [
    [t("count.pages"), stats.pages],
    [t("count.words"), stats.words],
    [t("count.charsNoSpaces"), stats.charsNoSpaces],
    [t("count.chars"), stats.chars],
    [t("count.paragraphs"), stats.paragraphs],
    [t("count.lines"), stats.lines],
  ];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal word-count" role="dialog" aria-modal="true" aria-labelledby="word-count-title">
        <h2 id="word-count-title">{t("cmd.review.wordCount")}</h2>
        <div className="word-count-scope">{selected ? t("count.selection") : t("count.document")}</div>
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{number.format(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <button ref={close} className="bs-primary" onClick={onClose}>
            {t("count.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Linhas como aparecem na tela, nos parágrafos com texto (só na seleção, se houver). */
function countLines(root: HTMLElement, view: DocView, selection: Selection): number {
  const [from, to] = isCollapsed(selection)
    ? [
        { block: 0, offset: 0 },
        { block: view.blocks.length - 1, offset: Number.MAX_SAFE_INTEGER },
      ]
    : ordered(selection);
  let lines = 0;
  for (let block = from.block; block <= to.block; block++) {
    const el = root.querySelector<HTMLElement>(`[data-block="${block}"]`);
    if (!el) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const start = block === from.block ? posToDom(root, { block, offset: from.offset }) : null;
    const end = block === to.block && to.offset !== Number.MAX_SAFE_INTEGER ? posToDom(root, { block, offset: to.offset }) : null;
    if (start) range.setStart(start[0], start[1]);
    if (end) range.setEnd(end[0], end[1]);
    if (!range.toString().trim()) continue;
    // Retângulos de texto em ordem; uma linha nova começa abaixo do fim da anterior.
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top);
    let bottom = -Infinity;
    for (const r of rects) {
      if (r.top >= bottom - 1) {
        lines++;
        bottom = r.bottom;
      } else {
        bottom = Math.max(bottom, r.bottom);
      }
    }
  }
  return lines;
}
