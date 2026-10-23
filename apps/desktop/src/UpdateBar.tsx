// Aviso de atualização: a faixa discreta abaixo da faixa de opções ("Nova
// versão 0.1.X disponível — Novidades · Baixar e instalar · Depois"), a caixa
// com as notas da release e a página Arquivo → Sobre.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "./i18n";
import { BrandMark, icons } from "./icons";
import {
  checkDue,
  loadLastCheck,
  loadNotify,
  parseMarkdown,
  percent,
  storeLastCheck,
  storeNotify,
  updateApi,
  type Inline,
  type Progress,
  type UpdateInfo,
} from "./update";

/** Com o app aberto, olha a cada hora se já passou um dia desde a última consulta. */
const POLL_MS = 60 * 60 * 1000;

type Phase =
  | { step: "idle" }
  | { step: "downloading"; progress: Progress }
  | { step: "ready" }
  | { step: "failed"; error: string };

export interface Updates {
  version: string;
  notify: boolean;
  setNotify: (on: boolean) => void;
  found: UpdateInfo | null;
  /** A faixa aparece: há versão nova e o usuário não clicou em Depois. */
  showBar: boolean;
  dismiss: () => void;
  checking: boolean;
  /** Resultado da última consulta pedida em Arquivo → Sobre. */
  manual: "upToDate" | "found" | { error: string } | null;
  check: () => void;
  phase: Phase;
  /** Baixa e confere o instalador; depois chama `onReady` (que pergunta e instala). */
  download: (onReady: () => void) => void;
}

