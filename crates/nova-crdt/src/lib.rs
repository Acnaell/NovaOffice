//! Camada CRDT da NovaOffice.
//!
//! Encapsula o Yrs para que o resto do núcleo não dependa da API dele.
//! Um documento de texto é um array `blocks`; cada bloco é um `YMap` com
//! `style` (texto) e `text` (`YText` com atributos de formatação).
//! Posições dentro de um bloco são contadas em unidades UTF-16, as mesmas
//! do JavaScript, para que front-end e núcleo concordem sobre offsets.

use std::collections::BTreeMap;

use thiserror::Error;
use yrs::types::text::Diff;
use yrs::types::Attrs;
use yrs::undo::{Options as UndoOptions, UndoManager};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{
    Any, Array, ArrayRef, Doc, GetString, Map, MapPrelim, MapRef, OffsetKind, Options, Out,
    ReadTxn, StateVector, Text, TextPrelim, TextRef, Transact, TransactionMut, Update,
};

pub type ClientId = u64;

/// Estilo de um bloco recém-criado quando nenhum outro é informado.
pub const DEFAULT_STYLE: &str = "paragraph";

/// Origem das transações que vêm de outras réplicas. O desfazer ignora essa
/// origem, então cada usuário desfaz só as próprias edições.
const REMOTE_ORIGIN: &str = "remote";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CrdtError {
    #[error("bloco {0} não existe")]
    BlockNotFound(u32),
    #[error("posição {offset} inválida no bloco {block} (tamanho {len} em UTF-16)")]
    InvalidOffset { block: u32, offset: u32, len: u32 },
    #[error("atualização CRDT inválida: {0}")]
    InvalidUpdate(String),
}

/// Valor de um atributo de formatação.
#[derive(Debug, Clone, PartialEq)]
pub enum AttrValue {
    Bool(bool),
    Text(String),
    Number(f64),
}

pub type AttrMap = BTreeMap<String, AttrValue>;

/// Trecho contínuo de texto com a mesma formatação.
#[derive(Debug, Clone, PartialEq)]
pub struct Span {
    pub text: String,
    pub attrs: AttrMap,
}

/// Uma réplica local do documento. Cada cliente (aba, processo, usuário)
/// tem a sua, com um `ClientId` próprio.
pub struct Replica {
    doc: Doc,
    blocks: ArrayRef,
    undo: UndoManager<()>,
}

impl Replica {
    pub fn new(client_id: ClientId) -> Self {
        let doc = Doc::with_options(Options {
            client_id,
            offset_kind: OffsetKind::Utf16,
            ..Options::default()
        });
        let blocks = doc.get_or_insert_array("blocks");
        let undo = UndoManager::with_scope_and_options(&doc, &blocks, UndoOptions::default());
        Self { doc, blocks, undo }
    }

    /// Cria uma réplica a partir do estado completo de outra. O estado
    /// carregado não entra no histórico de desfazer.
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

    pub fn block_style(&self, block: u32) -> Result<String, CrdtError> {
        let txn = self.doc.transact();
        let map = self.block_at(&txn, block)?;
        Ok(match map.get(&txn, "style") {
            Some(Out::Any(Any::String(style))) => style.to_string(),
            _ => DEFAULT_STYLE.to_string(),
        })
    }

    pub fn block_spans(&self, block: u32) -> Result<Vec<Span>, CrdtError> {
        let txn = self.doc.transact();
        let text = self.text_at(&txn, block)?;
        Ok(raw_spans(&text, &txn)
            .into_iter()
            .map(|(text, attrs)| Span {
                text,
                attrs: to_attr_map(&attrs),
            })
            .collect())
    }

    pub fn blocks(&self) -> Vec<String> {
        let txn = self.doc.transact();
        (0..self.blocks.len(&txn))
            .filter_map(|i| self.text_at(&txn, i).ok())
            .map(|text| text.get_string(&txn))
            .collect()
    }

