//! Camada de aplicação: a única porta de entrada do núcleo.
//!
//! UI, plugins, agentes de IA e o CLI mandam os mesmos comandos para uma
//! `Session`, que os executa no agregado e publica os eventos resultantes.

pub mod docx;
pub mod file;
pub mod formats;
pub mod html;
pub mod markdown;
pub mod media;
pub mod odt;

use std::time::{SystemTime, UNIX_EPOCH};

use nova_crdt::ClientId;
use nova_domain_text::{DomainError, TextCommand, TextDocument, TextEvent};
use thiserror::Error;

/// Id de cliente CRDT para uma nova sessão. O Yjs usa ids de 32 bits, então o
/// valor fica nessa faixa para manter compatibilidade com clientes web.
pub fn new_client_id() -> ClientId {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos()))
        .unwrap_or(0);
    let pid = u64::from(std::process::id());
    ((nanos ^ (pid << 16)) & 0xFFFF_FFFF).max(1)
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("JSON inválido: {0}")]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Domain(#[from] DomainError),
    #[error("não é um arquivo NovaOffice")]
    NotANovaFile,
    #[error("versão de arquivo {0} não suportada")]
    UnsupportedVersion(u8),
    #[error("arquivo inválido: {0}")]
    InvalidFile(String),
}

type Listener = Box<dyn FnMut(&TextEvent) + Send>;

pub struct Session {
    document: TextDocument,
    listeners: Vec<Listener>,
}

impl Session {
    pub fn new(document: TextDocument) -> Self {
        Self {
            document,
            listeners: Vec::new(),
        }
    }

    pub fn document(&self) -> &TextDocument {
        &self.document
    }

    pub fn into_document(self) -> TextDocument {
        self.document
    }

    /// Registra quem quer saber das mudanças (layout, renderização, auditoria).
    pub fn subscribe(&mut self, listener: impl FnMut(&TextEvent) + Send + 'static) {
        self.listeners.push(Box::new(listener));
    }

    pub fn dispatch(&mut self, command: TextCommand) -> Result<Vec<TextEvent>, AppError> {
        let events = self.document.execute(command)?;
        for event in &events {
            for listener in &mut self.listeners {
                listener(event);
            }
        }
        Ok(events)
    }

    /// Mesmo que `dispatch`, com comando e eventos em JSON. É a forma usada
    /// pela ponte Tauri, pela API web e pelas ferramentas dos agentes de IA.
    pub fn dispatch_json(&mut self, command: &str) -> Result<String, AppError> {
        let command: TextCommand = serde_json::from_str(command)?;
        let events = self.dispatch(command)?;
        Ok(serde_json::to_string(&events)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn despacha_json_e_avisa_assinantes() {
        let mut session = Session::new(TextDocument::new(1));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        session.subscribe(move |event| sink.lock().unwrap().push(event.clone()));

        let out = session
            .dispatch_json(r#"{"type":"text.insert","block":0,"offset":0,"text":"Oi"}"#)
            .unwrap();

        assert_eq!(
            out,
            r#"[{"type":"textInserted","block":0,"offset":0,"len":2}]"#
        );
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert_eq!(session.document().to_plain_text(), "Oi");
    }

    #[test]
    fn comando_desconhecido_vira_erro_de_json() {
        let mut session = Session::new(TextDocument::new(1));
        assert!(matches!(
            session.dispatch_json(r#"{"type":"text.explode"}"#),
            Err(AppError::Json(_))
        ));
    }
}

/// Fundo escuro o bastante para o texto automático ficar branco (luminância < 0,5), como no Word.
pub fn is_dark(hex: &str) -> bool {
    let channel = |i: usize| {
        u8::from_str_radix(hex.get(i..i + 2).unwrap_or("ff"), 16)
            .map_or(1.0, |v| f64::from(v) / 255.0)
    };
    0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5) < 0.5
}

#[cfg(test)]
mod is_dark_tests {
    #[test]
    fn fundo_escuro_ou_claro() {
        assert!(super::is_dark("#343541"));
        assert!(super::is_dark("#1F3864"));
        assert!(!super::is_dark("#D9E2F3"));
        assert!(!super::is_dark("#FFFF00"));
    }
}
