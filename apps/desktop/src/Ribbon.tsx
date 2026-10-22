// Barra de título do aplicativo e faixa de opções: abas no alto, grupos de
// comandos com o nome embaixo. Os comandos chegam por `onCommand`, com os
// mesmos ids da tabela de atalhos.

import { useState, type MouseEvent, type ReactNode } from "react";
import { LOCALES, useI18n, type Locale, type MessageKey } from "./i18n";
import { BrandMark, icons } from "./icons";
import { withShortcut, type CommandId } from "./shortcuts";
import { THEME_MODES, type ThemeMode } from "./theme";
import type { BlockStyle, ToggleMark } from "./types";

export type RibbonCommand = CommandId | "file.exportMarkdown";

export const BLOCK_STYLES: BlockStyle[] = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "quote",
  "code",
];

const styleCommand = (style: BlockStyle): CommandId => `style.${style}`;

/** Os estilos visíveis na galeria; o resto fica no seletor ao lado. */
const GALLERY: BlockStyle[] = ["paragraph", "heading1", "heading2", "heading3", "quote", "code"];

const MARKS: ToggleMark[] = ["bold", "italic", "underline", "strike"];

type Tab = "file" | "home" | "view";
const TABS: Tab[] = ["file", "home", "view"];

interface Props {
  title: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  style: BlockStyle;
  active: Record<ToggleMark, boolean>;
  theme: ThemeMode;
  onCommand: (command: RibbonCommand) => void;
  onToggleMark: (kind: ToggleMark) => void;
  onStyle: (style: BlockStyle) => void;
  onTheme: (mode: ThemeMode) => void;
}

// mousedown cancelado: clicar num botão não tira o foco nem a seleção do texto.
const keepFocus = (e: MouseEvent) => e.preventDefault();

