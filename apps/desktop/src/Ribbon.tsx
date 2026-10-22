// Barra de título do aplicativo e faixa de opções: abas no alto, grupos de
// comandos com o nome embaixo, na mesma organização do Microsoft Word. Os
// comandos chegam por `onCommand`, com os mesmos ids da tabela de atalhos.

import { useState, type ReactNode } from "react";
import { AppLauncher } from "./AppLauncher";
import { HIGHLIGHT_CSS } from "./clipboard";
import {
  ColorBarIcon,
  FontColorMenu,
  FontPicker,
  HighlightMenu,
  keepFocus,
  MenuButton,
  MenuItem,
  SizePicker,
  SplitButton,
} from "./controls";
import type { CaseMode } from "./formatting";
import { LOCALES, useI18n, type Locale, type MessageKey } from "./i18n";
import { BrandMark, icons } from "./icons";
import { withShortcut, type CommandId, type Profile } from "./shortcuts";
import { THEME_MODES, type ThemeMode } from "./theme";
import type { Align, BlockStyle, FileFormat, HighlightColor, ListKind } from "./types";

export type RibbonCommand = CommandId;

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

/** "Arquivo" não é uma aba de comandos: abre a tela Arquivo, como no Word. */
type Tab = "home" | "view";
const TABS: ("file" | Tab)[] = ["file", "home", "view"];

/** Marcas que aparecem pressionadas na faixa de opções. */
export type ActiveMarks = Record<"bold" | "italic" | "underline" | "strike" | "subscript" | "superscript", boolean>;

export interface RibbonProps {
  title: string;
  /** Formato do arquivo aberto, mostrado ao lado do nome. */
  format: FileFormat | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  style: BlockStyle;
  /** `undefined` quando a seleção mistura valores (o campo fica vazio, como no Word). */
  font: string | undefined;
  size: number | undefined;
  active: ActiveMarks;
  align: Align | undefined;
  list: ListKind | null | undefined;
  lineSpacing: number | null | undefined;
  showMarks: boolean;
  painter: "off" | "once" | "sticky";
  fontColor: string;
  highlight: HighlightColor;
  theme: ThemeMode;
  profile: Profile;
  onCommand: (command: RibbonCommand) => void;
  /** Abre a tela Arquivo (aba Arquivo) ou a tela inicial do NovaOffice. */
  onBackstage: (page: "home" | "open") => void;
  onStyle: (style: BlockStyle) => void;
  onTheme: (mode: ThemeMode) => void;
  onFont: (font: string) => void;
  onSize: (pt: number | null) => void;
  onFontColor: (color: string | null) => void;
  onHighlight: (color: HighlightColor | null) => void;
  onCase: (mode: CaseMode) => void;
  onLineSpacing: (percent: number | null) => void;
  onParaSpace: (side: "before" | "after", add: boolean) => void;
  onPaste: (mode: "keep" | "text") => void;
  onPainter: (sticky: boolean) => void;
}

/** Entrelinhas oferecidas no menu, em % (como no Word: 1,0 1,15 1,5 2,0 2,5 3,0). */
const SPACINGS = [100, 115, 150, 200, 250, 300];

