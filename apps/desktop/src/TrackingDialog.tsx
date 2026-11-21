// Nome de quem faz as alterações, pedido ao ligar Controlar Alterações pela primeira vez.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "./i18n";
import { Modal } from "./Insert";

export function AuthorDialog({ initial, onApply, onClose }: { initial: string; onApply: (name: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const clean = name.replace(/[|\r\n]/g, " ").trim().slice(0, 255);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (clean) onApply(clean);
  };
  return (
    <Modal title={t("track.authorTitle")} onClose={onClose}>
      <form onSubmit={submit} className="dialog-form">
        <p className="dialog-note">{t("track.authorHint")}</p>
        <label>
          <span>{t("track.authorName")}</span>
          <input ref={field} value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="submit" className="bs-primary" disabled={!clean}>
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