    pub fn insert_block(&self, index: u32, text: &str, style: &str) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let new_text = self.insert_block_in(&mut txn, index, style)?;
        new_text.insert(&mut txn, 0, text);
        Ok(())
    }

    /// Remove o bloco e devolve o texto que ele tinha.
    pub fn remove_block(&self, index: u32) -> Result<String, CrdtError> {
        let mut txn = self.doc.transact_mut();
        let removed = self.text_at(&txn, index)?.get_string(&txn);
        self.blocks.remove(&mut txn, index);
        Ok(removed)
    }

    pub fn set_block_style(&self, block: u32, style: &str) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let map = self.block_at(&txn, block)?;
        map.insert(&mut txn, "style", style);
        Ok(())
    }

    /// Atributos de parágrafo (alinhamento, recuo, lista…): todas as chaves do
    /// bloco exceto `style` e `text`.
    pub fn block_attrs(&self, block: u32) -> Result<AttrMap, CrdtError> {
        let txn = self.doc.transact();
        let map = self.block_at(&txn, block)?;
        Ok(paragraph_attrs(&map, &txn))
    }

    /// Define ou remove (`None`) atributos de parágrafo.
    pub fn set_block_attrs(
        &self,
        block: u32,
        changes: &[(String, Option<AttrValue>)],
    ) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let map = self.block_at(&txn, block)?;
        for (key, value) in changes {
            debug_assert!(key != "style" && key != "text", "chave reservada: {key}");
            match value {
                Some(value) => {
                    map.insert(&mut txn, key.as_str(), to_any(value));
                }
                None => {
                    map.remove(&mut txn, key);
                }
            }
        }
        Ok(())
    }

    /// Insere texto. Sem `attrs`, o texto herda a formatação à esquerda (como
    /// continuar digitando em negrito); com `attrs`, recebe exatamente essa.
    pub fn insert_text(
        &self,
        block: u32,
        offset: u32,
        chunk: &str,
        attrs: Option<&AttrMap>,
    ) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        check_boundary(&text.get_string(&txn), block, offset)?;
        match attrs {
            Some(attrs) => text.insert_with_attributes(&mut txn, offset, chunk, to_attrs(attrs)),
            None => text.insert(&mut txn, offset, chunk),
        }
        Ok(())
    }

    /// Apaga `len` unidades UTF-16 a partir de `offset` e devolve o trecho apagado.
    pub fn delete_text(&self, block: u32, offset: u32, len: u32) -> Result<String, CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        let current = text.get_string(&txn);
        let (start, end) = check_range(&current, block, offset, len)?;
        let removed = current[start..end].to_string();
        text.remove_range(&mut txn, offset, len);
        Ok(removed)
    }

    /// Aplica ou remove atributos num intervalo. `None` remove o atributo.
    pub fn format_text(
        &self,
        block: u32,
        offset: u32,
        len: u32,
        changes: &[(String, Option<AttrValue>)],
    ) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        check_range(&text.get_string(&txn), block, offset, len)?;
        if len > 0 && !changes.is_empty() {
            let attrs = changes
                .iter()
                .map(|(key, value)| {
                    (
                        key.as_str().into(),
                        value.as_ref().map_or(Any::Null, to_any),
                    )
                })
                .collect();
            text.format(&mut txn, offset, len, attrs);
        }
        Ok(())
    }

    /// Divide o bloco em `offset`; o trecho final, com a formatação dele, vira
    /// um novo bloco com estilo `new_style` e os mesmos atributos de parágrafo,
    /// logo abaixo. Tudo numa transação.
    pub fn split_block(&self, block: u32, offset: u32, new_style: &str) -> Result<(), CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        let current = text.get_string(&txn);
        check_boundary(&current, block, offset)?;
        let tail = spans_from(&text, &txn, offset);
        let len = utf16_len(&current);
        if offset < len {
            text.remove_range(&mut txn, offset, len - offset);
        }
        let attrs = paragraph_attrs(&self.block_at(&txn, block)?, &txn);
        let new_text = self.insert_block_in(&mut txn, block + 1, new_style)?;
        let new_map = self.block_at(&txn, block + 1)?;
        for (key, value) in &attrs {
            new_map.insert(&mut txn, key.as_str(), to_any(value));
        }
        append_spans(&new_text, &mut txn, 0, tail);
        Ok(())
    }

    /// Junta o bloco seguinte ao fim deste, mantendo a formatação. Devolve o
    /// offset da junção.
    pub fn merge_with_next(&self, block: u32) -> Result<u32, CrdtError> {
        let mut txn = self.doc.transact_mut();
        let text = self.text_at(&txn, block)?;
        let next = self.text_at(&txn, block + 1)?;
        let at = utf16_len(&text.get_string(&txn));
        let tail = raw_spans(&next, &txn);
        append_spans(&text, &mut txn, at, tail);
        self.blocks.remove(&mut txn, block + 1);
        Ok(at)
    }

    /// Desfaz o último grupo de edições locais. `false` se não havia nada.
    pub fn undo(&mut self) -> bool {
        self.undo.undo_blocking()
    }

    pub fn redo(&mut self) -> bool {
        self.undo.redo_blocking()
    }

    pub fn can_undo(&self) -> bool {
        self.undo.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.undo.can_redo()
    }

    /// Fecha o grupo de desfazer atual. Edições feitas em menos de 500 ms são
    /// agrupadas; um comando discreto (Enter, aplicar negrito) chama isto antes.
    pub fn checkpoint(&mut self) {
        self.undo.reset();
    }

    /// Esquece o histórico de desfazer (por exemplo, depois de montar o
    /// documento inicial, que o usuário não deve poder desfazer).
    pub fn clear_history(&mut self) {
        self.undo.clear();
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
            .transact_mut_with(REMOTE_ORIGIN)
            .apply_update(update)
            .map_err(|e| CrdtError::InvalidUpdate(e.to_string()))
    }

    fn insert_block_in(
        &self,
        txn: &mut TransactionMut,
        index: u32,
        style: &str,
    ) -> Result<TextRef, CrdtError> {
        if index > self.blocks.len(txn) {
            return Err(CrdtError::BlockNotFound(index));
        }
        let map = self.blocks.insert(txn, index, MapPrelim::default());
        map.insert(txn, "style", style);
        Ok(map.insert(txn, "text", TextPrelim::new("")))
    }

    fn block_at<T: ReadTxn>(&self, txn: &T, block: u32) -> Result<MapRef, CrdtError> {
        match self.blocks.get(txn, block) {
            Some(Out::YMap(map)) => Ok(map),
            _ => Err(CrdtError::BlockNotFound(block)),
        }
    }

    fn text_at<T: ReadTxn>(&self, txn: &T, block: u32) -> Result<TextRef, CrdtError> {
        match self.block_at(txn, block)?.get(txn, "text") {
            Some(Out::YText(text)) => Ok(text),
            _ => Err(CrdtError::BlockNotFound(block)),
        }
    }
}

