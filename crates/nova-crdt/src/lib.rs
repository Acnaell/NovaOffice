//! Camada CRDT da NovaOffice.
//!
//! Encapsula o Yrs para que o resto do núcleo não dependa da API dele.
//! Um documento de texto é um array `blocks` de `YText`, um por parágrafo.
//! Posições dentro de um bloco são contadas em unidades UTF-16, as mesmas
//! do JavaScript, para que front-end e núcleo concordem sobre offsets.

use thiserror::Error;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{
    Array, ArrayRef, Doc, GetString, OffsetKind, Options, Out, ReadTxn, StateVector, Text,
    TextPrelim, TextRef, Transact, Update,
};

pub type ClientId = u64;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CrdtError {
    #[error("bloco {0} não existe")]
    BlockNotFound(u32),
    #[error("posição {offset} inválida no bloco {block} (tamanho {len} em UTF-16)")]
    InvalidOffset { block: u32, offset: u32, len: u32 },
    #[error("atualização CRDT inválida: {0}")]
    InvalidUpdate(String),
}

/// Uma réplica local do documento. Cada cliente (aba, processo, usuário)
/// tem a sua, com um `ClientId` próprio.
pub struct Replica {
    doc: Doc,
    blocks: ArrayRef,
}

impl Replica {
    pub fn new(client_id: ClientId) -> Self {
        let doc = Doc::with_options(Options {
            client_id,
            offset_kind: OffsetKind::Utf16,
            ..Options::default()
        });
        let blocks = doc.get_or_insert_array("blocks");
        Self { doc, blocks }
    }

    /// Cria uma réplica a partir do estado completo de outra.
    pub fn from_update(client_id: ClientId, update: &[u8]) -> Result<Self, CrdtError> {
        let replica = Self::new(client_id);
        replica.apply_update(update)?;
        Ok(replica)
    }

    pub fn client_id(&self) -> ClientId {
        self.doc.client_id()
    }

    pub fn block_count(&self) -> u32 {
        let txn = self.doc.transact();
        self.blocks.len(&txn)
    }

    pub fn block_text(&self, block: u32) -> Result<String, CrdtError> {
        let txn = self.doc.transact();
        Ok(self.text_at(&txn, block)?.get_string(&txn))
    }

    pub fn blocks(&self) -> Vec<String> {
        let txn = self.doc.transact();
        (0..self.blocks.len(&txn))
            .filter_map(|i| self.text_at(&txn, i).ok())
            .map(|text| text.get_string(&txn))
            .collect()
    }

