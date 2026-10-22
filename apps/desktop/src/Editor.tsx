// Área de edição. O `contenteditable` dá cursor, seleção com mouse e IME
// nativos, mas nenhuma digitação altera o DOM: cada `beforeinput` é cancelado
// e vira um comando para o núcleo, que devolve o documento para redesenhar.

import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties, type JSX } from "react";
import { readSelection, writeSelection } from "./dom";
import {
  deleteBackward,
  deleteForward,
  deleteToBlockEdge,
  deleteWordBackward,
  deleteWordForward,
  insertText,
  isCollapsed,
  ordered,
  deleteRange,
  splitBlock,
  type Edit,
  type Selection,
} from "./model";
import { useI18n } from "./i18n";
import { matchShortcut, type CommandId } from "./shortcuts";
import type { BlockView, DocView, Mark } from "./types";

export type EditFn = (doc: DocView, sel: Selection) => Edit | null;

interface Props {
  view: DocView;
  revision: number;
  selection: Selection;
  /** Marcas escolhidas com o cursor parado, para o próximo texto digitado. */
  pendingMarks: Mark[] | null;
  onEdit: (fn: EditFn) => void;
  onSelect: (sel: Selection) => void;
  /** Comandos de edição e formatação (atalhos e menu nativo); os de arquivo ficam com a janela. */
  onCommand: (command: CommandId) => void;
}

export function Editor(props: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  // Os listeners nativos são registrados uma vez; leem as props mais recentes daqui.
  const latest = useRef(props);
  latest.current = props;

  // Depois de cada redesenho, recoloca o cursor onde o modelo diz. Só quando
  // o documento muda: mudanças de seleção vindas do próprio DOM (mouse, setas)
  // não precisam ser escritas de volta.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root && document.activeElement === root) writeSelection(root, latest.current.selection);
  }, [props.revision]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    writeSelection(root, latest.current.selection);

    const edit = (fn: EditFn) => latest.current.onEdit(fn);
    const typed = (text: string): EditFn => (doc, sel) =>
      insertText(doc, sel, text, latest.current.pendingMarks ?? undefined);

    const onBeforeInput = (e: InputEvent) => {
      // Durante a composição (acentos com tecla morta, IME) o navegador escreve
      // no DOM; o texto final chega em compositionend.
      if (e.isComposing || e.inputType === "insertCompositionText") return;
      e.preventDefault();
      switch (e.inputType) {
        case "insertText":
        case "insertReplacementText":
        case "insertFromPaste":
        case "insertFromYank": {
          const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
          if (text) edit(typed(text));
          break;
        }
        case "insertParagraph":
        case "insertLineBreak":
          edit(splitBlock);
          break;
        case "deleteContentBackward":
          edit(deleteBackward);
          break;
        case "deleteContentForward":
          edit(deleteForward);
          break;
        case "deleteWordBackward":
          edit(deleteWordBackward);
          break;
        case "deleteWordForward":
          edit(deleteWordForward);
          break;
        case "deleteSoftLineBackward":
        case "deleteHardLineBackward":
          edit((doc, sel) => deleteToBlockEdge(doc, sel, true));
          break;
        case "deleteSoftLineForward":
        case "deleteHardLineForward":
          edit((doc, sel) => deleteToBlockEdge(doc, sel, false));
          break;
        case "deleteByCut":
        case "deleteContent":
          edit((_doc, sel) => (isCollapsed(sel) ? null : deleteRange(...ordered(sel))));
          break;
        case "historyUndo":
          latest.current.onCommand("edit.undo");
          break;
        case "historyRedo":
          latest.current.onCommand("edit.redo");
          break;
        case "formatBold":
          latest.current.onCommand("format.bold");
          break;
        case "formatItalic":
          latest.current.onCommand("format.italic");
          break;
        case "formatUnderline":
          latest.current.onCommand("format.underline");
          break;
        case "formatStrikeThrough":
          latest.current.onCommand("format.strike");
          break;
        default:
          // Demais tipos (arrastar e soltar, formatação do navegador) são ignorados.
          break;
      }
    };

    const onCompositionEnd = (e: CompositionEvent) => {
      // Mesmo sem texto, o edit força um redesenho que descarta o que o IME escreveu no DOM.
      const text = e.data;
      edit((doc, sel) => (text ? typed(text)(doc, sel) : { command: null, selection: sel }));
    };

    const onSelectionChange = () => {
      const sel = readSelection(root);
      if (sel) latest.current.onSelect(sel);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const command = matchShortcut(e);
      // Atalhos de arquivo sobem até a janela, que cuida deles.
      if (command && !command.startsWith("file.")) {
        handled();
        latest.current.onCommand(command);
      } else if (e.key === "Tab" && !(e.ctrlKey || e.metaKey) && !e.altKey) {
        handled();
        edit(typed("\t"));
      }
    };

    const block = (e: Event) => e.preventDefault();

    root.addEventListener("beforeinput", onBeforeInput);
    root.addEventListener("compositionend", onCompositionEnd);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("dragstart", block);
    root.addEventListener("drop", block);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      root.removeEventListener("beforeinput", onBeforeInput);
      root.removeEventListener("compositionend", onCompositionEnd);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("dragstart", block);
      root.removeEventListener("drop", block);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="page"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      aria-label={t("editor.label")}
    >
      {/* A chave muda a cada resposta do núcleo: o DOM é recriado do zero,
          descartando qualquer coisa que o navegador tenha escrito nele. */}
      <Blocks key={props.revision} blocks={props.view.blocks} />
    </div>
  );
}

const Blocks = memo(function Blocks({ blocks }: { blocks: BlockView[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        const Tag = tagFor(block.style);
        const empty = block.spans.every((s) => s.text === "");
        return (
          <Tag key={i} data-block={i} className={`block block-${block.style}`}>
            {empty ? (
              <br />
            ) : (
              block.spans.map((span, j) => (
                <span key={j} style={spanStyle(span.marks)}>
                  {span.text}
                </span>
              ))
            )}
          </Tag>
        );
      })}
    </>
  );
});

function tagFor(style: BlockView["style"]): keyof JSX.IntrinsicElements {
  switch (style) {
    case "heading1":
      return "h1";
    case "heading2":
      return "h2";
    case "heading3":
      return "h3";
    case "heading4":
      return "h4";
    case "heading5":
      return "h5";
    case "heading6":
      return "h6";
    case "quote":
      return "blockquote";
    case "code":
      return "pre";
    default:
      return "p";
  }
}

function spanStyle(marks: Mark[]): CSSProperties | undefined {
  if (marks.length === 0) return undefined;
  const style: CSSProperties = {};
  const decorations: string[] = [];
  for (const m of marks) {
    switch (m.mark) {
      case "bold":
        style.fontWeight = 700;
        break;
      case "italic":
        style.fontStyle = "italic";
        break;
      case "underline":
        decorations.push("underline");
        break;
      case "strike":
        decorations.push("line-through");
        break;
      case "fontFamily":
        style.fontFamily = m.value;
        break;
      case "fontSize":
        style.fontSize = `${m.halfPoints / 2}pt`;
        break;
      case "color":
        style.color = m.value;
        break;
    }
  }
  if (decorations.length) style.textDecoration = decorations.join(" ");
  return style;
}
