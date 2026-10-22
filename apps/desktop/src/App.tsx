import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { Editor, type EditFn } from "./Editor";
import { useI18n } from "./i18n";
import {
  caret,
  clampSelection,
  comparePos,
  isCollapsed,
  markActive,
  marksAt,
  setStyle,
  toggleMark,
  toggledMarks,
  wordCount,
  type Selection,
} from "./model";
import { Ribbon, type RibbonCommand } from "./Ribbon";
import { matchShortcut } from "./shortcuts";
import { useTheme } from "./theme";
import type { BlockStyle, DocView, Mark, TextCommand, ToggleMark } from "./types";

interface State {
  view: DocView;
  /** Muda a cada resposta do núcleo; o editor redesenha o DOM do zero. */
  revision: number;
  selection: Selection;
}

const START = caret({ block: 0, offset: 0 });

const sameSelection = (a: Selection, b: Selection) =>
  comparePos(a.anchor, b.anchor) === 0 && comparePos(a.focus, b.focus) === 0;

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Mark[] | null>(null);
  const [status, setStatus] = useState("");
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();
  // Callbacks estáveis leem a tradução atual daqui; trocar de idioma não os recria.
  const tRef = useRef(t);
  tRef.current = t;

  // Fonte da verdade fora do ciclo de render: comandos enfileirados leem daqui
  // o estado deixado pelo comando anterior, mesmo antes de o React redesenhar.
  const stateRef = useRef<State | null>(null);
  const pendingRef = useRef<Mark[] | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const commit = useCallback((next: State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const setPending = useCallback((marks: Mark[] | null) => {
    pendingRef.current = marks;
    setPendingMarks(marks);
  }, []);

  const showError = useCallback((error: unknown) => setStatus(tRef.current("app.error", { error: String(error) })), []);

  /** Enfileira uma edição; cada uma vê o resultado da anterior. */
  const run = useCallback(
    (fn: EditFn) => {
      queue.current = queue.current.then(async () => {
        const current = stateRef.current;
        if (!current) return;
        const edit = fn(current.view, current.selection);
        if (!edit) return;
        try {
          const view = edit.command ? (await api.dispatch(edit.command)).view : current.view;
          if (edit.command) setPending(null);
          commit({ view, revision: current.revision + 1, selection: clampSelection(view, edit.selection) });
          setStatus("");
        } catch (error) {
          showError(error);
          commit({ ...current, revision: current.revision + 1 });
        }
      });
    },
    [commit, setPending, showError],
  );

  const runCommand = useCallback(
    (command: TextCommand | null) => run((_doc, sel) => ({ command, selection: sel })),
    [run],
  );

  const loadView = useCallback(
    (view: DocView) => {
      setPending(null);
      commit({ view, revision: (stateRef.current?.revision ?? 0) + 1, selection: START });
    },
    [commit, setPending],
  );

  useEffect(() => {
    api.snapshot().then(loadView, showError);
  }, [loadView, showError]);

  // Título da janela: nome do arquivo e um ponto quando há alterações não salvas.
  useEffect(() => {
    if (!state) return;
    const title = `${state.view.dirty ? "● " : ""}${state.view.title} — NovaOffice`;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [state?.view.title, state?.view.dirty]);

  const onSelect = useCallback(
    (selection: Selection) => {
      const current = stateRef.current;
      if (!current || sameSelection(current.selection, selection)) return;
      if (pendingRef.current) setPending(null);
      commit({ ...current, selection });
    },
    [commit, setPending],
  );

  const onToggleMark = useCallback(
    (kind: ToggleMark) => {
      const current = stateRef.current;
      if (!current) return;
      if (isCollapsed(current.selection)) {
        // Sem seleção, a marca vale para o próximo texto digitado.
        setPending(toggledMarks(pendingRef.current ?? marksAt(current.view, current.selection.focus), kind));
        return;
      }
      run((doc, sel) => ({ command: toggleMark(doc, sel, kind), selection: sel }));
    },
    [run, setPending],
  );

  const focusEditor = () => document.querySelector<HTMLElement>(".page")?.focus();

  const onStyle = useCallback(
    (style: BlockStyle) => {
      focusEditor();
      run((doc, sel) => ({ command: setStyle(doc, sel, style), selection: sel }));
    },
    [run],
  );

  const undo = useCallback(() => runCommand({ type: "history.undo" }), [runCommand]);
  const redo = useCallback(() => runCommand({ type: "history.redo" }), [runCommand]);

  // Operações de arquivo esperam as edições em andamento terminarem.
  const afterQueue = useCallback(
    (task: () => Promise<void>) => {
      queue.current = queue.current.then(() => task().catch(showError));
    },
    [showError],
  );

  const filters = () => [{ name: t("filter.nova"), extensions: ["nova"] }];

  const confirmDiscard = async () =>
    !stateRef.current?.view.dirty ||
    (await ask(t("dialog.discard"), {
      title: "NovaOffice",
      kind: "warning",
    }));

  const newDocument = () =>
    afterQueue(async () => {
      if (await confirmDiscard()) loadView(await api.newDocument());
    });

  const openDocument = () =>
    afterQueue(async () => {
      if (!(await confirmDiscard())) return;
      const path = await open({
        multiple: false,
        directory: false,
        filters: [...filters(), { name: t("filter.text"), extensions: ["txt", "md"] }],
      });
      if (path) loadView(await api.openDocument(path));
    });

  const saveDocument = (as: boolean) =>
    afterQueue(async () => {
      const current = stateRef.current;
      if (!current) return;
      let path: string | null = null;
      if (as || !current.view.path) {
        path = await save({ filters: filters(), defaultPath: `${current.view.title}.nova` });
        if (!path) return;
      }
      const view = await api.saveDocument(path);
      commit({ ...current, view, revision: current.revision + 1 });
      setStatus(t("status.savedTo", { path: view.path ?? "" }));
    });

  const exportMarkdown = () =>
    afterQueue(async () => {
      const current = stateRef.current;
      if (!current) return;
      const path = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: `${current.view.title}.md`,
      });
      if (!path) return;
      await api.exportMarkdown(path);
      setStatus(t("status.exportedTo", { path }));
    });

  const onCommand = (command: RibbonCommand) => {
    switch (command) {
      case "file.new":
        return newDocument();
      case "file.open":
        return openDocument();
      case "file.save":
        return saveDocument(false);
      case "file.saveAs":
        return saveDocument(true);
      case "file.exportMarkdown":
        return exportMarkdown();
      case "edit.undo":
        return undo();
      case "edit.redo":
        return redo();
      case "format.bold":
      case "format.italic":
      case "format.underline":
      case "format.strike":
        return onToggleMark(command.slice("format.".length) as ToggleMark);
      default:
        return onStyle(command.slice("style.".length) as BlockStyle);
    }
  };

  // Atalhos de arquivo valem na janela toda; os de edição o editor trata antes.
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = matchShortcut(e);
      if (!command?.startsWith("file.")) return;
      e.preventDefault();
      commandRef.current(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!state) return <div className="loading">{t("app.loading")}</div>;

  const { view, selection } = state;
  const active = (kind: ToggleMark) =>
    pendingMarks && isCollapsed(selection)
      ? pendingMarks.some((m) => m.mark === kind)
      : markActive(view, selection, kind);
  const blockStyle = view.blocks[selection.focus.block]?.style ?? "paragraph";

  return (
    <div className="app">
      <Ribbon
        title={view.title}
        dirty={view.dirty}
        canUndo={view.canUndo}
        canRedo={view.canRedo}
        style={blockStyle}
        active={{
          bold: active("bold"),
          italic: active("italic"),
          underline: active("underline"),
          strike: active("strike"),
        }}
        theme={theme}
        onCommand={onCommand}
        onToggleMark={onToggleMark}
        onStyle={onStyle}
        onTheme={setTheme}
      />
      <main className="workspace">
        <Editor
          view={view}
          revision={state.revision}
          selection={selection}
          pendingMarks={pendingMarks}
          onEdit={run}
          onSelect={onSelect}
          onCommand={onCommand}
        />
      </main>
      <footer className="statusbar">
        <span>{t(`style.${blockStyle}`)}</span>
        <span>{t("status.words", { words: wordCount(view), blocks: view.blocks.length })}</span>
        <span className="status">{status || (view.dirty ? t("status.unsaved") : view.path ? t("status.saved") : "")}</span>
      </footer>
    </div>
  );
}
