// Menu de contexto de uma palavra errada, como o do Word: sugestões em
// negrito, depois Ignorar Tudo e Adicionar ao Dicionário.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { useI18n } from "./i18n";

interface Props {
  word: string;
  language: string;
  x: number;
  y: number;
  onPick: (suggestion: string) => void;
  onIgnoreAll: () => void;
  onAdd: () => void;
  onClose: () => void;
}

export function SpellMenu({ word, language, x, y, onPick, onIgnoreAll, onAdd, onClose }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let live = true;
    api.spellSuggest(language, word).then(
      (s) => live && setSuggestions(Array.isArray(s) ? s : []),
      () => live && setSuggestions([]),
    );
    return () => {
      live = false;
    };
  }, [language, word]);

  // Cabe na janela: abre para cima ou para a esquerda perto das bordas.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    setPos({
      left: Math.max(4, x + w > window.innerWidth - 4 ? x - w : x),
      top: Math.max(4, y + h > window.innerHeight - 4 ? y - h : y),
    });
  }, [x, y, suggestions]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [suggestions]);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    // A rolagem do documento deixaria o menu longe da palavra.
    window.addEventListener("wheel", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onClose, true);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      className="popover spell-menu"
      role="menu"
      aria-label={t("spell.menu", { word })}
      style={pos ?? { left: x, top: y, visibility: "hidden" }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {suggestions === null ? (
        <div className="spell-note">{t("spell.loading")}</div>
      ) : suggestions.length === 0 ? (
        <div className="spell-note">{t("spell.noSuggestions")}</div>
      ) : (
        suggestions.map((s) => (
          <button key={s} className="menu-item spell-suggestion" role="menuitem" onClick={() => onPick(s)}>
            {s}
          </button>
        ))
      )}
      <div className="menu-sep" />
      <button className="menu-item" role="menuitem" onClick={onIgnoreAll}>
        {t("spell.ignoreAll")}
      </button>
      <button className="menu-item" role="menuitem" onClick={onAdd}>
        {t("spell.add")}
      </button>
    </div>,
    document.body,
  );
}
