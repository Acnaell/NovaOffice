// Tela Arquivo, como a do Word: barra lateral (Início, Novo, Abrir, Salvar,
// Salvar como, Imprimir, Exportar, Fechar) e a página escolhida ao lado. A
// página Início também é a tela inicial do NovaOffice, de onde se escolhe o
// aplicativo.

import { useEffect, useRef, type ReactNode } from "react";
import { APPS, type AppInfo } from "./AppLauncher";
import { useI18n, type MessageKey } from "./i18n";
import { BrandMark, icons } from "./icons";
import type { DocView, FileFormat, Recent, RecoveryInfo } from "./types";

export type BackstagePage = "home" | "new" | "open" | "saveAs" | "print" | "export";

/** Tipos de arquivo na ordem de Salvar como; o primeiro é o padrão (Word). */
export const SAVE_FORMATS: FileFormat[] = ["docx", "odt", "nova", "md", "txt", "html"];

/** Formatos que perdem formatação ao salvar (o Word também avisa). */
export const LOSSY: FileFormat[] = ["md", "txt"];

interface Props {
  page: BackstagePage;
  view: DocView;
  recents: Recent[];
  recovery: RecoveryInfo | null;
  /** Primeira abertura do app: a página Início é a tela inicial, sem documento aberto atrás. */
  startup: boolean;
  onPage: (page: BackstagePage) => void;
  onBack: () => void;
  onNew: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onBrowse: () => void;
  onSave: () => void;
  onSaveAs: (format: FileFormat) => void;
  onPrint: () => void;
  onExport: (format: FileFormat) => void;
  onClose: () => void;
  onRecover: () => void;
  onDiscardRecovery: () => void;
}

const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");
const nameOf = (path: string) => path.replace(/^.*[\\/]/, "");

