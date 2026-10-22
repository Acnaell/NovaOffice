//! App desktop da NovaOffice: expõe o núcleo à interface web como comandos Tauri.
//!
//! A interface nunca altera o documento por conta própria: cada tecla vira um
//! `TextCommand`, e a resposta traz a visão atualizada para redesenhar.

mod editor;

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use editor::{DispatchResult, DocView, Editor};
use nova_domain_text::TextCommand;
use tauri::State;

struct AppState(Mutex<Editor>);

impl AppState {
    fn editor(&self) -> MutexGuard<'_, Editor> {
        // Um pânico num comando anterior não deve travar a janela.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[tauri::command]
fn snapshot(state: State<'_, AppState>) -> DocView {
    state.editor().view()
}

#[tauri::command]
fn dispatch(state: State<'_, AppState>, command: TextCommand) -> Result<DispatchResult, String> {
    state.editor().dispatch(command)
}

#[tauri::command]
fn new_document(state: State<'_, AppState>) -> DocView {
    let mut editor = state.editor();
    *editor = Editor::new();
    editor.view()
}

#[tauri::command]
fn open_document(state: State<'_, AppState>, path: String) -> Result<DocView, String> {
    let opened = Editor::open(&PathBuf::from(path))?;
    let mut editor = state.editor();
    *editor = opened;
    Ok(editor.view())
}

#[tauri::command]
fn save_document(state: State<'_, AppState>, path: Option<String>) -> Result<DocView, String> {
    let mut editor = state.editor();
    editor.save(path.map(PathBuf::from))?;
    Ok(editor.view())
}

#[tauri::command]
fn export_markdown(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.editor().export_markdown(&PathBuf::from(path))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState(Mutex::new(Editor::new())))
        .invoke_handler(tauri::generate_handler![
            snapshot,
            dispatch,
            new_document,
            open_document,
            save_document,
            export_markdown
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a NovaOffice");
}
