// Aba Design da faixa de opções, na organização do Word: Plano de Fundo da
// Página (Marca d'Água, Cor da Página e Bordas da Página). O documento fica
// com o App; aqui ficam os botões, a galeria, os diálogos e os ícones da aba.

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type SVGProps } from "react";
import { createPortal } from "react-dom";
import { FontColorMenu, keepFocus, MenuButton, MenuItem } from "./controls";
import {
  BORDER_WIDTHS,
  borderStyle,
  borderWidthLabel,
  DEFAULT_BORDER,
  DEFAULT_WATERMARK,
  MAX_WATERMARK_CHARS,
  validWatermark,
  WATERMARK_PRESETS,
} from "./design";
import { useI18n, type MessageKey } from "./i18n";
import type { PageBorder, PageSetup, Watermark } from "./types";

export interface DesignTabProps {
  page: PageSetup;
  watermark: Watermark | null;
  /** Grava a página inteira (`page.set`), com a cor e a borda. */
  onPage: (page: PageSetup) => void;
  /** `watermark.set`; `null` remove. */
  onWatermark: (value: Watermark | null) => void;
}

export function DesignTab({ page, watermark, onPage, onWatermark }: DesignTabProps) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<"watermark" | "borders" | null>(null);
  const setBackground = (color: string | null) => {
    const { background: _old, ...rest } = page;
    onPage(color ? { ...rest, background: color } : rest);
  };
  const setBorder = (border: PageBorder | null) => {
    const { border: _old, ...rest } = page;
    onPage(border ? { ...rest, border } : rest);
  };
  return (
    <RibbonGroup label={t("group.pageBackground")}>
      <MenuButton
        label={t("design.watermark")}
        title={t("design.watermarkTip")}
        className="big-button"
        menuClass="watermark-menu"
        render={(close) => (
          <>
            {(["confidential", "disclaimers"] as const).map((group) => (
              <div key={group}>
                <div className="menu-heading">{t(group === "confidential" ? "design.watermarkConfidential" : "design.watermarkDisclaimers")}</div>
                <div className="watermark-gallery">
                  {WATERMARK_PRESETS.filter((p) => p.group === group).flatMap((p) =>
                    (["diagonal", "horizontal"] as const).map((layout) => {
                      const value: Watermark = { ...DEFAULT_WATERMARK, text: p.text, layout };
                      const name = `${p.text} (${t(`design.${layout}`)})`;
                      return (
                        <button
                          key={`${p.text}-${layout}`}
                          className="watermark-tile"
                          title={name}
                          aria-label={name}
                          aria-pressed={watermark?.text === value.text && watermark.layout === layout}
                          onClick={() => {
                            close();
                            onWatermark(value);
                          }}
                        >
                          <span className={`watermark-tile-text ${layout}`}>{p.text}</span>
                        </button>
                      );
                    }),
                  )}
                </div>
              </div>
            ))}
            <MenuItem
              onSelect={() => {
                close();
                setDialog("watermark");
              }}
            >
              {t("design.customWatermark")}
            </MenuItem>
            {watermark && (
              <MenuItem
                onSelect={() => {
                  close();
                  onWatermark(null);
                }}
              >
                {t("design.removeWatermark")}
              </MenuItem>
            )}
          </>
        )}
      >
        {designIcons.watermark}
        <span>{t("design.watermark")}</span>
      </MenuButton>
      <MenuButton
        label={t("design.pageColor")}
        title={t("design.pageColorTip")}
        className="big-button"
        render={(close) => <FontColorMenu close={close} onPick={setBackground} autoLabel="color.none" />}
      >
        <span className="color-icon">
          {designIcons.pageColor}
          <span className="color-bar" style={{ background: page.background ?? "transparent" }} />
        </span>
        <span>{t("design.pageColor")}</span>
      </MenuButton>
      <button className="big-button" onMouseDown={keepFocus} onClick={() => setDialog("borders")} title={t("design.pageBordersTip")}>
        {designIcons.pageBorders}
        <span>{t("design.pageBorders")}</span>
      </button>
      {dialog === "watermark" && (
        <WatermarkDialog
          value={watermark}
          onApply={onWatermark}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "borders" && (
        <PageBordersDialog
          value={page.border ?? null}
          onApply={(border) => {
            setDialog(null);
            setBorder(border);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </RibbonGroup>
  );
}

/** Caixa de diálogo no <body>, fora da faixa de opções; Esc fecha. */
function Modal({ title, className = "", onClose, children }: { title: string; className?: string; onClose: () => void; children: ReactNode }) {
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
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-title">{title}</div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Marca d'Água Personalizada, como "Marca d'Água Impressa" no Word: Aplicar não fecha. */
export function WatermarkDialog({
  value,
  onApply,
  onClose,
}: {
  value: Watermark | null;
  onApply: (value: Watermark | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [on, setOn] = useState(value !== null);
  const [draft, setDraft] = useState<Watermark>(value ?? DEFAULT_WATERMARK);
  const [error, setError] = useState(false);
  const text = useRef<HTMLInputElement>(null);
  useEffect(() => text.current?.select(), []);
  const apply = () => {
    const next = on ? { ...draft, text: draft.text.trim(), color: draft.color.toUpperCase() } : null;
    if (next && !validWatermark(next)) {
      setError(true);
      return false;
    }
    onApply(next);
    return true;
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (apply()) onClose();
  };
  return (
    <Modal title={t("design.watermark")} className="watermark-dialog" onClose={onClose}>
      <form onSubmit={submit} className="dialog-form">
        <label className="check">
          <input type="radio" name="wm-kind" checked={!on} onChange={() => setOn(false)} />
          <span>{t("design.noWatermark")}</span>
        </label>
        <label className="check">
          <input type="radio" name="wm-kind" checked={on} onChange={() => setOn(true)} />
          <span>{t("design.textWatermark")}</span>
        </label>
        <fieldset className="dialog-fieldset" disabled={!on}>
          <label>
            <span>{t("design.text")}</span>
            <input
              ref={text}
              list="watermark-texts"
              maxLength={MAX_WATERMARK_CHARS}
              value={draft.text}
              aria-invalid={error}
              onChange={(e) => {
                setDraft({ ...draft, text: e.target.value });
                setError(false);
              }}
            />
            <datalist id="watermark-texts">
              {WATERMARK_PRESETS.map((p) => (
                <option key={p.text} value={p.text} />
              ))}
            </datalist>
          </label>
          <div className="dialog-row">
            <label>
              <span>{t("design.color")}</span>
              <input type="color" value={draft.color.toLowerCase()} onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.semitransparent} onChange={(e) => setDraft({ ...draft, semitransparent: e.target.checked })} />
              <span>{t("design.semitransparent")}</span>
            </label>
          </div>
          <div className="dialog-row" role="radiogroup" aria-label={t("design.layout")}>
            <span className="dialog-label">{t("design.layout")}</span>
            {(["diagonal", "horizontal"] as const).map((layout) => (
              <label key={layout} className="check">
                <input type="radio" name="wm-layout" checked={draft.layout === layout} onChange={() => setDraft({ ...draft, layout })} />
                <span>{t(`design.${layout}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p className="dialog-error">{t("design.invalidWatermark")}</p>}
        <div className="modal-actions">
          <button type="button" className="bs-secondary push-left" onClick={apply}>
            {t("design.apply")}
          </button>
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

const BORDER_SETTINGS: { id: "none" | PageBorder["style"]; label: MessageKey }[] = [
  { id: "none", label: "design.borderNone" },
  { id: "single", label: "design.borderBox" },
  { id: "shadow", label: "design.borderShadow" },
  { id: "double", label: "design.borderDouble" },
];

/** Bordas da Página: Definição (Nenhuma, Caixa, Sombra, Dupla), cor e largura, com a visualização. */
export function PageBordersDialog({
  value,
  onApply,
  onClose,
}: {
  value: PageBorder | null;
  onApply: (value: PageBorder | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [setting, setSetting] = useState<"none" | PageBorder["style"]>(value?.style ?? "none");
  const [draft, setDraft] = useState<PageBorder>(value ?? DEFAULT_BORDER);
  const border = setting === "none" ? null : { ...draft, style: setting };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(border);
  };
  return (
    <Modal title={t("design.pageBorders")} className="borders-dialog" onClose={onClose}>
      <form onSubmit={submit} className="dialog-form">
        <div className="borders-body">
          <div className="border-settings" role="radiogroup" aria-label={t("design.borderSetting")}>
            <span className="dialog-label">{t("design.borderSetting")}</span>
            {BORDER_SETTINGS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={setting === s.id}
                className="border-setting"
                onClick={() => setSetting(s.id)}
              >
                <span className="border-thumb" style={s.id === "none" ? undefined : borderStyle({ ...DEFAULT_BORDER, style: s.id, width: 6 })} />
                <span>{t(s.label)}</span>
              </button>
            ))}
          </div>
          <div className="borders-options">
            <label>
              <span>{t("design.color")}</span>
              <input type="color" disabled={!border} value={draft.color.toLowerCase()} onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })} />
            </label>
            <label>
              <span>{t("design.borderWidth")}</span>
              <select disabled={!border} value={draft.width} onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}>
                {BORDER_WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {borderWidthLabel(w)}
                  </option>
                ))}
              </select>
            </label>
            <div className="border-preview" aria-hidden="true">
              <span className="border-preview-page">{border && <span className="border-preview-line" style={borderStyle(border)} />}</span>
            </div>
          </div>
        </div>
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

/** Mesmo desenho dos grupos do Ribbon: botões em cima, nome do grupo embaixo. */
function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="group" role="group" aria-label={label}>
      <div className="group-body">{children}</div>
      <div className="group-label">{label}</div>
    </div>
  );
}

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const designIcons = {
  /** Página com um "A" claro na diagonal: Marca d'Água. */
  watermark: (
    <Icon>
      <path d="M5 2.5h7l3.5 3.5v11.5H5z" />
      <path d="M12 2.5V6h3.5" />
      <path d="M7.5 15l3-7 2.5 5.5M8.8 12.2h3.4" strokeWidth="1.4" opacity="0.6" />
    </Icon>
  ),
  /** Balde de tinta: Cor da Página. */
  pageColor: (
    <Icon>
      <path d="M4 9.5L9.5 4l6 6-5.5 5.5a1.5 1.5 0 0 1-2.1 0L4 11.6a1.5 1.5 0 0 1 0-2.1z" />
      <path d="M7 3l3 3M4.5 10.5h10.5" />
      <path d="M17 12.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8z" />
    </Icon>
  ),
  /** Página com uma moldura por dentro: Bordas da Página. */
  pageBorders: (
    <Icon>
      <path d="M4 2.5h12v15H4z" />
      <path d="M6.5 5h7v10h-7z" strokeWidth="1.3" />
    </Icon>
  ),
};
