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
  | { mark: "link"; href: string }
  /** Chamada de nota de rodapé: vai no caractere FOOTNOTE_CHAR; o texto fica em `DocView.footnotes`. */
  | { mark: "footnote"; id: string }
  /** Trecho comentado; o comentário fica em `DocView.comments`. */
  | { mark: "comment"; id: string }
  /** Chamada de citação: vai no caractere CITATION_CHAR; a fonte fica em `DocView.sources`. */
  | { mark: "citation"; id: string; page?: string };

/** Caractere da chamada de nota de rodapé (uso privado do Unicode, igual ao núcleo). */
export const FOOTNOTE_CHAR = "\uE000";

/** Caractere da chamada de citação (uso privado do Unicode, igual ao núcleo). */
export const CITATION_CHAR = "\uE001";

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
  /** Parágrafo da Bibliografia (título ou entrada), gerado a partir das fontes. */
  bibliography?: BibPart | null;
}

export type BibPart = "title" | "entry";

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
  | { attr: "toc"; value: TocEntry | null }
  | { attr: "bibliography"; value: BibPart | null };

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
  /** Marca d'água (aba Design); `null` ou ausente sem marca d'água. */
  watermark?: Watermark | null;
  /** Texto das notas de rodapé, pelo id da marca `footnote` das chamadas. */
  footnotes: Record<string, string>;
  /** Comentários (Revisão), pelo id; respostas têm `parent`. */
  comments: Record<string, Comment>;
  /** Fontes bibliográficas (Referências), pelo id da marca `citation`. */
  sources?: Record<string, Source>;
}

export type SourceKind = "book" | "article" | "web" | "thesis";

/** Autor: sobrenome e prenomes; entidade (empresa, órgão) só com `last`. */
export interface Person {
  last: string;
  first: string;
}

/** Fonte bibliográfica (nova-domain-text `Source`); campos vazios podem faltar. */
export interface Source {
  kind: SourceKind;
  authors?: Person[];
  /** Título; o que vem depois de ": " é o subtítulo. */
  title: string;
  year?: string;
  /** Editora (livro) ou nome do site. */
  publisher?: string;
  place?: string;
  edition?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  institution?: string;
  /** Tese: "Tese (Doutorado em Educação)". */
  degree?: string;
  url?: string;
  /** Data de acesso, AAAA-MM-DD. */
  accessed?: string;
}

/** Comentário (nova-domain-text `Comment`). */
export interface Comment {
  author: string;
  initials: string;
  /** ISO 8601 em UTC (`2026-10-30T14:45:00Z`); pode vir vazio de arquivos antigos. */
  date: string;
  /** Texto; quebras de linha como U+000B. */
  text: string;
  done: boolean;
  parent?: string;
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
  /** Cor da Página (`#RRGGBB`, aba Design); ausente é Sem Cor. */
  background?: string;
  /** Bordas da Página (aba Design). */
  border?: PageBorder;
}

/** Borda nos quatro lados da página, a 24 pt da beira do papel, como no Word. */
export interface PageBorder {
  style: "single" | "shadow" | "double";
  color: string;
  /** Espessura em oitavos de ponto (2 = ¼ pt … 48 = 6 pt), como o `w:sz` do Word. */
  width: number;
}

/** Marca d'água de texto atrás do conteúdo de cada página. */
export interface Watermark {
  text: string;
  color: string;
  /** 50% de opacidade, como "Semitransparente" no Word. */
  semitransparent: boolean;
  layout: "diagonal" | "horizontal";
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
  | { type: "watermark.set"; value: Watermark | null }
  | { type: "footnote.set"; id: string; text: string | null }
  | { type: "comment.set"; id: string; value: Comment | null }
  | { type: "source.set"; id: string; value: Source | null }
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
  watermark?: Watermark | null;
  footnotes?: Record<string, string>;
  comments?: Record<string, Comment>;
  sources?: Record<string, Source>;
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
  return { blocks, canUndo, canRedo, path, title, dirty, format, page: patch.page ?? view.page, headerFooter: patch.headerFooter ?? view.headerFooter, watermark: patch.watermark === undefined ? view.watermark : patch.watermark, footnotes: patch.footnotes ?? view.footnotes, comments: patch.comments ?? view.comments, sources: patch.sources ?? view.sources };
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
