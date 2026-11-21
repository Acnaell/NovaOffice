//! Controlar Alterações (Revisão; ADR 0015).
//!
//! Com o controle ligado, a interface manda as edições dentro de
//! `{"type":"tracked","author":…,"date":…,"commands":[…]}`. Aqui elas viram
//! revisões:
//! - texto inserido leva a marca `ins {autor, data}`;
//! - texto excluído fica no documento com a marca `del {autor, data}`, a não
//!   ser que seja uma inserção ainda não aceita do mesmo autor (aí sai de vez,
//!   como no Word);
//! - parágrafos inteiros excluídos ficam, com o texto riscado.
//!
//! Os comandos de um lote foram calculados como se as exclusões tirassem o
//! texto; como o texto fica, as posições dos comandos seguintes são deslocadas
//! (`Shift`). Quebras de parágrafo e formatação não são controladas: entram
//! direto, como hoje.

use crate::format::{Mark, MarkKind};
use crate::{DomainError, Pos, TextCommand, TextDocument, TextEvent};
use nova_crdt::utf16_len;

/// Chave das configurações: o documento abre com o controle ligado (Word: `w:trackRevisions`).
pub(crate) const TRACKING_KEY: &str = "trackChanges";

/// Autor de 1 a 255 caracteres numa linha, sem `|`; data ISO 8601 (pode ficar vazia).
pub(crate) fn validate_revision(author: &str, date: &str) -> Result<(), DomainError> {
    if author.trim().is_empty()
        || author.chars().count() > 255
        || author.contains(['\n', '\r', '|'])
    {
        return Err(DomainError::InvalidMark(format!(
            "revisão: autor {author:?} de 1 a 255 caracteres numa linha, sem |"
        )));
    }
    if date.len() > 40
        || !date
            .chars()
            .all(|c| c.is_ascii_digit() || "-:T.Z+".contains(c))
    {
        return Err(DomainError::InvalidMark(format!(
            "revisão: data {date:?} fora do ISO 8601"
        )));
    }
    Ok(())
}

/// Deslocamento das posições dos comandos seguintes do lote: o texto que o
/// comando "excluiu" continua no documento.
#[derive(Debug, Clone, Copy)]
enum Shift {
    /// `len` unidades UTF-16 ficaram em `block`, a partir de `at`.
    Kept { block: u32, at: u32, len: u32 },
    /// Uma exclusão entre parágrafos deixou todos eles: o que vinha depois de
    /// `from` (no parágrafo unido) está em `to`.
    KeptRange { from: Pos, to: Pos },
    /// O parágrafo `block` foi "removido", mas ficou (riscado).
    KeptBlock { block: u32 },
}

impl Shift {
    fn pos(self, p: Pos) -> Pos {
        match self {
            Shift::Kept { block, at, len } if p.block == block && p.offset >= at => Pos {
                block,
                offset: p.offset.saturating_add(len),
            },
            Shift::KeptRange { from, to } if p.block == from.block && p.offset >= from.offset => {
                Pos {
                    block: to.block,
                    offset: (p.offset - from.offset).saturating_add(to.offset),
                }
            }
            Shift::KeptRange { from, to } if p.block > from.block => Pos {
                block: p.block + (to.block - from.block),
                offset: p.offset,
            },
            Shift::KeptBlock { block } if p.block >= block => Pos {
                block: p.block + 1,
                offset: p.offset,
            },
            _ => p,
        }
    }
}

fn map(shifts: &[Shift], block: u32, offset: u32) -> (u32, u32) {
    let p = shifts.iter().fold(Pos { block, offset }, |p, s| s.pos(p));
    (p.block, p.offset)
}

/// Índice de parágrafo dos comandos de bloco: o fim do parágrafo, para seguir uniões.
fn map_block(shifts: &[Shift], block: u32) -> u32 {
    map(shifts, block, 0).0
}

