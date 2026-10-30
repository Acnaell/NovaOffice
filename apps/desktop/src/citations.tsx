// Caixas de Citações e Bibliografia (Referências): Gerenciar Fontes, o
// formulário de uma fonte (Criar Fonte / Editar Fonte, como no Word) e
// Inserir Citação. As regras ficam em citations.ts.

import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { citationText, formatAuthors, parseAuthors, referencePieces, sortedSources } from "./citations";
import { useI18n, type MessageKey } from "./i18n";
import { Modal } from "./Insert";
import type { Source, SourceKind } from "./types";

const KINDS: SourceKind[] = ["book", "article", "web", "thesis"];

type Field = "edition" | "place" | "publisher" | "journal" | "volume" | "issue" | "pages" | "institution" | "degree";

/** Campos de cada tipo, entre os comuns (autores, título, ano) e o endereço na Web. */
const FIELDS: Record<SourceKind, Field[]> = {
  book: ["edition", "place", "publisher"],
  article: ["journal", "place", "volume", "issue", "pages"],
  web: ["publisher"],
  thesis: ["degree", "institution", "place"],
};

/** Entrada da referência com o negrito, para conferir antes de salvar. */
function ReferencePreview({ source }: { source: Source }) {
  return (
    <p className="source-preview">
      {referencePieces(source).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </p>
  );
}

/** Criar Fonte / Editar Fonte. */
export function SourceForm({ initial, onSave, onCancel }: { initial: Source | null; onSave: (source: Source) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<SourceKind>(initial?.kind ?? "book");
  const [authors, setAuthors] = useState(formatAuthors(initial?.authors));
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (initial) for (const [k, v] of Object.entries(initial)) if (typeof v === "string") out[k] = v;
    return out;
  });
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  const value = (k: string) => values[k] ?? "";
  const set = (k: string, v: string) => setValues((old) => ({ ...old, [k]: v }));
  // Só os campos do tipo escolhido vão para a fonte.
  const source: Source = { kind, title: value("title").trim() };
  const people = parseAuthors(authors);
  if (people.length) source.authors = people;
  for (const k of ["year", ...FIELDS[kind], "url", "accessed"] as const) {
    const v = value(k).trim();
    if (v) (source as unknown as Record<string, string>)[k] = v;
  }
  const valid = !!source.title || people.length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSave(source);
  };
  const input = (k: string, label: MessageKey, extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label key={k} className={`source-field source-${k}`}>
      <span>{t(label)}</span>
      <input name={k} value={value(k)} onChange={(e) => set(k, e.target.value)} {...extra} />
    </label>
  );
  return (
    <form onSubmit={submit} className="dialog-form source-form">
      <label>
        <span>{t("src.kind")}</span>
        <select ref={first} name="kind" value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`src.kind.${k}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("src.authors")}</span>
        <input name="authors" value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder={t("src.authorsHint")} />
      </label>
      {input("title", "src.title")}
      <div className="source-row">
        {input("year", "src.year", { inputMode: "numeric" })}
        {FIELDS[kind].map((k) => input(k, (kind === "web" && k === "publisher" ? "src.site" : `src.${k}`) as MessageKey))}
      </div>
      <div className="source-row">
        {input("url", "src.url", { placeholder: "https://" })}
        {input("accessed", "src.accessed", { type: "date" })}
      </div>
      <div className="source-preview-box">
        <span>{t("src.preview")}</span>
        <ReferencePreview source={source} />
      </div>
      <div className="modal-actions">
        <button type="submit" className="bs-primary" disabled={!valid}>
          {t("dialog.ok")}
        </button>
        <button type="button" className="bs-secondary" onClick={onCancel}>
          {t("save.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Gerenciar Fontes: a lista das fontes do documento, com Nova, Editar e Excluir. */
export function SourcesDialog({
  sources,
  cited,
  newId,
  onSave,
  onDelete,
  onClose,
}: {
  sources: Record<string, Source> | undefined;
  cited: Set<string>;
  newId: () => string;
  onSave: (id: string, source: Source) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const list = sortedSources(sources);
  const [chosen, setChosen] = useState<string | null>(list[0]?.[0] ?? null);
  const [editing, setEditing] = useState<{ id: string; source: Source | null } | null>(null);
  if (editing) {
    return (
      <Modal title={t(editing.source ? "src.editTitle" : "src.createTitle")} className="sources-dialog" onClose={() => setEditing(null)}>
        <SourceForm
          initial={editing.source}
          onCancel={() => setEditing(null)}
          onSave={(source) => {
            onSave(editing.id, source);
            setChosen(editing.id);
            setEditing(null);
          }}
        />
      </Modal>
    );
  }
  const current = chosen && sources?.[chosen] ? chosen : null;
  return (
    <Modal title={t("cite.manage")} className="sources-dialog" onClose={onClose}>
      <div className="dialog-form">
        <span className="sources-label">{t("cite.list")}</span>
        <ul className="sources-list" role="listbox" aria-label={t("cite.list")}>
          {list.length === 0 && <li className="sources-empty">{t("cite.none")}</li>}
          {list.map(([id, s]) => (
            <li
              key={id}
              role="option"
              aria-selected={id === current}
              className={id === current ? "selected" : undefined}
              data-source={id}
              onClick={() => setChosen(id)}
              onDoubleClick={() => setEditing({ id, source: s })}
            >
              <span className="sources-cite">{citationText(s)}</span>
              <ReferencePreview source={s} />
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="bs-secondary push-left" onClick={() => setEditing({ id: newId(), source: null })}>
            {t("cite.add")}
          </button>
          <button type="button" className="bs-secondary" disabled={!current} onClick={() => current && setEditing({ id: current, source: sources![current] })}>
            {t("cite.edit")}
          </button>
          <button
            type="button"
            className="bs-secondary"
            disabled={!current || cited.has(current)}
            title={current && cited.has(current) ? t("cite.inUse") : undefined}
            onClick={() => {
              if (!current) return;
              onDelete(current);
              setChosen(list.find(([id]) => id !== current)?.[0] ?? null);
            }}
          >
            {t("cite.delete")}
          </button>
          <button type="button" className="bs-primary" onClick={onClose}>
            {t("cite.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Inserir Citação: a fonte e, se quiser, a página; sem fontes, abre Criar Fonte. */
export function CitationDialog({
  sources,
  newId,
  onSave,
  onInsert,
  onClose,
}: {
  sources: Record<string, Source> | undefined;
  newId: () => string;
  onSave: (id: string, source: Source) => void;
  onInsert: (id: string, page: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const list = sortedSources(sources);
  const [chosen, setChosen] = useState(list[0]?.[0] ?? "");
  const [page, setPage] = useState("");
  const [creating, setCreating] = useState(list.length === 0);
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!creating) select.current?.focus();
  }, [creating]);
  if (creating) {
    return (
      <Modal title={t("src.createTitle")} className="sources-dialog" onClose={list.length ? () => setCreating(false) : onClose}>
        <SourceForm
          initial={null}
          onCancel={list.length ? () => setCreating(false) : onClose}
          onSave={(source) => {
            const id = newId();
            onSave(id, source);
            setChosen(id);
            setCreating(false);
          }}
        />
      </Modal>
    );
  }
  const source = sources?.[chosen];
  return (
    <Modal title={t("cite.insert")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (source) onInsert(chosen, page);
        }}
      >
        <label>
          <span>{t("cite.source")}</span>
          <select ref={select} name="source" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {list.map(([id, s]) => (
              <option key={id} value={id}>
                {`${citationText(s)} ${s.title}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("cite.page")}</span>
          <input name="page" value={page} maxLength={32} onChange={(e) => setPage(e.target.value)} placeholder="12" />
        </label>
        <p className="source-preview">{citationText(source, page)}</p>
        <div className="modal-actions">
          <button type="button" className="bs-secondary push-left" onClick={() => setCreating(true)}>
            {t("cite.newSource")}
          </button>
          <button type="submit" className="bs-primary" disabled={!source}>
            {t("cite.insertButton")}
          </button>
          <button type="button" className="bs-secondary" onClick={onClose}>
            {t("save.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
