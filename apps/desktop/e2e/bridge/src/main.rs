//! Ponte de teste: os comandos do app (src-tauri/src/app.rs) atrás de HTTP, no
//! lugar do IPC do Tauri. Cada requisição é `POST /<comando>` com os mesmos
//! argumentos JSON que a interface manda ao Tauri.
#[path = "../../../src-tauri/src/app.rs"]
mod app;
#[path = "../../../src-tauri/src/editor.rs"]
mod editor;
#[path = "../../../src-tauri/src/spell.rs"]
mod spell;
#[path = "../../../src-tauri/src/store.rs"]
mod store;

use app::App;
use serde_json::{json, Value};
use spell::Spelling;

fn main() {
    let addr = std::env::var("NOVA_BRIDGE").unwrap_or_else(|_| "127.0.0.1:1430".into());
    // Recentes e recuperação numa pasta temporária, limpa a cada execução.
    let dir = std::env::temp_dir().join("nova-e2e-store");
    let _ = std::fs::remove_dir_all(&dir);
    let mut app = App::new(dir.clone());
    // Dicionário do usuário só em memória: os testes não gravam no disco.
    let spelling = Spelling::new(None);
    // A ponte atende um pedido por vez: carregar o dicionário na primeira
    // verificação seguraria as teclas do primeiro fluxo. No app, o Tauri roda o
    // corretor fora da fila dos comandos de edição.
    let _ = spelling.check("pt-BR", &[]);
    let server = tiny_http::Server::http(&addr).expect("porta da ponte");
    for mut req in server.incoming_requests() {
        let cmd = req.url().trim_start_matches('/').to_string();
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let args: Value = serde_json::from_str(&body).unwrap_or(json!({}));
        let s = |k: &str| args[k].as_str().unwrap_or("").to_string();
        let to = |v: Result<Value, String>| v;
        let res: Result<Value, String> = match cmd.as_str() {
            "snapshot" => Ok(json!(app.snapshot())),
            // Só nos testes: simula o app fechando sem salvar (travamento) e abrindo de novo.
            "restart" => {
                app = App::new(dir.clone());
                Ok(Value::Null)
            }
            "dispatch" => serde_json::from_value(args["command"].clone())
                .map_err(|e| e.to_string())
                .and_then(|c| app.dispatch(c))
                .map(|r| json!(r)),
            "new_document" => Ok(json!(app.new_document())),
            "open_document" => app.open_document(&s("path")).map(|v| json!(v)),
            "save_document" => app
                .save_document(args["path"].as_str().map(String::from))
                .map(|v| json!(v)),
            "export_document" => app.export_document(&s("path")).map(|_| Value::Null),
            "formats" => Ok(app.formats()),
            "recent_documents" => Ok(json!(app.recent())),
            "remove_recent" => app.remove_recent(&s("path")).map(|_| Value::Null),
            "autosave" => app.autosave().map(|v| json!(v)),
            "recovery_info" => Ok(json!(app.recovery_info())),
            "add_image_file" => app.add_image_file(&s("path")).map(|v| json!(v)),
            "add_image_data" => app.add_image_data(&s("data")).map(|v| json!(v)),
            "media" => Ok(json!(app.media(&s("id")))),
            "recover" => to(app.recover().map(|v| json!(v))),
            "discard_recovery" => {
                app.discard_recovery();
                Ok(Value::Null)
            }
            "spell_check" => serde_json::from_value::<Vec<String>>(args["texts"].clone())
                .map_err(|e| e.to_string())
                .and_then(|texts| spelling.check(&s("language"), &texts))
                .map(|v| json!(v)),
            "spell_suggest" => spelling
                .suggest(&s("language"), &s("word"))
                .map(|v| json!(v)),
            "spell_add_word" => spelling
                .add_word(&s("language"), &s("word"))
                .map(|_| Value::Null),
            "spell_ignore_all" => spelling
                .ignore_all(&s("language"), &s("word"))
                .map(|_| Value::Null),
            _ => Ok(Value::Null),
        };
        let out = match res {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": e }),
        };
        let header = |h: &str| h.parse::<tiny_http::Header>().expect("cabeçalho");
        let resp = tiny_http::Response::from_string(out.to_string())
            .with_header(header("Access-Control-Allow-Origin: *"))
            .with_header(header("Access-Control-Allow-Headers: *"))
            .with_header(header("Content-Type: application/json"));
        let _ = req.respond(resp);
    }
}
