// Aba Revisão da faixa de opções, na organização do Word: Revisão de Texto
// (Ortografia e Gramática, Contar Palavras) e Idioma. O estado fica com o App;
// aqui só ficam os botões e os ícones próprios da aba.

import { useEffect, useRef, type ReactNode, type SVGProps } from "react";
import { keepFocus, MenuButton, MenuItem } from "./controls";
import { useI18n, type MessageKey } from "./i18n";
import { matchShortcut, withShortcut, type CommandId, type Profile } from "./shortcuts";
import { SPELL_LANGUAGES, type Proofing } from "./spell";

export interface ReviewTabProps {
  proofing: Proofing;
  profile: Profile;
  onProofing: (proofing: Proofing) => void;
  onCommand: (command: CommandId) => void;
}

export function ReviewTab({ proofing, profile, onProofing, onCommand }: ReviewTabProps) {
  const { t } = useI18n();
  const button = (command: CommandId, icon: ReactNode) => (
    <button
      className="big-button"
      onMouseDown={keepFocus}
      onClick={() => onCommand(command)}
      title={withShortcut(t(`cmd.${command}` as MessageKey), command, profile)}
    >
      {icon}
      <span>{t(`cmd.${command}` as MessageKey)}</span>
    </button>
  );
  return (
    <>
      <RibbonGroup label={t("group.proofing")}>{button("review.spelling", reviewIcons.spelling)}</RibbonGroup>
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

/**
 * Atalhos da aba Revisão (F7) na janela toda. No documento, o Editor já os
 * trata e marca o evento; aqui ficam os que vêm de fora dele (faixa, painéis).
 */
export function useReviewShortcuts(profile: Profile, onCommand: (command: CommandId) => void) {
  const latest = useRef(onCommand);
  latest.current = onCommand;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = matchShortcut(e, profile);
      if (!command?.startsWith("review.") || e.defaultPrevented) return;
      e.preventDefault();
      latest.current(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [profile]);
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
  /** "ABC" com um visto: Ortografia e Gramática. */
  spelling: (
    <Icon strokeWidth="1.5">
      <path d="M2 9l1.8-5.5L5.6 9M2.6 7.2h2.4" />
      <path d="M7.5 9V3.5h1.7a1.3 1.3 0 0 1 0 2.6H7.5h2a1.45 1.45 0 0 1 0 2.9h-2" />
      <path d="M16 4.2a2.2 2.2 0 0 0-1.6-.7c-1.5 0-2.4 1.2-2.4 2.75S12.9 9 14.4 9a2.2 2.2 0 0 0 1.6-.7" />
      <path d="M5 13.5l3.5 3.5 7.5-7" strokeWidth="1.75" />
    </Icon>
  ),
  /** Balão com "A" e um visto: idioma de revisão. */
  language: (
    <Icon>
      <path d="M3 3.5h14v9H9l-4 3.5v-3.5H3z" />
      <path d="M6.5 10.5l2-5 2 5M7.2 9h2.6" />
      <path d="M12 8.5l1.2 1.2 2.3-2.7" />
    </Icon>
  ),
};
