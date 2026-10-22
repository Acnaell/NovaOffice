// Controles da faixa de opções: menus suspensos, botão dividido, seletores de
// fonte, tamanho e cor. Botões cancelam o mousedown para não tirar o foco nem
// a seleção do documento; campos de texto devolvem o foco ao terminar.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HIGHLIGHT_CSS } from "./clipboard";
import { DEFAULT_FONT, FONT_SIZES } from "./formatting";
import { useI18n, type MessageKey } from "./i18n";
import { BRAND, icons } from "./icons";
import type { HighlightColor } from "./types";

export const keepFocus = (e: MouseEvent) => e.preventDefault();

// ---------- Menu suspenso ----------

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Painel flutuante abaixo do botão. Fica no <body> para não ser cortado pela faixa de opções. */
export function Popover({ anchor, open, onClose, children, className = "" }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = ref.current?.offsetWidth ?? 0;
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - width - 4)), top: r.bottom + 2 });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onMouseDown={(e) => {
        // Cliques no menu não tiram o foco do documento, exceto em campos.
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Botão que abre um menu. `render` recebe a função de fechar. */
export function MenuButton({
  label,
  title,
  className = "",
  children,
  render,
  menuClass,
  disabled,
}: {
  label: string;
  title?: string;
  className?: string;
  children: ReactNode;
  render: (close: () => void) => ReactNode;
  menuClass?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        className={`menu-button ${className}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? label}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
        {icons.caret}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} className={menuClass}>
        {render(() => setOpen(false))}
      </Popover>
    </>
  );
}

export function MenuItem({ children, onSelect, checked, icon }: { children: ReactNode; onSelect: () => void; checked?: boolean; icon?: ReactNode }) {
  return (
    <button className="menu-item" role="menuitemradio" aria-checked={!!checked} onClick={onSelect}>
      <span className="menu-check">{icon ?? (checked ? "✓" : "")}</span>
      <span className="menu-text">{children}</span>
    </button>
  );
}

/** Botão dividido: a parte principal repete a última escolha; a seta abre o menu. */
export function SplitButton({
  label,
  title,
  icon,
  onMain,
  render,
  pressed,
  menuClass,
}: {
  label: string;
  title?: string;
  icon: ReactNode;
  onMain: () => void;
  render: (close: () => void) => ReactNode;
  pressed?: boolean;
  menuClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="split" ref={ref}>
      <button
        className="split-main icon-button"
        aria-label={label}
        aria-pressed={pressed}
        title={title ?? label}
        onMouseDown={keepFocus}
        onClick={onMain}
      >
        {icon}
      </button>
      <button
        className="split-arrow"
        aria-label={`${label}: opções`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? label}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        {icons.caret}
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} className={menuClass}>
        {render(() => setOpen(false))}
      </Popover>
    </div>
  );
}

// ---------- Fonte ----------

/** Fontes comuns no Windows, macOS e Linux; só as instaladas aparecem. */
const CANDIDATE_FONTS = [
  "Arial", "Arial Black", "Arial Narrow", "Bahnschrift", "Book Antiqua", "Bookman Old Style", "Calibri",
  "Calibri Light", "Cambria", "Candara", "Caladea", "Carlito", "Century Gothic", "Comic Sans MS", "Consolas",
  "Constantia", "Corbel", "Courier New", "DejaVu Sans", "DejaVu Serif", "Ebrima", "Franklin Gothic Medium",
  "Gabriola", "Garamond", "Georgia", "Helvetica", "Helvetica Neue", "Impact", "Inter", "Liberation Mono",
  "Liberation Sans", "Liberation Serif", "Lucida Console", "Lucida Sans Unicode", "Menlo", "Noto Sans",
  "Noto Serif", "Open Sans", "Palatino Linotype", "Roboto", "Segoe Print", "Segoe Script", "Segoe UI",
  "SF Pro Text", "Sitka Text", "Sylfaen", "Tahoma", "Times New Roman", "Trebuchet MS", "Ubuntu", "Verdana",
];

let installedCache: string[] | null = null;

/** Detecta fontes instaladas medindo o texto contra as genéricas (funciona em qualquer WebView). */
export function installedFonts(): string[] {
  if (installedCache) return installedCache;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (installedCache = CANDIDATE_FONTS);
  const sample = "mmmmmmmmmmlli1WQ@#ãç";
  const width = (font: string) => {
    ctx.font = `32px ${font}`;
    return ctx.measureText(sample).width;
  };
  const bases = ["monospace", "serif", "sans-serif"].map((b) => [b, width(b)] as const);
  installedCache = CANDIDATE_FONTS.filter((f) => bases.some(([b, w]) => width(`"${f}", ${b}`) !== w));
  if (installedCache.length === 0) installedCache = CANDIDATE_FONTS;
  return installedCache;
}

export function FontPicker({ value, onPick }: { value: string | undefined; onPick: (font: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const shown = text ?? value ?? "";
  const fonts = useMemo(() => (open ? installedFonts() : []), [open]);
  const filter = (text ?? "").toLowerCase();
  const visible = filter ? fonts.filter((f) => f.toLowerCase().includes(filter)) : fonts;

  const pick = (font: string) => {
    setOpen(false);
    setText(null);
    if (font.trim()) onPick(font.trim());
  };

  return (
    <div className="combo font-combo" ref={wrap}>
      <input
        aria-label={t("font.family")}
        title={t("font.family")}
        value={shown}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          // O Enter não pode seguir para o documento depois que o foco voltar para ele.
          if (e.key === "Enter" || e.key === "Escape") e.preventDefault();
          if (e.key === "Enter") pick(shown);
          if (e.key === "Escape") {
            setOpen(false);
            setText(null);
            onPick("");
          }
          if (e.key === "ArrowDown") setOpen(true);
        }}
        onBlur={() => setText(null)}
      />
      <button className="combo-arrow" aria-label={t("font.family")} onMouseDown={keepFocus} onClick={() => setOpen((o) => !o)}>
        {icons.caret}
      </button>
      <Popover anchor={wrap.current} open={open} onClose={() => setOpen(false)} className="font-menu">
        {!filter && (
          <>
            <div className="menu-heading">{t("font.themeFonts")}</div>
            <button className="font-item" onClick={() => pick("Calibri Light")} style={{ fontFamily: "'Calibri Light', 'Carlito', sans-serif" }}>
              Calibri Light <small>{t("font.headings")}</small>
            </button>
            <button className="font-item" onClick={() => pick(DEFAULT_FONT)} style={{ fontFamily: `'${DEFAULT_FONT}', 'Carlito', sans-serif` }}>
              {DEFAULT_FONT} <small>{t("font.body")}</small>
            </button>
            <div className="menu-heading">{t("font.allFonts")}</div>
          </>
        )}
        {visible.map((f) => (
          <button key={f} className="font-item" aria-checked={f === value} onClick={() => pick(f)} style={{ fontFamily: `'${f}'` }}>
            {f}
          </button>
        ))}
      </Popover>
    </div>
  );
}

export function SizePicker({ value, onPick }: { value: number | undefined; onPick: (pt: number | null) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const shown = text ?? (value === undefined ? "" : String(value).replace(".", ","));
  const pick = (raw: string) => {
    setOpen(false);
    setText(null);
    const pt = Number(raw.replace(",", "."));
    // Como no Word: meio ponto é o menor passo; 1 a 1638 pt.
    onPick(Number.isFinite(pt) && pt >= 1 && pt <= 1638 ? Math.round(pt * 2) / 2 : null);
  };
  return (
    <div className="combo size-combo" ref={wrap}>
      <input
        aria-label={t("font.size")}
        title={t("font.size")}
        value={shown}
        inputMode="decimal"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") e.preventDefault();
          if (e.key === "Enter") pick(shown);
          if (e.key === "Escape") {
            setText(null);
            onPick(null);
          }
          if (e.key === "ArrowDown") setOpen(true);
        }}
        onBlur={() => setText(null)}
      />
      <button className="combo-arrow" aria-label={t("font.size")} onMouseDown={keepFocus} onClick={() => setOpen((o) => !o)}>
        {icons.caret}
      </button>
      <Popover anchor={wrap.current} open={open} onClose={() => setOpen(false)} className="size-menu">
        {FONT_SIZES.map((s) => (
          <button key={s} className="size-item" aria-checked={s === value} onClick={() => pick(String(s))}>
            {String(s).replace(".", ",")}
          </button>
        ))}
      </Popover>
    </div>
  );
}

// ---------- Cores ----------

/** Cores do tema NovaOffice, na ordem da grade do Word (fundo, texto, destaques). */
const THEME_BASE = ["#FFFFFF", "#000000", "#E7E6E6", BRAND.navy, BRAND.blue, BRAND.green, BRAND.orange, BRAND.lilac, BRAND.gold, BRAND.teal];

/** Cores Padrão do Word. */
export const STANDARD_COLORS = ["#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050", "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0"];

const mix = (hex: string, target: number, amount: number) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c
    .map((v) => Math.round(v + (target - v) * amount).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
};

/** Grade 10 × 6: a cor e variações mais claras (80%, 60%, 40%) e mais escuras (25%, 50%). */
export const THEME_GRID = THEME_BASE.map((base, i) => {
  const variants = i === 0 ? [0.05, 0.15, 0.25, 0.35, 0.5].map((a) => mix(base, 0, a)) : i === 1 ? [0.5, 0.35, 0.25, 0.15, 0.05].map((a) => mix(base, 255, a)) : [
    mix(base, 255, 0.8), mix(base, 255, 0.6), mix(base, 255, 0.4), mix(base, 0, 0.25), mix(base, 0, 0.5),
  ];
  return [base, ...variants];
});

export function FontColorMenu({ onPick, close }: { onPick: (color: string | null) => void; close: () => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const choose = (c: string | null) => {
    onPick(c);
    close();
  };
  return (
    <div className="color-menu" role="menu">
      <button className="menu-item" onClick={() => choose(null)}>
        <span className="swatch" style={{ background: "#000" }} />
        {t("color.auto")}
      </button>
      <div className="menu-heading">{t("color.theme")}</div>
      <div className="swatch-grid theme">
        {Array.from({ length: 6 }, (_, row) =>
          THEME_GRID.map((col) => (
            <button key={`${row}-${col[row]}`} className="swatch" style={{ background: col[row] }} title={col[row]} aria-label={col[row]} onClick={() => choose(col[row])} />
          )),
        )}
      </div>
      <div className="menu-heading">{t("color.standard")}</div>
      <div className="swatch-grid">
        {STANDARD_COLORS.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} title={c} aria-label={c} onClick={() => choose(c)} />
        ))}
      </div>
      <button className="menu-item" onClick={() => input.current?.click()}>
        <span className="swatch rainbow" />
        {t("color.more")}
      </button>
      <input ref={input} type="color" className="hidden-color" onChange={(e) => choose(e.target.value.toUpperCase())} />
    </div>
  );
}

export const HIGHLIGHT_ORDER: HighlightColor[] = [
  "yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan",
  "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray", "black",
];

export function HighlightMenu({ onPick, close }: { onPick: (color: HighlightColor | null) => void; close: () => void }) {
  const { t } = useI18n();
  const choose = (c: HighlightColor | null) => {
    onPick(c);
    close();
  };
  return (
    <div className="color-menu" role="menu">
      <div className="swatch-grid highlight">
        {HIGHLIGHT_ORDER.map((c) => (
          <button
            key={c}
            className="swatch big"
            style={{ background: HIGHLIGHT_CSS[c] }}
            title={t(`hl.${c}` as MessageKey)}
            aria-label={t(`hl.${c}` as MessageKey)}
            onClick={() => choose(c)}
          />
        ))}
      </div>
      <button className="menu-item" onClick={() => choose(null)}>
        <span className="swatch none" />
        {t("color.none")}
      </button>
    </div>
  );
}

/** Ícone com a barra de cor embaixo (cor da fonte e realce mostram a última escolha). */
export function ColorBarIcon({ icon, color }: { icon: ReactNode; color: string }) {
  return (
    <span className="color-icon">
      {icon}
      <span className="color-bar" style={{ background: color }} />
    </span>
  );
}
