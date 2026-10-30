// Notas de rodapé (Referências → Inserir Nota de Rodapé, Ctrl+Alt+F; ADR 0012).
// A chamada é o caractere FOOTNOTE_CHAR com a marca `footnote {id}` no texto;
// o texto da nota fica em `DocView.footnotes`. O número é a ordem das chamadas.
// Na tela, as notas de cada página ficam no pé dela, editáveis ali mesmo.

import { useEffect, useLayoutEffect, useRef } from "react";
import { caret, ordered, type Edit, type Selection } from "./model";
import { FOOTNOTE_CHAR, type BlockView, type DocView, type Mark } from "./types";

/** Id da nota de uma lista de marcas, se houver. */
export function footnoteOf(marks: Mark[]): string | null {
  for (const m of marks) if (m.mark === "footnote") return m.id;
  return null;
}

/** Ids das notas na ordem da primeira chamada no documento (número = posição + 1). */
export function footnoteOrder(blocks: BlockView[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks)
    for (const s of b.spans) {
      const id = footnoteOf(s.marks);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  return out;
}

export function newFootnoteId(): string {
  return `n${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Insere a chamada no cursor (no fim da seleção) e cria a nota vazia: um passo de desfazer. */
export function insertFootnote(sel: Selection, id = newFootnoteId()): Edit {
  const [, end] = ordered(sel);
  const { block, offset } = end;
  return {
    command: {
      type: "batch",
      commands: [
        { type: "text.insert", block, offset, text: FOOTNOTE_CHAR, marks: [{ mark: "footnote", id }] },
        { type: "footnote.set", id, text: "" },
      ],
    },
    selection: caret({ block, offset: offset + 1 }),
  };
}

/** Leva o cursor para logo depois da próxima chamada (ou da anterior, com `back`). */
export function nextFootnote(doc: DocView, sel: Selection, back = false): Edit | null {
  const calls: { block: number; offset: number }[] = [];
  doc.blocks.forEach((b, block) => {
    let offset = 0;
    for (const s of b.spans) {
      if (footnoteOf(s.marks)) for (let i = 0; i < s.text.length; i++) if (s.text[i] === FOOTNOTE_CHAR) calls.push({ block, offset: offset + i });
      offset += s.text.length;
    }
  });
  const { block, offset } = sel.focus;
  const after = (c: { block: number; offset: number }) => c.block > block || (c.block === block && c.offset >= offset);
  const target = back ? calls.filter((c) => !after(c) && !(c.block === block && c.offset + 1 === offset)).pop() : calls.find(after);
  if (!target) return null;
  return { command: null, selection: caret({ block: target.block, offset: target.offset + 1 }) };
}

/** Texto com as quebras de linha da nota (U+000B) para mostrar e de volta. */
const toScreen = (text: string) => text.replace(/\u000b/g, "\n");
const fromScreen = (text: string) => text.replace(/\r?\n$/, "").replace(/\r?\n/g, "\u000b");

// ---------------------------------------------------------------- medida

let canvas: CanvasRenderingContext2D | null = null;
/** Altura aproximada de uma nota (10 pt, entrelinhas simples) na largura do texto. */
export function noteHeight(text: string, width: number): number {
  const line = 16;
  if (!canvas) canvas = document.createElement("canvas").getContext("2d");
  const measure = (s: string) => {
    if (!canvas) return s.length * 6.5;
    canvas.font = "10pt Calibri, Carlito, 'Segoe UI', sans-serif";
    return canvas.measureText(s).width;
  };
  const avail = Math.max(60, width - 22);
  const lines = text.split("\u000b").reduce((n, l) => n + Math.max(1, Math.ceil(measure(l) / avail)), 0);
  return lines * line + 3;
}

/** Espaço do traço que separa o texto das notas. */
export const NOTE_SEPARATOR = 18;

// ---------------------------------------------------------------- tela

export interface PageNotes {
  page: number;
  items: { id: string; n: number }[];
}

/**
 * Notas de cada página: a página de cada chamada vem da posição dela depois da
 * paginação (`data-stride` na `.page`); numera as chamadas (`data-n`).
 */
export function notesByPage(root: HTMLElement, order: string[]): PageNotes[] {
  const stride = Number(root.dataset.stride) || 0;
  const pages = new Map<number, PageNotes>();
  const placed = new Set<string>();
  root.querySelectorAll<HTMLElement>(".fn-ref").forEach((el) => {
    const id = el.dataset.fn ?? "";
    const n = order.indexOf(id) + 1;
    if (n === 0 || placed.has(id) || !stride) return;
    placed.add(id);
    let top = 0;
    for (let node: HTMLElement | null = el; node && node !== root; node = node.offsetParent as HTMLElement | null) top += node.offsetTop;
    const page = Math.floor(top / stride);
    const entry = pages.get(page) ?? { page, items: [] };
    entry.items.push({ id, n });
    pages.set(page, entry);
  });
  return [...pages.values()].sort((a, b) => a.page - b.page);
}

export function FootnotesLayer({
  pages,
  texts,
  pageHeight,
  gap,
  marginBottom,
  marginLeft,
  marginRight,
  focus,
  onFocused,
  onChange,
  onDone,
  label,
}: {
  pages: PageNotes[];
  texts: Record<string, string>;
  pageHeight: number;
  gap: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** Nota que acabou de ser inserida: recebe o cursor. */
  focus: string | null;
  onFocused: () => void;
  onChange: (id: string, text: string) => void;
  /** Enter ou Esc: volta ao texto. */
  onDone: () => void;
  label: (n: number) => string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!focus) return;
    const el = layer.current?.querySelector<HTMLElement>(`.fn-text[data-fn="${focus}"]`);
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
    el.scrollIntoView({ block: "nearest" });
    onFocused();
  });
  // Enter/Esc gravam e tiram o foco, e o blur que vem em seguida não grava de novo.
  const commit = (el: HTMLElement) => {
    const id = el.dataset.fn ?? "";
    const text = fromScreen(el.innerText);
    const last = el.dataset.committed ?? texts[id] ?? "";
    if (text !== last) {
      el.dataset.committed = text;
      onChange(id, text);
    }
  };
  return (
    <div className="fn-layer" ref={layer}>
      {pages.map((p) => (
        <div
          key={p.page}
          className="fn-area"
          style={{ top: `${p.page * (pageHeight + gap) + pageHeight - marginBottom}px`, left: `${marginLeft}px`, right: `${marginRight}px` }}
        >
          {p.items.map(({ id, n }) => (
            <div key={id} className="fn-item">
              <span className="fn-num" aria-hidden="true">{n}</span>
              <NoteText id={id} text={texts[id] ?? ""} label={label(n)} onCommit={commit} onDone={onDone} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function NoteText({ id, text, label, onCommit, onDone }: { id: string; text: string; label: string; onCommit: (el: HTMLElement) => void; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // O texto só é escrito no DOM quando muda de fora (abrir, desfazer, coedição), nunca enquanto se digita.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    delete el.dataset.committed;
    if (document.activeElement !== el && fromScreen(el.innerText) !== text) el.textContent = toScreen(text);
  }, [text]);
  return (
    <div
      ref={ref}
      className="fn-text"
      data-fn={id}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      spellCheck={false}
      onBlur={(e) => onCommit(e.currentTarget)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          onCommit(e.currentTarget);
          onDone();
        }
      }}
      onPaste={(e) => {
        // Só texto simples na nota.
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\r?\n/g, " "));
      }}
    >
      {toScreen(text)}
    </div>
  );
}

/** Lista das notas para a impressão (o navegador pagina sozinho e não monta o pé de cada página). */
export function FootnotesPrint({ order, texts, title }: { order: string[]; texts: Record<string, string>; title: string }) {
  if (!order.length) return null;
  return (
    <ol className="fn-print" aria-label={title}>
      {order.map((id) => (
        <li key={id}>{toScreen(texts[id] ?? "")}</li>
      ))}
    </ol>
  );
}

