// Espelho dos tipos serializados pelo núcleo Rust (nova-domain-text e src-tauri/src/editor.rs).

export type Mark =
  | { mark: "bold" }
  | { mark: "italic" }
  | { mark: "underline" }
  | { mark: "strike" }
  | { mark: "fontFamily"; value: string }
  | { mark: "fontSize"; halfPoints: number }
  | { mark: "color"; value: string }
  | { mark: "highlight"; value: HighlightColor }
  | { mark: "vertAlign"; value: "superscript" | "subscript" }
  | { mark: "link"; href: string };

/** Cores de realce do Word (nomes do OOXML, `w:highlight`). */
export type HighlightColor =
  | "yellow"
  | "green"
  | "cyan"
  | "magenta"
  | "blue"
  | "red"
  | "darkBlue"
  | "darkCyan"
  | "darkGreen"
  | "darkMagenta"
  | "darkRed"
  | "darkYellow"
  | "darkGray"
  | "lightGray"
  | "black";

export type MarkKind = Mark["mark"];

/** Marcas sem valor, que um botão liga e desliga. */
export type ToggleMark = "bold" | "italic" | "underline" | "strike";

export type BlockStyle =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "quote"
  | "code";

export interface Span {
  text: string;
  marks: Mark[];
}

export type Align = "left" | "center" | "right" | "justify";
export type ListKind = "bullet" | "number";

/** Atributos de parágrafo (src-tauri: `ParaAttrs`). */
export interface ParaAttrs {
  align: Align;
  /** Nível de recuo, 0 a 8 (1,27 cm cada); numa lista, o nível do item. */
  indent: number;
  /** Entrelinhas em % do simples (100, 115, 150, 200…); `null` = padrão. */
  lineSpacing: number | null;
  /** Pontos; `null` = padrão do estilo. */
  spaceBefore: number | null;
  spaceAfter: number | null;
  list: ListKind | null;
  /** Sombreamento (cor de fundo) do parágrafo, `#RRGGBB`. */
  shading: string | null;
  /** Começa numa página nova (Quebra de Página, Ctrl+Enter). */
  pageBreakBefore: boolean;
  /** Célula de tabela do parágrafo; parágrafos seguidos da mesma tabela formam a tabela. */
  cell: CellRef | null;
  /** Imagem do parágrafo (alinhada com o texto); o arquivo vem de `api.media`. */
  image: ImageRef | null;
  /** Parágrafo do Sumário (título = nível 0); o texto é o do título do documento. */
  toc: TocEntry | null;
}

export interface TocEntry {
  /** 0 = título do sumário; 1 a 6 = nível do título. */
  level: number;
  /** Página da última atualização (a tela mostra a calculada na hora). */
  page: number;
}

export interface ImageRef {
  id: string;
  /** Tamanho em pontos. */
  width: number;
  height: number;
}

export interface CellRef {
  table: string;
  row: number;
  col: number;
}

/** Um atributo a mudar, no formato do comando `block.setAttr`. */
export type ParaAttr =
  | { attr: "align"; value: Align }
  | { attr: "indent"; value: number }
  | { attr: "lineSpacing"; value: number | null }
  | { attr: "spaceBefore"; value: number | null }
  | { attr: "spaceAfter"; value: number | null }
  | { attr: "list"; value: ListKind | null }
  | { attr: "shading"; value: string | null }
  | { attr: "pageBreakBefore"; value: boolean }
  | { attr: "cell"; value: CellRef | null }
  | { attr: "image"; value: ImageRef | null }
  | { attr: "toc"; value: TocEntry | null };

export const MAX_INDENT = 8;

export interface BlockView {
  style: BlockStyle;
  attrs: ParaAttrs;
  spans: Span[];
}

/** Extensões dos formatos de arquivo (src-tauri: nova_app::formats::Format). */
export type FileFormat = "docx" | "odt" | "nova" | "md" | "txt" | "html";

