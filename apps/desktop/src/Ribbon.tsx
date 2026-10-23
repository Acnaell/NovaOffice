// Barra de título do aplicativo e faixa de opções: abas no alto, grupos de
// comandos com o nome embaixo, na mesma organização do Microsoft Word. Os
// comandos chegam por `onCommand`, com os mesmos ids da tabela de atalhos.

import { useEffect, useState, type ReactNode } from "react";
import { AppLauncher } from "./AppLauncher";
import { HIGHLIGHT_CSS } from "./clipboard";
import { SymbolMenu, TablePicker } from "./Insert";
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
import type { Align, BlockStyle, FileFormat, HeadersFooters, HighlightColor, ListKind, PageSetup } from "./types";
import type { Part } from "./headerfooter";
import { isLandscape, MARGIN_PRESETS, marginsOf, PAPER_SIZES, paperOf, toCm, withMargins, withOrientation, withPaper } from "./layout";

/** Comandos da faixa: os com atalho e os que só existem como botão. */
export type RibbonCommand =
  | CommandId
  | "insert.dateTime"
  | "insert.picture"
  | "image.size25"
  | "image.size50"
  | "image.size75"
  | "image.size100"
  | "image.delete"
  | "table.insertAbove"
  | "table.insertBelow"
  | "table.insertLeft"
  | "table.insertRight"
  | "table.deleteRows"
  | "table.deleteColumns"
  | "table.deleteTable";

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
/** "table" é a aba contextual Layout da Tabela, que só aparece com o cursor numa tabela. */
type Tab = "home" | "insert" | "layout" | "review" | "view" | "table" | "picture" | "headerFooter";
const TABS: ("file" | Tab)[] = ["file", "home", "insert", "layout", "review", "view"];

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
  /** Último sombreamento usado (o botão aplica este). */
  shading: string;
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
  onShading: (color: string | null) => void;
  onHighlight: (color: HighlightColor | null) => void;
  onCase: (mode: CaseMode) => void;
  onLineSpacing: (percent: number | null) => void;
  onParaSpace: (side: "before" | "after", add: boolean) => void;
  onPaste: (mode: "keep" | "text") => void;
  onPainter: (sticky: boolean) => void;
  /** Insere texto no cursor (Símbolo). */
  onInsertText: (text: string) => void;
  onInsertTable: (rows: number, cols: number) => void;
  /** O cursor está numa tabela: mostra a aba Layout da Tabela. */
  inTable: boolean;
  /** O cursor está numa imagem: mostra a aba Formato da Imagem. */
  onImage: boolean;
  page: PageSetup;
  onPage: (page: PageSetup) => void;
  onCustomMargins: () => void;
  /** Editando o cabeçalho ou o rodapé: mostra a aba Cabeçalho e Rodapé. */
  hfEditing: Part | null;
  headerFooter: HeadersFooters;
  onEditHeaderFooter: (part: Part) => void;
  onCloseHeaderFooter: () => void;
  onPageNumber: (part: Part, align: "left" | "center" | "right", xOfY?: boolean) => void;
  onRemovePageNumbers: () => void;
  onHeaderFooterAlign: (align: Align) => void;
  onDifferentFirst: () => void;
  onInsertField: (field: string) => void;
  /** Conteúdo da aba Revisão (ReviewTab.tsx). */
  review: ReactNode;
}

/** Entrelinhas oferecidas no menu, em % (como no Word: 1,0 1,15 1,5 2,0 2,5 3,0). */
const SPACINGS = [100, 115, 150, 200, 250, 300];

