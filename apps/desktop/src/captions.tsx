// Caixas de Legendas (Referências): Inserir Legenda, Inserir Índice de
// Ilustrações e Referência Cruzada, como as do Word. As regras ficam em captions.ts.

import { useEffect, useRef, useState } from "react";
import { CAPTION_LABELS, CAPTION_SEPARATOR, HEADING_KIND, documentLabels, isCaptionLabel, nextNumber, refItems, type CaptionPosition, type RefKind } from "./captions";
import { useI18n } from "./i18n";
import { Modal } from "./Insert";
import type { BlockView, RefShow } from "./types";

/** Rótulos para escolher: os do Nova, os do documento e os criados nesta sessão. */
function allLabels(blocks: BlockView[], extra: string[] = []): string[] {
  const out = [...CAPTION_LABELS];
  for (const l of [...documentLabels(blocks), ...extra]) if (!out.includes(l)) out.push(l);
  return out;
}

/** Inserir Legenda: rótulo, posição e a descrição, com a prévia "Figura 3 – Mapa". */
export function CaptionDialog({
  blocks,
  caretBlock,
  inTable,
  onInsert,
  onClose,
}: {
  blocks: BlockView[];
  caretBlock: number;
  /** Com o cursor numa tabela, a legenda vai acima dela (ABNT) e o rótulo começa em Tabela. */
  inTable: boolean;
  onInsert: (label: string, position: CaptionPosition, description: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState<string[]>([]);
  const [label, setLabel] = useState(inTable ? "Tabela" : "Figura");
  const [position, setPosition] = useState<CaptionPosition>("above");
  const [description, setDescription] = useState("");
  const [newLabel, setNewLabel] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [newLabel === null]);
  const labels = allLabels(blocks, custom);
  const n = nextNumber(blocks, label, position === "above" ? caretBlock : caretBlock + 1);
  if (newLabel !== null) {
    const valid = isCaptionLabel(newLabel.trim());
    return (
      <Modal title={t("cap.newLabel")} onClose={() => setNewLabel(null)}>
        <form
          className="dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            const l = newLabel.trim();
            setCustom((old) => (old.includes(l) ? old : [...old, l]));
            setLabel(l);
            setNewLabel(null);
          }}
        >
          <label>
            <span>{t("cap.label")}</span>
            <input ref={input} name="newLabel" value={newLabel} maxLength={32} onChange={(e) => setNewLabel(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="submit" className="bs-primary" disabled={!valid}>
              {t("cap.ok")}
            </button>
            <button type="button" className="bs-secondary" onClick={() => setNewLabel(null)}>
              {t("save.cancel")}
            </button>
          </div>
        </form>
      </Modal>
    );
  }
  return (
    <Modal title={t("cap.insert")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          onInsert(label, position, description);
        }}
      >
        <label>
          <span>{t("cap.description")}</span>
          <input ref={input} name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("cap.descriptionHint")} />
        </label>
        <label>
          <span>{t("cap.label")}</span>
          <select name="label" value={label} onChange={(e) => setLabel(e.target.value)}>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("cap.position")}</span>
          <select name="position" value={position} onChange={(e) => setPosition(e.target.value as CaptionPosition)}>
            <option value="above">{t("cap.above")}</option>
            <option value="below">{t("cap.below")}</option>
          </select>
        </label>
        <p className="source-preview caption-preview">{`${label} ${n}${description.trim() ? `${CAPTION_SEPARATOR}${description.trim()}` : ""}`}</p>
        <div className="modal-actions">
          <button type="button" className="bs-secondary push-left" onClick={() => setNewLabel("")}>
            {t("cap.newLabelButton")}
          </button>
          <button type="submit" className="bs-primary">
            {t("cap.ok")}
          </button>
          <button type="button" className="bs-secondary" onClick={onClose}>
            {t("save.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Inserir Índice de Ilustrações: o rótulo das legendas que entram na lista. */
export function FigureIndexDialog({ blocks, onInsert, onClose }: { blocks: BlockView[]; onInsert: (label: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const labels = allLabels(blocks);
  const used = documentLabels(blocks);
  const [label, setLabel] = useState(used[0] ?? "Figura");
  const select = useRef<HTMLSelectElement>(null);
  useEffect(() => select.current?.focus(), []);
  return (
    <Modal title={t("cap.indexTitle")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          onInsert(label);
        }}
      >
        <label>
          <span>{t("cap.indexLabel")}</span>
          <select ref={select} name="label" value={label} onChange={(e) => setLabel(e.target.value)}>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="submit" className="bs-primary">
            {t("cap.ok")}
          </button>
          <button type="button" className="bs-secondary" onClick={onClose}>
            {t("save.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Referência Cruzada: tipo (um rótulo ou Título), o que mostrar e o item. */
export function CrossRefDialog({
  blocks,
  onInsert,
  onClose,
}: {
  blocks: BlockView[];
  onInsert: (target: number, show: RefShow) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const kinds: RefKind[] = [...allLabels(blocks), HEADING_KIND];
  const used = documentLabels(blocks);
  const [kind, setKind] = useState<RefKind>(used[0] ?? (refItems(blocks, HEADING_KIND).length ? HEADING_KIND : "Figura"));
  const [show, setShow] = useState<RefShow>("label");
  const items = refItems(blocks, kind);
  const [chosen, setChosen] = useState<number | null>(null);
  const target = items.some((i) => i.block === chosen) ? chosen : (items[0]?.block ?? null);
  const list = useRef<HTMLSelectElement>(null);
  useEffect(() => list.current?.focus(), []);
  return (
    <Modal title={t("cap.xrefTitle")} className="xref-dialog" onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (target !== null) onInsert(target, show);
        }}
      >
        <label>
          <span>{t("cap.xrefKind")}</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k === HEADING_KIND ? t("cap.heading") : k}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("cap.xrefShow")}</span>
          <select name="show" value={show} onChange={(e) => setShow(e.target.value as RefShow)}>
            <option value="label">{kind === HEADING_KIND ? t("cap.showHeading") : t("cap.showLabel")}</option>
            <option value="page">{t("cap.showPage")}</option>
          </select>
        </label>
        <label>
          <span>{t("cap.xrefItem")}</span>
          <select ref={list} name="item" size={6} value={target === null ? "" : String(target)} onChange={(e) => setChosen(Number(e.target.value))}>
            {items.map((i) => (
              <option key={i.block} value={i.block}>
                {i.text}
              </option>
            ))}
          </select>
        </label>
        {!items.length && <p className="dialog-note">{t("cap.xrefNone")}</p>}
        <div className="modal-actions">
          <button type="submit" className="bs-primary" disabled={target === null}>
            {t("cap.insertButton")}
          </button>
          <button type="button" className="bs-secondary" onClick={onClose}>
            {t("save.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