/// Posições do comando no documento de verdade.
fn remap(shifts: &[Shift], command: TextCommand) -> TextCommand {
    if shifts.is_empty() {
        return command;
    }
    let pos = |p: Pos| {
        let (block, offset) = map(shifts, p.block, p.offset);
        Pos { block, offset }
    };
    match command {
        TextCommand::InsertText {
            block,
            offset,
            text,
            marks,
        } => {
            let (block, offset) = map(shifts, block, offset);
            TextCommand::InsertText {
                block,
                offset,
                text,
                marks,
            }
        }
        TextCommand::DeleteText { block, offset, len } => {
            let (block, offset) = map(shifts, block, offset);
            TextCommand::DeleteText { block, offset, len }
        }
        TextCommand::DeleteRange { from, to } => TextCommand::DeleteRange {
            from: pos(from),
            to: pos(to),
        },
        TextCommand::ApplyMark {
            block,
            offset,
            len,
            mark,
        } => {
            let (block, offset) = map(shifts, block, offset);
            TextCommand::ApplyMark {
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
            let (block, offset) = map(shifts, block, offset);
            TextCommand::RemoveMark {
                block,
                offset,
                len,
                kind,
            }
        }
        TextCommand::SplitBlock { block, offset } => {
            let (block, offset) = map(shifts, block, offset);
            TextCommand::SplitBlock { block, offset }
        }
        TextCommand::MergeWithNext { block } => TextCommand::MergeWithNext {
            block: map(shifts, block, u32::MAX).0,
        },
        TextCommand::InsertBlock { index, text, style } => TextCommand::InsertBlock {
            index: map_block(shifts, index),
            text,
            style,
        },
        TextCommand::RemoveBlock { block } => TextCommand::RemoveBlock {
            block: map_block(shifts, block),
        },
        TextCommand::SetBlockStyle { block, style } => TextCommand::SetBlockStyle {
            block: map_block(shifts, block),
            style,
        },
        TextCommand::SetBlockAttr { block, attr } => TextCommand::SetBlockAttr {
            block: map_block(shifts, block),
            attr,
        },
        other => other,
    }
}

/// Pedaço de um trecho excluído: o que acontece com ele.
#[derive(PartialEq)]
enum Piece {
    /// Inserção ainda não aceita do mesmo autor: sai de vez.
    Own,
    /// Já estava excluído: fica como está.
    Deleted,
    /// Ganha a marca `del`.
    Mark,
}

impl TextDocument {
    /// O documento está com Controlar Alterações ligado?
    pub fn tracking(&self) -> bool {
        matches!(
            self.replica.settings().get(TRACKING_KEY),
            Some(nova_crdt::AttrValue::Bool(true))
        )
    }

    pub(crate) fn run_tracked(
        &mut self,
        author: String,
        date: String,
        commands: Vec<TextCommand>,
    ) -> Result<Vec<TextEvent>, DomainError> {
        validate_revision(&author, &date)?;
        let mut shifts: Vec<Shift> = Vec::new();
        let mut events = Vec::new();
        for command in commands {
            if matches!(
                command,
                TextCommand::Batch { .. }
                    | TextCommand::Tracked { .. }
                    | TextCommand::Undo
                    | TextCommand::Redo
            ) {
                return Err(DomainError::InvalidBatch);
            }
            match remap(&shifts, command) {
                TextCommand::InsertText {
                    block,
                    offset,
                    text,
                    marks,
                } => {
                    let mut marks = match marks {
                        Some(marks) => marks,
                        None => self.inherited_marks(block, offset)?,
                    };
                    marks.retain(|m| !matches!(m.kind(), MarkKind::Insert | MarkKind::Delete));
                    marks.push(Mark::Insert {
                        author: author.clone(),
                        date: date.clone(),
                    });
                    events.extend(self.run(TextCommand::InsertText {
                        block,
                        offset,
                        text,
                        marks: Some(marks),
                    })?);
                }
                TextCommand::DeleteText { block, offset, len } => {
                    let kept =
                        self.track_delete(block, offset, len, &author, &date, &mut events)?;
                    shifts.push(Shift::Kept {
                        block,
                        at: offset,
                        len: kept,
                    });
                }
                TextCommand::DeleteRange { from, to } if from.block == to.block => {
                    let len = to.offset.saturating_sub(from.offset);
                    let kept = self.track_delete(
                        from.block,
                        from.offset,
                        len,
                        &author,
                        &date,
                        &mut events,
                    )?;
                    shifts.push(Shift::Kept {
                        block: from.block,
                        at: from.offset,
                        len: kept,
                    });
                }
                TextCommand::DeleteRange { from, to } => {
                    if from.block > to.block || to.block >= self.block_count() {
                        return Err(DomainError::InvalidRange);
                    }
                    // De trás para a frente: o que sai de vez não mexe nas posições anteriores.
                    let kept_to =
                        self.track_delete(to.block, 0, to.offset, &author, &date, &mut events)?;
                    for block in (from.block + 1..to.block).rev() {
                        let len = self.block_len(block)?;
                        self.track_delete(block, 0, len, &author, &date, &mut events)?;
                    }
                    let len = self.block_len(from.block)?.saturating_sub(from.offset);
                    self.track_delete(from.block, from.offset, len, &author, &date, &mut events)?;
                    shifts.push(Shift::KeptRange {
                        from,
                        to: Pos {
                            block: to.block,
                            offset: kept_to,
                        },
                    });
                }
                TextCommand::RemoveBlock { block } => {
                    let len = self.block_len(block)?;
                    let kept = self.track_delete(block, 0, len, &author, &date, &mut events)?;
                    if kept == 0 && self.block_count() > 1 {
                        // Parágrafo só com inserções do mesmo autor: sai de vez.
                        events.extend(self.run(TextCommand::RemoveBlock { block })?);
                    } else {
                        shifts.push(Shift::KeptBlock { block });
                    }
                }
                other => events.extend(self.run(other)?),
            }
        }
        Ok(events)
    }

    fn block_len(&self, block: u32) -> Result<u32, DomainError> {
        Ok(self
            .block_spans(block)?
            .iter()
            .map(|s| utf16_len(&s.text))
            .sum())
    }

    /// Marcas do texto digitado sem formatação explícita: as do caractere
    /// anterior (ou do seguinte, no começo do parágrafo), sem as que valem só
    /// para um caractere ou um trecho que termina ali.
    fn inherited_marks(&self, block: u32, offset: u32) -> Result<Vec<Mark>, DomainError> {
        let spans = self.block_spans(block)?;
        let at = |pos: u32| -> Vec<Mark> {
            let mut start = 0;
            for span in &spans {
                let end = start + utf16_len(&span.text);
                if pos >= start && pos < end {
                    return span.marks.clone();
                }
                start = end;
            }
            Vec::new()
        };
        let after = at(offset);
        let mut marks = if offset > 0 {
            at(offset - 1)
        } else {
            after.clone()
        };
        marks.retain(|m| match m.kind() {
            MarkKind::Footnote | MarkKind::Citation => false,
            // Link e comentário só continuam dentro do trecho, não no fim dele.
            MarkKind::Link | MarkKind::Comment => after.contains(m),
            _ => true,
        });
        Ok(marks)
    }

    /// Exclui `[offset, offset + len)` com o controle ligado. Devolve quantas
    /// unidades ficaram no parágrafo.
    fn track_delete(
        &mut self,
        block: u32,
        offset: u32,
        len: u32,
        author: &str,
        date: &str,
        events: &mut Vec<TextEvent>,
    ) -> Result<u32, DomainError> {
        if len == 0 {
            return Ok(0);
        }
        let end = offset.saturating_add(len);
        if end > self.block_len(block)? {
            return Err(DomainError::InvalidRange);
        }
        let mut pieces: Vec<(u32, u32, Piece)> = Vec::new();
        let mut start = 0;
        for span in self.block_spans(block)? {
            let span_end = start + utf16_len(&span.text);
            let (a, b) = (start.max(offset), span_end.min(end));
            if a < b {
                let kind = if span.marks.iter().any(|m| matches!(m, Mark::Delete { .. })) {
                    Piece::Deleted
                } else if span
                    .marks
                    .iter()
                    .any(|m| matches!(m, Mark::Insert { author: who, .. } if who == author))
                {
                    Piece::Own
                } else {
                    Piece::Mark
                };
                match pieces.last_mut() {
                    Some(last) if last.2 == kind && last.1 == a => last.1 = b,
                    _ => pieces.push((a, b, kind)),
                }
            }
            start = span_end;
        }
        let mut removed = 0;
        for (a, b, kind) in pieces.into_iter().rev() {
            match kind {
                Piece::Own => {
                    removed += b - a;
                    events.extend(self.run(TextCommand::DeleteText {
                        block,
                        offset: a,
                        len: b - a,
                    })?);
                }
                Piece::Mark => events.extend(self.run(TextCommand::ApplyMark {
                    block,
                    offset: a,
                    len: b - a,
                    mark: Mark::Delete {
                        author: author.to_string(),
                        date: date.to_string(),
                    },
                })?),
                Piece::Deleted => {}
            }
        }
        Ok(len - removed)
    }
}

/// Uma revisão no texto: parágrafo, início e tamanho (UTF-16), e se é inserção.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Revision {
    pub block: u32,
    pub offset: u32,
    pub len: u32,
    pub insert: bool,
    pub author: String,
    pub date: String,
}

