// "Deseja salvar as alterações em …?" com Salvar, Não Salvar e Cancelar,
// como no Word. Aparece ao fechar a janela, criar ou abrir outro documento.

import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";
import { BrandMark } from "./icons";

export type SaveChoice = "save" | "discard" | "cancel";

export function SaveChangesDialog({ title, onChoose }: { title: string; onChoose: (choice: SaveChoice) => void }) {
  const { t } = useI18n();
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    save.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onChoose("cancel");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onChoose]);
  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="save-title">
        <div className="modal-head">
          <BrandMark app="text" size={22} />
          <span>Nova Text</span>
        </div>
        <p id="save-title">{t("save.question", { title })}</p>
        <p className="modal-sub">{t("save.detail")}</p>
        <div className="modal-actions">
          <button ref={save} className="bs-primary" onClick={() => onChoose("save")}>{t("save.save")}</button>
          <button className="bs-secondary" onClick={() => onChoose("discard")}>{t("save.discard")}</button>
          <button className="bs-secondary" onClick={() => onChoose("cancel")}>{t("save.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
