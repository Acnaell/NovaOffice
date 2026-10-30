//! Estado do documento aberto na janela: sessão, arquivo e alterações não salvas.

use std::fs;
use std::path::{Path, PathBuf};

use nova_app::formats::{self, Format};
use nova_app::{file, new_client_id, Session};
use nova_domain_text::{BlockStyle, ParaAttrs, Span, TextCommand, TextDocument, TextEvent};
use serde::Serialize;

/// O que a interface precisa para desenhar o documento.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocView {
    pub blocks: Vec<BlockView>,
    /// Extensão do formato do arquivo atual (`docx`, `odt`, `nova`…), ou `null` se ainda não foi salvo.
    pub format: Option<&'static str>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub path: Option<String>,
    pub title: String,
    pub dirty: bool,
    /// Papel e margens (aba Layout), cor e bordas da página (aba Design).
    pub page: nova_domain_text::PageSetup,
    pub header_footer: nova_domain_text::HeadersFooters,
    /// Marca d'água (aba Design).
    pub watermark: Option<nova_domain_text::Watermark>,
    /// Texto das notas de rodapé, pelo id da marca `footnote` das chamadas.
    pub footnotes: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct BlockView {
    pub style: BlockStyle,
    pub attrs: ParaAttrs,
    pub spans: Vec<Span>,
}

/// Resposta de um comando: só os parágrafos que mudaram, para a interface não
/// precisar receber nem redesenhar o documento inteiro a cada tecla.
#[derive(Debug, Serialize)]
pub struct DispatchResult {
    pub events: Vec<TextEvent>,
    pub patch: ViewPatch,
}

/// Troca os parágrafos `start..start + delete_count` da visão anterior por
/// `blocks` (como `Array.splice`). `block_count` confere o resultado.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewPatch {
    pub format: Option<&'static str>,
    pub start: u32,
    pub delete_count: u32,
    pub blocks: Vec<BlockView>,
    pub block_count: u32,
    pub can_undo: bool,
    pub can_redo: bool,
    pub path: Option<String>,
    pub title: String,
    pub dirty: bool,
    pub page: nova_domain_text::PageSetup,
    pub header_footer: nova_domain_text::HeadersFooters,
    pub watermark: Option<nova_domain_text::Watermark>,
    /// Texto das notas de rodapé, pelo id da marca `footnote` das chamadas.
    pub footnotes: std::collections::BTreeMap<String, String>,
}

/// Faixa de parágrafos alterada, no documento atual: `[start, end)`. Cresce a
/// cada evento e acompanha os deslocamentos de inserções e remoções.
#[derive(Default)]
struct Dirty(Option<(u32, u32)>);

impl Dirty {
    fn touch(&mut self, from: u32, to: u32) {
        self.0 = Some(match self.0 {
            Some((a, b)) => (a.min(from), b.max(to)),
            None => (from, to),
        });
    }

    fn changed(&mut self, block: u32) {
        self.touch(block, block + 1);
    }

    fn inserted(&mut self, index: u32) {
        if let Some((a, b)) = &mut self.0 {
            if *a >= index {
                *a += 1;
            }
            if *b >= index {
                *b += 1;
            }
        }
        self.touch(index, index + 1);
    }

    fn removed(&mut self, index: u32) {
        if let Some((a, b)) = &mut self.0 {
            if *a > index {
                *a -= 1;
            }
            if *b > index {
                *b -= 1;
            }
        }
        // O ponto da remoção precisa ficar dentro da faixa trocada.
        self.touch(index, index);
    }
}

/// Faixa alterada a partir dos eventos, ou `None` se é preciso redesenhar tudo
/// (desfazer e refazer podem mudar qualquer parte do documento).
fn dirty_range(events: &[TextEvent]) -> Option<(u32, u32)> {
    let mut dirty = Dirty::default();
    for event in events {
        match event {
            TextEvent::TextInserted { block, .. }
            | TextEvent::TextDeleted { block, .. }
            | TextEvent::MarkApplied { block, .. }
            | TextEvent::MarkRemoved { block, .. }
            | TextEvent::BlockStyled { block, .. }
            | TextEvent::BlockAttrSet { block, .. } => dirty.changed(*block),
            TextEvent::BlockSplit { block, .. } => {
                dirty.changed(*block);
                dirty.inserted(block + 1);
            }
            TextEvent::BlocksMerged { block, .. } => {
                dirty.removed(block + 1);
                dirty.changed(*block);
            }
            TextEvent::BlockInserted { index } => dirty.inserted(*index),
            TextEvent::BlockRemoved { index, .. } => dirty.removed(*index),
            TextEvent::RangeDeleted { from, to } => {
                for _ in from.block..to.block {
                    dirty.removed(from.block + 1);
                }
                dirty.changed(from.block);
            }
            // Desfazer, refazer e mudar a página devolvem a visão inteira.
            TextEvent::Undone
            | TextEvent::Redone
            | TextEvent::PageSet { .. }
            | TextEvent::HeaderFooterSet { .. }
            | TextEvent::WatermarkSet { .. }
            | TextEvent::FootnoteSet { .. } => return None,
        }
    }
    Some(dirty.0.unwrap_or((0, 0)))
}