impl TextDocument {
    /// Todas as revisões, na ordem do texto (trechos vizinhos do mesmo autor e data juntos).
    pub fn revisions(&self) -> Vec<Revision> {
        let mut out: Vec<Revision> = Vec::new();
        for block in 0..self.block_count() {
            let mut offset = 0;
            for span in self.block_spans(block).unwrap_or_default() {
                let len = utf16_len(&span.text);
                for mark in &span.marks {
                    let (insert, author, date) = match mark {
                        Mark::Insert { author, date } => (true, author, date),
                        Mark::Delete { author, date } => (false, author, date),
                        _ => continue,
                    };
                    match out.last_mut() {
                        Some(r)
                            if r.block == block
                                && r.offset + r.len == offset
                                && r.insert == insert
                                && &r.author == author
                                && &r.date == date =>
                        {
                            r.len += len
                        }
                        _ => out.push(Revision {
                            block,
                            offset,
                            len,
                            insert,
                            author: author.clone(),
                            date: date.clone(),
                        }),
                    }
                }
                offset += len;
            }
        }
        out
    }

    /// Comandos que aceitam (ou rejeitam) as revisões dadas: aceitar uma inserção
    /// tira a marca, aceitar uma exclusão apaga o texto; rejeitar faz o contrário.
    /// De trás para a frente, para as posições não mudarem.
    pub fn resolve_commands(revisions: &[Revision], accept: bool) -> Vec<TextCommand> {
        let mut sorted: Vec<&Revision> = revisions.iter().collect();
        sorted.sort_by_key(|r| std::cmp::Reverse((r.block, r.offset)));
        sorted
            .into_iter()
            .map(|r| {
                if r.insert == accept {
                    TextCommand::RemoveMark {
                        block: r.block,
                        offset: r.offset,
                        len: r.len,
                        kind: if r.insert {
                            MarkKind::Insert
                        } else {
                            MarkKind::Delete
                        },
                    }
                } else {
                    TextCommand::DeleteText {
                        block: r.block,
                        offset: r.offset,
                        len: r.len,
                    }
                }
            })
            .collect()
    }

    /// Aceita ou rejeita todas as revisões, num passo de desfazer.
    pub fn resolve_all(&mut self, accept: bool) -> Result<Vec<TextEvent>, DomainError> {
        let commands = Self::resolve_commands(&self.revisions(), accept);
        if commands.is_empty() {
            return Ok(Vec::new());
        }
        self.execute(TextCommand::Batch { commands })
    }
}

impl TextDocument {
    /// Liga Controlar Alterações ao abrir um arquivo, sem entrar no desfazer.
    pub fn load_tracking(&mut self, on: bool) {
        self.replica.set_settings(&[(
            TRACKING_KEY.to_string(),
            on.then_some(nova_crdt::AttrValue::Bool(true)),
        )]);
        self.replica.clear_history();
    }
}
