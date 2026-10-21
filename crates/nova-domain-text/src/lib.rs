//! Contexto delimitado "Texto": o agregado `TextDocument`.
//!
//! Toda mudança entra como `TextCommand` e sai como `TextEvent`. O agregado
//! não conhece UI, rede nem formato de arquivo; o estado vive num CRDT
//! (`nova_crdt::Replica`), então coedição e histórico saem do mesmo modelo.
//!
//! Offsets são unidades UTF-16 dentro de um bloco (parágrafo).

mod format;

pub use format::{BlockStyle, Mark, MarkKind, Span};

use nova_crdt::{utf16_len, AttrMap, ClientId, CrdtError, Replica};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Comandos aceitos pelo agregado. O campo `type` do JSON é o nome do comando,
/// o mesmo usado pela UI, por plugins e por agentes de IA.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TextCommand {
    /// Sem `marks`, o texto herda a formatação à esquerda; com `marks`
    /// (mesmo vazio), recebe exatamente essas marcas.
    #[serde(rename = "text.insert")]
    InsertText {
        block: u32,
        offset: u32,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        marks: Option<Vec<Mark>>,
    },
    #[serde(rename = "text.delete")]
    DeleteText { block: u32, offset: u32, len: u32 },
    #[serde(rename = "text.applyMark")]
    ApplyMark {
        block: u32,
        offset: u32,
        len: u32,
        mark: Mark,
    },
    #[serde(rename = "text.removeMark")]
    RemoveMark {
        block: u32,
        offset: u32,
        len: u32,
        kind: MarkKind,
    },
    #[serde(rename = "block.split")]
    SplitBlock { block: u32, offset: u32 },
    #[serde(rename = "block.mergeNext")]
    MergeWithNext { block: u32 },
    #[serde(rename = "block.insert")]
    InsertBlock {
        index: u32,
        text: String,
        #[serde(default)]
        style: BlockStyle,
    },
    #[serde(rename = "block.remove")]
    RemoveBlock { block: u32 },
    #[serde(rename = "block.setStyle")]
    SetBlockStyle { block: u32, style: BlockStyle },
    #[serde(rename = "history.undo")]
    Undo,
    #[serde(rename = "history.redo")]
    Redo,
}

