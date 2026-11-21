// Aba Revisão da faixa de opções, na organização do Word: Revisão de Texto
// (Ortografia e Gramática, Contar Palavras) e Idioma. O estado fica com o App;
// aqui só ficam os botões e os ícones próprios da aba.

import { useEffect, useRef, type ReactNode, type SVGProps } from "react";
import { keepFocus, MenuButton, MenuItem } from "./controls";
import type { Markup } from "./tracking";
import { useI18n, type MessageKey } from "./i18n";
import { matchShortcut, withShortcut, type CommandId, type Profile } from "./shortcuts";
import { SPELL_LANGUAGES, type Proofing } from "./spell";

export interface ReviewTabProps {
  proofing: Proofing;
  profile: Profile;
  onProofing: (proofing: Proofing) => void;
  onCommand: (command: CommandId) => void;
  showComments: boolean;
  hasComments: boolean;
  /** Controlar Alterações ligado, modo de exibição e se há alterações no documento. */
  tracking: boolean;
  markup: Markup;
  hasRevisions: boolean;
}

export function ReviewTab({ proofing, profile, onProofing, onCommand, showComments, hasComments, tracking, markup, hasRevisions }: ReviewTabProps) {
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
      <RibbonGroup label={t("group.proofing")}>
        {button("review.spelling", reviewIcons.spelling)}
        {button("review.autocorrect", reviewIcons.autocorrect)}
        {button("review.wordCount", reviewIcons.wordCount)}
      </RibbonGroup>
      <RibbonGroup label={t("group.comments")}>
        {button("review.newComment", reviewIcons.newComment)}
        <MenuButton
          label={t("cm.deleteMenu")}
          title={t("cm.deleteTip")}
          className="big-button"
          disabled={!hasComments}
          render={(close) => (
            <>
              <MenuItem
                onSelect={() => {
                  close();
                  onCommand("review.deleteComment");
                }}
              >
                {t("cmd.review.deleteComment")}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close();
                  onCommand("review.deleteAllComments");
                }}
              >
                {t("cmd.review.deleteAllComments")}
              </MenuItem>
            </>
          )}
        >
          {reviewIcons.deleteComment}
          <span>{t("cm.deleteMenu")}</span>
        </MenuButton>
        <div className="stack">
          <button className="small-button" onMouseDown={keepFocus} disabled={!hasComments} onClick={() => onCommand("review.prevComment")}>
            {reviewIcons.prevComment}
            <span>{t("cmd.review.prevComment")}</span>
          </button>
          <button className="small-button" onMouseDown={keepFocus} disabled={!hasComments} onClick={() => onCommand("review.nextComment")}>
            {reviewIcons.nextComment}
            <span>{t("cmd.review.nextComment")}</span>
          </button>
          <button
            className={`small-button${showComments ? " active" : ""}`}
            aria-pressed={showComments}
            onMouseDown={keepFocus}
            onClick={() => onCommand("review.showComments")}
          >
            {reviewIcons.showComments}
            <span>{t("cmd.review.showComments")}</span>
          </button>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t("group.tracking")}>
        <button
          className={`big-button${tracking ? " active" : ""}`}
          aria-pressed={tracking}
          onMouseDown={keepFocus}
          onClick={() => onCommand("review.trackChanges")}
          title={withShortcut(t("track.toggleTip"), "review.trackChanges", profile)}
        >
          {reviewIcons.trackChanges}
          <span>{t("cmd.review.trackChanges")}</span>
        </button>
        <MenuButton
          label={t(`track.markup.${markup}` as MessageKey)}
          title={t("track.markupTip")}
          render={(close) => (
            <>
              {(["all", "none", "original"] as const).map((m) => (
                <MenuItem
                  key={m}
                  checked={markup === m}
                  onSelect={() => {
                    close();
                    onCommand(m === "all" ? "review.markupAll" : m === "none" ? "review.markupNone" : "review.markupOriginal");
                  }}
                >
                  {t(`track.markup.${m}` as MessageKey)}
                </MenuItem>
              ))}
            </>
          )}
        >
          {reviewIcons.markup}
          <span>{t(`track.markup.${markup}` as MessageKey)}</span>
        </MenuButton>
      </RibbonGroup>
      <RibbonGroup label={t("group.changes")}>
        {(["accept", "reject"] as const).map((kind) => (
          <MenuButton
            key={kind}
            label={t(`cmd.review.${kind}` as MessageKey)}
            title={t(`track.${kind}Tip` as MessageKey)}
            className="big-button"
            disabled={!hasRevisions}
            render={(close) => (
              <>
                {(["Next", "", "All"] as const).map((suffix) => (
                  <MenuItem
                    key={suffix}
                    onSelect={() => {
                      close();
                      onCommand(`review.${kind}${suffix}` as CommandId);
                    }}
                  >
                    {t(`track.${kind}${suffix || "This"}` as MessageKey)}
                  </MenuItem>
                ))}
              </>
            )}
          >
            {kind === "accept" ? reviewIcons.accept : reviewIcons.reject}
            <span>{t(`cmd.review.${kind}` as MessageKey)}</span>
          </MenuButton>
        ))}
        <div className="stack">
          <button className="small-button" onMouseDown={keepFocus} disabled={!hasRevisions} onClick={() => onCommand("review.prevChange")}>
            {reviewIcons.prevChange}
            <span>{t("cmd.review.prevChange")}</span>
          </button>
          <button className="small-button" onMouseDown={keepFocus} disabled={!hasRevisions} onClick={() => onCommand("review.nextChange")}>
            {reviewIcons.nextChange}
            <span>{t("cmd.review.nextChange")}</span>
          </button>
        </div>
      </RibbonGroup>
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
  /** Página com lápis e linhas marcadas: Controlar Alterações. */
  trackChanges: (
    <Icon>
      <path d="M4 3h8l3 3v5" />
      <path d="M4 3v14h6" />
      <path d="M6.5 8h6M6.5 11h3" />
      <path d="M12 17l1-3 4.5-4.5 2 2L15 16z" />
    </Icon>
  ),
  /** Linhas com um trecho sublinhado e outro riscado: modo de exibição. */
  markup: (
    <Icon>
      <path d="M3 5h14" />
      <path d="M3 9.5h6M11 9.5h6" />
      <path d="M11 11.5h6" strokeWidth="1" />
      <path d="M3 14h5M10 14h7" />
      <path d="M10 14h7" />
    </Icon>
  ),
  /** Página com visto: Aceitar. */
  accept: (
    <Icon>
      <path d="M4 3h9l3 3v11H4z" />
      <path d="M6.5 11l2.5 2.5 5-5.5" />
    </Icon>
  ),
  /** Página com X: Rejeitar. */
  reject: (
    <Icon>
      <path d="M4 3h9l3 3v11H4z" />
      <path d="M7.2 8l5.6 5.6M12.8 8l-5.6 5.6" />
    </Icon>
  ),
  /** Seta para cima até uma alteração: Anterior. */
  prevChange: (
    <Icon>
      <path d="M4 6h12M4 14h12" strokeDasharray="2 1.5" />
      <path d="M10 15V5M7.5 7.5L10 5l2.5 2.5" />
    </Icon>
  ),
  /** Seta para baixo até uma alteração: Próxima. */
  nextChange: (
    <Icon>
      <path d="M4 6h12M4 14h12" strokeDasharray="2 1.5" />
      <path d="M10 5v10M7.5 12.5L10 15l2.5-2.5" />
    </Icon>
  ),
  /** Balão de fala com "+": Novo Comentário. */
  newComment: (
    <Icon>
      <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
      <path d="M10 6.8v4.4M7.8 9h4.4" />
    </Icon>
  ),
  /** Balão de fala com "×": Excluir comentário. */
  deleteComment: (
    <Icon>
      <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
      <path d="M8.2 7.2l3.6 3.6M11.8 7.2l-3.6 3.6" />
    </Icon>
  ),
  /** Balão com seta para cima: Comentário Anterior. */
  prevComment: (
    <Icon>
      <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
      <path d="M10 11.5v-5M7.8 8.7L10 6.5l2.2 2.2" />
    </Icon>
  ),
  /** Balão com seta para baixo: Próximo Comentário. */
  nextComment: (
    <Icon>
      <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
      <path d="M10 6.5v5M7.8 9.3L10 11.5l2.2-2.2" />
    </Icon>
  ),
  /** Dois balões: Mostrar Comentários. */
  showComments: (
    <Icon>
      <path d="M2.5 3.5h10v7h-5l-3 2.5v-2.5h-2z" />
      <path d="M14.5 7.5h3v7h-2v2.5l-3-2.5h-4.5v-2" />
    </Icon>
  ),
  /** "123" sobre linhas de texto: Contar Palavras. */
  wordCount: (
    <Icon strokeWidth="1.5">
      <path d="M3 3.5l1.5-1v6M3 8.5h3" />
      <path d="M7.5 3.5a1.5 1.3 0 1 1 2.2 1.7L7.5 8.5h3" />
      <path d="M12.5 3a1.3 1.1 0 1 1 1.2 1.9 1.4 1.2 0 1 1-1.3 2.2" />
      <path d="M3 12h14M3 15h14M3 18h9" strokeWidth="1.75" />
    </Icon>
  ),
  /** Varinha com brilho: AutoCorreção. */
  autocorrect: (
    <Icon>
      <path d="M3 17l9.5-9.5M11 6l1.5-1.5 3 3L14 9" />
      <path d="M15 2v3M13.5 3.5h3M5 4v2.5M3.75 5.25h2.5M16.5 12v2.5M15.25 13.25h2.5" strokeWidth="1.5" />
    </Icon>
  ),
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