export interface DocView {
  blocks: BlockView[];
  /** Formato do arquivo atual; `null` se o documento ainda não foi salvo. */
  format: FileFormat | null;
  canUndo: boolean;
  canRedo: boolean;
  path: string | null;
  title: string;
  dirty: boolean;
  /** Papel e margens (aba Layout). */
  page: PageSetup;
  headerFooter: HeadersFooters;
}

/** Texto de cabeçalho/rodapé: `{PAGE}` e `{NUMPAGES}` são os campos de número e total de páginas. */
export interface HeaderFooter {
  text: string;
  align: Align;
}

export interface HeadersFooters {
  header: HeaderFooter;
  footer: HeaderFooter;
  /** "Primeira Página Diferente": nada na primeira página. */
  differentFirst: boolean;
}

export const DEFAULT_HEADER_FOOTER: HeadersFooters = {
  header: { text: "", align: "left" },
  footer: { text: "", align: "left" },
  differentFirst: false,
};

/** Página em twips (1/1440 de polegada), como no Word. */
export interface PageSetup {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

/** A4 retrato com margens de 2,5 cm, o padrão do núcleo. */
export const DEFAULT_PAGE: PageSetup = { width: 11906, height: 16838, marginTop: 1417, marginBottom: 1417, marginLeft: 1417, marginRight: 1417 };

/** Posição: bloco e offset em unidades UTF-16 (o mesmo que `string.length`). */
export interface Pos {
  block: number;
  offset: number;
}

export type TextCommand =
  | { type: "text.insert"; block: number; offset: number; text: string; marks?: Mark[] }
  | { type: "text.delete"; block: number; offset: number; len: number }
  | { type: "text.deleteRange"; from: Pos; to: Pos }
  | { type: "text.applyMark"; block: number; offset: number; len: number; mark: Mark }
  | { type: "text.removeMark"; block: number; offset: number; len: number; kind: MarkKind }
  | { type: "block.split"; block: number; offset: number }
  | { type: "block.mergeNext"; block: number }
  | { type: "block.insert"; index: number; text: string; style?: BlockStyle }
  | { type: "block.remove"; block: number }
  | { type: "page.set"; page: PageSetup }
  | { type: "headerFooter.set"; value: HeadersFooters }
  | { type: "block.setStyle"; block: number; style: BlockStyle }
  | ({ type: "block.setAttr"; block: number } & ParaAttr)
  | { type: "history.undo" }
  | { type: "history.redo" }
  | { type: "batch"; commands: TextCommand[] };

/** Parágrafos `start..start + deleteCount` trocados por `blocks` (src-tauri: `ViewPatch`). */
export interface ViewPatch {
  format: FileFormat | null;
  start: number;
  deleteCount: number;
  blocks: BlockView[];
  blockCount: number;
  canUndo: boolean;
  canRedo: boolean;
  path: string | null;
  title: string;
  dirty: boolean;
  page?: PageSetup;
  headerFooter?: HeadersFooters;
}

export interface DispatchResult {
  events: unknown[];
  patch: ViewPatch;
}

/** Aplica o remendo; os parágrafos que não mudaram continuam sendo os mesmos objetos. */
export function applyPatch(view: DocView, patch: ViewPatch): DocView | null {
  const blocks = view.blocks.slice();
  blocks.splice(patch.start, patch.deleteCount, ...patch.blocks);
  if (blocks.length !== patch.blockCount) return null;
  const { canUndo, canRedo, path, title, dirty, format } = patch;
  return { blocks, canUndo, canRedo, path, title, dirty, format, page: patch.page ?? view.page, headerFooter: patch.headerFooter ?? view.headerFooter };
}

export interface FormatInfo {
  extension: FileFormat;
  canOpen: boolean;
  keepsFormatting: boolean;
}

export interface Recent {
  path: string;
  title: string;
  /** Milissegundos desde 1970. */
  openedAt: number;
}

export interface RecoveryInfo {
  title: string;
  path: string | null;
  savedAt: number;
}
