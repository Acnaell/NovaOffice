//! Contexto delimitado "Texto": o agregado `TextDocument`.
//!
//! Toda mudança entra como `TextCommand` e sai como `TextEvent`. O agregado
//! não conhece UI, rede nem formato de arquivo; o estado vive num CRDT
//! (`nova_crdt::Replica`), então coedição e histórico saem do mesmo modelo.
//!
//! Offsets são unidades UTF-16 dentro de um bloco (parágrafo).

use nova_crdt::{utf16_len, ClientId, CrdtError, Replica};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Comandos aceitos pelo agregado. O campo `type` do JSON é o nome do comando,
/// o mesmo usado pela UI, por plugins e por agentes de IA.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TextCommand {
    #[serde(rename = "text.insert")]
    InsertText { block: u32, offset: u32, text: String },
    #[serde(rename = "text.delete")]
    DeleteText { block: u32, offset: u32, len: u32 },
    #[serde(rename = "block.split")]
    SplitBlock { block: u32, offset: u32 },
    #[serde(rename = "block.mergeNext")]
    MergeWithNext { block: u32 },
    #[serde(rename = "block.insert")]
    InsertBlock { index: u32, text: String },
    #[serde(rename = "block.remove")]
    RemoveBlock { block: u32 },
}

/// Eventos de domínio. Carregam o que foi removido para que o desfazer e a
/// auditoria não precisem consultar o estado anterior.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextEvent {
    TextInserted { block: u32, offset: u32, len: u32 },
    TextDeleted { block: u32, offset: u32, text: String },
    BlockSplit { block: u32, offset: u32 },
    BlocksMerged { block: u32, at: u32 },
    BlockInserted { index: u32 },
    BlockRemoved { index: u32, text: String },
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DomainError {
    #[error(transparent)]
    Crdt(#[from] CrdtError),
    #[error("texto vazio")]
    EmptyText,
    #[error("quebras de linha viram blocos: use block.split ou block.insert")]
    LineBreakInText,
    #[error("o documento precisa de pelo menos um bloco")]
    LastBlock,
    #[error("o estado carregado não tem nenhum bloco")]
    EmptyDocument,
}

pub struct TextDocument {
    replica: Replica,
}

impl TextDocument {
    /// Documento novo com um parágrafo vazio.
    ///
    /// Só a réplica que cria o documento chama isto. As demais usam `load`
    /// com o estado dela; se duas réplicas criassem o primeiro bloco cada uma,
    /// a fusão teria dois blocos.
    pub fn new(client: ClientId) -> Self {
        Self::from_plain_text(client, "")
    }

    /// Um bloco por linha; `\r\n` e `\n` são aceitos.
    pub fn from_plain_text(client: ClientId, text: &str) -> Self {
        let replica = Replica::new(client);
        for (i, line) in text.split('\n').enumerate() {
            replica
                .insert_block(i as u32, line.strip_suffix('\r').unwrap_or(line))
                .expect("inserir no fim do array sempre é válido");
        }
        Self { replica }
    }

    pub fn load(client: ClientId, state: &[u8]) -> Result<Self, DomainError> {
        let replica = Replica::from_update(client, state)?;
        if replica.block_count() == 0 {
            return Err(DomainError::EmptyDocument);
        }
        Ok(Self { replica })
    }

    pub fn execute(&mut self, command: TextCommand) -> Result<Vec<TextEvent>, DomainError> {
        let event = match command {
            TextCommand::InsertText { block, offset, text } => {
                validate_inline(&text)?;
                self.replica.insert_text(block, offset, &text)?;
                TextEvent::TextInserted { block, offset, len: utf16_len(&text) }
            }
            TextCommand::DeleteText { block, offset, len } => {
                if len == 0 {
                    return Ok(Vec::new());
                }
                let text = self.replica.delete_text(block, offset, len)?;
                TextEvent::TextDeleted { block, offset, text }
            }
            TextCommand::SplitBlock { block, offset } => {
                self.replica.split_block(block, offset)?;
                TextEvent::BlockSplit { block, offset }
            }
            TextCommand::MergeWithNext { block } => {
                let at = self.replica.merge_with_next(block)?;
                TextEvent::BlocksMerged { block, at }
            }
            TextCommand::InsertBlock { index, text } => {
                if text.contains(['\n', '\r']) {
                    return Err(DomainError::LineBreakInText);
                }
                self.replica.insert_block(index, &text)?;
                TextEvent::BlockInserted { index }
            }
            TextCommand::RemoveBlock { block } => {
                if self.replica.block_count() <= 1 {
                    return Err(DomainError::LastBlock);
                }
                let text = self.replica.remove_block(block)?;
                TextEvent::BlockRemoved { index: block, text }
            }
        };
        Ok(vec![event])
    }

    pub fn block_count(&self) -> u32 {
        self.replica.block_count()
    }

    pub fn block_text(&self, block: u32) -> Result<String, DomainError> {
        Ok(self.replica.block_text(block)?)
    }

    pub fn blocks(&self) -> Vec<String> {
        self.replica.blocks()
    }

    pub fn to_plain_text(&self) -> String {
        self.replica.blocks().join("\n")
    }

    /// Estado completo para gravar em disco ou enviar a um cliente novo.
    pub fn save(&self) -> Vec<u8> {
        self.replica.encode_state()
    }

    pub fn state_vector(&self) -> Vec<u8> {
        self.replica.state_vector()
    }

    pub fn diff_since(&self, remote_state_vector: &[u8]) -> Result<Vec<u8>, DomainError> {
        Ok(self.replica.encode_diff(remote_state_vector)?)
    }

    /// Aplica mudanças de outra réplica.
    // TODO: emitir TextEvent para mudanças remotas (observadores do Yrs) e
    // normalizar o caso em que duas réplicas apagam o último bloco ao mesmo tempo.
    pub fn apply_remote(&mut self, update: &[u8]) -> Result<(), DomainError> {
        Ok(self.replica.apply_update(update)?)
    }
}

fn validate_inline(text: &str) -> Result<(), DomainError> {
    if text.is_empty() {
        return Err(DomainError::EmptyText);
    }
    if text.contains(['\n', '\r']) {
        return Err(DomainError::LineBreakInText);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert(block: u32, offset: u32, text: &str) -> TextCommand {
        TextCommand::InsertText { block, offset, text: text.into() }
    }

    /// Troca as diferenças nos dois sentidos, como faria o servidor de sync.
    fn sync(a: &mut TextDocument, b: &mut TextDocument) {
        let a_to_b = a.diff_since(&b.state_vector()).unwrap();
        let b_to_a = b.diff_since(&a.state_vector()).unwrap();
        b.apply_remote(&a_to_b).unwrap();
        a.apply_remote(&b_to_a).unwrap();
    }

    #[test]
    fn documento_novo_tem_um_bloco_vazio() {
        let doc = TextDocument::new(1);
        assert_eq!(doc.blocks(), vec![""]);
    }

    #[test]
    fn inserir_e_apagar_emitem_eventos() {
        let mut doc = TextDocument::new(1);
        let events = doc.execute(insert(0, 0, "Olá")).unwrap();
        assert_eq!(events, vec![TextEvent::TextInserted { block: 0, offset: 0, len: 3 }]);

        let events = doc
            .execute(TextCommand::DeleteText { block: 0, offset: 1, len: 2 })
            .unwrap();
        assert_eq!(
            events,
            vec![TextEvent::TextDeleted { block: 0, offset: 1, text: "lá".into() }]
        );
        assert_eq!(doc.to_plain_text(), "O");
    }

    #[test]
    fn enter_e_backspace_no_inicio_do_paragrafo() {
        let mut doc = TextDocument::from_plain_text(1, "Primeira linha");
        doc.execute(TextCommand::SplitBlock { block: 0, offset: 8 }).unwrap();
        assert_eq!(doc.blocks(), vec!["Primeira", " linha"]);

        let events = doc.execute(TextCommand::MergeWithNext { block: 0 }).unwrap();
        assert_eq!(events, vec![TextEvent::BlocksMerged { block: 0, at: 8 }]);
        assert_eq!(doc.to_plain_text(), "Primeira linha");
    }

    #[test]
    fn texto_simples_ida_e_volta() {
        let text = "Título\n\nCorpo com acentuação\r\nFim";
        let doc = TextDocument::from_plain_text(1, text);
        assert_eq!(doc.block_count(), 4);
        assert_eq!(doc.to_plain_text(), "Título\n\nCorpo com acentuação\nFim");
    }

    #[test]
    fn offsets_em_utf16_nao_cortam_emoji() {
        let mut doc = TextDocument::from_plain_text(1, "a😀b");
        assert!(matches!(
            doc.execute(insert(0, 2, "X")),
            Err(DomainError::Crdt(CrdtError::InvalidOffset { .. }))
        ));
        doc.execute(insert(0, 3, "X")).unwrap();
        assert_eq!(doc.to_plain_text(), "a😀Xb");
    }

    #[test]
    fn rejeita_comandos_invalidos() {
        let mut doc = TextDocument::new(1);
        assert_eq!(doc.execute(insert(0, 0, "")), Err(DomainError::EmptyText));
        assert_eq!(doc.execute(insert(0, 0, "a\nb")), Err(DomainError::LineBreakInText));
        assert_eq!(
            doc.execute(TextCommand::RemoveBlock { block: 0 }),
            Err(DomainError::LastBlock)
        );
        assert_eq!(
            doc.execute(insert(5, 0, "x")),
            Err(DomainError::Crdt(CrdtError::BlockNotFound(5)))
        );
    }

    #[test]
    fn salvar_e_carregar() {
        let original = TextDocument::from_plain_text(1, "um\ndois");
        let loaded = TextDocument::load(2, &original.save()).unwrap();
        assert_eq!(loaded.blocks(), original.blocks());
    }

    #[test]
    fn edicoes_concorrentes_convergem() {
        let mut a = TextDocument::from_plain_text(1, "Olá mundo");
        let mut b = TextDocument::load(2, &a.save()).unwrap();

        a.execute(insert(0, 0, "A: ")).unwrap();
        b.execute(insert(0, 9, "!")).unwrap();
        b.execute(TextCommand::InsertBlock { index: 1, text: "nova linha".into() }).unwrap();

        sync(&mut a, &mut b);

        assert_eq!(a.to_plain_text(), b.to_plain_text());
        assert_eq!(a.to_plain_text(), "A: Olá mundo!\nnova linha");
    }

    #[test]
    fn divisao_concorrente_com_digitacao_converge() {
        let mut a = TextDocument::from_plain_text(1, "abcdef");
        let mut b = TextDocument::load(2, &a.save()).unwrap();

        a.execute(TextCommand::SplitBlock { block: 0, offset: 3 }).unwrap();
        b.execute(insert(0, 6, "g")).unwrap();

        sync(&mut a, &mut b);

        assert_eq!(a.blocks(), b.blocks());
    }

    #[test]
    fn comandos_em_json() {
        let cmd: TextCommand =
            serde_json::from_str(r#"{"type":"text.insert","block":0,"offset":2,"text":"oi"}"#)
                .unwrap();
        assert_eq!(cmd, insert(0, 2, "oi"));

        let event = TextEvent::BlocksMerged { block: 1, at: 4 };
        assert_eq!(
            serde_json::to_string(&event).unwrap(),
            r#"{"type":"blocksMerged","block":1,"at":4}"#
        );
    }
}
