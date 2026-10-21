//! Formato de arquivo `.nova`: cabeçalho de 6 bytes + estado CRDT (atualização v1 do Yjs).
//!
//! ```text
//! bytes 0..4  "NOVA"
//! byte  4     versão do formato
//! byte  5     tipo de documento (1 = texto)
//! bytes 6..   estado do documento
//! ```

use crate::AppError;
use nova_crdt::ClientId;
use nova_domain_text::TextDocument;

const MAGIC: &[u8; 4] = b"NOVA";
const VERSION: u8 = 1;
const KIND_TEXT: u8 = 1;
const HEADER_LEN: usize = 6;

pub fn encode(document: &TextDocument) -> Vec<u8> {
    let state = document.save();
    let mut bytes = Vec::with_capacity(HEADER_LEN + state.len());
    bytes.extend_from_slice(MAGIC);
    bytes.push(VERSION);
    bytes.push(KIND_TEXT);
    bytes.extend_from_slice(&state);
    bytes
}

pub fn decode(client: ClientId, bytes: &[u8]) -> Result<TextDocument, AppError> {
    if bytes.len() < HEADER_LEN || &bytes[..4] != MAGIC || bytes[5] != KIND_TEXT {
        return Err(AppError::NotANovaFile);
    }
    if bytes[4] != VERSION {
        return Err(AppError::UnsupportedVersion(bytes[4]));
    }
    Ok(TextDocument::load(client, &bytes[HEADER_LEN..])?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ida_e_volta() {
        let doc = TextDocument::from_plain_text(1, "linha 1\nlinha 2");
        let loaded = decode(2, &encode(&doc)).unwrap();
        assert_eq!(loaded.to_plain_text(), "linha 1\nlinha 2");
    }

    #[test]
    fn rejeita_arquivo_estranho() {
        assert!(matches!(decode(1, b"PK\x03\x04zip"), Err(AppError::NotANovaFile)));
        assert!(matches!(
            decode(1, b"NOVA\x09\x01"),
            Err(AppError::UnsupportedVersion(9))
        ));
    }
}
