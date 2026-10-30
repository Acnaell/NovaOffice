//! Contexto delimitado "Texto": o agregado `TextDocument`.
//!
//! Toda mudança entra como `TextCommand` e sai como `TextEvent`. O agregado
//! não conhece UI, rede nem formato de arquivo; o estado vive num CRDT
//! (`nova_crdt::Replica`), então coedição e histórico saem do mesmo modelo.
//!
//! Offsets são unidades UTF-16 dentro de um bloco (parágrafo).

mod design;
mod format;

pub use design::{
    BorderStyle, PageBorder, Watermark, WatermarkLayout, BORDER_WIDTHS, MAX_WATERMARK_CHARS,
};
pub use format::{
    is_hex_color, is_link, is_media_id, is_note_id, Align, BlockStyle, CellRef, ImageRef, ListKind,
    Mark, MarkKind, ParaAttr, ParaAttrs, Paragraph, Span, TocEntry, FOOTNOTE_CHAR,
    HIGHLIGHT_COLORS, MAX_IMAGE_PT, MAX_INDENT, MAX_TABLE_SIZE, MAX_TOC_LEVEL,
};

/// Página do documento, em twips (1/20 de ponto, 1/1440 de polegada), como no
/// `w:sectPr` do Word. O padrão é A4 retrato com margens de 2,5 cm, sem cor
/// nem borda (aba Design).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    pub width: u32,
    pub height: u32,
    pub margin_top: u32,
    pub margin_bottom: u32,
    pub margin_left: u32,
    pub margin_right: u32,
    /// Cor da Página (`#RRGGBB`); `None` é Sem Cor (papel branco).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    /// Bordas da Página.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<PageBorder>,
}

impl Default for PageSetup {
    fn default() -> Self {
        PageSetup {
            width: 11906,
            height: 16838,
            margin_top: 1417,
            margin_bottom: 1417,
            margin_left: 1417,
            margin_right: 1417,
            background: None,
            border: None,
        }
    }
}

/// Uma polegada em twips: menor lado do papel e menor área de texto.
const INCH: u32 = 1440;

impl PageSetup {
    const KEYS: [&'static str; 6] = [
        "pageWidth",
        "pageHeight",
        "marginTop",
        "marginBottom",
        "marginLeft",
        "marginRight",
    ];

    fn values(&self) -> [u32; 6] {
        [
            self.width,
            self.height,
            self.margin_top,
            self.margin_bottom,
            self.margin_left,
            self.margin_right,
        ]
    }

    pub fn validate(&self) -> Result<(), DomainError> {
        let ok = (INCH..=22 * INCH).contains(&self.width)
            && (INCH..=22 * INCH).contains(&self.height)
            && self.margin_left + self.margin_right + INCH <= self.width
            && self.margin_top + self.margin_bottom + INCH <= self.height;
        if let Some(border) = &self.border {
            border.validate()?;
        }
        if self.background.as_deref().is_some_and(|c| !is_hex_color(c)) {
            return Err(DomainError::InvalidAttr(format!(
                "cor da página {:?}: use #RRGGBB",
                self.background
            )));
        }
        if ok {
            Ok(())
        } else {
            Err(DomainError::InvalidAttr(format!(
                "página {self:?}: papel de 1 a 22 polegadas e pelo menos 1 polegada de texto"
            )))
        }
    }

    fn to_settings(&self) -> Vec<(String, Option<AttrValue>)> {
        let mut out: Vec<_> = Self::KEYS
            .iter()
            .zip(self.values())
            .map(|(k, v)| (k.to_string(), Some(AttrValue::Number(f64::from(v)))))
            .collect();
        out.push((
            "pageBackground".into(),
            self.background.clone().map(AttrValue::Text),
        ));
        out.extend(PageBorder::to_settings(self.border.as_ref()));
        out
    }