pub fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// `true` se `offset` é uma posição válida em `s` (não passa do fim e não
/// cai no meio de um par substituto).
pub fn is_boundary(s: &str, offset: u32) -> bool {
    byte_index(s, offset).is_some()
}

/// Trechos do texto com seus atributos crus do Yrs.
fn raw_spans<T: ReadTxn>(text: &TextRef, txn: &T) -> Vec<(String, Attrs)> {
    text.diff(txn, |_| ())
        .into_iter()
        .filter_map(
            |Diff {
                 insert, attributes, ..
             }| match insert {
                Out::Any(Any::String(s)) => {
                    Some((s.to_string(), attributes.map(|a| *a).unwrap_or_default()))
                }
                _ => None,
            },
        )
        .collect()
}

/// Trechos a partir de `offset`, que precisa ser uma fronteira válida.
fn spans_from<T: ReadTxn>(text: &TextRef, txn: &T, offset: u32) -> Vec<(String, Attrs)> {
    let mut pos = 0u32;
    let mut tail = Vec::new();
    for (chunk, attrs) in raw_spans(text, txn) {
        let len = utf16_len(&chunk);
        if pos + len > offset {
            let skip = offset.saturating_sub(pos);
            let start = byte_index(&chunk, skip).expect("offset validado antes");
            tail.push((chunk[start..].to_string(), attrs));
        }
        pos += len;
    }
    tail
}

