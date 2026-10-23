// Aba Revisão da faixa de opções, na organização do Word: Revisão de Texto
// (Ortografia e Gramática, Contar Palavras) e Idioma. O estado fica com o App;
// aqui só ficam os botões e os ícones próprios da aba.

import type { ReactNode, SVGProps } from "react";
import { MenuButton, MenuItem } from "./controls";
import { useI18n } from "./i18n";
import { SPELL_LANGUAGES, type Proofing } from "./spell";

export interface ReviewTabProps {
  proofing: Proofing;
  onProofing: (proofing: Proofing) => void;
}

export function ReviewTab({ proofing, onProofing }: ReviewTabProps) {
  const { t } = useI18n();
  return (
    <>
      <RibbonGroup label={t("group.language")}>
        <MenuButton
          label={t("review.language")}
          title={t("review.languageTip")}
          className="big-button review-language"
          render={(close) => (
            <>
              {SPELL_LANGUAGES.map((language) => (
                <MenuItem
                  key={language}
                  checked={proofing === language}
                  onSelect={() => {
                    close();
                    onProofing(language);
                  }}
                >
                  {t(`spell.lang.${language}`)}
                </MenuItem>
              ))}
              <MenuItem
                checked={proofing === "off"}
                onSelect={() => {
                  close();
                  onProofing("off");
                }}
              >
                {t("spell.off")}
              </MenuItem>
            </>
          )}
        >
          {reviewIcons.language}
          <span>{t("review.language")}</span>
        </MenuButton>
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

export const reviewIcons = {
  /** Balão com "A" e um visto: idioma de revisão. */
  language: (
    <Icon>
      <path d="M3 3.5h14v9H9l-4 3.5v-3.5H3z" />
      <path d="M6.5 10.5l2-5 2 5M7.2 9h2.6" />
      <path d="M12 8.5l1.2 1.2 2.3-2.7" />
    </Icon>
  ),
};