    fn from_settings(map: &AttrMap) -> PageSetup {
        let d = PageSetup::default();
        let get = |key: &str, default: u32| match map.get(key) {
            Some(AttrValue::Number(n)) if *n >= 0.0 && *n <= f64::from(22 * INCH) => *n as u32,
            _ => default,
        };
        let page = PageSetup {
            width: get("pageWidth", d.width),
            height: get("pageHeight", d.height),
            margin_top: get("marginTop", d.margin_top),
            margin_bottom: get("marginBottom", d.margin_bottom),
            margin_left: get("marginLeft", d.margin_left),
            margin_right: get("marginRight", d.margin_right),
            background: match map.get("pageBackground") {
                Some(AttrValue::Text(c)) if is_hex_color(c) => Some(c.clone()),
                _ => None,
            },
            border: PageBorder::from_settings(map),
        };
        if page.validate().is_ok() {
            page
        } else {
            d
        }
    }
}

/// Texto de um cabeçalho ou rodapé, com o alinhamento. `{PAGE}` vira o número
/// da página e `{NUMPAGES}` o total de páginas, como os campos PAGE e NUMPAGES do Word.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFooter {
    pub text: String,
    pub align: Align,
}

/// Cabeçalho e rodapé do documento (um para todas as páginas, opcionalmente
/// sem nada na primeira, como "Primeira Página Diferente" no Word).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadersFooters {
    pub header: HeaderFooter,
    pub footer: HeaderFooter,
    pub different_first: bool,
}

/// Campo do número da página e do total de páginas no texto do cabeçalho/rodapé.
pub const PAGE_FIELD: &str = "{PAGE}";
pub const NUMPAGES_FIELD: &str = "{NUMPAGES}";

impl HeadersFooters {
    pub fn validate(&self) -> Result<(), DomainError> {
        for hf in [&self.header, &self.footer] {
            if hf.text.chars().count() > 1000 || hf.text.contains(['\n', '\r']) {
                return Err(DomainError::InvalidAttr(
                    "cabeçalho/rodapé: até 1000 caracteres numa linha (use U+000B para quebrar)"
                        .into(),
                ));
            }
        }
        Ok(())
    }

    fn to_settings(&self) -> Vec<(String, Option<AttrValue>)> {
        let text = |v: &str| (!v.is_empty()).then(|| AttrValue::Text(v.to_string()));
        let align = |a: Align| (a != Align::Left).then(|| AttrValue::Text(a.as_str().into()));
        vec![
            ("headerText".into(), text(&self.header.text)),
            ("headerAlign".into(), align(self.header.align)),
            ("footerText".into(), text(&self.footer.text)),
            ("footerAlign".into(), align(self.footer.align)),
            (
                "differentFirst".into(),
                self.different_first.then_some(AttrValue::Bool(true)),
            ),
        ]
    }

    fn from_settings(map: &AttrMap) -> HeadersFooters {
        let text = |k: &str| match map.get(k) {
            Some(AttrValue::Text(v)) => v.clone(),
            _ => String::new(),
        };
        let align = |k: &str| match map.get(k) {
            Some(AttrValue::Text(v)) => Align::parse(v),
            _ => Align::Left,
        };
        HeadersFooters {
            header: HeaderFooter {
                text: text("headerText"),
                align: align("headerAlign"),
            },
            footer: HeaderFooter {
                text: text("footerText"),
                align: align("footerAlign"),
            },
            different_first: matches!(map.get("differentFirst"), Some(AttrValue::Bool(true))),
        }
    }
}

/// Tipos de imagem aceitos (os que o Word, o LibreOffice e o navegador abrem).
pub const MEDIA_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/bmp",
    "image/webp",
];

/// Maior arquivo embutido: 25 MB.
pub const MAX_MEDIA_BYTES: usize = 25 * 1024 * 1024;