fn append_spans(
    text: &TextRef,
    txn: &mut TransactionMut,
    mut at: u32,
    spans: Vec<(String, Attrs)>,
) {
    for (chunk, attrs) in spans {
        let len = utf16_len(&chunk);
        text.insert_with_attributes(txn, at, &chunk, attrs);
        at += len;
    }
}

fn to_any(value: &AttrValue) -> Any {
    match value {
        AttrValue::Bool(b) => Any::Bool(*b),
        AttrValue::Text(s) => Any::String(s.as_str().into()),
        AttrValue::Number(n) => Any::Number(*n),
    }
}

fn to_attrs(map: &AttrMap) -> Attrs {
    map.iter()
        .map(|(k, v)| (k.as_str().into(), to_any(v)))
        .collect()
}

fn to_attr_map(attrs: &Attrs) -> AttrMap {
    attrs
        .iter()
        .filter_map(|(k, v)| {
            let value = match v {
                Any::Bool(b) => AttrValue::Bool(*b),
                Any::String(s) => AttrValue::Text(s.to_string()),
                Any::Number(n) => AttrValue::Number(*n),
                Any::BigInt(n) => AttrValue::Number(*n as f64),
                _ => return None,
            };
            Some((k.to_string(), value))
        })
        .collect()
}

fn paragraph_attrs<T: ReadTxn>(map: &MapRef, txn: &T) -> AttrMap {
    map.iter(txn)
        .filter(|(key, _)| *key != "style" && *key != "text")
        .filter_map(|(key, value)| {
            let value = match value {
                Out::Any(Any::Bool(b)) => AttrValue::Bool(b),
                Out::Any(Any::String(s)) => AttrValue::Text(s.to_string()),
                Out::Any(Any::Number(n)) => AttrValue::Number(n),
                Out::Any(Any::BigInt(n)) => AttrValue::Number(n as f64),
                _ => return None,
            };
            Some((key.to_string(), value))
        })
        .collect()
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

fn check_range(s: &str, block: u32, offset: u32, len: u32) -> Result<(usize, usize), CrdtError> {
    let start = check_boundary(s, block, offset)?;
    let end_offset = offset.checked_add(len).ok_or(CrdtError::InvalidOffset {
        block,
        offset,
        len: utf16_len(s),
    })?;
    Ok((start, check_boundary(s, block, end_offset)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bold() -> AttrMap {
        AttrMap::from([("bold".to_string(), AttrValue::Bool(true))])
    }

    fn texts(spans: &[Span]) -> Vec<&str> {
        spans.iter().map(|s| s.text.as_str()).collect()
    }

    #[test]
    fn atributos_de_paragrafo_e_divisao() {
        let r = Replica::new(1);
        r.insert_block(0, "lista", DEFAULT_STYLE).unwrap();
        let align = ("align".to_string(), Some(AttrValue::Text("center".into())));
        let list = ("list".to_string(), Some(AttrValue::Text("bullet".into())));
        r.set_block_attrs(0, &[align, list]).unwrap();
        r.split_block(0, 2, DEFAULT_STYLE).unwrap();
        assert_eq!(r.block_attrs(1).unwrap(), r.block_attrs(0).unwrap());
        assert_eq!(r.block_attrs(1).unwrap().len(), 2);
        r.set_block_attrs(1, &[("list".to_string(), None)]).unwrap();
        assert_eq!(r.block_attrs(1).unwrap().len(), 1);
        assert_eq!(r.block_style(1).unwrap(), DEFAULT_STYLE);
    }

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
        r.insert_block(0, "Olá mundo", DEFAULT_STYLE).unwrap();
        r.split_block(0, 4, DEFAULT_STYLE).unwrap();
        assert_eq!(r.blocks(), vec!["Olá ", "mundo"]);
        assert_eq!(r.merge_with_next(0).unwrap(), 4);
        assert_eq!(r.blocks(), vec!["Olá mundo"]);
    }

    #[test]
    fn formatar_gera_trechos() {
        let r = Replica::new(1);
        r.insert_block(0, "um dois tres", DEFAULT_STYLE).unwrap();
        r.format_text(0, 3, 4, &[("bold".into(), Some(AttrValue::Bool(true)))])
            .unwrap();
        let spans = r.block_spans(0).unwrap();
        assert_eq!(texts(&spans), vec!["um ", "dois", " tres"]);
        assert_eq!(spans[1].attrs, bold());
        assert!(spans[0].attrs.is_empty() && spans[2].attrs.is_empty());

        r.format_text(0, 3, 4, &[("bold".into(), None)]).unwrap();
        assert_eq!(texts(&r.block_spans(0).unwrap()), vec!["um dois tres"]);
    }

    #[test]
    fn insercao_herda_ou_recebe_formatacao() {
        let r = Replica::new(1);
        r.insert_block(0, "", DEFAULT_STYLE).unwrap();
        r.insert_text(0, 0, "negrito", Some(&bold())).unwrap();
        r.insert_text(0, 7, "!", None).unwrap();
        r.insert_text(0, 8, " normal", Some(&AttrMap::new()))
            .unwrap();
        let spans = r.block_spans(0).unwrap();
        assert_eq!(texts(&spans), vec!["negrito!", " normal"]);
        assert_eq!(spans[0].attrs, bold());
        assert!(spans[1].attrs.is_empty());
    }

    #[test]
    fn dividir_e_juntar_preservam_formatacao() {
        let r = Replica::new(1);
        r.insert_block(0, "abcdef", "heading1").unwrap();
        r.format_text(0, 2, 3, &[("italic".into(), Some(AttrValue::Bool(true)))])
            .unwrap();
        r.split_block(0, 3, DEFAULT_STYLE).unwrap();

        let tail = r.block_spans(1).unwrap();
        assert_eq!(texts(&tail), vec!["de", "f"]);
        assert!(tail[0].attrs.contains_key("italic"));
        assert_eq!(r.block_style(0).unwrap(), "heading1");
        assert_eq!(r.block_style(1).unwrap(), DEFAULT_STYLE);

        r.merge_with_next(0).unwrap();
        let spans = r.block_spans(0).unwrap();
        assert_eq!(texts(&spans), vec!["ab", "cde", "f"]);
        assert!(spans[1].attrs.contains_key("italic"));
    }

    #[test]
    fn desfazer_e_refazer() {
        let mut r = Replica::new(1);
        r.insert_block(0, "base", DEFAULT_STYLE).unwrap();
        r.checkpoint();
        r.insert_text(0, 4, " mais", None).unwrap();
        r.checkpoint();
        r.set_block_style(0, "heading2").unwrap();

        assert!(r.undo());
        assert_eq!(r.block_style(0).unwrap(), DEFAULT_STYLE);
        assert!(r.undo());
        assert_eq!(r.blocks(), vec!["base"]);
        assert!(r.redo());
        assert_eq!(r.blocks(), vec!["base mais"]);
    }

    #[test]
    fn desfazer_ignora_edicoes_remotas() {
        let a = Replica::new(1);
        a.insert_block(0, "texto", DEFAULT_STYLE).unwrap();
        let mut b = Replica::from_update(2, &a.encode_state()).unwrap();
        assert!(!b.can_undo());

        b.insert_text(0, 5, " de B", None).unwrap();
        a.insert_text(0, 0, "A: ", None).unwrap();
        b.apply_update(&a.encode_diff(&b.state_vector()).unwrap())
            .unwrap();

        assert!(b.undo());
        assert_eq!(b.blocks(), vec!["A: texto"]);
        assert!(!b.undo());
    }

    #[test]
    fn estado_completo_reconstroi_a_replica() {
        let a = Replica::new(1);
        a.insert_block(0, "primeiro", "heading1").unwrap();
        a.insert_block(1, "segundo", DEFAULT_STYLE).unwrap();
        let b = Replica::from_update(2, &a.encode_state()).unwrap();
        assert_eq!(b.blocks(), a.blocks());
        assert_eq!(b.block_style(0).unwrap(), "heading1");
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
