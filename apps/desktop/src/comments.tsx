// Comentários (Revisão → Novo Comentário, Ctrl+Alt+M; ADR 0014).
// O trecho comentado leva a marca `comment {id}`; o comentário fica em
// `DocView.comments`. Respostas têm `parent` e não marcam o texto. Os balões
// ficam numa coluna à direita do papel, na altura do trecho, como no Word.

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { posToDom } from "./dom";
import { useI18n } from "./i18n";
import { blockText, caret, ordered, segments, wordEnd, wordStart, isCollapsed, type Edit, type Selection } from "./model";
import type { BlockView, Comment, DocView, Mark, Pos, TextCommand } from "./types";

// ---------------------------------------------------------------- modelo

export function commentOf(marks: Mark[]): string | null {
  for (const m of marks) if (m.mark === "comment") return m.id;
  return null;
}

export function newCommentId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Data de agora no formato guardado (ISO 8601, UTC, sem frações). */
export function nowIso(now = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

/** Iniciais a partir do nome: "Ana Maria Souza" → "AMS". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .slice(0, 3)
    .join("")
    .toUpperCase();
}

export interface Range {
  block: number;
  offset: number;
  len: number;
}

/** Trechos marcados com o comentário, em ordem. */
export function commentRanges(blocks: BlockView[], id: string): Range[] {
  const out: Range[] = [];
  blocks.forEach((b, block) => {
    let offset = 0;
    for (const s of b.spans) {
      if (commentOf(s.marks) === id) {
        const last = out[out.length - 1];
        if (last && last.block === block && last.offset + last.len === offset) last.len += s.text.length;
        else out.push({ block, offset, len: s.text.length });
      }
      offset += s.text.length;
    }
  });
  return out;
}

/** Comentários principais na ordem do trecho no texto (só os que existem). */
export function commentOrder(blocks: BlockView[], comments: Record<string, Comment>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks)
    for (const s of b.spans) {
      const id = commentOf(s.marks);
      if (id && !seen.has(id) && comments[id] && !comments[id].parent) {
        seen.add(id);
        out.push(id);
      }
    }
  return out;
}

/** Respostas de um comentário, pela data. */
export function repliesOf(comments: Record<string, Comment>, root: string): [string, Comment][] {
  return Object.entries(comments)
    .filter(([, c]) => c.parent === root)
    .sort((a, b) => a[1].date.localeCompare(b[1].date) || a[0].localeCompare(b[0]));
}

/** Comentário no cursor: o do caractere seguinte ou, no fim do trecho, o do anterior. */
export function commentAt(doc: DocView, pos: Pos): string | null {
  const block = doc.blocks[pos.block];
  if (!block) return null;
  let offset = 0;
  let before: string | null = null;
  for (const s of block.spans) {
    const end = offset + s.text.length;
    if (pos.offset >= offset && pos.offset < end) return commentOf(s.marks) ?? before;
    if (end === pos.offset) before = commentOf(s.marks);
    offset = end;
  }
  return before;
}

/**
 * Trecho que o novo comentário marca: a seleção ou, sem seleção, a palavra do
 * cursor (como o Word). `null` se não há texto para marcar.
 */
export function commentTarget(doc: DocView, sel: Selection): Selection | null {
  if (!isCollapsed(sel)) return sel;
  const { block, offset } = sel.focus;
  const text = blockText(doc.blocks[block]);
  if (!text.length) return null;
  let start = wordStart(text, Math.min(offset + 1, text.length));
  let end = wordEnd(text, start);
  if (start === end) {
    // Cursor depois do último caractere, ou só espaços: o caractere anterior.
    start = Math.max(0, offset - 1);
    end = start + 1;
  }
  // Sem os espaços em volta da palavra.
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start === end) return null;
  return { anchor: { block, offset: start }, focus: { block, offset: end } };
}

/** Cria o comentário no trecho: um passo de desfazer. */
export function addComment(doc: DocView, target: Selection, id: string, comment: Comment): Edit | null {
  const [from, to] = ordered(target);
  const commands: TextCommand[] = segments(doc, from, to).map((s) => ({
    type: "text.applyMark",
    block: s.block,
    offset: s.start,
    len: s.end - s.start,
    mark: { mark: "comment", id },
  }));
  if (!commands.length) return null;
  commands.push({ type: "comment.set", id, value: comment });
  return { command: { type: "batch", commands }, selection: caret(to) };
}

