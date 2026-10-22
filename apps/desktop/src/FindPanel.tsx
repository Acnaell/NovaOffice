// Painel de Navegação, à esquerda como no Word: pesquisa com resultados em
// lista e, aberto em modo Substituir, os campos de troca. As ocorrências são
// destacadas no documento pelo Editor (CSS Custom Highlight API).

import { useEffect, useMemo, useRef } from "react";
import { keepFocus } from "./controls";
import { findAll, matchContext, type FindOptions, type Match } from "./find";
import { useI18n } from "./i18n";
import { icons } from "./icons";
import type { DocView } from "./types";

export interface FindState {
  mode: "find" | "replace";
  query: string;
  replacement: string;
  options: FindOptions;
  /** Índice do resultado atual em `matches`, ou -1. */
  current: number;
  /** Aviso depois de Substituir Tudo. */
  notice: string;
  /** Muda para pedir foco no campo de pesquisa (Ctrl+L de novo com o painel aberto). */
  focusToken: number;
}

interface Props {
  state: FindState;
  doc: DocView;
  onChange: (next: Partial<FindState>) => void;
  onGo: (index: number) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export const useMatches = (doc: DocView, state: FindState | null): Match[] =>
  useMemo(() => (state ? findAll(doc, state.query, state.options) : []), [doc, state?.query, state?.options.matchCase, state?.options.wholeWord]);

export function FindPanel({ state, doc, onChange, onGo, onReplace, onReplaceAll, onClose }: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const matches = useMatches(doc, state);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [state.focusToken, state.mode]);

  const go = (delta: 1 | -1) => {
    if (matches.length === 0) return;
    const base = state.current < 0 ? (delta > 0 ? -1 : 0) : state.current;
    onGo((base + delta + matches.length) % matches.length);
  };

  const status =
    !state.query ? "" : matches.length === 0 ? t("find.none") : state.current >= 0
      ? t("find.count", { current: state.current + 1, count: matches.length })
      : t("find.countNone", { count: matches.length });

  return (
    <aside className="find-panel" aria-label={t("find.title")}>
      <div className="find-header">
        <h2>{t("find.title")}</h2>
        <button className="icon-button" onClick={onClose} title={t("find.close")} aria-label={t("find.close")}>
          {icons.close}
        </button>
      </div>
      <div className="find-box">
        {icons.find}
        <input
          ref={input}
          type="search"
          placeholder={t("find.placeholder")}
          aria-label={t("find.placeholder")}
          value={state.query}
          onChange={(e) => onChange({ query: e.target.value, current: -1, notice: "" })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            }
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <div className="find-nav">
        <span className="find-status" aria-live="polite">{state.notice || status}</span>
        <button className="icon-button" onMouseDown={keepFocus} onClick={() => go(-1)} disabled={!matches.length} title={t("find.prev")} aria-label={t("find.prev")}>
          {icons.arrowUp}
        </button>
        <button className="icon-button" onMouseDown={keepFocus} onClick={() => go(1)} disabled={!matches.length} title={t("find.next")} aria-label={t("find.next")}>
          {icons.arrowDown}
        </button>
      </div>
      <div className="find-options">
        <label>
          <input type="checkbox" checked={state.options.matchCase} onChange={(e) => onChange({ options: { ...state.options, matchCase: e.target.checked }, current: -1 })} />
          {t("find.matchCase")}
        </label>
        <label>
          <input type="checkbox" checked={state.options.wholeWord} onChange={(e) => onChange({ options: { ...state.options, wholeWord: e.target.checked }, current: -1 })} />
          {t("find.wholeWord")}
        </label>
      </div>
      {state.mode === "replace" ? (
        <div className="replace-box">
          <input
            placeholder={t("find.replaceWith")}
            aria-label={t("find.replaceWith")}
            value={state.replacement}
            onChange={(e) => onChange({ replacement: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onReplace();
              if (e.key === "Escape") onClose();
            }}
          />
          <div className="replace-actions">
            <button className="text-button" onClick={onReplace} disabled={!matches.length}>{t("find.replaceOne")}</button>
            <button className="text-button" onClick={onReplaceAll} disabled={!matches.length}>{t("find.replaceAll")}</button>
          </div>
        </div>
      ) : (
        <button className="link-button" onClick={() => onChange({ mode: "replace" })}>
          {icons.replace}
          {t("cmd.edit.replace")}
        </button>
      )}
      <ol className="find-results">
        {matches.slice(0, 500).map((m, i) => {
          const ctx = matchContext(doc, m);
          return (
            <li key={`${m.block}:${m.start}`}>
              <button aria-current={i === state.current} onMouseDown={keepFocus} onClick={() => onGo(i)}>
                {ctx.before}
                <mark>{ctx.match}</mark>
                {ctx.after}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
