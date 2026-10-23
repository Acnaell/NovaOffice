// Cabeçalho e rodapé desenhados em cada folha. Duplo clique entra na edição
// (como no Word); os campos de número e total de páginas aparecem como
// marcadores que não se editam letra por letra.

import { useEffect, useLayoutEffect, useRef } from "react";
import { useI18n } from "./i18n";
import type { Align, HeaderFooter, HeadersFooters } from "./types";

export type Part = "header" | "footer";

export const PAGE_FIELD = "{PAGE}";
export const NUMPAGES_FIELD = "{NUMPAGES}";
const FIELDS = [PAGE_FIELD, NUMPAGES_FIELD];

/** Texto com os campos trocados pelos números da página. */
export function fillFields(text: string, page: number, pages: number): string {
  return text.split(PAGE_FIELD).join(String(page)).split(NUMPAGES_FIELD).join(String(pages)).replace(/\u000B/g, "\n");
}

/** Divide o texto em pedaços de texto e campos, na ordem. */
export function splitFields(text: string): { text?: string; field?: string }[] {
  const out: { text?: string; field?: string }[] = [];
  let rest = text;
  while (rest) {
    const hits = FIELDS.map((f) => [rest.indexOf(f), f] as const).filter(([i]) => i >= 0);
    if (!hits.length) {
      out.push({ text: rest });
      break;
    }
    const [i, f] = hits.reduce((a, b) => (b[0] < a[0] ? b : a));
    if (i > 0) out.push({ text: rest.slice(0, i) });
    out.push({ field: f });
    rest = rest.slice(i + f.length);
  }
  return out;
}

/** Conteúdo do editor → texto com campos; `<br>` vira quebra de linha. */
export function editorText(el: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) out += (child.textContent ?? "").replace(/ /g, " ");
      else if (child instanceof HTMLElement) {
        if (child.dataset.field) out += child.dataset.field;
        else if (child.tagName === "BR") out += "\u000B";
        else {
          if (child.tagName === "DIV" && out) out += "\u000B";
          walk(child);
        }
      }
    }
  };
  walk(el);
  return out.replace(/\u000B+$/, "").slice(0, 1000);
}

function fieldNode(field: string, label: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "hf-field";
  span.contentEditable = "false";
  span.dataset.field = field;
  span.textContent = label;
  return span;
}

/** Insere um campo no cursor do editor de cabeçalho/rodapé aberto. */
export function insertFieldAtCaret(field: string, label: string): boolean {
  const editor = document.getElementById("hf-editor");
  const sel = document.getSelection();
  if (!editor || !sel) return false;
  editor.focus();
  let range = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  const node = fieldNode(field, label);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

const alignCss = (a: Align): "left" | "center" | "right" | "justify" => a;

interface Props {
  value: HeadersFooters;
  pages: number;
  /** Altura do papel, intervalo entre folhas, distância do cabeçalho/rodapé à borda e margens laterais, em px. */
  pageHeight: number;
  gap: number;
  distance: number;
  marginLeft: number;
  marginRight: number;
  editing: { part: Part; page: number } | null;
  onEdit: (part: Part, page: number) => void;
  onChange: (part: Part, value: HeaderFooter) => void;
  onClose: () => void;
}

export function HeaderFooterLayer(props: Props) {
  const { t } = useI18n();
  const labels = { [PAGE_FIELD]: t("hf.pageField"), [NUMPAGES_FIELD]: t("hf.pagesField") } as Record<string, string>;
  const boxes = [];
  for (let k = 0; k < props.pages; k++) {
    for (const part of ["header", "footer"] as const) {
      const value = props.value[part];
      const hiddenOnFirst = k === 0 && props.value.differentFirst;
      const editingHere = props.editing?.part === part && props.editing.page === k;
      const top = k * (props.pageHeight + props.gap) + (part === "header" ? props.distance : props.pageHeight - props.distance);
      boxes.push(
        <div
          key={`${part}-${k}`}
          className={`hf hf-${part}${props.editing?.part === part ? " editing" : ""}${!value.text || hiddenOnFirst ? " empty" : ""}`}
          style={{ top: `${top}px`, left: `${props.marginLeft}px`, right: `${props.marginRight}px`, textAlign: alignCss(value.align) }}
          title={props.editing ? undefined : t(part === "header" ? "hf.editHeader" : "hf.editFooter")}
          onDoubleClick={() => props.onEdit(part, k)}
        >
          {editingHere ? (
            <PartEditor value={value} labels={labels} onChange={(v) => props.onChange(part, v)} onClose={props.onClose} label={t(part === "header" ? "hf.header" : "hf.footer")} />
          ) : hiddenOnFirst ? (
            props.editing?.part === part ? <span className="hf-note">{t("hf.firstPage")}</span> : null
          ) : (
            fillFields(value.text, k + 1, props.pages)
          )}
          {props.editing?.part === part && <span className="hf-tag">{t(part === "header" ? "hf.header" : "hf.footer")}</span>}
        </div>,
      );
    }
  }
  return <div className="hf-layer">{boxes}</div>;
}

function PartEditor({
  value,
  labels,
  label,
  onChange,
  onClose,
}: {
  value: HeaderFooter;
  labels: Record<string, string>;
  label: string;
  onChange: (value: HeaderFooter) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(value);
  latest.current = value;
  // Monta o conteúdo uma vez; depois o DOM é a fonte até sair da edição.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    for (const piece of splitFields(value.text)) {
      if (piece.field) el.appendChild(fieldNode(piece.field, labels[piece.field]));
      else
        piece.text!.split("\u000B").forEach((line, i) => {
          if (i > 0) el.appendChild(document.createElement("br"));
          if (line) el.appendChild(document.createTextNode(line));
        });
    }
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        // Uma linha nova dentro do cabeçalho (o Word faria outro parágrafo).
        e.preventDefault();
        document.execCommand("insertLineBreak");
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      id="hf-editor"
      ref={ref}
      className="hf-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      onInput={() => ref.current && onChange({ ...latest.current, text: editorText(ref.current) })}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\r?\n/g, " "));
      }}
    />
  );
}