/** Exclui o comentário, as respostas e a marca no texto: um passo de desfazer. */
export function deleteComment(doc: DocView, sel: Selection, root: string): Edit {
  const commands: TextCommand[] = commentRanges(doc.blocks, root).map((r) => ({
    type: "text.removeMark",
    block: r.block,
    offset: r.offset,
    len: r.len,
    kind: "comment",
  }));
  for (const [id] of repliesOf(doc.comments, root)) commands.push({ type: "comment.set", id, value: null });
  commands.push({ type: "comment.set", id: root, value: null });
  return { command: { type: "batch", commands }, selection: sel };
}

/** Exclui todos os comentários do documento. */
export function deleteAllComments(doc: DocView, sel: Selection): Edit | null {
  const commands: TextCommand[] = [];
  doc.blocks.forEach((b, block) => {
    let offset = 0;
    for (const s of b.spans) {
      if (commentOf(s.marks)) commands.push({ type: "text.removeMark", block, offset, len: s.text.length, kind: "comment" });
      offset += s.text.length;
    }
  });
  for (const id of Object.keys(doc.comments)) commands.push({ type: "comment.set", id, value: null });
  return commands.length ? { command: { type: "batch", commands }, selection: sel } : null;
}

/** Leva o cursor ao início do próximo (ou anterior) comentário. */
export function nextComment(doc: DocView, sel: Selection, back = false): { edit: Edit; id: string } | null {
  const order = commentOrder(doc.blocks, doc.comments);
  const starts = order.map((id) => {
    const r = commentRanges(doc.blocks, id)[0];
    return { id, pos: { block: r.block, offset: r.offset } };
  });
  const cmp = (a: Pos, b: Pos) => a.block - b.block || a.offset - b.offset;
  const here = sel.focus;
  const target = back ? starts.filter((s) => cmp(s.pos, here) < 0).pop() : starts.find((s) => cmp(s.pos, here) > 0);
  if (!target) return null;
  return { edit: { command: null, selection: caret(target.pos) }, id: target.id };
}

// ---------------------------------------------------------------- tela

