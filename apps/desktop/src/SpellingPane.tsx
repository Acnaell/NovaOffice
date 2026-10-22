// Painel Ortografia (Revisão › Ortografia e Gramática, F7), à direita como o
// do Word: mostra um erro por vez, com o trecho em volta e as sugestões, e
// segue para o próximo depois de Alterar ou Ignorar. A palavra atual fica
// destacada no documento mesmo com o foco no painel.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "./api";
import { matchContext, type Match } from "./find";
import { useI18n, type MessageKey } from "./i18n";
import { icons } from "./icons";
import { posToDom } from "./dom";
import { nextError, occurrenceKey } from "./proofread";
import type { Proofing } from "./spell";
import type { DocView, Pos } from "./types";

interface Props {
  view: DocView;
  /** Todas as palavras erradas conhecidas (`useSpelling().all`). */
  matches: Match[];
  /** O corretor já respondeu por todos os parágrafos. */
  ready: boolean;
  proofing: Proofing;
  /** Onde a revisão começa (o cursor quando o painel abriu). */
  start: Pos;
  /** Muda a cada F7: recomeça do cursor. */
  token: number;
  onSelect: (m: Match) => void;
  onChange: (m: Match, word: string, replacement: string) => void;
  onChangeAll: (word: string, replacement: string) => void;
  /** Depois de Ignorar Tudo ou Adicionar ao Dicionário. */
  onRecheck: () => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}

const HIGHLIGHT = "nova-spell-current";

