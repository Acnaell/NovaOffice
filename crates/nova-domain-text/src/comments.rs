//! Comentários (Revisão → Novo Comentário; ADR 0014).
//!
//! O trecho comentado leva a marca `comment {id}`; o comentário (autor, data,
//! texto, resolvido) fica nas configurações do documento, na chave `cm:<id>`,
//! como JSON. Respostas são comentários com `parent` e não marcam o texto.

use nova_crdt::AttrValue;
use serde::{Deserialize, Serialize};

use crate::format::is_note_id;
use crate::DomainError;

/// Maior comentário, em caracteres.
pub const MAX_COMMENT_CHARS: usize = 20_000;

/// Prefixo das chaves dos comentários nas configurações do documento.
pub(crate) const COMMENT_PREFIX: &str = "cm:";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    /// Nome de quem escreveu.
    pub author: String,
    /// Iniciais mostradas no balão (como `w:initials` do Word).
    #[serde(default)]
    pub initials: String,
    /// Data e hora em ISO 8601 (`2026-10-30T14:45:00Z`); pode ficar vazia.
    #[serde(default)]
    pub date: String,
    /// Texto; quebras de linha como U+000B.
    pub text: String,
    /// Resolvido (Word: "Resolver"; LibreOffice: "Resolvido").
    #[serde(default)]
    pub done: bool,
    /// Comentário respondido; respostas não marcam o texto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

impl Comment {
    pub fn validate(&self, id: &str) -> Result<(), DomainError> {
        let bad = |msg: String| Err(DomainError::InvalidAttr(format!("comentário: {msg}")));
        if !is_note_id(id) {
            return bad(format!("id {id:?}: de 1 a 32 letras ou dígitos"));
        }
        let line = |s: &str| s.contains(['\n', '\r']);
        let name = self.author.trim();
        if name.is_empty() || self.author.chars().count() > 255 || line(&self.author) {
            return bad("autor de 1 a 255 caracteres numa linha".into());
        }
        if self.initials.chars().count() > 9 || line(&self.initials) {
            return bad("iniciais com até 9 caracteres".into());
        }
        if self.date.len() > 40
            || !self
                .date
                .chars()
                .all(|c| c.is_ascii_digit() || "-:T.Z+".contains(c))
        {
            return bad(format!("data {:?} fora do ISO 8601", self.date));
        }
        if self.text.chars().count() > MAX_COMMENT_CHARS || line(&self.text) {
            return bad(format!(
                "até {MAX_COMMENT_CHARS} caracteres numa linha (use U+000B para quebrar)"
            ));
        }
        if let Some(parent) = &self.parent {
            if !is_note_id(parent) || parent == id {
                return bad(format!("resposta a {parent:?}"));
            }
        }
        Ok(())
    }

    pub(crate) fn to_setting(&self) -> AttrValue {
        AttrValue::Text(serde_json::to_string(self).expect("comentário vira JSON"))
    }

    pub(crate) fn from_setting(id: &str, value: &AttrValue) -> Option<Comment> {
        let AttrValue::Text(json) = value else {
            return None;
        };
        let c: Comment = serde_json::from_str(json).ok()?;
        c.validate(id).is_ok().then_some(c)
    }

    /// Iniciais a partir do nome: "Ana Maria Souza" → "AMS" (até 3 letras).
    pub fn initials_of(author: &str) -> String {
        author
            .split_whitespace()
            .filter_map(|w| w.chars().next())
            .filter(|c| c.is_alphanumeric())
            .take(3)
            .flat_map(char::to_uppercase)
            .collect()
    }
}

pub(crate) fn comment_key(id: &str) -> String {
    format!("{COMMENT_PREFIX}{id}")
}
