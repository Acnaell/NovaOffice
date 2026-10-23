// Opções de AutoCorreção (Revisão › AutoCorreção), no modelo da janela do
// Word: as caixas de cada correção e a lista "Substituir / Por", editável.

import { useEffect, useRef, useState } from "react";
import { DEFAULT_REPLACEMENTS, type AutoCorrectOptions } from "./autocorrect";
import { useI18n } from "./i18n";

interface Props {
  options: AutoCorrectOptions;
  onSave: (options: AutoCorrectOptions) => void;
  onClose: () => void;
}

type Flag = "capitalize" | "smartQuotes" | "dashes" | "replaceText";
const FLAGS: Flag[] = ["capitalize", "smartQuotes", "dashes", "replaceText"];

export function AutoCorrectDialog({ options, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(options);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
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

  const existing = draft.replacements.findIndex(([f]) => f === from);
  const save = () => {
    if (!from) return;
    const replacements = [...draft.replacements];
    if (existing >= 0) replacements[existing] = [from, to];
    else replacements.push([from, to]);
    setDraft({ ...draft, replacements });
    setFrom("");
    setTo("");
  };
  const remove = () => {
    if (existing < 0) return;
    setDraft({ ...draft, replacements: draft.replacements.filter((_, i) => i !== existing) });
    setFrom("");
    setTo("");
  };

  return (
    <div className="modal-backdrop">
      <div className="modal autocorrect" role="dialog" aria-modal="true" aria-labelledby="autocorrect-title">
        <h2 id="autocorrect-title">{t("autocorrect.title")}</h2>
        <div className="autocorrect-flags">
          {FLAGS.map((flag, i) => (
            <label key={flag}>
              <input
                ref={i === 0 ? first : undefined}
                type="checkbox"
                checked={draft[flag]}
                onChange={(e) => setDraft({ ...draft, [flag]: e.target.checked })}
              />
              {t(`autocorrect.${flag}`)}
            </label>
          ))}
        </div>
        <div className="autocorrect-edit">
          <label>
            {t("autocorrect.replace")}
            <input value={from} onChange={(e) => setFrom(e.target.value)} disabled={!draft.replaceText} aria-label={t("autocorrect.replace")} />
          </label>
          <label>
            {t("autocorrect.with")}
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              disabled={!draft.replaceText}
              aria-label={t("autocorrect.with")}
            />
          </label>
        </div>
        <div className="autocorrect-list" role="listbox" aria-label={t("autocorrect.list")}>
          {draft.replacements.map(([f, r]) => (
            <button
              key={f}
              role="option"
              aria-selected={f === from}
              disabled={!draft.replaceText}
              onClick={() => {
                setFrom(f);
                setTo(r);
              }}
            >
              <span>{f}</span>
              <span>{r}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions autocorrect-row">
          <button className="bs-secondary" onClick={save} disabled={!draft.replaceText || !from || !to}>
            {existing >= 0 ? t("autocorrect.update") : t("autocorrect.add")}
          </button>
          <button className="bs-secondary" onClick={remove} disabled={!draft.replaceText || existing < 0}>
            {t("autocorrect.remove")}
          </button>
          <button className="bs-secondary" onClick={() => setDraft({ ...draft, replacements: DEFAULT_REPLACEMENTS })} disabled={!draft.replaceText}>
            {t("autocorrect.reset")}
          </button>
        </div>
        <div className="modal-actions">
          <button className="bs-primary" onClick={() => onSave(draft)}>
            {t("autocorrect.ok")}
          </button>
          <button className="bs-secondary" onClick={onClose}>
            {t("save.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