/** Data curta no idioma da interface: "30 de out., 14:45" (ou só a hora, se for hoje). */
function shortDate(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Cor do avatar a partir do nome (sempre a mesma para a mesma pessoa). */
function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const toScreen = (text: string) => text.replace(/\u000b/g, "\n");
const fromScreen = (text: string) => text.replace(/\r?\n/g, "\u000b").trim();

export interface Pending {
  /** Trecho que vai receber o comentário. */
  target: Selection;
}

export interface CommentsPaneProps {
  view: DocView;
  revision: number;
  /** O texto (`.page`), para medir onde cada trecho está. */
  root: HTMLElement | null;
  active: string | null;
  pending: Pending | null;
  author: string;
  pages: number;
  onActivate: (id: string | null) => void;
  onPost: (text: string, author: string) => void;
  onCancel: () => void;
  onReply: (root: string, text: string) => void;
  onEdit: (id: string, text: string) => void;
  onResolve: (root: string, done: boolean) => void;
  onDelete: (root: string) => void;
  /** Volta o foco para o texto. */
  onDone: () => void;
}

/** Topo de uma posição do texto em relação ao papel (sem zoom). */
function topOf(root: HTMLElement, pos: Pos): number | null {
  const point = posToDom(root, pos);
  const paper = root.parentElement;
  if (!point || !paper) return null;
  const range = document.createRange();
  try {
    range.setStart(point[0], point[1]);
  } catch {
    return null;
  }
  range.collapse(true);
  let rect = range.getBoundingClientRect();
  if (!rect.height) {
    const el = point[0] instanceof Element ? point[0] : point[0].parentElement;
    if (!el) return null;
    rect = el.getBoundingClientRect();
  }
  const base = paper.getBoundingClientRect();
  const zoom = base.width / (paper.offsetWidth || base.width) || 1;
  return (rect.top - base.top) / zoom;
}

export function CommentsPane(props: CommentsPaneProps) {
  const { t, locale } = useI18n();
  const { view, root, active, pending } = props;
  const order = useMemo(() => commentOrder(view.blocks, view.comments), [view.blocks, view.comments]);
  const [anchors, setAnchors] = useState<Record<string, number>>({});
  const [tops, setTops] = useState<Record<string, number>>({});
  const cards = useRef(new Map<string, HTMLElement>());

  // 1. Altura do trecho de cada comentário (e do comentário novo).
  useLayoutEffect(() => {
    if (!root) return;
    const next: Record<string, number> = {};
    for (const id of order) {
      const r = commentRanges(view.blocks, id)[0];
      const top = r && topOf(root, { block: r.block, offset: r.offset });
      if (top != null) next[id] = top;
    }
    if (pending) {
      const top = topOf(root, ordered(pending.target)[0]);
      if (top != null) next["~pending"] = top;
    }
    setAnchors((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [root, order, view.blocks, pending, props.revision, props.pages]);

  // 2. Empilha os balões sem sobrepor; o ativo fica na altura do trecho e empurra os outros.
  useLayoutEffect(() => {
    const ids = Object.keys(anchors).sort((a, b) => anchors[a] - anchors[b] || a.localeCompare(b));
    const height = (id: string) => cards.current.get(id)?.offsetHeight ?? 60;
    const next: Record<string, number> = {};
    const focus = pending ? "~pending" : active && anchors[active] != null ? active : null;
    const at = focus ? ids.indexOf(focus) : -1;
    if (at >= 0) {
      next[focus!] = anchors[focus!];
      let floor = next[focus!] + height(focus!) + 8;
      for (const id of ids.slice(at + 1)) {
        next[id] = Math.max(anchors[id], floor);
        floor = next[id] + height(id) + 8;
      }
      let ceil = next[focus!];
      for (const id of ids.slice(0, at).reverse()) {
        next[id] = Math.min(anchors[id], ceil - height(id) - 8);
        ceil = next[id];
      }
      // Se subir demais, volta a empilhar de cima para baixo.
      let floor2 = 0;
      for (const id of ids) {
        if (next[id] < floor2) next[id] = floor2;
        floor2 = next[id] + height(id) + 8;
      }
    } else {
      let floor = 0;
      for (const id of ids) {
        next[id] = Math.max(anchors[id], floor);
        floor = next[id] + height(id) + 8;
      }
    }
    setTops((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  });

  const ref = (id: string) => (el: HTMLElement | null) => {
    if (el) cards.current.set(id, el);
    else cards.current.delete(id);
  };

  return (
    <aside className="comments-pane" aria-label={t("cm.pane")}>
      {pending && (
        <div ref={ref("~pending")} className="cm-card active" style={{ top: `${tops["~pending"] ?? anchors["~pending"] ?? 0}px` }}>
          <Composer
            author={props.author}
            placeholder={t("cm.placeholder")}
            submit={t("cm.post")}
            onSubmit={props.onPost}
            onCancel={props.onCancel}
            autoFocus
          />
        </div>
      )}
      {order.map((id) => (
        <Card
          key={id}
          id={id}
          cardRef={ref(id)}
          top={tops[id] ?? anchors[id] ?? 0}
          comment={view.comments[id]}
          replies={repliesOf(view.comments, id)}
          active={active === id}
          author={props.author}
          locale={locale}
          onActivate={() => props.onActivate(id)}
          onReply={(text) => props.onReply(id, text)}
          onEdit={props.onEdit}
          onResolve={(done) => props.onResolve(id, done)}
          onDelete={() => props.onDelete(id)}
          onDone={props.onDone}
        />
      ))}
    </aside>
  );
}

function Avatar({ name, initials }: { name: string; initials: string }) {
  return (
    <span className="cm-avatar" style={{ "--hue": avatarHue(name) } as CSSProperties} aria-hidden="true">
      {initials || initialsOf(name) || "?"}
    </span>
  );
}

function Card(p: {
  id: string;
  cardRef: (el: HTMLElement | null) => void;
  top: number;
  comment: Comment;
  replies: [string, Comment][];
  active: boolean;
  author: string;
  locale: string;
  onActivate: () => void;
  onReply: (text: string) => void;
  onEdit: (id: string, text: string) => void;
  onResolve: (done: boolean) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const c = p.comment;
  const entry = (id: string, cm: Comment, first: boolean): ReactNode => (
    <div key={id} className={`cm-entry${first ? " first" : ""}`}>
      <div className="cm-head">
        <Avatar name={cm.author} initials={cm.initials} />
        <span className="cm-author">{cm.author}</span>
        <span className="cm-date">{shortDate(cm.date, p.locale)}</span>
      </div>
      {editing === id ? (
        <Composer
          author={p.author}
          initial={toScreen(cm.text)}
          submit={t("cm.save")}
          onSubmit={(text) => {
            setEditing(null);
            if (text !== cm.text) p.onEdit(id, text);
          }}
          onCancel={() => setEditing(null)}
          autoFocus
        />
      ) : (
        <div
          className="cm-text"
          onDoubleClick={() => setEditing(id)}
          title={t("cm.editTip")}
        >
          {toScreen(cm.text)}
        </div>
      )}
    </div>
  );
  return (
    <div
      ref={p.cardRef}
      className={`cm-card${p.active ? " active" : ""}${c.done ? " done" : ""}`}
      data-comment={p.id}
      style={{ top: `${p.top}px` }}
      onMouseDown={(e) => {
        if (!p.active && !(e.target as HTMLElement).closest("button, textarea, input")) p.onActivate();
      }}
    >
      <div className="cm-tools">
        {c.done && <span className="cm-badge">{t("cm.resolved")}</span>}
        <button
          type="button"
          className="cm-tool"
          title={c.done ? t("cm.reopen") : t("cm.resolve")}
          aria-label={c.done ? t("cm.reopen") : t("cm.resolve")}
          onClick={() => p.onResolve(!c.done)}
        >
          {c.done ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
          )}
        </button>
        <button type="button" className="cm-tool" title={t("cm.delete")} aria-label={t("cm.delete")} onClick={p.onDelete}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" /></svg>
        </button>
      </div>
      {entry(p.id, c, true)}
      {(p.active || !c.done) && p.replies.map(([id, r]) => entry(id, r, false))}
      {!p.active && c.done && p.replies.length > 0 && <div className="cm-more">{t("cm.replies", { n: p.replies.length })}</div>}
      {p.active && !c.done && (
        <Composer author={p.author} placeholder={t("cm.replyPlaceholder")} submit={t("cm.reply")} onSubmit={p.onReply} onCancel={p.onDone} compact />
      )}
    </div>
  );
}

function Composer(p: {
  author: string;
  initial?: string;
  placeholder?: string;
  submit: string;
  onSubmit: (text: string, author: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
  /** Resposta: os botões só aparecem depois de começar a escrever. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(p.initial ?? "");
  const [name, setName] = useState(p.author);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!p.autoFocus) return;
    (p.author ? area.current : document.querySelector<HTMLInputElement>(".cm-name"))?.focus();
    area.current?.setSelectionRange(text.length, text.length);
    // Só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ready = fromScreen(text).length > 0 && name.trim().length > 0;
  const submit = () => {
    if (!ready) return;
    p.onSubmit(fromScreen(text), name.trim());
    if (p.compact) setText("");
  };
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      p.onCancel();
    }
  };
  return (
    <div className="cm-composer">
      {!p.author && (
        <input
          className="cm-name"
          value={name}
          placeholder={t("cm.yourName")}
          aria-label={t("cm.yourName")}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={keys}
        />
      )}
      <textarea
        ref={area}
        className="cm-input"
        value={text}
        rows={p.compact ? 1 : 2}
        placeholder={p.placeholder}
        aria-label={p.placeholder ?? p.submit}
        maxLength={20000}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={keys}
      />
      {(!p.compact || text) && (
        <div className="cm-actions">
          <button type="button" className="cm-btn" onClick={p.onCancel}>
            {t("cm.cancel")}
          </button>
          <button type="button" className="cm-btn primary" disabled={!ready} onClick={submit} title={`${p.submit} (Ctrl+Enter)`}>
            {p.submit}
          </button>
        </div>
      )}
    </div>
  );
}

/** Destaque do trecho do comentário novo (a seleção some quando o foco vai para o balão). */
export function usePendingHighlight(root: HTMLElement | null, pending: Pending | null, revision: number) {
  useLayoutEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const Ctor = (window as unknown as { Highlight?: new (...r: AbstractRange[]) => unknown }).Highlight;
    if (!highlights || !Ctor) return;
    if (!root || !pending) {
      highlights.delete("nova-comment");
      return;
    }
    const [from, to] = ordered(pending.target);
    const a = posToDom(root, from);
    const b = posToDom(root, to);
    if (!a || !b) return;
    const range = document.createRange();
    try {
      range.setStart(a[0], a[1]);
      range.setEnd(b[0], b[1]);
    } catch {
      return;
    }
    highlights.set("nova-comment", new Ctor(range));
    return () => void highlights.delete("nova-comment");
  }, [root, pending, revision]);
}
