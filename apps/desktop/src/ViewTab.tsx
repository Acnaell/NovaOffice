// Aba Exibir, como a do Word: Modo de Foco, Mostrar (Régua e Painel de
// Navegação) e Zoom. Aqui ficam também o controle de zoom da barra de
// status, a régua e o Painel de Navegação; o estado fica com o App.

import { useEffect, useRef, type ReactNode, type SVGProps } from "react";
import { keepFocus } from "./controls";
import { useI18n } from "./i18n";
import type { PageSetup } from "./types";
import { currentHeading, rulerTicks, twipsToPx, ZOOM_PRESETS, type Heading } from "./zoom";

export type ZoomFit = "page" | "width";

export interface ViewTabProps {
  zoom: number;
  ruler: boolean;
  navigation: boolean;
  onZoom: (zoom: number) => void;
  onFit: (fit: ZoomFit) => void;
  onRuler: (on: boolean) => void;
  onNavigation: (on: boolean) => void;
  onFocusMode: () => void;
}

export function ViewTab(props: ViewTabProps) {
  const { t } = useI18n();
  const big = (icon: ReactNode, label: string, onClick: () => void, title = label, pressed?: boolean) => (
    <button className="big-button" onMouseDown={keepFocus} onClick={onClick} title={title} aria-pressed={pressed}>
      {icon}
      <span>{label}</span>
    </button>
  );
  const check = (label: string, checked: boolean, onChange: (on: boolean) => void) => (
    <label className="view-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  return (
    <>
      <RibbonGroup label={t("group.immersive")}>
        {big(viewIcons.focus, t("view.focus"), props.onFocusMode, t("view.focusTip"))}
      </RibbonGroup>
      <RibbonGroup label={t("group.show")}>
        <div className="view-checks">
          {check(t("view.ruler"), props.ruler, props.onRuler)}
          {check(t("view.navigation"), props.navigation, props.onNavigation)}
        </div>
      </RibbonGroup>
      <RibbonGroup label={t("group.zoom")}>
        {big(viewIcons.zoom100, "100%", () => props.onZoom(1), t("view.zoom100Tip"), props.zoom === 1)}
        {big(viewIcons.onePage, t("view.onePage"), () => props.onFit("page"))}
        {big(viewIcons.pageWidth, t("view.pageWidth"), () => props.onFit("width"))}
      </RibbonGroup>
    </>
  );
}

/** Barra de status: − porcentagem +, como no Word. A porcentagem abre as opções prontas. */
export function ZoomControl({ zoom, onZoom, onFit, onStep }: { zoom: number; onZoom: (zoom: number) => void; onFit: (fit: ZoomFit) => void; onStep: (direction: 1 | -1) => void }) {
  const { t } = useI18n();
  const percent = Math.round(zoom * 100);
  return (
    <div className="zoom-control" role="group" aria-label={t("group.zoom")}>
      <button className="zoom-step" onMouseDown={keepFocus} onClick={() => onStep(-1)} title={t("view.zoomOut")} aria-label={t("view.zoomOut")}>
        −
      </button>
      <select
        className="zoom-level"
        value={String(percent)}
        aria-label={t("view.zoomLevel")}
        title={t("view.zoomLevel")}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "page" || value === "width") onFit(value);
          else onZoom(Number(value) / 100);
        }}
      >
        {!ZOOM_PRESETS.includes(percent) && <option value={String(percent)}>{percent}%</option>}
        {ZOOM_PRESETS.map((p) => (
          <option key={p} value={String(p)}>
            {p}%
          </option>
        ))}
        <option value="page">{t("view.onePage")}</option>
        <option value="width">{t("view.pageWidth")}</option>
      </select>
      <button className="zoom-step" onMouseDown={keepFocus} onClick={() => onStep(1)} title={t("view.zoomIn")} aria-label={t("view.zoomIn")}>
        +
      </button>
    </div>
  );
}

/** Régua horizontal com as margens da página (só visual por enquanto). */
export function Ruler({ page, zoom }: { page: PageSetup; zoom: number }) {
  const { t } = useI18n();
  const width = twipsToPx(page.width) * zoom;
  const left = twipsToPx(page.marginLeft) * zoom;
  const right = twipsToPx(page.marginRight) * zoom;
  return (
    <div className="ruler-track">
      <div className="ruler" style={{ width }} role="img" aria-label={t("view.ruler")}>
        <div className="ruler-margin" style={{ left: 0, width: left }} data-side="left" />
        <div className="ruler-margin" style={{ right: 0, width: right }} data-side="right" />
        <svg width={width} height={18} aria-hidden="true">
          {rulerTicks(page).map((tick, i) => {
            const x = Math.round(tick.x * zoom) + 0.5;
            if (tick.kind === "cm" && tick.label !== undefined)
              return (
                <text key={i} x={x} y={13} textAnchor="middle">
                  {tick.label}
                </text>
              );
            // Com pouco zoom, os quartos de centímetro embolam: ficam só as metades.
            if (tick.kind === "quarter" && zoom < 0.75) return null;
            const h = tick.kind === "half" ? 6 : tick.kind === "quarter" ? 3 : 8;
            return <line key={i} x1={x} x2={x} y1={9 - h / 2} y2={9 + h / 2} />;
          })}
        </svg>
      </div>
    </div>
  );
}

/** Painel de Navegação: os títulos do documento; o clique leva o cursor até eles. */
export function NavigationPane({ headings, caretBlock, onGo, onClose }: { headings: Heading[]; caretBlock: number; onGo: (block: number) => void; onClose: () => void }) {
  const { t } = useI18n();
  const current = currentHeading(headings, caretBlock);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <aside className="nav-pane" aria-label={t("view.navigation")}>
      <div className="nav-pane-head">
        <h2>{t("view.navigation")}</h2>
        <button className="nav-pane-close" onMouseDown={keepFocus} onClick={onClose} title={t("view.closePane")} aria-label={t("view.closePane")}>
          ×
        </button>
      </div>
      <div className="nav-pane-tab">{t("view.headings")}</div>
      {headings.length === 0 ? (
        <p className="nav-pane-empty">{t("view.noHeadings")}</p>
      ) : (
        <ul ref={list} className="nav-pane-list">
          {headings.map((h) => (
            <li key={h.block}>
              <button
                className={`nav-heading level-${h.level}`}
                aria-current={h.block === current ? "location" : undefined}
                onMouseDown={keepFocus}
                onClick={() => onGo(h.block)}
                title={h.text}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

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
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const viewIcons = {
  focus: (
    <Icon>
      <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
    </Icon>
  ),
  zoom100: (
    <Icon>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M12.5 12.5L17 17M6.5 8.5h4M8.5 6.5v4" />
    </Icon>
  ),
  onePage: (
    <Icon>
      <rect x="5.5" y="2.5" width="9" height="15" rx="1" />
      <path d="M8 6h4M8 9h4M8 12h3" />
    </Icon>
  ),
  pageWidth: (
    <Icon>
      <rect x="4.5" y="2.5" width="11" height="15" rx="1" />
      <path d="M2 10h16M4 8l-2 2 2 2M16 8l2 2-2 2" />
    </Icon>
  ),
};