export function Ribbon(props: RibbonProps) {
  const { t, locale, setLocale } = useI18n();
  const [tab, setTab] = useState<Tab>("home");
  // Saindo da tabela, a aba Layout da Tabela some e volta a Página Inicial.
  useEffect(() => {
    if ((!props.inTable && tab === "table") || (!props.onImage && tab === "picture") || (!props.hfEditing && tab === "headerFooter")) setTab("home");
  }, [props.inTable, props.onImage, tab]);
  // Entrando no cabeçalho/rodapé, a aba dele abre sozinha, como no Word.
  useEffect(() => {
    if (props.hfEditing) setTab("headerFooter");
  }, [props.hfEditing]);
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

  /** Botão grande com ícone e nome embaixo. */
  const big = (command: RibbonCommand, icon: ReactNode, text: string, title = text) => (
    <button className="big-button" onMouseDown={keepFocus} onClick={() => props.onCommand(command)} title={title}>
      {icon}
      <span>{text}</span>
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
            <SplitButton
              label={t("color.shading")}
              icon={<ColorBarIcon icon={icons.shading} color={props.shading} />}
              onMain={() => props.onShading(props.shading)}
              render={(close) => <FontColorMenu close={close} onPick={props.onShading} autoLabel="color.none" />}
            />
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

  const pageNumberMenu = (
    <MenuButton label={t("hf.pageNumber")} className="big-button" menuClass="layout-menu" render={(close) => (
      <>
        <div className="menu-heading">{t("hf.topOfPage")}</div>
        {(["left", "center", "right"] as const).map((a) => (
          <MenuItem key={`t${a}`} onSelect={() => { close(); props.onPageNumber("header", a); }}>{t(`hf.${a}`)}</MenuItem>
        ))}
        <div className="menu-heading">{t("hf.bottomOfPage")}</div>
        {(["left", "center", "right"] as const).map((a) => (
          <MenuItem key={`b${a}`} onSelect={() => { close(); props.onPageNumber("footer", a); }}>{t(`hf.${a}`)}</MenuItem>
        ))}
        <MenuItem onSelect={() => { close(); props.onPageNumber("footer", "right", true); }}>{t("hf.pageXofY")}</MenuItem>
        <div className="menu-sep" />
        <MenuItem onSelect={() => { close(); props.onRemovePageNumbers(); }}>{t("hf.removeNumbers")}</MenuItem>
      </>
    )}>
      {icons.pageNumber}
      <span>{t("hf.pageNumber")}</span>
    </MenuButton>
  );

  const editingPart = props.hfEditing ? props.headerFooter[props.hfEditing] : null;
  const headerFooterTab = (
    <>
      <Group label={t("group.headerFooter")}>
        {pageNumberMenu}
      </Group>
      <Group label={t("group.insert")}>
        <button className="big-button" onMouseDown={keepFocus} onClick={() => props.onInsertField("{PAGE}")}>
          {icons.pageNumber}
          <span>{t("hf.pageField")}</span>
        </button>
        <button className="big-button" onMouseDown={keepFocus} onClick={() => props.onInsertField("{NUMPAGES}")}>
          {icons.pageNumber}
          <span>{t("hf.pagesField")}</span>
        </button>
      </Group>
      <Group label={t("group.navigation")}>
        <button className="big-button" onMouseDown={keepFocus} onClick={() => props.onEditHeaderFooter(props.hfEditing === "header" ? "footer" : "header")}>
          {props.hfEditing === "header" ? icons.footer : icons.header}
          <span>{t(props.hfEditing === "header" ? "hf.goFooter" : "hf.goHeader")}</span>
        </button>
      </Group>
      <Group label={t("group.options")}>
        <label className="check-option">
          <input type="checkbox" checked={props.headerFooter.differentFirst} onChange={props.onDifferentFirst} />
          {t("hf.differentFirst")}
        </label>
      </Group>
      <Group label={t("group.position")}>
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            className="icon-button"
            aria-pressed={editingPart?.align === a}
            onMouseDown={keepFocus}
            onClick={() => props.onHeaderFooterAlign(a)}
            title={t(a === "left" ? "image.left" : a === "center" ? "image.center" : "image.right")}
          >
            {a === "left" ? icons.alignLeft : a === "center" ? icons.alignCenter : icons.alignRight}
          </button>
        ))}
      </Group>
      <Group label={t("group.close")}>
        <button className="big-button" onMouseDown={keepFocus} onClick={props.onCloseHeaderFooter}>
          {icons.closeDoc}
          <span>{t("hf.close")}</span>
        </button>
      </Group>
    </>
  );

  const insert = (
    <>
      <Group label={t("group.pages")}>
        {big("insert.pageBreak", icons.pageBreak, t("cmd.insert.pageBreak"), tip("insert.pageBreak"))}
      </Group>
      <Group label={t("group.illustrations")}>
        {big("insert.picture", icons.picture, t("insert.picture"))}
      </Group>
      <Group label={t("group.tables")}>
        <MenuButton label={t("insert.table")} className="big-button" menuClass="tables" render={(close) => <TablePicker close={close} onPick={props.onInsertTable} />}>
          {icons.table}
          <span>{t("insert.table")}</span>
        </MenuButton>
      </Group>
      <Group label={t("group.headerFooter")}>
        <button className="big-button" onMouseDown={keepFocus} onClick={() => props.onEditHeaderFooter("header")}>
          {icons.header}
          <span>{t("hf.header")}</span>
        </button>
        <button className="big-button" onMouseDown={keepFocus} onClick={() => props.onEditHeaderFooter("footer")}>
          {icons.footer}
          <span>{t("hf.footer")}</span>
        </button>
        {pageNumberMenu}
      </Group>
      <Group label={t("group.links")}>
        {big("insert.link", icons.link, t("cmd.insert.link"), tip("insert.link"))}
      </Group>
      <Group label={t("group.text")}>
        {big("insert.dateTime", icons.calendar, t("insert.dateTime"))}
      </Group>
      <Group label={t("group.symbols")}>
        <MenuButton label={t("insert.symbol")} className="big-button" menuClass="symbols" render={(close) => <SymbolMenu close={close} onPick={props.onInsertText} />}>
          {icons.omega}
          <span>{t("insert.symbol")}</span>
        </MenuButton>
      </Group>
    </>
  );

  const tableLayout = (
    <>
      <Group label={t("group.rowsCols")}>
        <MenuButton label={t("table.delete")} className="big-button" render={(close) => (
          <>
            <MenuItem onSelect={() => { close(); props.onCommand("table.deleteColumns"); }}>{t("table.deleteColumns")}</MenuItem>
            <MenuItem onSelect={() => { close(); props.onCommand("table.deleteRows"); }}>{t("table.deleteRows")}</MenuItem>
            <MenuItem onSelect={() => { close(); props.onCommand("table.deleteTable"); }}>{t("table.deleteTable")}</MenuItem>
          </>
        )}>
          {icons.tableDelete}
          <span>{t("table.delete")}</span>
        </MenuButton>
        {big("table.insertAbove", icons.rowAbove, t("table.insertAbove"))}
        {big("table.insertBelow", icons.rowBelow, t("table.insertBelow"))}
        {big("table.insertLeft", icons.colLeft, t("table.insertLeft"))}
        {big("table.insertRight", icons.colRight, t("table.insertRight"))}
      </Group>
    </>
  );

  const decimal = locale.startsWith("pt") ? "," : ".";
  const num = (twips: number) => String(toCm(twips)).replace(".", decimal);
  const currentMargins = marginsOf(props.page);
  const currentPaper = paperOf(props.page);
  const landscape = isLandscape(props.page);
  const layout = (
    <>
      <Group label={t("group.pageSetup")}>
        <MenuButton label={t("layout.margins")} className="big-button" menuClass="layout-menu" render={(close) => (
          <>
            {MARGIN_PRESETS.map((m) => (
              <MenuItem key={m.id} checked={currentMargins?.id === m.id} onSelect={() => { close(); props.onPage(withMargins(props.page, m)); }}>
                <span className="preset">
                  <strong>{t(`margins.${m.id}` as MessageKey)}</strong>
                  <small>{t("layout.marginValues", { top: num(m.top), bottom: num(m.bottom), left: num(m.left), right: num(m.right) })}</small>
                </span>
              </MenuItem>
            ))}
            <div className="menu-sep" />
            <MenuItem onSelect={() => { close(); props.onCustomMargins(); }}>{t("layout.customMargins")}…</MenuItem>
          </>
        )}>
          {icons.margins}
          <span>{t("layout.margins")}</span>
        </MenuButton>
        <MenuButton label={t("layout.orientation")} className="big-button" render={(close) => (
          <>
            <MenuItem checked={!landscape} onSelect={() => { close(); props.onPage(withOrientation(props.page, false)); }}>{t("layout.portrait")}</MenuItem>
            <MenuItem checked={landscape} onSelect={() => { close(); props.onPage(withOrientation(props.page, true)); }}>{t("layout.landscape")}</MenuItem>
          </>
        )}>
          {landscape ? icons.landscape : icons.portrait}
          <span>{t("layout.orientation")}</span>
        </MenuButton>
        <MenuButton label={t("layout.size")} className="big-button" menuClass="layout-menu" render={(close) => (
          <>
            {PAPER_SIZES.map((paper) => (
              <MenuItem key={paper.id} checked={currentPaper?.id === paper.id} onSelect={() => { close(); props.onPage(withPaper(props.page, paper)); }}>
                <span className="preset">
                  <strong>{t(`paper.${paper.id}` as MessageKey)}</strong>
                  <small>{num(paper.width)} × {num(paper.height)} cm</small>
                </span>
              </MenuItem>
            ))}
          </>
        )}>
          {icons.paperSize}
          <span>{t("layout.size")}</span>
        </MenuButton>
      </Group>
      <Group label={t("group.breaks")}>
        {big("insert.pageBreak", icons.pageBreak, t("cmd.insert.pageBreak"), tip("insert.pageBreak"))}
      </Group>
    </>
  );

  const pictureFormat = (
    <>
      <Group label={t("group.size")}>
        {big("image.size25", icons.picture, "25%", t("image.width", { percent: 25 }))}
        {big("image.size50", icons.picture, "50%", t("image.width", { percent: 50 }))}
        {big("image.size75", icons.picture, "75%", t("image.width", { percent: 75 }))}
        {big("image.size100", icons.picture, "100%", t("image.width", { percent: 100 }))}
      </Group>
      <Group label={t("group.arrange")}>
        {big("para.alignLeft", icons.alignLeft, t("image.left"), tip("para.alignLeft"))}
        {big("para.alignCenter", icons.alignCenter, t("image.center"), tip("para.alignCenter"))}
        {big("para.alignRight", icons.alignRight, t("image.right"), tip("para.alignRight"))}
      </Group>
      <Group label={t("group.delete")}>
        {big("image.delete", icons.tableDelete, t("image.delete"))}
      </Group>
    </>
  );

  const panels: Record<Tab, ReactNode> = {
    home,
    insert,
    layout,
    headerFooter: headerFooterTab,
    table: tableLayout,
    picture: pictureFormat,
    review: props.review,
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
          {[
            ...TABS,
            ...(props.inTable ? (["table"] as const) : []),
            ...(props.onImage ? (["picture"] as const) : []),
            ...(props.hfEditing ? (["headerFooter"] as const) : []),
          ].map((id) => (
            <button
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={id === "file" ? false : tab === id}
              aria-controls={id === "file" ? undefined : "ribbon-panel"}
              aria-haspopup={id === "file" ? "dialog" : undefined}
              className={id === "file" ? "tab tab-file" : id === "table" || id === "picture" || id === "headerFooter" ? "tab tab-context" : "tab"}
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
            {panels[(tab === "table" && !props.inTable) || (tab === "picture" && !props.onImage) || (tab === "headerFooter" && !props.hfEditing) ? "home" : tab]}
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