export function useUpdates(): Updates {
  const [version, setVersion] = useState("");
  const [notify, setNotifyState] = useState(loadNotify);
  const [found, setFound] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [manual, setManual] = useState<Updates["manual"]>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const busy = useRef(false);

  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);

  const run = useCallback(async (asked: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const info = await updateApi.check();
      storeLastCheck(Date.now());
      setFound(info);
      if (asked) {
        setManual(info ? "found" : "upToDate");
        // Pedido pelo usuário: mostra a faixa de novo, mesmo depois de "Depois".
        setDismissed(null);
      }
    } catch (error) {
      // Sem conexão na consulta automática: tenta de novo na próxima.
      if (asked) setManual({ error: String(error) });
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }, []);

  // Ao abrir o app e, com ele aberto, uma vez por dia.
  useEffect(() => {
    if (!notify) return;
    run(false);
    const id = window.setInterval(() => {
      if (checkDue(Date.now(), loadLastCheck())) run(false);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [notify, run]);

  const setNotify = useCallback((on: boolean) => {
    setNotifyState(on);
    storeNotify(on);
  }, []);

  const download = useCallback((onReady: () => void) => {
    setPhase({ step: "downloading", progress: { received: 0, total: 0 } });
    const unlisten = listen<Progress>("update-progress", (e) => setPhase({ step: "downloading", progress: e.payload }));
    updateApi
      .download()
      .then(
        () => {
          setPhase({ step: "ready" });
          onReady();
        },
        (error) => setPhase({ step: "failed", error: String(error) }),
      )
      .finally(() => unlisten.then((f) => f()).catch(() => {}));
  }, []);

  return {
    version,
    notify,
    setNotify,
    found,
    showBar: !!found && dismissed !== found.version,
    dismiss: () => setDismissed(found?.version ?? null),
    checking,
    manual,
    check: () => run(true),
    phase,
    download,
  };
}

interface BarProps {
  updates: Updates;
  onNotes: () => void;
  /** Windows: baixar, conferir e instalar. Senão, abrir a página da release. */
  onDownload: () => void;
  onInstall: () => void;
}

export function UpdateBar({ updates, onNotes, onDownload, onInstall }: BarProps) {
  const { t } = useI18n();
  const { found, phase } = updates;
  if (!found || !updates.showBar) return null;
  const link = (label: string, onClick: () => void, primary = false) => (
    <button className={primary ? "update-link primary" : "update-link"} onClick={onClick}>
      {label}
    </button>
  );
  const sep = <span className="update-sep" aria-hidden="true">·</span>;
  return (
    <div className="update-bar" role="status" aria-label={t("update.label")}>
      <span className="update-icon" aria-hidden="true">
        {icons.download}
      </span>
      {phase.step === "downloading" ? (
        <>
          <span>{t("update.downloading", { version: found.version, percent: percent(phase.progress) })}</span>
          <progress className="update-progress" max={100} value={percent(phase.progress)} aria-label={t("update.label")} />
        </>
      ) : phase.step === "ready" ? (
        <>
          <span>{t("update.ready", { version: found.version })}</span>
          {link(t("update.installNow"), onInstall, true)}
          {sep}
          {link(t("update.later"), updates.dismiss)}
        </>
      ) : phase.step === "failed" ? (
        <>
          <span className="update-error" title={phase.error}>
            {t("update.failed", { error: phase.error })}
          </span>
          {link(t("update.retry"), onDownload, true)}
          {sep}
          {link(t("update.later"), updates.dismiss)}
        </>
      ) : (
        <>
          <span>{t("update.available", { version: found.version })}</span>
          <span aria-hidden="true">—</span>
          {link(t("update.notes"), onNotes)}
          {sep}
          {link(t("update.install"), onDownload, true)}
          {sep}
          {link(t("update.later"), updates.dismiss)}
        </>
      )}
    </div>
  );
}

function InlineText({ content, onLink }: { content: Inline[]; onLink: (href: string) => void }) {
  return (
    <>
      {content.map((part, i) => {
        switch (part.kind) {
          case "bold":
            return <strong key={i}>{part.text}</strong>;
          case "italic":
            return <em key={i}>{part.text}</em>;
          case "code":
            return <code key={i}>{part.text}</code>;
          case "link":
            return (
              <a
                key={i}
                href={part.href}
                onClick={(e) => {
                  e.preventDefault();
                  onLink(part.href);
                }}
              >
                {part.text}
              </a>
            );
          default:
            return <span key={i}>{part.text}</span>;
        }
      })}
    </>
  );
}

/** Notas da release (Markdown) numa caixa; os links abrem no navegador. */
export function ReleaseNotesDialog({
  info,
  onLink,
  onDownload,
  onClose,
}: {
  info: UpdateInfo;
  onLink: (href: string) => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
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
  const blocks = parseMarkdown(info.notes);
  const inline = (content: Inline[]) => <InlineText content={content} onLink={onLink} />;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal release-notes" role="dialog" aria-modal="true" aria-labelledby="release-notes-title">
        <h2 id="release-notes-title">{t("update.notesTitle", { version: info.version })}</h2>
        <div className="release-notes-body">
          {blocks.length === 0 && <p className="modal-sub">{t("update.noNotes")}</p>}
          {blocks.map((block, i) => {
            if (block.kind === "heading") {
              // Dentro da caixa, # e ## são os títulos maiores (h3); ### vira h4.
              const H = block.level <= 2 ? "h3" : "h4";
              return <H key={i}>{inline(block.content)}</H>;
            }
            if (block.kind === "list") {
              const L = block.ordered ? "ol" : "ul";
              return (
                <L key={i}>
                  {block.items.map((item, j) => (
                    <li key={j}>{inline(item)}</li>
                  ))}
                </L>
              );
            }
            return <p key={i}>{inline(block.content)}</p>;
          })}
        </div>
        <div className="modal-actions">
          <button className="bs-secondary push-left" onClick={() => onLink(info.pageUrl)}>
            {t("update.openPage")}
          </button>
          <button className="bs-primary" onClick={onDownload}>
            {t("update.install")}
          </button>
          <button ref={close} className="bs-secondary" onClick={onClose}>
            {t("update.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Arquivo → Sobre: versão atual, Procurar atualizações e Avisar sobre atualizações. */
export function AboutPage({ updates, onNotes, onDownload }: { updates: Updates; onNotes: () => void; onDownload: () => void }): ReactNode {
  const { t } = useI18n();
  const { manual, found } = updates;
  return (
    <>
      <h1>{t("about.title")}</h1>
      <div className="about-product">
        <BrandMark size={48} />
        <div>
          <strong>
            <b>Nova</b>Office
          </strong>
          <span className="about-version">{t("about.version", { version: updates.version || "—" })}</span>
          <small>{t("about.license")}</small>
        </div>
      </div>
      <h2>{t("about.updates")}</h2>
      <div className="bs-row about-updates">
        <button className="bs-big" onClick={updates.check} disabled={updates.checking}>
          {icons.download}
          <span>{t("about.check")}</span>
        </button>
        <p className="bs-lead about-result" role="status">
          {updates.checking
            ? t("about.checking")
            : manual === "upToDate"
              ? t("about.upToDate", { version: updates.version })
              : manual && typeof manual === "object"
                ? t("about.error", { error: manual.error })
                : ""}
        </p>
      </div>
      {found && (
        <div className="about-found">
          <strong>{t("update.available", { version: found.version })}</strong>
          <button className="bs-secondary" onClick={onNotes}>
            {t("update.notes")}
          </button>
          <button className="bs-primary" onClick={onDownload}>
            {t("update.install")}
          </button>
        </div>
      )}
      <label className="about-notify">
        <input type="checkbox" checked={updates.notify} onChange={(e) => updates.setNotify(e.target.checked)} />
        <span>
          {t("about.notify")}
          <small>{t("about.notifyHint")}</small>
        </span>
      </label>
    </>
  );
}