export function Ribbon(props: RibbonProps) {
  const { t, locale, setLocale } = useI18n();
  const [tab, setTab] = useState<Tab>("home");
  const [collapsed, setCollapsed] = useState(false);

  const label = (command: CommandId) => t(`cmd.${command}` as MessageKey);
  const tip = (command: CommandId) => withShortcut(label(command), command, props.profile);

  /** Botão só com ícone, com nome e atalho na dica. */
  const iconButton = (command: CommandId, icon: ReactNode, opts: { pressed?: boolean; disabled?: boolean } = {}) => (
    <button
      className="icon-button"
      onMouseDown={keepFocus}
      onClick={() => props.onCommand(command)}
      disabled={opts.disabled}
      aria-pressed={opts.pressed}
      title={tip(command)}
      aria-label={label(command)}
    >
      {icon}
    </button>
  );

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

  const small = (command: CommandId, icon: ReactNode, opts: { disabled?: boolean; pressed?: boolean } = {}) => (
    <button
      className="small-button"
      onMouseDown={keepFocus}
      onClick={() => props.onCommand(command)}
      disabled={opts.disabled}
      aria-pressed={opts.pressed}
      title={tip(command)}
    >
      {icon}
      <span>{label(command)}</span>
    </button>
  );

  const markButton = (kind: "bold" | "italic" | "underline" | "strike") => {
    const command = `format.${kind}` as CommandId;
    return (
      <button
        key={kind}
        className={`icon-button mark-button mark-${kind}`}
        aria-pressed={props.active[kind]}
        onMouseDown={keepFocus}
        onClick={() => props.onCommand(command)}
        title={tip(command)}
        aria-label={label(command)}
      >
        {t(`mark.${kind}.letter` as MessageKey)}
      </button>
    );
  };

  const alignButton = (align: Align, command: CommandId, icon: ReactNode) =>
    iconButton(command, icon, { pressed: props.align === align });

  const home = (
    <>
      <Group label={t("group.clipboard")}>
        <div className="paste-split">
          <button
            className="big-button paste-main"
            onMouseDown={keepFocus}
            onClick={() => props.onPaste("keep")}
            title={withShortcut(label("edit.paste"), "edit.paste", props.profile) + " (Ctrl+V)"}
          >
            {icons.paste}
          </button>
          <MenuButton label={label("edit.paste")} className="paste-arrow" render={(close) => (
            <>
              <MenuItem onSelect={() => { close(); props.onPaste("keep"); }}>{t("cmd.edit.pasteKeep")}</MenuItem>
              <MenuItem onSelect={() => { close(); props.onPaste("text"); }}>{t("cmd.edit.pasteText")}</MenuItem>
            </>
          )}>
            <span>{label("edit.paste")}</span>
          </MenuButton>
        </div>
        <div className="stack">
          <button className="small-button" onMouseDown={keepFocus} onClick={() => props.onCommand("edit.cut")} title={`${label("edit.cut")} (Ctrl+X)`}>
            {icons.cut}
            <span>{label("edit.cut")}</span>
          </button>
          <button className="small-button" onMouseDown={keepFocus} onClick={() => props.onCommand("edit.copy")} title={`${label("edit.copy")} (Ctrl+C)`}>
            {icons.copy}
            <span>{label("edit.copy")}</span>
          </button>
          <button
            className="small-button"
            aria-pressed={props.painter !== "off"}
            onMouseDown={keepFocus}
            onClick={(e) => props.onPainter(e.detail >= 2)}
            title={withShortcut(label("format.painter"), "format.copyFormat", props.profile)}
          >
            {icons.painter}
            <span>{label("format.painter")}</span>
          </button>
        </div>
      </Group>

      <Group label={t("group.font")}>
        <div className="rows">
          <div className="row">
            <FontPicker value={props.font} onPick={props.onFont} />
            <SizePicker value={props.size} onPick={props.onSize} />
            {iconButton("format.grow", icons.grow)}
            {iconButton("format.shrink", icons.shrink)}
            <MenuButton label={label("format.case")} title={withShortcut(label("format.case"), "format.case", props.profile)} render={(close) => (
              <>
                {(["sentence", "lower", "upper", "title", "toggle"] as CaseMode[]).map((mode) => (
                  <MenuItem key={mode} onSelect={() => { close(); props.onCase(mode); }}>
                    {t(`case.${mode}` as MessageKey)}
                  </MenuItem>
                ))}
              </>
            )}>
              {icons.changeCase}
            </MenuButton>
            {iconButton("format.clear", icons.clearFormat)}
          </div>
          <div className="row">
            {markButton("bold")}
            {markButton("italic")}
            {markButton("underline")}
            {markButton("strike")}
            {iconButton("format.subscript", icons.subscript, { pressed: props.active.subscript })}
            {iconButton("format.superscript", icons.superscript, { pressed: props.active.superscript })}
            <span className="sep" />
            <SplitButton
              label={t("color.highlight")}
              icon={<ColorBarIcon icon={icons.highlight} color={HIGHLIGHT_CSS[props.highlight]} />}
              onMain={() => props.onHighlight(props.highlight)}
              render={(close) => <HighlightMenu close={close} onPick={props.onHighlight} />}
            />
            <SplitButton
              label={t("color.font")}
              icon={<ColorBarIcon icon={icons.fontColor} color={props.fontColor} />}
              onMain={() => props.onFontColor(props.fontColor)}
              render={(close) => <FontColorMenu close={close} onPick={props.onFontColor} />}
            />
          </div>
        </div>
      </Group>

      <Group label={t("group.paragraph")}>
        <div className="rows">
          <div className="row">
            {iconButton("para.bullets", icons.bullets, { pressed: props.list === "bullet" })}
            {iconButton("para.numbering", icons.numbering, { pressed: props.list === "number" })}
            {iconButton("para.outdent", icons.outdent)}
            {iconButton("para.indent", icons.indent)}
            <span className="sep" />
            {iconButton("para.showMarks", icons.pilcrow, { pressed: props.showMarks })}
          </div>
          <div className="row">
            {alignButton("left", "para.alignLeft", icons.alignLeft)}
            {alignButton("center", "para.alignCenter", icons.alignCenter)}
            {alignButton("right", "para.alignRight", icons.alignRight)}
            {alignButton("justify", "para.justify", icons.justify)}
            <MenuButton label={t("cmd.para.spacing")} render={(close) => (
              <>
                {SPACINGS.map((s) => (
                  <MenuItem key={s} checked={props.lineSpacing === s || (s === 100 && props.lineSpacing === null)} onSelect={() => { close(); props.onLineSpacing(s); }}>
                    {(s / 100).toFixed(s % 10 ? 2 : 1).replace(".", locale.startsWith("pt") ? "," : ".")}
                  </MenuItem>
                ))}
                <div className="menu-sep" />
                <MenuItem onSelect={() => { close(); props.onParaSpace("before", true); }}>{t("spacing.addBefore")}</MenuItem>
                <MenuItem onSelect={() => { close(); props.onParaSpace("before", false); }}>{t("spacing.removeBefore")}</MenuItem>
                <MenuItem onSelect={() => { close(); props.onParaSpace("after", true); }}>{t("spacing.addAfter")}</MenuItem>
                <MenuItem onSelect={() => { close(); props.onParaSpace("after", false); }}>{t("spacing.removeAfter")}</MenuItem>
              </>
            )}>
              {icons.lineSpacing}
            </MenuButton>
          </div>
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
              title={withShortcut(t(`style.${style}`), styleCommand(style), props.profile)}
            >
              <span className="style-sample">AaBbCc</span>
              <span className="style-name">{t(`style.${style}`)}</span>
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

      <Group label={t("group.editing")}>
        <div className="stack">
          {small("edit.find", icons.find)}
          {small("edit.replace", icons.replace)}
          <MenuButton label={t("cmd.edit.select")} className="small-button" render={(close) => (
            <MenuItem onSelect={() => { close(); props.onCommand("edit.selectAll"); }}>{tip("edit.selectAll")}</MenuItem>
          )}>
            {icons.select}
            <span>{t("cmd.edit.select")}</span>
          </MenuButton>
        </div>
      </Group>
    </>
  );

  const panels: Record<Tab, ReactNode> = {
    home,
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
        <AppLauncher current="text" onHome={() => props.onBackstage("home")} />
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
          {props.format && <span className="doc-format">.{props.format}</span>}
        </div>
      </div>
      <div className="ribbon">
        <div className="tabs" role="tablist" aria-label={t("ribbon.label")}>
          {TABS.map((id) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={id === "file" ? false : tab === id}
              aria-controls={id === "file" ? undefined : "ribbon-panel"}
              aria-haspopup={id === "file" ? "dialog" : undefined}
              className={id === "file" ? "tab tab-file" : "tab"}
              onMouseDown={keepFocus}
              onClick={() => {
                if (id === "file") return props.onBackstage("home");
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