pub struct Editor {
    session: Session,
    path: Option<PathBuf>,
    format: Option<Format>,
    dirty: bool,
}

impl Editor {
    pub fn new() -> Self {
        Self::with(TextDocument::new(new_client_id()), None)
    }

    fn with(document: TextDocument, path: Option<PathBuf>) -> Self {
        let format = path.as_deref().and_then(Format::from_path);
        Self {
            session: Session::new(document),
            path,
            format,
            dirty: false,
        }
    }

    /// Abre um arquivo em qualquer formato conhecido (.docx, .odt, .nova,
    /// .md, .txt). Como no Word, salvar depois grava no mesmo arquivo e formato;
    /// extensões desconhecidas abrem como texto e pedem um destino ao salvar.
    pub fn open(path: &Path) -> Result<Self, String> {
        let bytes = fs::read(path).map_err(|e| io_error("lendo", path, e))?;
        let document = formats::open(new_client_id(), path, &bytes)
            .map_err(|e| format!("abrindo {}: {e}", path.display()))?;
        let known = Format::from_path(path).is_some();
        let mut editor = Self::with(document, known.then(|| path.to_path_buf()));
        editor.dirty = !known;
        Ok(editor)
    }

    /// Documento restaurado da recuperação automática: com alterações não salvas.
    pub fn recovered(document: TextDocument, path: Option<PathBuf>) -> Self {
        let mut editor = Self::with(document, path);
        editor.dirty = true;
        editor
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn dispatch(&mut self, command: TextCommand) -> Result<DispatchResult, String> {
        let before = self.session.document().block_count();
        let events = self.session.dispatch(command).map_err(|e| e.to_string())?;
        if !events.is_empty() {
            self.dirty = true;
        }
        let after = self.session.document().block_count();
        let (start, end, old_end) = match dirty_range(&events) {
            // O que vem depois da faixa não mudou; só andou `after - before` posições.
            Some((start, end)) => (start, end, end + before - after),
            None => (0, after, before),
        };
        Ok(DispatchResult {
            events,
            patch: self.patch(start, end, old_end - start),
        })
    }

    fn patch(&self, start: u32, end: u32, delete_count: u32) -> ViewPatch {
        let view = self.meta();
        ViewPatch {
            format: view.format,
            start,
            delete_count,
            blocks: (start..end).map(|i| self.block_view(i)).collect(),
            block_count: self.session.document().block_count(),
            can_undo: view.can_undo,
            can_redo: view.can_redo,
            path: view.path,
            title: view.title,
            dirty: view.dirty,
            page: view.page,
            header_footer: view.header_footer,
            watermark: view.watermark,
            footnotes: view.footnotes,
        }
    }

    fn block_view(&self, i: u32) -> BlockView {
        let doc = self.session.document();
        BlockView {
            style: doc.block_style(i).expect("índice dentro do documento"),
            attrs: doc.block_attrs(i).expect("índice dentro do documento"),
            spans: doc.block_spans(i).expect("índice dentro do documento"),
        }
    }

    /// Visão sem os parágrafos (só os metadados).
    fn meta(&self) -> DocView {
        let doc = self.session.document();
        DocView {
            blocks: Vec::new(),
            format: self.format.map(Format::extension),
            can_undo: doc.can_undo(),
            can_redo: doc.can_redo(),
            path: self.path.as_ref().map(|p| p.display().to_string()),
            title: title_of(self.path.as_deref()),
            dirty: self.dirty,
            page: doc.page_setup(),
            header_footer: doc.header_footer(),
            watermark: doc.watermark(),
            footnotes: doc.footnote_texts(),
        }
    }

    /// Salva no arquivo atual ou em `target` (Salvar como). O formato vem da
    /// extensão; sem extensão conhecida, grava como documento do Word (.docx),
    /// o padrão do Word.
    pub fn save(&mut self, target: Option<PathBuf>) -> Result<(), String> {
        let path = match target {
            Some(path) => with_known_extension(path),
            None => self
                .path
                .clone()
                .ok_or("o documento ainda não tem arquivo; use Salvar como")?,
        };
        let format = Format::from_path(&path).unwrap_or(Format::Docx);
        let title = title_of(Some(&path));
        fs::write(
            &path,
            formats::save(self.session.document(), format, &title),
        )
        .map_err(|e| io_error("gravando", &path, e))?;
        self.path = Some(path);
        self.format = Some(format);
        self.dirty = false;
        Ok(())
    }

    /// Exportar: grava uma cópia em outro formato sem mudar o arquivo atual.
    pub fn export(&self, path: &Path) -> Result<(), String> {
        let path = with_known_extension(path.to_path_buf());
        let format = Format::from_path(&path).unwrap_or(Format::Docx);
        let title = title_of(self.path.as_deref());
        fs::write(
            &path,
            formats::save(self.session.document(), format, &title),
        )
        .map_err(|e| io_error("gravando", &path, e))
    }

    /// Guarda uma imagem no documento (a inserção do parágrafo vem depois, por
    /// `block.insert` + `block.setAttr image`, para entrar no desfazer).
    pub fn add_image(&self, data: &[u8]) -> Result<nova_domain_text::ImageRef, String> {
        nova_app::media::embed(self.session.document(), data, None).ok_or_else(|| {
            "formato de imagem não suportado (use PNG, JPEG, GIF, BMP ou WebP) ou arquivo grande demais (máximo 25 MB)".to_string()
        })
    }

    /// Imagem embutida como data URL, para a interface desenhar.
    pub fn media(&self, id: &str) -> Option<String> {
        let (mime, data) = self.session.document().media(id)?;
        Some(nova_app::media::data_url(&mime, &data))
    }

    /// Estado completo em .nova, para a recuperação automática.
    pub fn snapshot_bytes(&self) -> Vec<u8> {
        file::encode(self.session.document())
    }

    pub fn view(&self) -> DocView {
        DocView {
            blocks: (0..self.session.document().block_count())
                .map(|i| self.block_view(i))
                .collect(),
            ..self.meta()
        }
    }
}

pub fn title_of(path: Option<&Path>) -> String {
    path.and_then(|p| p.file_stem()).map_or_else(
        || "Sem título".to_string(),
        |s| s.to_string_lossy().into_owned(),
    )
}

/// Sem extensão conhecida, o arquivo ganha `.docx`.
fn with_known_extension(path: PathBuf) -> PathBuf {
    if Format::from_path(&path).is_some() {
        path
    } else {
        let mut name = path.into_os_string();
        name.push(".docx");
        PathBuf::from(name)
    }
}

fn io_error(action: &str, path: &Path, error: std::io::Error) -> String {
    format!("{action} {}: {error}", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::Mark;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nova-desktop-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn insert(text: &str) -> TextCommand {
        TextCommand::InsertText {
            block: 0,
            offset: 0,
            text: text.into(),
            marks: None,
        }
    }

    #[test]
    fn editar_marca_alteracao_e_salvar_limpa() {
        let dir = temp_dir("salvar");
        let mut editor = Editor::new();
        assert!(!editor.view().dirty);

        let result = editor.dispatch(insert("Olá")).unwrap();
        assert_eq!(result.events.len(), 1);
        assert!(result.patch.dirty && result.patch.can_undo);

        assert!(
            editor.save(None).is_err(),
            "sem arquivo, salvar exige um destino"
        );
        editor.save(Some(dir.join("carta"))).unwrap();
        let view = editor.view();
        assert!(!view.dirty);
        assert_eq!(view.title, "carta");
        assert_eq!(view.format, Some("docx"), "sem extensão, salva como Word");
        assert!(view.path.unwrap().ends_with("carta.docx"));
    }

    #[test]
    fn reabrir_preserva_conteudo_e_formatacao() {
        let dir = temp_dir("reabrir");
        let path = dir.join("doc.nova");
        let mut editor = Editor::new();
        editor.dispatch(insert("negrito")).unwrap();
        editor
            .dispatch(TextCommand::ApplyMark {
                block: 0,
                offset: 0,
                len: 7,
                mark: Mark::Bold,
            })
            .unwrap();
        editor.save(Some(path.clone())).unwrap();

        let view = Editor::open(&path).unwrap().view();
        assert_eq!(view.blocks[0].spans[0].text, "negrito");
        assert_eq!(view.blocks[0].spans[0].marks, vec![Mark::Bold]);
        assert!(!view.dirty && !view.can_undo);
    }

    #[test]
    fn abrir_texto_mantem_o_arquivo_e_o_formato() {
        let dir = temp_dir("importar");
        let path = dir.join("notas.txt");
        fs::write(&path, "linha 1\nlinha 2").unwrap();

        let view = Editor::open(&path).unwrap().view();
        assert_eq!(view.blocks.len(), 2);
        assert_eq!(view.format, Some("txt"));
        assert!(view.path.is_some() && !view.dirty);

        let other = dir.join("notas.xyz");
        fs::write(&other, "x").unwrap();
        let view = Editor::open(&other).unwrap().view();
        assert!(
            view.path.is_none() && view.dirty,
            "extensão desconhecida pede Salvar como"
        );
    }

    #[test]
    fn salvar_em_cada_formato_e_reabrir() {
        let dir = temp_dir("formatos");
        let mut editor = Editor::new();
        editor.dispatch(insert("Olá")).unwrap();
        editor
            .dispatch(TextCommand::ApplyMark {
                block: 0,
                offset: 0,
                len: 3,
                mark: Mark::Bold,
            })
            .unwrap();
        for ext in ["docx", "odt", "nova", "md"] {
            let path = dir.join(format!("doc.{ext}"));
            editor.save(Some(path.clone())).unwrap();
            let back = Editor::open(&path).unwrap().view();
            assert_eq!(back.blocks[0].spans[0].text, "Olá", "{ext}");
            assert_eq!(back.blocks[0].spans[0].marks, vec![Mark::Bold], "{ext}");
            assert_eq!(back.format, Some(ext));
        }
        // Exportar não muda o arquivo atual.
        editor.export(&dir.join("copia.html")).unwrap();
        assert!(editor.view().path.unwrap().ends_with("doc.md"));
        assert!(fs::read_to_string(dir.join("copia.html"))
            .unwrap()
            .contains("<strong>Olá</strong>"));
    }

    #[test]
    fn comando_invalido_vira_mensagem() {
        let mut editor = Editor::new();
        let error = editor
            .dispatch(TextCommand::RemoveBlock { block: 0 })
            .unwrap_err();
        assert!(error.contains("pelo menos um bloco"));
        assert!(!editor.view().dirty);
    }

    /// Aplica o remendo na visão anterior, como a interface faz.
    fn apply(mut blocks: Vec<String>, patch: &ViewPatch) -> Vec<String> {
        let start = patch.start as usize;
        let new: Vec<String> = patch
            .blocks
            .iter()
            .map(|b| b.spans.iter().map(|s| s.text.as_str()).collect())
            .collect();
        blocks.splice(start..start + patch.delete_count as usize, new);
        assert_eq!(blocks.len(), patch.block_count as usize);
        blocks
    }

    fn texts(editor: &Editor) -> Vec<String> {
        editor
            .view()
            .blocks
            .iter()
            .map(|b| b.spans.iter().map(|s| s.text.as_str()).collect())
            .collect()
    }

    #[test]
    fn remendo_traz_so_o_que_mudou() {
        use nova_domain_text::Pos;
        let mut editor = Editor::new();
        let lines: Vec<TextCommand> = (1..10)
            .map(|i| TextCommand::InsertBlock {
                index: i,
                text: format!("p{i}"),
                style: BlockStyle::Paragraph,
            })
            .collect();
        editor
            .dispatch(TextCommand::Batch { commands: lines })
            .unwrap();

        let cases = vec![
            TextCommand::InsertText {
                block: 5,
                offset: 0,
                text: "x".into(),
                marks: None,
            },
            TextCommand::SplitBlock {
                block: 3,
                offset: 1,
            },
            TextCommand::MergeWithNext { block: 7 },
            TextCommand::DeleteRange {
                from: Pos {
                    block: 2,
                    offset: 1,
                },
                to: Pos {
                    block: 6,
                    offset: 1,
                },
            },
            TextCommand::Batch {
                commands: vec![
                    TextCommand::SplitBlock {
                        block: 1,
                        offset: 0,
                    },
                    TextCommand::InsertBlock {
                        index: 0,
                        text: "topo".into(),
                        style: BlockStyle::Paragraph,
                    },
                    TextCommand::RemoveBlock { block: 4 },
                    TextCommand::InsertText {
                        block: 3,
                        offset: 0,
                        text: "y".into(),
                        marks: None,
                    },
                ],
            },
            TextCommand::Undo,
            TextCommand::RemoveBlock { block: 0 },
        ];
        for command in cases {
            let before = texts(&editor);
            let result = editor.dispatch(command.clone()).unwrap();
            assert_eq!(apply(before, &result.patch), texts(&editor), "{command:?}");
        }

        // Digitar num documento grande manda um parágrafo só.
        let result = editor.dispatch(insert("z")).unwrap();
        assert_eq!(
            (
                result.patch.start,
                result.patch.delete_count,
                result.patch.blocks.len()
            ),
            (0, 1, 1)
        );
    }

    #[test]
    fn visao_serializa_para_a_interface() {
        let json = serde_json::to_value(Editor::new().view()).unwrap();
        assert_eq!(json["blocks"][0]["style"], "paragraph");
        assert_eq!(json["blocks"][0]["attrs"]["align"], "left");
        assert_eq!(json["blocks"][0]["attrs"]["list"], serde_json::Value::Null);
        assert_eq!(json["canUndo"], false);
        assert_eq!(json["title"], "Sem título");
    }
}