/// Eventos de domínio. Carregam o que foi removido para que auditoria e
/// interface não precisem consultar o estado anterior.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextEvent {
    TextInserted {
        block: u32,
        offset: u32,
        len: u32,
    },
    TextDeleted {
        block: u32,
        offset: u32,
        text: String,
    },
    MarkApplied {
        block: u32,
        offset: u32,
        len: u32,
        mark: Mark,
    },
    MarkRemoved {
        block: u32,
        offset: u32,
        len: u32,
        kind: MarkKind,
    },
    BlockSplit {
        block: u32,
        offset: u32,
    },
    BlocksMerged {
        block: u32,
        at: u32,
    },
    BlockInserted {
        index: u32,
    },
    BlockRemoved {
        index: u32,
        text: String,
    },
    BlockStyled {
        block: u32,
        style: BlockStyle,
    },
    /// O documento voltou a um estado anterior; a interface deve redesenhar tudo.
    Undone,
    Redone,
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
    #[error("marca inválida: {0}")]
    InvalidMark(String),
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

    /// Um parágrafo por linha; `\r\n` e `\n` são aceitos.
    pub fn from_plain_text(client: ClientId, text: &str) -> Self {
        let mut replica = Replica::new(client);
        for (i, line) in text.split('\n').enumerate() {
            replica
                .insert_block(
                    i as u32,
                    line.strip_suffix('\r').unwrap_or(line),
                    BlockStyle::Paragraph.as_str(),
                )
                .expect("inserir no fim do array sempre é válido");
        }
        replica.clear_history();
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
        // Digitar e apagar se agrupam no desfazer (janela de 500 ms do Yrs);
        // os demais comandos viram um passo de desfazer próprio.
        let discrete = !matches!(
            command,
            TextCommand::InsertText { .. } | TextCommand::DeleteText { .. }
        );
        if discrete {
            self.replica.checkpoint();
        }
        let events = self.run(command)?;
        if discrete {
            self.replica.checkpoint();
        }
        Ok(events)
    }

    fn run(&mut self, command: TextCommand) -> Result<Vec<TextEvent>, DomainError> {
        let event = match command {
            TextCommand::InsertText {
                block,
                offset,
                text,
                marks,
            } => {
                validate_inline(&text)?;
                let attrs = marks.map(|marks| marks_to_attrs(&marks)).transpose()?;
                self.replica
                    .insert_text(block, offset, &text, attrs.as_ref())?;
                TextEvent::TextInserted {
                    block,
                    offset,
                    len: utf16_len(&text),
                }
            }
            TextCommand::DeleteText { block, offset, len } => {
                if len == 0 {
                    return Ok(Vec::new());
                }
                let text = self.replica.delete_text(block, offset, len)?;
                TextEvent::TextDeleted {
                    block,
                    offset,
                    text,
                }
            }
            TextCommand::ApplyMark {
                block,
                offset,
                len,
                mark,
            } => {
                mark.validate()?;
                let change = (mark.kind().key().to_string(), Some(mark.value()));
                self.replica.format_text(block, offset, len, &[change])?;
                TextEvent::MarkApplied {
                    block,
                    offset,
                    len,
                    mark,
                }
            }
            TextCommand::RemoveMark {
                block,
                offset,
                len,
                kind,
            } => {
                self.replica
                    .format_text(block, offset, len, &[(kind.key().to_string(), None)])?;
                TextEvent::MarkRemoved {
                    block,
                    offset,
                    len,
                    kind,
                }
            }
            TextCommand::SplitBlock { block, offset } => {
                let style = self.block_style(block)?;
                let at_end = offset == utf16_len(&self.replica.block_text(block)?);
                // Enter no fim de um título continua com parágrafo normal.
                let new_style = if at_end && style.is_heading() {
                    BlockStyle::Paragraph
                } else {
                    style
                };
                self.replica
                    .split_block(block, offset, new_style.as_str())?;
                TextEvent::BlockSplit { block, offset }
            }
            TextCommand::MergeWithNext { block } => {
                let at = self.replica.merge_with_next(block)?;
                TextEvent::BlocksMerged { block, at }
            }
            TextCommand::InsertBlock { index, text, style } => {
                if text.contains(['\n', '\r']) {
                    return Err(DomainError::LineBreakInText);
                }
                self.replica.insert_block(index, &text, style.as_str())?;
                TextEvent::BlockInserted { index }
            }
            TextCommand::RemoveBlock { block } => {
                if self.replica.block_count() <= 1 {
                    return Err(DomainError::LastBlock);
                }
                let text = self.replica.remove_block(block)?;
                TextEvent::BlockRemoved { index: block, text }
            }
            TextCommand::SetBlockStyle { block, style } => {
                self.replica.set_block_style(block, style.as_str())?;
                TextEvent::BlockStyled { block, style }
            }
            TextCommand::Undo => {
                if !self.replica.undo() {
                    return Ok(Vec::new());
                }
                TextEvent::Undone
            }
            TextCommand::Redo => {
                if !self.replica.redo() {
                    return Ok(Vec::new());
                }
                TextEvent::Redone
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

    pub fn block_style(&self, block: u32) -> Result<BlockStyle, DomainError> {
        Ok(BlockStyle::parse(&self.replica.block_style(block)?))
    }

    pub fn block_spans(&self, block: u32) -> Result<Vec<Span>, DomainError> {
        Ok(self
            .replica
            .block_spans(block)?
            .into_iter()
            .map(Span::from)
            .collect())
    }

    pub fn blocks(&self) -> Vec<String> {
        self.replica.blocks()
    }

    pub fn can_undo(&self) -> bool {
        self.replica.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.replica.can_redo()
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

    /// Aplica mudanças de outra réplica. Elas não entram no desfazer local.
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

fn marks_to_attrs(marks: &[Mark]) -> Result<AttrMap, DomainError> {
    marks
        .iter()
        .map(|mark| {
            mark.validate()?;
            Ok((mark.kind().key().to_string(), mark.value()))
        })
        .collect()
}

#[cfg(test)]
mod tests;
