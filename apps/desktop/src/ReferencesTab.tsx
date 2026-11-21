// Aba Referências da faixa de opções, na organização do Word: Sumário
// (Sumário Automático, Atualizar Sumário, Remover Sumário), Notas de Rodapé e
// Citações e Bibliografia (Inserir Citação, Gerenciar Fontes, Bibliografia) e Legendas
// (Inserir Legenda, Índice de Ilustrações, Atualizar Índice, Referência Cruzada). O estado e os
// comandos ficam com o App; aqui só ficam os botões e os ícones da aba.

import type { ReactNode, SVGProps } from "react";
import { keepFocus, MenuButton, MenuItem } from "./controls";
import { useI18n } from "./i18n";
import { withShortcut, type CommandId, type Profile } from "./shortcuts";

export interface ReferencesTabProps {
  hasToc: boolean;
  onInsertToc: () => void;
  onUpdateToc: () => void;
  onRemoveToc: () => void;
  hasBibliography: boolean;
  onInsertCitation: () => void;
  onManageSources: () => void;
  onInsertBibliography: () => void;
  onUpdateBibliography: () => void;
  onRemoveBibliography: () => void;
  hasFigureIndex: boolean;
  onInsertCaption: () => void;
  onInsertFigureIndex: () => void;
  onUpdateFigureIndex: () => void;
  onCrossRef: () => void;
  onCommand: (command: CommandId) => void;
  profile: Profile;
}

export function ReferencesTab({
  hasToc,
  onInsertToc,
  onUpdateToc,
  onRemoveToc,
  hasBibliography,
  onInsertCitation,
  onManageSources,
  onInsertBibliography,
  onUpdateBibliography,
  onRemoveBibliography,
  hasFigureIndex,
  onInsertCaption,
  onInsertFigureIndex,
  onUpdateFigureIndex,
  onCrossRef,
  onCommand,
  profile,
}: ReferencesTabProps) {
  const { t } = useI18n();
  return (
    <>
    <RibbonGroup label={t("group.toc")}>
      <MenuButton
        label={t("toc.button")}
        title={t("toc.buttonTip")}
        className="big-button"
        render={(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close();
                onInsertToc();
              }}
            >
              {t("toc.insert")}
            </MenuItem>
            {hasToc && (
              <MenuItem
                onSelect={() => {
                  close();
                  onRemoveToc();
                }}
              >
                {t("toc.remove")}
              </MenuItem>
            )}
          </>
        )}
      >
        {referencesIcons.toc}
        <span>{t("toc.button")}</span>
      </MenuButton>
      <button className="big-button" onMouseDown={keepFocus} onClick={onUpdateToc} disabled={!hasToc} title={t("toc.updateTip")}>
        {referencesIcons.update}
        <span>{t("toc.update")}</span>
      </button>
    </RibbonGroup>
    <RibbonGroup label={t("group.footnotes")}>
      <button
        className="big-button"
        onMouseDown={keepFocus}
        onClick={() => onCommand("references.footnote")}
        title={withShortcut(t("cmd.references.footnote"), "references.footnote", profile)}
      >
        {referencesIcons.footnote}
        <span>{t("cmd.references.footnote")}</span>
      </button>
      <button className="big-button" onMouseDown={keepFocus} onClick={() => onCommand("references.nextFootnote")} title={t("fn.nextTip")}>
        {referencesIcons.nextFootnote}
        <span>{t("cmd.references.nextFootnote")}</span>
      </button>
    </RibbonGroup>
    <RibbonGroup label={t("group.citations")}>
      <button className="big-button" onMouseDown={keepFocus} onClick={onInsertCitation} title={t("cite.insertTip")}>
        {referencesIcons.citation}
        <span>{t("cite.insert")}</span>
      </button>
      <button className="big-button" onMouseDown={keepFocus} onClick={onManageSources} title={t("cite.manageTip")}>
        {referencesIcons.sources}
        <span>{t("cite.manage")}</span>
      </button>
      <MenuButton
        label={t("bib.button")}
        title={t("bib.buttonTip")}
        className="big-button"
        render={(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close();
                onInsertBibliography();
              }}
            >
              {t("bib.insert")}
            </MenuItem>
            {hasBibliography && (
              <MenuItem
                onSelect={() => {
                  close();
                  onUpdateBibliography();
                }}
              >
                {t("bib.update")}
              </MenuItem>
            )}
            {hasBibliography && (
              <MenuItem
                onSelect={() => {
                  close();
                  onRemoveBibliography();
                }}
              >
                {t("bib.remove")}
              </MenuItem>
            )}
          </>
        )}
      >
        {referencesIcons.bibliography}
        <span>{t("bib.button")}</span>
      </MenuButton>
    </RibbonGroup>
    <RibbonGroup label={t("group.captions")}>
      <button className="big-button" onMouseDown={keepFocus} onClick={onInsertCaption} title={t("cap.insertTip")}>
        {referencesIcons.caption}
        <span>{t("cap.insert")}</span>
      </button>
      <button className="big-button" onMouseDown={keepFocus} onClick={onInsertFigureIndex} title={t("cap.indexTip")}>
        {referencesIcons.figureIndex}
        <span>{t("cap.index")}</span>
      </button>
      <button className="big-button" onMouseDown={keepFocus} onClick={onUpdateFigureIndex} disabled={!hasFigureIndex} title={t("cap.updateTip")}>
        {referencesIcons.update}
        <span>{t("cap.update")}</span>
      </button>
      <button className="big-button" onMouseDown={keepFocus} onClick={onCrossRef} title={t("cap.xrefTip")}>
        {referencesIcons.crossRef}
        <span>{t("cap.xref")}</span>
      </button>
    </RibbonGroup>
    </>
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

