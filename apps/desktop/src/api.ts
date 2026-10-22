// Chamadas ao núcleo Rust (comandos Tauri definidos em src-tauri/src/lib.rs).

import { invoke } from "@tauri-apps/api/core";
import type { DispatchResult, DocView, FormatInfo, ImageRef, Recent, RecoveryInfo, TextCommand } from "./types";

export const api = {
  snapshot: () => invoke<DocView>("snapshot"),
  dispatch: (command: TextCommand) => invoke<DispatchResult>("dispatch", { command }),
  newDocument: () => invoke<DocView>("new_document"),
  openDocument: (path: string) => invoke<DocView>("open_document", { path }),
  /** Sem `path`, salva no arquivo atual; com `path`, Salvar como (o formato vem da extensão). */
  saveDocument: (path: string | null) => invoke<DocView>("save_document", { path }),
  /** Grava uma cópia em outro formato sem mudar o arquivo atual. */
  exportDocument: (path: string) => invoke<void>("export_document", { path }),
  formats: () => invoke<FormatInfo[]>("formats"),
  recentDocuments: () => invoke<Recent[]>("recent_documents"),
  removeRecent: (path: string) => invoke<void>("remove_recent", { path }),
  autosave: () => invoke<boolean>("autosave"),
  recoveryInfo: () => invoke<RecoveryInfo | null>("recovery_info"),
  recover: () => invoke<DocView>("recover"),
  discardRecovery: () => invoke<void>("discard_recovery"),
  /** Guarda a imagem no documento; a interface insere o parágrafo com ela. */
  addImageFile: (path: string) => invoke<ImageRef>("add_image_file", { path }),
  addImageData: (data: string) => invoke<ImageRef>("add_image_data", { data }),
  /** A imagem embutida como data URL. */
  media: (id: string) => invoke<string | null>("media", { id }),
};
