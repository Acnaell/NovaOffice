// Aba Referências da faixa de opções, na organização do Word: Sumário
// (Sumário Automático, Atualizar Sumário, Remover Sumário). O estado e os
// comandos ficam com o App; aqui só ficam os botões e os ícones da aba.

import type { ReactNode, SVGProps } from "react";
import { keepFocus, MenuButton, MenuItem } from "./controls";
import { useI18n } from "./i18n";

export interface ReferencesTabProps {
  hasToc: boolean;
  onInsertToc: () => void;
  onUpdateToc: () => void;
  onRemoveToc: () => void;
}

export function ReferencesTab({ hasToc, onInsertToc, onUpdateToc, onRemoveToc }: ReferencesTabProps) {
  const { t } = useI18n();
  return (
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
  /** Linhas com pontilhado e número: Sumário. */
  toc: (
    <Icon>
      <path d="M3 4h7M6 9h5M6 14h4M3 18h6" />
      <path d="M12 4h2M13 9h1M12 14h2M11 18h3" strokeDasharray="0.5 1.6" strokeWidth="1.5" />
      <path d="M16.5 4h.5M16.5 9h.5M16.5 14h.5M16.5 18h.5" strokeWidth="2" />
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
