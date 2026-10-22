//! Ponte de teste: o núcleo real (editor.rs do app) atrás de HTTP, no lugar do IPC do Tauri.
#[path = "../../../src-tauri/src/editor.rs"]
mod editor;
use editor::Editor;
use serde_json::{json, Value};
use std::path::PathBuf;

fn main() {
    let server = tiny_http::Server::http(std::env::var("NOVA_BRIDGE").as_deref().unwrap_or("127.0.0.1:1430")).unwrap();
    let mut ed = Editor::new();
    for mut req in server.incoming_requests() {
        let cmd = req.url().trim_start_matches('/').to_string();
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let args: Value = serde_json::from_str(&body).unwrap_or(json!({}));
        let res: Result<Value, String> = (|| -> Result<Value, String> {
            Ok(match cmd.as_str() {
                "snapshot" => serde_json::to_value(ed.view()).unwrap(),
                "dispatch" => {
                    let c = serde_json::from_value(args["command"].clone()).map_err(|e| e.to_string())?;
                    serde_json::to_value(ed.dispatch(c)?).unwrap()
                }
                "new_document" => { ed = Editor::new(); serde_json::to_value(ed.view()).unwrap() }
                "open_document" => { ed = Editor::open(&PathBuf::from(args["path"].as_str().unwrap_or("")))?; serde_json::to_value(ed.view()).unwrap() }
                "save_document" => { ed.save(args["path"].as_str().map(PathBuf::from))?; serde_json::to_value(ed.view()).unwrap() }
                "export_markdown" => { ed.export_markdown(&PathBuf::from(args["path"].as_str().unwrap_or("")))?; Value::Null }
                _ => Value::Null,
            })
        })();
        let (code, out) = match res { Ok(v) => (200, json!({"ok": v})), Err(e) => (200, json!({"err": e})) };
        let resp = tiny_http::Response::from_string(out.to_string()).with_status_code(code)
            .with_header("Access-Control-Allow-Origin: *".parse::<tiny_http::Header>().unwrap())
            .with_header("Access-Control-Allow-Headers: *".parse::<tiny_http::Header>().unwrap())
            .with_header("Content-Type: application/json".parse::<tiny_http::Header>().unwrap());
        let _ = req.respond(resp);
    }
}