export function Backstage(props: Props) {
  const { t, locale } = useI18n();
  const main = useRef<HTMLDivElement>(null);

  // Esc volta ao documento, como no Word (na tela inicial não há para onde voltar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !props.startup) {
        e.preventDefault();
        props.onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.startup, props.onBack]);

  useEffect(() => {
    main.current?.focus();
  }, [props.page]);

  const date = (ms: number) =>
    new Date(ms).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const nav = (page: BackstagePage, icon: ReactNode, label: string) => (
    <button className="bs-nav" aria-current={props.page === page ? "page" : undefined} onClick={() => props.onPage(page)}>
      {icon}
      <span>{label}</span>
    </button>
  );

  const action = (icon: ReactNode, label: string, onClick: () => void, disabled = false) => (
    <button className="bs-nav" onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );

  const recentList = (limit?: number) =>
    props.recents.length === 0 ? (
      <p className="bs-empty">{t("bs.noRecent")}</p>
    ) : (
      <table className="bs-recent">
        <thead>
          <tr>
            <th>{t("bs.name")}</th>
            <th>{t("bs.modified")}</th>
            <th aria-label={t("bs.remove")} />
          </tr>
        </thead>
        <tbody>
          {props.recents.slice(0, limit).map((r) => (
            <tr key={r.path}>
              <td>
                <button className="bs-file" onClick={() => props.onOpenRecent(r.path)} title={r.path}>
                  <span className={`bs-file-icon ext-${nameOf(r.path).split(".").pop()}`}>{icons.new}</span>
                  <span>
                    <strong>{nameOf(r.path)}</strong>
                    <small>{folderOf(r.path)}</small>
                  </span>
                </button>
              </td>
              <td className="bs-date">{date(r.openedAt)}</td>
              <td>
                <button className="bs-remove" onClick={() => props.onRemoveRecent(r.path)} title={t("bs.remove")} aria-label={t("bs.remove")}>
                  {icons.close}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  const blankTile = (
    <button className="bs-tile" onClick={props.onNew}>
      <span className="bs-paper" aria-hidden="true" />
      <span>{t("bs.blank")}</span>
    </button>
  );

  const appTile = (app: AppInfo) => (
    <button key={app.id} className="bs-app" disabled={!app.ready} onClick={app.ready ? props.onNew : undefined} title={app.ready ? undefined : t("apps.soon")}>
      <BrandMark app={app.id} size={40} />
      <span className="bs-app-name">{app.name}</span>
      <span className="bs-app-sub">{app.ready ? t(app.subtitle) : t("apps.soon")}</span>
    </button>
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("bs.morning") : hour < 18 ? t("bs.afternoon") : t("bs.evening");

  const formatLabel = (f: FileFormat) => t(`fmt.${f}` as MessageKey);
  const formatHint = (f: FileFormat) => t(`fmt.${f}.hint` as MessageKey);

  const pages: Record<BackstagePage, ReactNode> = {
    home: (
      <>
        <h1>{greeting}</h1>
        {props.recovery && (
          <div className="bs-recovery" role="alert">
            <div>
              <strong>{t("bs.recoveryTitle")}</strong>
              <p>{t("bs.recoveryText", { title: props.recovery.title, date: date(props.recovery.savedAt) })}</p>
            </div>
            <button className="bs-primary" onClick={props.onRecover}>{t("bs.recover")}</button>
            <button className="bs-secondary" onClick={props.onDiscardRecovery}>{t("bs.discard")}</button>
          </div>
        )}
        <h2>{t("bs.apps")}</h2>
        <div className="bs-apps">{APPS.map(appTile)}</div>
        <h2>{t("bs.new")}</h2>
        <div className="bs-tiles">{blankTile}</div>
        <h2>{t("bs.recent")}</h2>
        {recentList(8)}
      </>
    ),
    new: (
      <>
        <h1>{t("bs.new")}</h1>
        <div className="bs-tiles">{blankTile}</div>
      </>
    ),
    open: (
      <>
        <h1>{t("bs.open")}</h1>
        <div className="bs-row">
          <button className="bs-big" onClick={props.onBrowse}>
            {icons.open}
            <span>{t("bs.browse")}</span>
          </button>
        </div>
        <h2>{t("bs.recent")}</h2>
        {recentList()}
      </>
    ),
    saveAs: (
      <>
        <h1>{t("bs.saveAs")}</h1>
        <p className="bs-lead">{t("bs.saveAsLead")}</p>
        <ul className="bs-formats">
          {SAVE_FORMATS.map((f) => (
            <li key={f}>
              <button onClick={() => props.onSaveAs(f)} aria-current={props.view.format === f ? "true" : undefined}>
                <span className={`bs-ext ext-${f}`}>.{f}</span>
                <span>
                  <strong>
                    {formatLabel(f)}
                    {f === "docx" && <em className="bs-badge">{t("bs.default")}</em>}
                  </strong>
                  <small>{formatHint(f)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>
    ),
    print: (
      <>
        <h1>{t("bs.print")}</h1>
        <div className="bs-row">
          <button className="bs-big bs-print" onClick={props.onPrint}>
            {icons.print}
            <span>{t("bs.print")}</span>
          </button>
          <p className="bs-lead">{t("bs.printHint")}</p>
        </div>
      </>
    ),
    export: (
      <>
        <h1>{t("bs.export")}</h1>
        <h2>{t("bs.pdf")}</h2>
        <div className="bs-row">
          <button className="bs-big" onClick={props.onPrint}>
            {icons.pdf}
            <span>{t("bs.createPdf")}</span>
          </button>
          <p className="bs-lead">{t("bs.pdfHint")}</p>
        </div>
        <h2>{t("bs.changeType")}</h2>
        <p className="bs-lead">{t("bs.exportLead")}</p>
        <ul className="bs-formats">
          {SAVE_FORMATS.map((f) => (
            <li key={f}>
              <button onClick={() => props.onExport(f)}>
                <span className={`bs-ext ext-${f}`}>.{f}</span>
                <span>
                  <strong>{formatLabel(f)}</strong>
                  <small>{formatHint(f)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>
    ),
  };

  return (
    <div className="backstage" role="dialog" aria-label={t("tab.file")}>
      <nav className="bs-side">
        {!props.startup && (
          <button className="bs-back" onClick={props.onBack} title={t("bs.back")} aria-label={t("bs.back")}>
            {icons.arrowLeft}
          </button>
        )}
        <div className="bs-brand">
          <BrandMark size={26} />
          <span>
            <b>Nova</b>Office
          </span>
        </div>
        {nav("home", icons.home, t("bs.home"))}
        {nav("new", icons.new, t("bs.new"))}
        {nav("open", icons.open, t("bs.open"))}
        {!props.startup && (
          <>
            <div className="bs-sep" />
            {action(icons.save, t("cmd.file.save"), props.onSave)}
            {nav("saveAs", icons.saveAs, t("bs.saveAs"))}
            {nav("print", icons.print, t("bs.print"))}
            {nav("export", icons.export, t("bs.export"))}
            <div className="bs-sep" />
            {action(icons.closeDoc, t("bs.close"), props.onClose)}
          </>
        )}
      </nav>
      <div className="bs-main" ref={main} tabIndex={-1}>
        {pages[props.page]}
      </div>
    </div>
  );
}