export const referencesIcons = {
  /** Texto com um "1" sobrescrito e a nota no pé: Inserir Nota de Rodapé. */
  footnote: (
    <Icon>
      <path d="M3 4h8M3 7.5h6" />
      <path d="M12.5 3.5l1.5-1v4" strokeWidth="1.5" />
      <path d="M3 13h14" strokeDasharray="2 1.6" strokeWidth="1.25" />
      <path d="M3 16.5h4M9 16.5h8" />
    </Icon>
  ),
  /** Seta para baixo até a próxima chamada: Próxima Nota de Rodapé. */
  nextFootnote: (
    <Icon>
      <path d="M3 4h9M3 8h6" />
      <path d="M15 4v10M12 11l3 3 3-3" />
      <path d="M3 16.5h8" />
    </Icon>
  ),
  /** Linhas com pontilhado e número: Sumário. */
  toc: (
    <Icon>
      <path d="M3 4h7M6 9h5M6 14h4M3 18h6" />
      <path d="M12 4h2M13 9h1M12 14h2M11 18h3" strokeDasharray="0.5 1.6" strokeWidth="1.5" />
      <path d="M16.5 4h.5M16.5 9h.5M16.5 14h.5M16.5 18h.5" strokeWidth="2" />
    </Icon>
  ),
  /** Aspas com uma linha de texto: Inserir Citação. */
  citation: (
    <Icon>
      <path d="M4 5.5c-1 .6-1.5 1.6-1.5 3h2.5v2.5H2.5V8.5M9 5.5c-1 .6-1.5 1.6-1.5 3H10v2.5H7.5V8.5" strokeWidth="1.5" />
      <path d="M12.5 7h5M12.5 10.5h5M3 15h14" />
    </Icon>
  ),
  /** Livros na estante: Gerenciar Fontes. */
  sources: (
    <Icon>
      <path d="M3.5 3.5h3v13h-3zM7.5 3.5h3v13h-3z" />
      <path d="M12 4.5l2.8-.8 3 12.4-2.8.8z" />
    </Icon>
  ),
  /** Lista com título: Bibliografia. */
  bibliography: (
    <Icon>
      <path d="M6 3.5h8" strokeWidth="2" />
      <path d="M3 8h14M5 10.8h12M3 14h14M5 16.8h12" />
    </Icon>
  ),
  /** Imagem com a linha da legenda embaixo: Inserir Legenda. */
  caption: (
    <Icon>
      <rect x="3" y="2.5" width="14" height="10" rx="1" />
      <path d="M5.5 10l3-3.2 2.2 2.2 1.8-1.6 2 2.6" strokeWidth="1.4" />
      <path d="M3 16h3M8 16h9" />
    </Icon>
  ),
  /** Imagem pequena ao lado de linhas com pontilhado: Inserir Índice de Ilustrações. */
  figureIndex: (
    <Icon>
      <rect x="2.5" y="3" width="5" height="4" rx="0.6" />
      <path d="M2.5 11h9M2.5 15h7M2.5 18.5h8" />
      <path d="M13 11h1.5M12 15h2.5M12.5 18.5h2" strokeDasharray="0.5 1.6" strokeWidth="1.5" />
      <path d="M17 11h.5M17 15h.5M17 18.5h.5" strokeWidth="2" />
      <path d="M10 4h7M10 6.5h5" strokeWidth="1.4" />
    </Icon>
  ),
  /** Duas páginas ligadas por uma seta: Referência Cruzada. */
  crossRef: (
    <Icon>
      <path d="M2.5 3.5h6v8h-6zM11.5 8.5h6v8h-6z" />
      <path d="M4.5 6h2M4.5 8.5h2M13.5 11h2M13.5 13.5h2" strokeWidth="1.3" />
      <path d="M8.5 14.5c1.5 0 2.5-.6 3-2M10.2 12.4l1.3.1.2 1.3" strokeWidth="1.4" />
    </Icon>
  ),
  /** Setas em círculo sobre linhas: Atualizar Sumário. */
  update: (
    <Icon>
      <path d="M3 5h6M3 9h4M3 13h5M3 17h7" />
      <path d="M17 11a4 4 0 1 1-1.2-2.85" />
      <path d="M16.2 5.5v2.9h-2.9" />
    </Icon>
  ),
};