use nova_crdt::{is_boundary, utf16_len, AttrMap, AttrValue, ClientId, CrdtError, Replica};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Posição no documento: bloco e offset UTF-16 dentro dele.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Pos {
    pub block: u32,
    pub offset: u32,
}

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
    /// Apaga de `from` até `to`, mesmo atravessando parágrafos; os parágrafos
    /// das pontas são unidos, como ao apagar uma seleção num editor.
    #[serde(rename = "text.deleteRange")]
    DeleteRange { from: Pos, to: Pos },
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
    /// Muda um atributo de parágrafo: `{"type":"block.setAttr","block":0,"attr":"align","value":"center"}`.
    #[serde(rename = "block.setAttr")]
    SetBlockAttr {
        block: u32,
        #[serde(flatten)]
        attr: ParaAttr,
    },
    /// Cabeçalho e rodapé: `{"type":"headerFooter.set","value":{…}}`.
    #[serde(rename = "headerFooter.set")]
    SetHeaderFooter { value: HeadersFooters },
    /// Texto de uma nota de rodapé: `{"type":"footnote.set","id":"n1","text":"…"}`;
    /// `text: null` apaga a nota.
    #[serde(rename = "footnote.set")]
    SetFootnote { id: String, text: Option<String> },
    /// Tamanho do papel e margens (aba Layout): `{"type":"page.set","page":{…}}`.
    #[serde(rename = "page.set")]
    SetPage { page: PageSetup },
    /// Marca d'água (aba Design); `null` remove: `{"type":"watermark.set","value":{…}}`.
    #[serde(rename = "watermark.set")]
    SetWatermark { value: Option<Watermark> },
    #[serde(rename = "history.undo")]
    Undo,
    #[serde(rename = "history.redo")]
    Redo,
    /// Vários comandos como um único passo de desfazer (colar várias linhas,
    /// formatar vários parágrafos). Não é atômico: se um comando falha, os
    /// anteriores já foram aplicados.
    #[serde(rename = "batch")]
    Batch { commands: Vec<TextCommand> },
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
    RangeDeleted {
        from: Pos,
        to: Pos,
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
    BlockAttrSet {
        block: u32,
        #[serde(flatten)]
        attr: ParaAttr,
    },
    /// O documento voltou a um estado anterior; a interface deve redesenhar tudo.
    Undone,
    Redone,
    PageSet {
        page: PageSetup,
    },
    HeaderFooterSet {
        value: HeadersFooters,
    },
    WatermarkSet {
        value: Option<Watermark>,
    },
    FootnoteSet {
        id: String,
        text: Option<String>,
    },
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
    #[error("atributo de parágrafo inválido: {0}")]
    InvalidAttr(String),
    #[error("intervalo inválido: o início vem depois do fim")]
    InvalidRange,
    #[error("batch não pode conter batch, history.undo ou history.redo")]
    InvalidBatch,
    #[error("arquivo embutido inválido: {0}")]
    InvalidMedia(String),
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

    /// Documento montado a partir de parágrafos (importação de .docx, .odt,
    /// Markdown). A montagem não entra no histórico de desfazer. Quebras de
    /// linha (`\n`) dentro de um trecho viram quebras manuais (U+000B).
    pub fn from_paragraphs(
        client: ClientId,
        paragraphs: &[Paragraph],
    ) -> Result<Self, DomainError> {
        let mut doc = Self::new(client);
        let mut commands = Vec::new();
        for (i, p) in paragraphs.iter().enumerate() {
            let index = i as u32;
            if i > 0 {
                commands.push(TextCommand::InsertBlock {
                    index,
                    text: String::new(),
                    style: p.style,
                });
            } else if p.style != BlockStyle::Paragraph {
                commands.push(TextCommand::SetBlockStyle {
                    block: 0,
                    style: p.style,
                });
            }
            let mut offset = 0;
            for span in &p.spans {
                let text = span.text.replace(['\r', '\n'], "\u{b}");
                if text.is_empty() {
                    continue;
                }
                let len = utf16_len(&text);
                commands.push(TextCommand::InsertText {
                    block: index,
                    offset,
                    text,
                    marks: Some(span.marks.clone()),
                });
                offset += len;
            }
            let d = &p.attrs;
            let defaults = ParaAttrs::default();
            let changes = [
                (d.align != defaults.align).then_some(ParaAttr::Align(d.align)),
                (d.indent != 0).then_some(ParaAttr::Indent(d.indent.min(MAX_INDENT))),
                d.line_spacing
                    .map(|v| ParaAttr::LineSpacing(Some(v.clamp(50, 500)))),
                d.space_before
                    .map(|v| ParaAttr::SpaceBefore(Some(v.min(1584)))),
                d.space_after
                    .map(|v| ParaAttr::SpaceAfter(Some(v.min(1584)))),
                d.list.map(|k| ParaAttr::List(Some(k))),
                d.shading
                    .clone()
                    .filter(|c| is_hex_color(c))
                    .map(|c| ParaAttr::Shading(Some(c))),
                d.page_break_before
                    .then_some(ParaAttr::PageBreakBefore(true)),
                d.cell.clone().map(|c| ParaAttr::Cell(Some(c))),
                d.image.clone().map(|i| ParaAttr::Image(Some(i))),
                d.toc
                    .filter(TocEntry::is_valid)
                    .map(|t| ParaAttr::Toc(Some(t))),
            ];
            commands.extend(
                changes
                    .into_iter()
                    .flatten()
                    .map(|attr| TextCommand::SetBlockAttr { block: index, attr }),
            );
        }
        doc.execute(TextCommand::Batch { commands })?;
        doc.replica.clear_history();
        Ok(doc)
    }

    /// Todos os parágrafos, para exportar.
    pub fn paragraphs(&self) -> Vec<Paragraph> {
        (0..self.block_count())
            .map(|i| Paragraph {
                style: self.block_style(i).expect("índice dentro do documento"),
                attrs: self.block_attrs(i).expect("índice dentro do documento"),
                spans: self.block_spans(i).expect("índice dentro do documento"),
            })
            .collect()
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
        if let TextCommand::Batch { commands } = command {
            let mut events = Vec::new();
            for command in commands {
                if matches!(
                    command,
                    TextCommand::Batch { .. } | TextCommand::Undo | TextCommand::Redo
                ) {
                    return Err(DomainError::InvalidBatch);
                }
                events.extend(self.run(command)?);
            }
            return Ok(events);
        }
        let event = match command {
            TextCommand::InsertText {
                block,
                offset,
                text,
                marks,
            } => {
                validate_inline(&text)?;
                // Digitar logo depois de um link não estende o link (Word); dentro dele, sim.
                let ends_link = marks.is_none()
                    && offset > 0
                    && self.link_at(block, offset - 1)?.is_some()
                    && self.link_at(block, offset - 1)? != self.link_at(block, offset)?;
                let attrs = marks.map(|marks| marks_to_attrs(&marks)).transpose()?;
                self.replica
                    .insert_text(block, offset, &text, attrs.as_ref())?;
                if ends_link {
                    self.replica.format_text(
                        block,
                        offset,
                        utf16_len(&text),
                        &[(MarkKind::Link.key().to_string(), None)],
                    )?;
                }
                // A marca de nota só vale no caractere da chamada: texto digitado
                // ao lado dela não vira nota.
                if !text.chars().all(|c| c == FOOTNOTE_CHAR) {
                    self.replica.format_text(
                        block,
                        offset,
                        utf16_len(&text),
                        &[(MarkKind::Footnote.key().to_string(), None)],
                    )?;
                }
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
            TextCommand::DeleteRange { from, to } => {
                if from == to {
                    return Ok(Vec::new());
                }
                self.delete_range(from, to)?;
                TextEvent::RangeDeleted { from, to }
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
                // Enter num item de lista vazio sai da lista (ou volta um nível), como no Word.
                let attrs = self.block_attrs(block)?;
                if attrs.list.is_some() && self.replica.block_text(block)?.is_empty() {
                    let attr = if attrs.indent > 0 {
                        ParaAttr::Indent(attrs.indent - 1)
                    } else {
                        ParaAttr::List(None)
                    };
                    self.replica.set_block_attrs(block, &[attr.to_change()])?;
                    return Ok(vec![TextEvent::BlockAttrSet { block, attr }]);
                }
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
                // A quebra de página e a imagem ficam só no parágrafo original.
                if attrs.page_break_before {
                    self.replica.set_block_attrs(
                        block + 1,
                        &[ParaAttr::PageBreakBefore(false).to_change()],
                    )?;
                }
                if attrs.image.is_some() {
                    self.replica
                        .set_block_attrs(block + 1, &[ParaAttr::Image(None).to_change()])?;
                }
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
            TextCommand::SetBlockAttr { block, attr } => {
                attr.validate()?;
                self.replica.set_block_attrs(block, &[attr.to_change()])?;
                TextEvent::BlockAttrSet { block, attr }
            }
            TextCommand::SetHeaderFooter { value } => {
                value.validate()?;
                self.replica.set_settings(&value.to_settings());
                TextEvent::HeaderFooterSet { value }
            }
            TextCommand::SetFootnote { id, text } => {
                validate_note(&id, text.as_deref())?;
                self.replica
                    .set_settings(&[(note_key(&id), text.clone().map(AttrValue::Text))]);
                TextEvent::FootnoteSet { id, text }
            }
            TextCommand::SetPage { page } => {
                page.validate()?;
                self.replica.set_settings(&page.to_settings());
                TextEvent::PageSet { page }
            }
            TextCommand::SetWatermark { value } => {
                if let Some(w) = &value {
                    w.validate()?;
                }
                self.replica
                    .set_settings(&Watermark::to_settings(value.as_ref()));
                TextEvent::WatermarkSet { value }
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
            TextCommand::Batch { .. } => unreachable!("tratado no início de run"),
        };
        Ok(vec![event])
    }

    /// Valida as duas pontas antes de mudar qualquer coisa, para não deixar
    /// o documento pela metade.
    fn delete_range(&mut self, from: Pos, to: Pos) -> Result<(), DomainError> {
        if from > to {
            return Err(DomainError::InvalidRange);
        }
        let first = self.replica.block_text(from.block)?;
        let last = self.replica.block_text(to.block)?;
        for (pos, text) in [(from, &first), (to, &last)] {
            if !is_boundary(text, pos.offset) {
                return Err(CrdtError::InvalidOffset {
                    block: pos.block,
                    offset: pos.offset,
                    len: utf16_len(text),
                }
                .into());
            }
        }

        if from.block == to.block {
            self.replica
                .delete_text(from.block, from.offset, to.offset - from.offset)?;
            return Ok(());
        }
        let first_len = utf16_len(&first);
        if from.offset < first_len {
            self.replica
                .delete_text(from.block, from.offset, first_len - from.offset)?;
        }
        if to.offset > 0 {
            self.replica.delete_text(to.block, 0, to.offset)?;
        }
        for block in (from.block + 1..to.block).rev() {
            self.replica.remove_block(block)?;
        }
        self.replica.merge_with_next(from.block)?;
        Ok(())
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

    pub fn block_attrs(&self, block: u32) -> Result<ParaAttrs, DomainError> {
        Ok(ParaAttrs::from_attr_map(&self.replica.block_attrs(block)?))
    }

    /// Define a página ao abrir um arquivo, sem entrar no desfazer.
    pub fn load_page_setup(&mut self, page: PageSetup) -> Result<(), DomainError> {
        page.validate()?;
        self.replica.set_settings(&page.to_settings());
        self.replica.clear_history();
        Ok(())
    }

    /// Cabeçalho e rodapé.
    pub fn header_footer(&self) -> HeadersFooters {
        HeadersFooters::from_settings(&self.replica.settings())
    }

    /// Define cabeçalho e rodapé ao abrir um arquivo, sem entrar no desfazer.
    pub fn load_header_footer(&mut self, value: HeadersFooters) -> Result<(), DomainError> {
        value.validate()?;
        self.replica.set_settings(&value.to_settings());
        self.replica.clear_history();
        Ok(())
    }

    /// Textos das notas de rodapé gravadas, pelo id (inclusive notas sem chamada no texto).
    pub fn footnote_texts(&self) -> std::collections::BTreeMap<String, String> {
        self.replica
            .settings()
            .iter()
            .filter_map(|(k, v)| match (k.strip_prefix(NOTE_PREFIX), v) {
                (Some(id), AttrValue::Text(t)) if is_note_id(id) => {
                    Some((id.to_string(), t.clone()))
                }
                _ => None,
            })
            .collect()
    }

    /// Notas de rodapé na ordem das chamadas no texto: (id, texto). O número
    /// de cada nota é a posição nesta lista mais um.
    pub fn footnotes(&self) -> Vec<(String, String)> {
        let texts = self.footnote_texts();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for p in self.paragraphs() {
            for span in &p.spans {
                for mark in &span.marks {
                    if let Mark::Footnote { id } = mark {
                        if seen.insert(id.clone()) {
                            out.push((id.clone(), texts.get(id).cloned().unwrap_or_default()));
                        }
                    }
                }
            }
        }
        out
    }

    /// Define as notas ao abrir um arquivo, sem entrar no desfazer.
    pub fn load_footnotes(&mut self, notes: &[(String, String)]) -> Result<(), DomainError> {
        let mut changes = Vec::new();
        for (id, text) in notes {
            validate_note(id, Some(text))?;
            changes.push((note_key(id), Some(AttrValue::Text(text.clone()))));
        }
        self.replica.set_settings(&changes);
        self.replica.clear_history();
        Ok(())
    }

    /// Tamanho do papel, margens, cor e borda da página.
    pub fn page_setup(&self) -> PageSetup {
        PageSetup::from_settings(&self.replica.settings())
    }

    /// Marca d'água, se houver.
    pub fn watermark(&self) -> Option<Watermark> {
        Watermark::from_settings(&self.replica.settings())
    }

    /// Define a marca d'água ao abrir um arquivo, sem entrar no desfazer.
    pub fn load_watermark(&mut self, value: Watermark) -> Result<(), DomainError> {
        value.validate()?;
        self.replica
            .set_settings(&Watermark::to_settings(Some(&value)));
        self.replica.clear_history();
        Ok(())
    }

    /// Guarda um arquivo embutido (imagem). Não entra no desfazer.
    pub fn put_media(&self, id: &str, mime: &str, data: &[u8]) -> Result<(), DomainError> {
        if !is_media_id(id) {
            return Err(DomainError::InvalidMedia(format!("id {id:?}")));
        }
        if !MEDIA_TYPES.contains(&mime) {
            return Err(DomainError::InvalidMedia(format!("tipo {mime}")));
        }
        if data.is_empty() || data.len() > MAX_MEDIA_BYTES {
            return Err(DomainError::InvalidMedia(format!("{} bytes", data.len())));
        }
        self.replica.put_media(id, mime, data);
        Ok(())
    }

    /// Arquivo embutido: (tipo MIME, bytes).
    pub fn media(&self, id: &str) -> Option<(String, Vec<u8>)> {
        self.replica.media(id)
    }

    /// Link do caractere na posição (UTF-16), se houver.
    fn link_at(&self, block: u32, at: u32) -> Result<Option<String>, DomainError> {
        let mut start = 0;
        for span in self.block_spans(block)? {
            let end = start + utf16_len(&span.text);
            if at >= start && at < end {
                return Ok(span.marks.into_iter().find_map(|m| match m {
                    Mark::Link { href } => Some(href),
                    _ => None,
                }));
            }
            start = end;
        }
        Ok(None)
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

/// Chave do texto de uma nota nas configurações do documento.
const NOTE_PREFIX: &str = "fn:";

fn note_key(id: &str) -> String {
    format!("{NOTE_PREFIX}{id}")
}

/// Maior nota de rodapé, em caracteres.
pub const MAX_NOTE_CHARS: usize = 5000;

fn validate_note(id: &str, text: Option<&str>) -> Result<(), DomainError> {
    if !is_note_id(id) {
        return Err(DomainError::InvalidMark(format!(
            "nota {id:?}: id de 1 a 32 letras ou dígitos"
        )));
    }
    if let Some(t) = text {
        if t.chars().count() > MAX_NOTE_CHARS || t.contains(['\n', '\r']) {
            return Err(DomainError::InvalidAttr(format!(
                "nota: até {MAX_NOTE_CHARS} caracteres numa linha (use U+000B para quebrar)"
            )));
        }
    }
    Ok(())
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
