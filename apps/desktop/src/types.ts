// Espelho dos tipos serializados pelo núcleo Rust (nova-domain-text e src-tauri/src/editor.rs).

export type Mark =
  | { mark: "bold" }
  | { mark: "italic" }
  | { mark: "underline" }
  | { mark: "strike" }
  | { mark: "fontFamily"; value: string }
  | { mark: "fontSize"; halfPoints: number }
  | { mark: "color"; value: string };

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

export interface BlockView {
  style: BlockStyle;
  spans: Span[];
}

export interface DocView {
  blocks: BlockView[];
  canUndo: boolean;
  canRedo: boolean;
  path: string | null;
  title: string;
  dirty: boolean;
}

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
  | { type: "block.setStyle"; block: number; style: BlockStyle }
  | { type: "history.undo" }
  | { type: "history.redo" }
  | { type: "batch"; commands: TextCommand[] };

export interface DispatchResult {
  events: unknown[];
  view: DocView;
}