export function SpellingPane(props: Props) {
  const { view, matches, ready, proofing, start, token } = props;
  const { t } = useI18n();
  const [from, setFrom] = useState(start);
  const [once, setOnce] = useState<ReadonlySet<string>>(new Set());
  const [words, setWords] = useState<ReadonlySet<string>>(new Set());
  // Depois de Alterar, espera o documento novo antes de seguir.
  const [waitFor, setWaitFor] = useState<DocView | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [picked, setPicked] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const last = useRef<Match | null>(null);

  useEffect(() => {
    setFrom(start);
    setOnce(new Set());
    setWords(new Set());
    setWaitFor(null);
    // Só a cada F7: `start` muda junto com `token`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Se a troca falhar, o documento não muda; não fica esperando para sempre.
  useEffect(() => {
    if (!waitFor) return;
    const timer = setTimeout(() => setWaitFor(null), 2000);
    return () => clearTimeout(timer);
  }, [waitFor]);

  const off = proofing === "off";
  const settled = !off && ready && view !== waitFor;
  const current = useMemo(
    () => (settled ? nextError(view, matches, from, { once, words }) : last.current),
    [settled, view, matches, from, once, words],
  );
  last.current = current;
  const word = current ? matchContext(view, current, 0).match : "";
  const key = current ? occurrenceKey(current, word) : "";
  const done = settled && !current;

  // Leva a seleção do documento até o erro atual.
  useEffect(() => {
    if (current && settled) props.onSelect(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settled]);

  useEffect(() => {
    if (!word || off) return;
    let live = true;
    setSuggestions(null);
    setPicked(0);
    api.spellSuggest(proofing, word).then(
      (s) => live && setSuggestions(Array.isArray(s) ? s : []),
      () => live && setSuggestions([]),
    );
    return () => {
      live = false;
    };
  }, [word, proofing, off]);

  // Destaque da palavra atual, que o Editor não pinta (a seleção só aparece com o foco nele).
  useLayoutEffect(() => {
    const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    const root = document.querySelector<HTMLElement>(".page");
    if (!registry || !HighlightCtor || !root) return;
    const range = current ? matchRange(root, current) : null;
    registry.set(HIGHLIGHT, new HighlightCtor(...(range ? [range] : [])));
  }, [view, current]);

  useEffect(
    () => () => {
      (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.delete(HIGHLIGHT);
    },
    [],
  );

  // Rola o documento até o erro.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".page");
    const range = root && current ? matchRange(root, current) : null;
    const el = range?.startContainer.parentElement;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(".proof-focus")?.focus();
  }, [key, done]);

  const replacement = suggestions?.[picked];

  const change = (all: boolean, chosen = replacement) => {
    if (!current || !chosen || !settled) return;
    if (all) props.onChangeAll(word, chosen);
    else props.onChange(current, word, chosen);
    setFrom({ block: current.block, offset: current.start + chosen.length });
    setWaitFor(view);
  };

  const ignoreOnce = () => {
    if (!current) return;
    setOnce((s) => new Set(s).add(key));
    setFrom({ block: current.block, offset: current.end });
  };

  const remember = (action: "ignore" | "add") => {
    if (!current || off) return;
    setWords((s) => new Set(s).add(word));
    (action === "add" ? api.spellAddWord(proofing, word) : api.spellIgnoreAll(proofing, word)).then(
      props.onRecheck,
      props.onError,
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };

  const context = current ? matchContext(view, current, 40) : null;

  return (
    <aside className="proof-pane" ref={panel} aria-label={t("proof.title")} onKeyDown={onKeyDown}>
      <div className="find-header">
        <h2>{t("proof.title")}</h2>
        <button className="icon-button" onClick={props.onClose} title={t("proof.close")} aria-label={t("proof.close")}>
          {icons.close}
        </button>
      </div>
      {off ? (
        <p className="proof-message">{t("proof.off")}</p>
      ) : done ? (
        <div className="proof-done" role="status">
          <p className="proof-message">{t("proof.done")}</p>
          <button className="text-button proof-focus" onClick={props.onClose}>
            {t("proof.ok")}
          </button>
        </div>
      ) : !current ? (
        <p className="proof-message">{t("proof.checking")}</p>
      ) : (
        <>
          <div className="proof-kind">{t("proof.notInDictionary")}</div>
          {context && (
            <p className="proof-context">
              {context.before}
              <mark>{context.match}</mark>
              {context.after}
            </p>
          )}
          <div className="proof-actions">
            <button className="text-button" onClick={ignoreOnce} disabled={!settled}>
              {t("proof.ignoreOnce")}
            </button>
            <button className="text-button" onClick={() => remember("ignore")} disabled={!settled}>
              {t("spell.ignoreAll")}
            </button>
            <button className="text-button" onClick={() => remember("add")} disabled={!settled}>
              {t("spell.add")}
            </button>
          </div>
          <div className="proof-label" id="proof-suggestions">
            {t("proof.suggestions")}
          </div>
          {suggestions === null ? (
            <p className="proof-message">{t("spell.loading")}</p>
          ) : suggestions.length === 0 ? (
            <p className="proof-message">{t("proof.noSuggestions")}</p>
          ) : (
            <ul className="proof-suggestions" role="listbox" aria-labelledby="proof-suggestions">
              {suggestions.map((s, i) => (
                <li key={s}>
                  <button
                    role="option"
                    aria-selected={i === picked}
                    className={i === picked ? "proof-focus" : undefined}
                    onClick={() => setPicked(i)}
                    onDoubleClick={() => change(false, s)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        change(false);
                      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const next = Math.max(0, Math.min(suggestions.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
                        setPicked(next);
                        (e.currentTarget.parentElement?.parentElement?.children[next]?.firstElementChild as HTMLElement | null)?.focus();
                      }
                    }}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="proof-actions proof-change">
            <button className="text-button primary" onClick={() => change(false)} disabled={!settled || !replacement}>
              {t("proof.change")}
            </button>
            <button className="text-button" onClick={() => change(true)} disabled={!settled || !replacement}>
              {t("proof.changeAll")}
            </button>
          </div>
        </>
      )}
      <div className="proof-language">{off ? t("spell.off") : t(`spell.lang.${proofing}` as MessageKey)}</div>
    </aside>
  );
}

function matchRange(root: HTMLElement, m: Match): Range | null {
  const start = posToDom(root, { block: m.block, offset: m.start });
  const end = posToDom(root, { block: m.block, offset: m.end });
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  return range;
}