    pub fn insert_block(&self, index: u32, text: &str) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        if index > self.blocks.len(&txn) {
            return Err(CrdtError::BlockNotFound(index));
        }
        self.blocks.insert(&mut txn, index, TextPrelim::new(text));
        Ok(())
    }

    /// Remove o bloco e devolve o texto que ele tinha.
    pub fn remove_block(&self, index: u32) -> Result<String, CrdtError> {
        let mut txn = self.doc.transact_mut();
        let removed = self.text_at(&txn, index)?.get_string(&txn);
        self.blocks.remove(&mut txn, index);
        Ok(removed)
    }

    pub fn insert_text(&self, block: u32, offset: u32, chunk: &str) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        check_boundary(&text.get_string(&txn), block, offset)?;
        text.insert(&mut txn, offset, chunk);
        Ok(())
    }

    /// Apaga `len` unidades UTF-16 a partir de `offset` e devolve o trecho apagado.
    pub fn delete_text(&self, block: u32, offset: u32, len: u32) -> Result<String, CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        let current = text.get_string(&txn);
        let start = check_boundary(&current, block, offset)?;
        let end_offset = offset.checked_add(len).ok_or(CrdtError::InvalidOffset {
            block,
            offset,
            len: utf16_len(&current),
        })?;
        let end = check_boundary(&current, block, end_offset)?;
        let removed = current[start..end].to_string();
        text.remove_range(&mut txn, offset, len);
        Ok(removed)
    }

    /// Divide o bloco em `offset`; o trecho final vira um novo bloco logo abaixo.
    /// Tudo acontece numa única transação, então outros clientes nunca veem metade.
    pub fn split_block(&self, block: u32, offset: u32) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        let current = text.get_string(&txn);
        let at = check_boundary(&current, block, offset)?;
        let len = utf16_len(&current);
        if offset < len {
            text.remove_range(&mut txn, offset, len - offset);
        }
        self.blocks
            .insert(&mut txn, block + 1, TextPrelim::new(&current[at..]));
        Ok(())
    }

    /// Junta o bloco seguinte ao fim deste. Devolve o offset da junção.
    pub fn merge_with_next(&self, block: u32) -> Result<u32, CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        let next = self.text_at(&txn, block + 1)?;
        let at = utf16_len(&text.get_string(&txn));
        let tail = next.get_string(&txn);
        if !tail.is_empty() {
            text.insert(&mut txn, at, &tail);
        }
        self.blocks.remove(&mut txn, block + 1);
        Ok(at)
    }

    /// Estado completo, no formato de atualização v1 do Yjs.
    pub fn encode_state(&self) -> Vec<u8> {
        self.doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    /// O que esta réplica já viu; outra réplica usa isso para calcular a diferença.
    pub fn state_vector(&self) -> Vec<u8> {
        self.doc.transact().state_vector().encode_v1()
    }

    /// Atualizações que a réplica dona de `remote_state_vector` ainda não tem.
    pub fn encode_diff(&self, remote_state_vector: &[u8]) -> Result<Vec<u8>, CrdtError> {
        let sv = StateVector::decode_v1(remote_state_vector)
            .map_err(|e| CrdtError::InvalidUpdate(e.to_string()))?;
        Ok(self.doc.transact().encode_diff_v1(&sv))
    }

    pub fn apply_update(&self, update: &[u8]) -> Result<(), CrdtError> {
        let update =
            Update::decode_v1(update).map_err(|e| CrdtError::InvalidUpdate(e.to_string()))?;
        self.doc
            .transact_mut()
            .apply_update(update)
            .map_err(|e| CrdtError::InvalidUpdate(e.to_string()))
    }

    fn text_at<T: ReadTxn>(&self, txn: &T, block: u32) -> Result<TextRef, CrdtError> {
        match self.blocks.get(txn, block) {
            Some(Out::YText(text)) => Ok(text),
            _ => Err(CrdtError::BlockNotFound(block)),
        }
    }
}

pub fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Converte um offset UTF-16 em índice de byte. `None` se o offset passa do fim
/// ou cai no meio de um par substituto (por exemplo, dentro de um emoji).
fn byte_index(s: &str, offset: u32) -> Option<usize> {
    let mut units = 0u32;
    for (i, ch) in s.char_indices() {
        if units == offset {
            return Some(i);
        }
        units += ch.len_utf16() as u32;
        if units > offset {
            return None;
        }
    }
    (units == offset).then_some(s.len())
}

fn check_boundary(s: &str, block: u32, offset: u32) -> Result<usize, CrdtError> {
    byte_index(s, offset).ok_or(CrdtError::InvalidOffset {
        block,
        offset,
        len: utf16_len(s),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_index_respeita_pares_substitutos() {
        let s = "a😀b";
        assert_eq!(byte_index(s, 0), Some(0));
        assert_eq!(byte_index(s, 1), Some(1));
        assert_eq!(byte_index(s, 2), None);
        assert_eq!(byte_index(s, 3), Some(5));
        assert_eq!(byte_index(s, 4), Some(6));
        assert_eq!(byte_index(s, 5), None);
    }

    #[test]
    fn dividir_e_juntar_blocos() {
        let r = Replica::new(1);
        r.insert_block(0, "Olá mundo").unwrap();
        r.split_block(0, 4).unwrap();
        assert_eq!(r.blocks(), vec!["Olá ", "mundo"]);
        assert_eq!(r.merge_with_next(0).unwrap(), 4);
        assert_eq!(r.blocks(), vec!["Olá mundo"]);
    }

    #[test]
    fn estado_completo_reconstroi_a_replica() {
        let a = Replica::new(1);
        a.insert_block(0, "primeiro").unwrap();
        a.insert_block(1, "segundo").unwrap();
        let b = Replica::from_update(2, &a.encode_state()).unwrap();
        assert_eq!(b.blocks(), a.blocks());
    }

    #[test]
    fn atualizacao_invalida_e_rejeitada() {
        let r = Replica::new(1);
        assert!(matches!(
            r.apply_update(&[0xff, 0xff, 0xff]),
            Err(CrdtError::InvalidUpdate(_))
        ));
    }
}