export function Ribbon(props: Props) {
  const { t, locale, setLocale } = useI18n();
  const [tab, setTab] = useState<Tab>("home");
  const [collapsed, setCollapsed] = useState(false);

  const label = (command: CommandId) => t(`cmd.${command}` as MessageKey);
  const tip = (command: CommandId) => withShortcut(label(command), command);

  const quick = (command: CommandId, icon: ReactNode, disabled = false) => (
    <button
      className="quick-button"
      onMouseDown={keepFocus}
      onClick={() => props.onCommand(command)}
      disabled={disabled}
      title={tip(command)}
      aria-label={label(command)}
    >
      {icon}
    </button>
  );

  const big = (command: RibbonCommand, icon: ReactNode, text: string, title = text) => (
    <button className="big-button" onMouseDown={keepFocus} onClick={() => props.onCommand(command)} title={title}>
      {icon}
      <span>{text}</span>
    </button>
  );

  const small = (command: CommandId, icon: ReactNode, disabled: boolean) => (
    <button
      className="small-button"
      onMouseDown={keepFocus}
      onClick={() => props.onCommand(command)}
      disabled={disabled}
      title={tip(command)}
    >
      {icon}
      <span>{label(command)}</span>
    </button>
  );

  const panels: Record<Tab, ReactNode> = {
    file: (
      <>
        <Group label={t("group.document")}>
          {big("file.new", icons.new, t("cmd.file.new"), tip("file.new"))}
          {big("file.open", icons.open, t("cmd.file.open"), tip("file.open"))}
          {big("file.save", icons.save, t("cmd.file.save"), tip("file.save"))}
          {big("file.saveAs", icons.saveAs, t("cmd.file.saveAs"), tip("file.saveAs"))}
        </Group>
        <Group label={t("group.export")}>
          {big("file.exportMarkdown", icons.export, t("cmd.file.exportMarkdown"), t("cmd.file.exportMarkdown.title"))}
        </Group>
      </>
    ),
    home: (
      <>
        <Group label={t("group.history")}>
          <div className="stack">
            {small("edit.undo", icons.undo, !props.canUndo)}
            {small("edit.redo", icons.redo, !props.canRedo)}
          </div>
        </Group>
        <Group label={t("group.font")}>
          <div className="marks">
            {MARKS.map((kind) => {
              const command = `format.${kind}` as CommandId;
              return (
                <button
                  key={kind}
                  className={`mark-button mark-${kind}`}
                  aria-pressed={props.active[kind]}
                  onMouseDown={keepFocus}
                  onClick={() => props.onToggleMark(kind)}
                  title={tip(command)}
                  aria-label={label(command)}
                >
                  {t(`mark.${kind}.letter` as MessageKey)}
                </button>
              );
            })}
          </div>
        </Group>
        <Group label={t("group.styles")}>
          <div className="gallery" role="listbox" aria-label={t("group.styles")}>
            {GALLERY.map((style) => (
              <button
                key={style}
                role="option"
                aria-selected={props.style === style}
                className={`style-chip style-${style}`}
                onMouseDown={keepFocus}
                onClick={() => props.onStyle(style)}
                title={withShortcut(t(`style.${style}`), styleCommand(style))}
              >
                {t(`style.${style}`)}
              </button>
            ))}
          </div>
          <select
            className="style-select"
            value={props.style}
            onChange={(e) => props.onStyle(e.target.value as BlockStyle)}
            title={t("cmd.style.more")}
            aria-label={t("cmd.style.more")}
          >
            {BLOCK_STYLES.map((style) => (
              <option key={style} value={style}>
                {t(`style.${style}`)}
              </option>
            ))}
          </select>
        </Group>
      </>
    ),
    view: (
      <>
        <Group label={t("group.theme")}>
          <div className="segmented" role="radiogroup" aria-label={t("group.theme")}>
            {THEME_MODES.map((mode) => (
              <button
                key={mode}
                role="radio"
                aria-checked={props.theme === mode}
                onMouseDown={keepFocus}
                onClick={() => props.onTheme(mode)}
              >
                {icons[mode]}
                <span>{t(`theme.${mode}`)}</span>
              </button>
            ))}
          </div>
        </Group>
        <Group label={t("group.language")}>
          <label className="language">
            {icons.language}
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t("group.language")}>
              {(Object.keys(LOCALES) as Locale[]).map((l) => (
                <option key={l} value={l}>
                  {LOCALES[l].name}
                </option>
              ))}
            </select>
          </label>
        </Group>
      </>
    ),
  };

  return (
    <header className="chrome">
      <div className="titlebar">
        <div className="brand">
          <BrandMark app="text" size={22} />
          <span className="brand-name">Nova Text</span>
        </div>
        <div className="quick" role="toolbar" aria-label={t("quick.label")}>
          {quick("file.save", icons.save)}
          {quick("edit.undo", icons.undo, !props.canUndo)}
          {quick("edit.redo", icons.redo, !props.canRedo)}
        </div>
        <div className="doc-title">
          {props.dirty && <span className="dirty-dot" aria-hidden="true" />}
          {props.title}
        </div>
      </div>
      <div className="ribbon">
        <div className="tabs" role="tablist" aria-label={t("ribbon.label")}>
          {TABS.map((id) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls="ribbon-panel"
              className={id === "file" ? "tab tab-file" : "tab"}
              onMouseDown={keepFocus}
              onClick={() => {
                setTab(id);
                setCollapsed(false);
              }}
            >
              {t(`tab.${id}`)}
            </button>
          ))}
          <button
            className="collapse"
            onMouseDown={keepFocus}
            onClick={() => setCollapsed((c) => !c)}
            title={t(collapsed ? "ribbon.expand" : "ribbon.collapse")}
            aria-label={t(collapsed ? "ribbon.expand" : "ribbon.collapse")}
            aria-expanded={!collapsed}
          >
            {collapsed ? icons.chevronDown : icons.chevronUp}
          </button>
        </div>
        {!collapsed && (
          <div className="panel" role="tabpanel" id="ribbon-panel" aria-labelledby={`tab-${tab}`}>
            {panels[tab]}
          </div>
        )}
      </div>
    </header>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="group" role="group" aria-label={label}>
      <div className="group-body">{children}</div>
      <div className="group-label">{label}</div>
    </div>
  );
}
