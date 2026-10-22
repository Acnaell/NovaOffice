// Aba Inserir: caixa de link (Ctrl+K), Data e Hora e o menu de símbolos.

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { dateTimeFormats, normalizeHref } from "./formatting";
import { useI18n } from "./i18n";

/** Caixa modal no estilo das do Word; Esc ou Cancelar fecha. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

export interface LinkRequest {
  /** Texto selecionado (ou do link sob o cursor); vazio quando não há. */
  text: string;
  /** Endereço atual, ao editar um link. */
  href: string | null;
  /** Há texto selecionado: o campo de texto não aparece, como no Word. */
  hasSelection: boolean;
}

export function LinkDialog({
  request,
  onApply,
  onRemove,
  onClose,
}: {
  request: LinkRequest;
  onApply: (text: string, href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(request.text);
  const [address, setAddress] = useState(request.href ?? "");
  const [error, setError] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const href = normalizeHref(address);
    if (!href) return setError(true);
    onApply(text || address.trim(), href);
  };
  return (
    <Modal title={request.href ? t("link.edit") : t("link.insert")} onClose={onClose}>
      <form onSubmit={submit} className="dialog-form">
        <label>
          <span>{t("link.text")}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} disabled={request.hasSelection} placeholder={address} />
        </label>
        <label>
          <span>{t("link.address")}</span>
          <input
            ref={field}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setError(false);
            }}
            placeholder="https://"
            aria-invalid={error}
          />
        </label>
        {error && <p className="dialog-error">{t("link.invalid")}</p>}
        <div className="modal-actions">
          {request.href && (
            <button type="button" className="bs-secondary push-left" onClick={onRemove}>
              {t("link.remove")}
            </button>
          )}
          <button type="submit" className="bs-primary">
            {t("dialog.ok")}
          </button>
          <button type="button" className="bs-secondary" onClick={onClose}>
            {t("save.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DateTimeDialog({ onInsert, onClose }: { onInsert: (text: string) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const options = useMemo(() => dateTimeFormats(new Date(), locale), [locale]);
  const [chosen, setChosen] = useState(0);
  const list = useRef<HTMLSelectElement>(null);
  useEffect(() => list.current?.focus(), []);
  return (
    <Modal title={t("insert.dateTime")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          onInsert(options[chosen]);
        }}
      >
        <label>
          <span>{t("dateTime.formats")}</span>
          <select
            ref={list}
            size={Math.min(options.length, 9)}
            value={chosen}
            onChange={(e) => setChosen(Number(e.target.value))}
            onDoubleClick={() => onInsert(options[chosen])}
          >
            {options.map((o, i) => (
              <option key={o} value={i}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="submit" className="bs-primary">
            {t("dialog.ok")}
          </button>
          <button type="button" className="bs-secondary" onClick={onClose}>
            {t("save.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Grade do botão Tabela: passar o mouse escolhe linhas × colunas, como no Word. */
export function TablePicker({ onPick, close }: { onPick: (rows: number, cols: number) => void; close: () => void }) {
  const { t } = useI18n();
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const ROWS = 8;
  const COLS = 10;
  return (
    <div className="table-picker" role="grid" aria-label={t("insert.table")}>
      <div className="table-picker-label">
        {size[0] ? t("table.size", { rows: size[0], cols: size[1] }) : t("insert.table")}
      </div>
      <div className="table-picker-grid" onMouseLeave={() => setSize([0, 0])}>
        {Array.from({ length: ROWS }, (_, r) =>
          Array.from({ length: COLS }, (_, c) => (
            <button
              key={`${r}-${c}`}
              className={r < size[0] && c < size[1] ? "on" : undefined}
              aria-label={t("table.size", { rows: r + 1, cols: c + 1 })}
              onMouseEnter={() => setSize([r + 1, c + 1])}
              onFocus={() => setSize([r + 1, c + 1])}
              onClick={() => {
                onPick(r + 1, c + 1);
                close();
              }}
            />
          )),
        )}
      </div>
    </div>
  );
}

/** Os símbolos mais usados, como a grade do botão Símbolo do Word. */
export const SYMBOLS = [
  "©", "®", "™", "§", "¶", "°", "±", "×", "÷", "≠",
  "≤", "≥", "≈", "∞", "√", "∑", "π", "Ω", "µ", "α",
  "β", "γ", "Δ", "€", "£", "¥", "¢", "¹", "²", "³",
  "½", "¼", "¾", "→", "←", "↑", "↓", "↔", "•", "…",
  "–", "—", "«", "»", "“", "”", "‘", "’", "¿", "¡",
  "✓", "✗", "★", "☆", "♥", "☺", "☎", "✉", "⚠", "ª",
];

export function SymbolMenu({ onPick, close }: { onPick: (symbol: string) => void; close: () => void }) {
  const { t } = useI18n();
  return (
    <div className="symbol-menu" role="menu" aria-label={t("insert.symbol")}>
      <div className="symbol-grid">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            role="menuitem"
            className="symbol"
            title={`U+${s.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`}
            onClick={() => {
              onPick(s);
              close();
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
