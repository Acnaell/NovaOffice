//! App desktop da NovaOffice: expõe o núcleo à interface web como comandos Tauri.
//!
//! A interface nunca altera o documento por conta própria: cada tecla vira um
//! `TextCommand`, e a resposta traz os parágrafos alterados para redesenhar.

mod app;
mod editor;
mod spell;
mod store;

use app::App;
use editor::{DispatchResult, DocView};
use nova_domain_text::TextCommand;
use serde_json::Value;
use spell::Spelling;
use store::{Recent, RecoveryInfo};
use tauri::{Manager, State};

#[tauri::command]
fn snapshot(app: State<'_, App>) -> DocView {
    app.snapshot()
}

#[tauri::command]
fn dispatch(app: State<'_, App>, command: TextCommand) -> Result<DispatchResult, String> {
    app.dispatch(command)
}

#[tauri::command]
fn new_document(app: State<'_, App>) -> DocView {
    app.new_document()
}

#[tauri::command]
fn open_document(app: State<'_, App>, path: String) -> Result<DocView, String> {
    app.open_document(&path)
}

#[tauri::command]
fn save_document(app: State<'_, App>, path: Option<String>) -> Result<DocView, String> {
    app.save_document(path)
}

#[tauri::command]
fn export_document(app: State<'_, App>, path: String) -> Result<(), String> {
    app.export_document(&path)
}

#[tauri::command]
fn formats(app: State<'_, App>) -> Value {
    app.formats()
}

#[tauri::command]
fn recent_documents(app: State<'_, App>) -> Vec<Recent> {
    app.recent()
}

#[tauri::command]
fn remove_recent(app: State<'_, App>, path: String) -> Result<(), String> {
    app.remove_recent(&path)
}

#[tauri::command]
fn autosave(app: State<'_, App>) -> Result<bool, String> {
    app.autosave()
}

#[tauri::command]
fn recovery_info(app: State<'_, App>) -> Option<RecoveryInfo> {
    app.recovery_info()
}

#[tauri::command]
fn recover(app: State<'_, App>) -> Result<DocView, String> {
    app.recover()
}

#[tauri::command]
fn discard_recovery(app: State<'_, App>) {
    app.discard_recovery()
}

#[tauri::command]
fn add_image_file(app: State<'_, App>, path: String) -> Result<nova_domain_text::ImageRef, String> {
    app.add_image_file(&path)
}

#[tauri::command]
fn add_image_data(app: State<'_, App>, data: String) -> Result<nova_domain_text::ImageRef, String> {
    app.add_image_data(&data)
}

#[tauri::command]
fn media(app: State<'_, App>, id: String) -> Option<String> {
    app.media(&id)
}

// Corretor ortográfico. Assíncronos para rodar fora da thread da janela:
// carregar um dicionário leva algumas centenas de milissegundos.

#[tauri::command]
async fn spell_check(
    spelling: State<'_, Spelling>,
    language: String,
    texts: Vec<String>,
) -> Result<Vec<Vec<(u32, u32)>>, String> {
    spelling.check(&language, &texts)
}

#[tauri::command]
async fn spell_suggest(
    spelling: State<'_, Spelling>,
    language: String,
    word: String,
) -> Result<Vec<String>, String> {
    spelling.suggest(&language, &word)
}

#[tauri::command]
async fn spell_add_word(
    spelling: State<'_, Spelling>,
    language: String,
    word: String,
) -> Result<(), String> {
    spelling.add_word(&language, &word)
}

#[tauri::command]
async fn spell_ignore_all(
    spelling: State<'_, Spelling>,
    language: String,
    word: String,
) -> Result<(), String> {
    spelling.ignore_all(&language, &word)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|handle| {
            // Recentes e recuperação ficam na pasta de dados do app
            // (%APPDATA%\org.novaoffice.desktop no Windows).
            let dir = handle.path().app_data_dir()?;
            handle.manage(App::new(dir));
            let user_dictionary = handle
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join("dicionario.json"));
            handle.manage(Spelling::new(user_dictionary));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            dispatch,
            new_document,
            open_document,
            save_document,
            export_document,
            formats,
            recent_documents,
            remove_recent,
            autosave,
            recovery_info,
            recover,
            discard_recovery,
            add_image_file,
            add_image_data,
            media,
            spell_check,
            spell_suggest,
            spell_add_word,
            spell_ignore_all
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar a NovaOffice");
}
