// Chamadas ao núcleo Rust (comandos Tauri definidos em src-tauri/src/lib.rs).

import { invoke } from "@tauri-apps/api/core";
import type { DispatchResult, DocView, TextCommand } from "./types";

export const api = {
  snapshot: () => invoke<DocView>("snapshot"),
  dispatch: (command: TextCommand) => invoke<DispatchResult>("dispatch", { command }),
  newDocument: () => invoke<DocView>("new_document"),
  openDocument: (path: string) => invoke<DocView>("open_document", { path }),
  saveDocument: (path: string | null) => invoke<DocView>("save_document", { path }),
  exportMarkdown: (path: string) => invoke<void>("export_markdown", { path }),
};
