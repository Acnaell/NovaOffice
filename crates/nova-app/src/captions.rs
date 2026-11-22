//! Legendas, Índice de Ilustrações e Referência Cruzada nos arquivos (ADR 0016).
//!
//! - .docx: o número da legenda é um campo `SEQ Figura \* ARABIC`; o alvo de uma
//!   referência é um `w:bookmarkStart`/`w:bookmarkEnd` ("_Ref<id>") em volta de
//!   "Figura 3" (ou do título inteiro); a referência é um campo `REF` ou
//!   `PAGEREF` com `\h`; o índice é um campo `TOC \h \z \c "Figura"`.
//! - .odt: `text:sequence` (com `text:ref-name` na legenda referenciada),
//!   `text:sequence-ref` para legendas e `text:bookmark-ref` para títulos, e o
//!   índice é um `text:illustration-index` (ou `text:table-index` para Tabela).
//! - Texto, Markdown e HTML: o número e o texto da referência no lugar dos caracteres.

use std::collections::{HashMap, HashSet};

use nova_domain_text::{
    is_caption_label, CaptionFields, Mark, Paragraph, RefShow, Span, TextDocument, SEQ_CHAR,
    XREF_CHAR,
};

use crate::docx::esc;

/// Texto de cada número de legenda e de cada referência cruzada, na ordem do documento.
pub struct Texts {
    pub seq: Vec<String>,
    pub xref: Vec<String>,
}

pub fn texts(doc: &TextDocument) -> Texts {
    texts_of(&doc.paragraphs())
}

pub(crate) fn texts_of(paragraphs: &[Paragraph]) -> Texts {
    let fields = CaptionFields::new(paragraphs);
    let mut xref = Vec::new();
    for span in paragraphs.iter().flat_map(|p| &p.spans) {
        if let Some((target, show, page)) = xref_of(span) {
            let text = fields.xref_text(target, show, page);
            let n = span.text.chars().filter(|c| *c == XREF_CHAR).count();
            xref.extend(std::iter::repeat(text).take(n));
        }
    }
    Texts {
        seq: fields.numbers.iter().map(u32::to_string).collect(),
        xref,
    }
}

/// Troca os caracteres de número e de referência pelo texto deles (passado por `fmt`).
pub fn replace(text: &str, texts: &Texts, fmt: impl Fn(&str) -> String) -> String {
    let (mut s, mut x) = (0, 0);
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            SEQ_CHAR => {
                if let Some(t) = texts.seq.get(s) {
                    out.push_str(&fmt(t));
                }
                s += 1;
            }
            XREF_CHAR => {
                if let Some(t) = texts.xref.get(x) {
                    out.push_str(&fmt(t));
                }
                x += 1;
            }
            c => out.push(c),
        }
    }
    out
}

fn seq_of(span: &Span) -> Option<&str> {
    span.marks.iter().find_map(|m| match m {
        Mark::Seq { label } => Some(label.as_str()),
        _ => None,
    })
}

fn xref_of(span: &Span) -> Option<(&str, RefShow, Option<u16>)> {
    span.marks.iter().find_map(|m| match m {
        Mark::CrossRef { target, show, page } => Some((target.as_str(), *show, *page)),
        _ => None,
    })
}

/// O trecho sem as marcas de campo, para escrever o resultado com a formatação dele.
fn shown(span: &Span, text: String) -> Span {
    Span {
        text,
        marks: span
            .marks
            .iter()
            .filter(|m| !matches!(m, Mark::Seq { .. } | Mark::CrossRef { .. }))
            .cloned()
            .collect(),
    }
}

fn is_caption(p: &Paragraph) -> bool {
    p.spans.iter().any(|s| s.text.contains(SEQ_CHAR))
}

/// Nome do marcador nos arquivos: "_Ref<id>" (o prefixo do Word para marcadores ocultos).
pub(crate) fn bookmark_name(id: &str) -> String {
    format!("_Ref{id}")
}

/// Id do Nova para um marcador de outro programa: sem o "_Ref", só letras e dígitos.
pub(crate) fn bookmark_id(name: &str) -> Option<String> {
    let base = name.strip_prefix("_Ref").unwrap_or(name);
    let id: String = base
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(32)
        .collect();
    (!id.is_empty()).then_some(id)
}

/// Rótulo de outro programa: "Figura", "Mapa_de_Risco" → "Mapa de Risco".
pub(crate) fn label_from(name: &str) -> Option<String> {
    let label = name.replace('_', " ").trim().to_string();
    is_caption_label(&label).then_some(label)
}

/// Marcadores lidos de um arquivo: (parágrafo, ids na ordem). Cada parágrafo
/// fica com um só, o primeiro que alguma referência usa; as referências aos
/// outros marcadores do mesmo parágrafo passam para ele. Marcadores que nenhuma
/// referência usa (como os "_Toc" do Sumário do Word) não entram.
pub(crate) fn apply_bookmarks(paragraphs: &mut [Paragraph], found: &[(usize, Vec<String>)]) {
    let used: HashSet<String> = paragraphs
        .iter()
        .flat_map(|p| &p.spans)
        .filter_map(|s| xref_of(s).map(|(t, ..)| t.to_string()))
        .collect();
    let mut remap: HashMap<String, String> = HashMap::new();
    let mut taken: HashSet<String> = HashSet::new();
    for (index, ids) in found {
        let Some(p) = paragraphs.get_mut(*index) else {
            continue;
        };
        let ids: Vec<&String> = ids
            .iter()
            .filter(|id| used.contains(*id) && !taken.contains(*id))
            .collect();
        let Some(first) = ids.first() else { continue };
        let chosen = p
            .attrs
            .bookmark
            .get_or_insert_with(|| (*first).clone())
            .clone();
        taken.insert(chosen.clone());
        for other in ids {
            if *other != chosen {
                remap.insert(other.clone(), chosen.clone());
                taken.insert(other.clone());
            }
        }
    }
    if remap.is_empty() {
        return;
    }
    for span in paragraphs.iter_mut().flat_map(|p| p.spans.iter_mut()) {
        for m in span.marks.iter_mut() {
            if let Mark::CrossRef { target, .. } = m {
                if let Some(to) = remap.get(target) {
                    *target = to.clone();
                }
            }
        }
    }
}

/// Títulos de índice lidos sem rótulo (o título vem antes do campo, no .docx)
/// ficam com o rótulo das entradas que vêm depois deles.
pub(crate) fn fix_index_titles(paragraphs: &mut [Paragraph]) {
    for i in (0..paragraphs.len()).rev() {
        let next = paragraphs
            .get(i + 1)
            .and_then(|n| n.attrs.figure_index.as_ref())
            .map(|e| e.label.clone());
        if let (Some(entry), Some(label)) = (paragraphs[i].attrs.figure_index.as_mut(), next) {
            if entry.title {
                entry.label = label;
            }
        }
    }
}

// ---------------------------------------------------------------- .docx

/// Campo do Word que o Nova entende.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DocxField {
    Seq(String),
    /// Marcador (nome no arquivo) e o que mostra.
    Ref(String, RefShow),
    /// Índice de ilustrações (`TOC \c "Figura"`).
    FigureIndex(String),
}

/// O que um campo é, pela instrução.
pub(crate) fn docx_field(instr: &str) -> Option<DocxField> {
    let mut words = instr.split_whitespace();
    let word = words.next()?.to_ascii_uppercase();
    match word.as_str() {
        "SEQ" => label_from(words.next()?).map(DocxField::Seq),
        "REF" | "PAGEREF" => {
            let name = words.next()?;
            let show = if word == "PAGEREF" {
                RefShow::Page
            } else {
                RefShow::Label
            };
            Some(DocxField::Ref(name.to_string(), show))
        }
        "TOC" => {
            let mut rest = instr.split_once("\\c")?.1.trim_start().chars();
            let label: String = if rest.clone().next() == Some('"') {
                rest.next();
                rest.take_while(|c| *c != '"').collect()
            } else {
                rest.take_while(|c| !c.is_whitespace()).collect()
            };
            label_from(&label).map(DocxField::FigureIndex)
        }
        _ => None,
    }
}

/// O caractere de um campo lido (número de legenda ou referência), com a
/// formatação do trecho; `result` é o texto do campo (a página, num PAGEREF).
pub(crate) fn docx_field_span(field: &DocxField, result: &str, marks: &[Mark]) -> Option<Span> {
    let mut marks: Vec<Mark> = marks
        .iter()
        .filter(|m| !matches!(m, Mark::Link { .. }))
        .cloned()
        .collect();
    let ch = match field {
        DocxField::Seq(label) => {
            marks.push(Mark::Seq {
                label: label.clone(),
            });
            SEQ_CHAR
        }
        DocxField::Ref(name, show) => {
            marks.push(Mark::CrossRef {
                target: bookmark_id(name)?,
                show: *show,
                page: (*show == RefShow::Page)
                    .then(|| result.trim().parse().ok())
                    .flatten(),
            });
            XREF_CHAR
        }
        DocxField::FigureIndex(_) => return None,
    };
    Some(Span {
        text: ch.to_string(),
        marks,
    })
}

/// Marca o parágrafo como parte do índice de ilustrações. A entrada perde o
/// número da página do fim ("Figura 1 – Mapa\t3"), que fica guardado nela.
/// Sem rótulo (só pelo estilo), fica "Figura" até achar o do campo.
pub(crate) fn index_entry(p: &mut Paragraph, label: Option<String>, title: bool) {
    if let Some(entry) = p.attrs.figure_index.as_mut() {
        if let Some(label) = label {
            entry.label = label;
        }
        return;
    }
    let page = if title {
        0
    } else {
        crate::docx::take_toc_page(p)
    };
    p.style = nova_domain_text::BlockStyle::Paragraph;
    p.attrs.figure_index = Some(nova_domain_text::FigureEntry {
        label: label.unwrap_or_else(|| "Figura".into()),
        title,
        page,
    });
}

/// Instrução de um Sumário ou índice (os PAGEREF das entradas ficam como texto).
pub(crate) fn is_toc_instr(instr: &str) -> bool {
    instr
        .split_whitespace()
        .next()
        .is_some_and(|w| w.eq_ignore_ascii_case("TOC"))
}

fn docx_label(label: &str) -> String {
    label.replace(' ', "_")
}

fn field(out: &mut String, instr: &str, result: &Span, run: &dyn Fn(&mut String, &Span)) {
    out.push_str(&format!(
        r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">{}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#,
        esc(instr)
    ));
    run(out, result);
    out.push_str(r#"<w:r><w:fldChar w:fldCharType="end"/></w:r>"#);
}

/// Início do campo do índice de um rótulo, antes da primeira entrada.
pub(crate) fn docx_index_begin(label: &str) -> String {
    format!(
        r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \h \z \c "{}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#,
        esc(&docx_label(label))
    )
}

/// Estilos "caption", "table of figures" e o do título do índice.
pub(crate) const DOCX_STYLES: &str = r#"<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableofFigures"><w:name w:val="table of figures"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="TableofFiguresHeading"><w:name w:val="Table of Figures Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:bCs/><w:caps/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>"#;

/// Parte do índice de ilustrações de um estilo pelo nome: Word ("table of
/// figures") e LibreOffice ("Figure Index 1", "Illustration Index 1"…). `Some(true)` é o título.
pub(crate) fn index_style(name: &str) -> Option<bool> {
    let n = name.to_lowercase().replace("_20_", " ");
    let heading = n.ends_with(" heading");
    let base = n.trim_end_matches(" heading").trim_end_matches(" 1");
    matches!(
        base,
        "table of figures" | "figure index" | "illustration index" | "table index"
    )
    .then_some(heading)
}

/// Escreve os números de legenda e as referências cruzadas de um .docx.
pub(crate) struct DocxWriter {
    fields: CaptionFields,
    next_seq: usize,
    bookmarks: u32,
    /// Marcador aberto no parágrafo: fecha depois do número (legenda) ou no fim.
    open: Option<(u32, bool)>,
}

impl DocxWriter {
    pub(crate) fn new(paragraphs: &[Paragraph]) -> DocxWriter {
        DocxWriter {
            fields: CaptionFields::new(paragraphs),
            next_seq: 0,
            bookmarks: 0,
            open: None,
        }
    }

    /// No começo do parágrafo (depois do `w:pPr`): o marcador dele.
    pub(crate) fn start(&mut self, out: &mut String, p: &Paragraph) {
        if let Some(id) = &p.attrs.bookmark {
            self.bookmarks += 1;
            out.push_str(&format!(
                r#"<w:bookmarkStart w:id="{}" w:name="{}"/>"#,
                self.bookmarks,
                esc(&bookmark_name(id))
            ));
            self.open = Some((self.bookmarks, is_caption(p)));
        }
    }

    /// Antes do `</w:p>`: fecha o marcador que ainda está aberto.
    pub(crate) fn end(&mut self, out: &mut String) {
        if let Some((n, _)) = self.open.take() {
            out.push_str(&format!(r#"<w:bookmarkEnd w:id="{n}"/>"#));
        }
    }

    /// Escreve o trecho se ele for um número de legenda ou uma referência.
    pub(crate) fn span(
        &mut self,
        out: &mut String,
        span: &Span,
        run: &dyn Fn(&mut String, &Span),
    ) -> bool {
        if let Some(label) = seq_of(span) {
            for _ in span.text.chars().filter(|c| *c == SEQ_CHAR) {
                let n = self.fields.numbers.get(self.next_seq).copied().unwrap_or(0);
                self.next_seq += 1;
                let instr = format!(" SEQ {} \\* ARABIC ", docx_label(label));
                field(out, &instr, &shown(span, n.to_string()), run);
                if let Some((id, true)) = self.open {
                    out.push_str(&format!(r#"<w:bookmarkEnd w:id="{id}"/>"#));
                    self.open = None;
                }
            }
            return true;
        }
        if let Some((target, show, page)) = xref_of(span) {
            let text = self.fields.xref_text(target, show, page);
            let kind = if show == RefShow::Page {
                "PAGEREF"
            } else {
                "REF"
            };
            let instr = format!(" {kind} {} \\h ", bookmark_name(target));
            for _ in span.text.chars().filter(|c| *c == XREF_CHAR) {
                field(out, &instr, &shown(span, text.clone()), run);
            }
            return true;
        }
        false
    }
}

// ---------------------------------------------------------------- .odt

/// Categorias de legenda do LibreOffice: o nome no arquivo é o interno, em
/// inglês, e a interface mostra o traduzido ("Figure" aparece como "Figura").
const ODF_LABELS: [(&str, &str); 5] = [
    ("Figura", "Figure"),
    ("Tabela", "Table"),
    ("Ilustração", "Illustration"),
    ("Desenho", "Drawing"),
    ("Texto", "Text"),
];

/// Nome da variável de sequência no .odt para um rótulo do Nova.
fn odf_label(label: &str) -> &str {
    ODF_LABELS
        .iter()
        .find(|(pt, _)| *pt == label)
        .map_or(label, |(_, name)| name)
}

/// Rótulo do Nova para uma variável de sequência de um .odt.
pub(crate) fn label_from_odf(name: &str) -> Option<String> {
    match ODF_LABELS.iter().find(|(_, n)| *n == name) {
        Some((pt, _)) => Some(pt.to_string()),
        None => label_from(name),
    }
}

/// `text:sequence-decls` com os rótulos usados (vem no começo do `office:text`).
pub(crate) fn odt_sequence_decls(paragraphs: &[Paragraph]) -> String {
    let mut labels: Vec<&str> = Vec::new();
    for label in paragraphs.iter().flat_map(|p| &p.spans).filter_map(seq_of) {
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    if labels.is_empty() {
        return String::new();
    }
    let mut out = String::from("<text:sequence-decls>");
    for label in labels {
        out.push_str(&format!(
            r#"<text:sequence-decl text:display-outline-level="0" text:name="{}"/>"#,
            esc(odf_label(label))
        ));
    }
    out.push_str("</text:sequence-decls>");
    out
}

/// O índice de um rótulo: `text:table-index` para Tabela, `text:illustration-index` para os outros.
fn odt_index(label: &str) -> (&'static str, &'static str, &'static str) {
    if label == "Tabela" {
        (
            "table-index",
            "Table_20_index_20_Heading",
            "Table_20_index_20_1",
        )
    } else {
        (
            "illustration-index",
            "Illustration_20_Index_20_Heading",
            "Illustration_20_Index_20_1",
        )
    }
}

/// Estilo (pai) de um parágrafo do índice.
pub(crate) fn odt_index_style(entry: &nova_domain_text::FigureEntry) -> &'static str {
    let (_, heading, item) = odt_index(&entry.label);
    if entry.title {
        heading
    } else {
        item
    }
}

/// Abre o índice de um rótulo, com o modelo que o LibreOffice usa ao atualizar.
pub(crate) fn odt_index_open(label: &str, title: &str, n: u32) -> String {
    let (kind, heading, item) = odt_index(label);
    let label = esc(odf_label(label));
    format!(
        r#"<text:{kind} text:name="Ilustrações{n}" text:protected="false"><text:{kind}-source text:caption-sequence-name="{label}" text:caption-sequence-format="text"><text:index-title-template text:style-name="{heading}">{}</text:index-title-template><text:{kind}-entry-template text:style-name="{item}"><text:index-entry-link-start/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/><text:index-entry-link-end/></text:{kind}-entry-template></text:{kind}-source><text:index-body>"#,
        esc(title)
    )
}

pub(crate) fn odt_index_close(label: &str) -> String {
    format!("</text:index-body></text:{}>", odt_index(label).0)
}

/// Estilos de legenda e dos índices, com os nomes do LibreOffice.
pub(crate) const ODT_STYLES: &str = r#"<style:style style:name="Caption" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-top="6pt" fo:margin-bottom="6pt" fo:line-height="100%"/><style:text-properties fo:font-size="10pt"/></style:style><style:style style:name="Illustration_20_Index_20_Heading" style:display-name="Illustration Index Heading" style:family="paragraph" style:parent-style-name="Heading" style:class="index"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="12pt" fo:font-weight="bold" fo:text-transform="uppercase"/></style:style><style:style style:name="Illustration_20_Index_20_1" style:display-name="Illustration Index 1" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-bottom="0pt"><style:tab-stops><style:tab-stop style:position="17cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style><style:style style:name="Table_20_index_20_Heading" style:display-name="Table index Heading" style:family="paragraph" style:parent-style-name="Heading" style:class="index"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="12pt" fo:font-weight="bold" fo:text-transform="uppercase"/></style:style><style:style style:name="Table_20_index_20_1" style:display-name="Table index 1" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-bottom="0pt"><style:tab-stops><style:tab-stop style:position="17cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>"#;

/// Escreve os números de legenda e as referências cruzadas de um .odt.
pub(crate) struct OdtWriter {
    fields: CaptionFields,
    next_seq: usize,
    /// Marcador da legenda: vai como `text:ref-name` do primeiro número dela.
    ref_name: Option<String>,
    /// Marcador do título, fechado no fim do parágrafo.
    bookmark_end: Option<String>,
}

impl OdtWriter {
    pub(crate) fn new(paragraphs: &[Paragraph]) -> OdtWriter {
        OdtWriter {
            fields: CaptionFields::new(paragraphs),
            next_seq: 0,
            ref_name: None,
            bookmark_end: None,
        }
    }

    /// No começo do parágrafo: o marcador de um título vira `text:bookmark-start`.
    pub(crate) fn start(&mut self, body: &mut String, p: &Paragraph) {
        let name = p.attrs.bookmark.as_deref().map(bookmark_name);
        if is_caption(p) {
            self.ref_name = name;
        } else if let Some(name) = name {
            body.push_str(&format!(
                r#"<text:bookmark-start text:name="{}"/>"#,
                esc(&name)
            ));
            self.bookmark_end = Some(name);
        }
    }

    /// No fim do parágrafo: fecha o marcador do título.
    pub(crate) fn end(&mut self, body: &mut String) {
        self.ref_name = None;
        if let Some(name) = self.bookmark_end.take() {
            body.push_str(&format!(
                r#"<text:bookmark-end text:name="{}"/>"#,
                esc(&name)
            ));
        }
    }

    /// O trecho como `text:sequence` ou referência, ou `None` se não for um deles.
    pub(crate) fn span(&mut self, span: &Span, paragraphs: &[Paragraph]) -> Option<String> {
        let mut out = String::new();
        if let Some(label) = seq_of(span) {
            let label = esc(odf_label(label));
            for _ in span.text.chars().filter(|c| *c == SEQ_CHAR) {
                let n = self.fields.numbers.get(self.next_seq).copied().unwrap_or(0);
                self.next_seq += 1;
                let ref_name = self
                    .ref_name
                    .take()
                    .map(|name| format!(r#" text:ref-name="{}""#, esc(&name)))
                    .unwrap_or_default();
                out.push_str(&format!(
                    r#"<text:sequence text:name="{label}"{ref_name} text:formula="ooow:{label}+1" style:num-format="1">{n}</text:sequence>"#
                ));
            }
            return Some(out);
        }
        let (target, show, page) = xref_of(span)?;
        let text = esc(&self.fields.xref_text(target, show, page));
        let name = esc(&bookmark_name(target));
        let to_caption = self
            .fields
            .targets
            .get(target)
            .is_some_and(|(_, i)| paragraphs.get(*i).is_some_and(is_caption));
        let (element, format) = match (to_caption, show) {
            (true, RefShow::Label) => ("sequence-ref", "category-and-value"),
            (true, RefShow::Page) => ("sequence-ref", "page"),
            (false, RefShow::Label) => ("bookmark-ref", "text"),
            (false, RefShow::Page) => ("bookmark-ref", "page"),
        };
        for _ in span.text.chars().filter(|c| *c == XREF_CHAR) {
            out.push_str(&format!(
                r#"<text:{element} text:reference-format="{format}" text:ref-name="{name}">{text}</text:{element}>"#
            ));
        }
        Some(out)
    }
}

/// `reference-format` de uma referência do LibreOffice: página ou o resto (texto, rótulo e número).
pub(crate) fn odt_show(format: Option<&str>) -> RefShow {
    if format == Some("page") {
        RefShow::Page
    } else {
        RefShow::Label
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn campos_do_word() {
        assert_eq!(
            docx_field(" SEQ Figura \\* ARABIC "),
            Some(DocxField::Seq("Figura".into()))
        );
        assert_eq!(
            docx_field(" SEQ Mapa_de_Risco \\* ARABIC "),
            Some(DocxField::Seq("Mapa de Risco".into()))
        );
        assert_eq!(
            docx_field(" PAGEREF _Ref123 \\h "),
            Some(DocxField::Ref("_Ref123".into(), RefShow::Page))
        );
        assert_eq!(
            docx_field(" TOC \\h \\z \\c \"Figura\" "),
            Some(DocxField::FigureIndex("Figura".into()))
        );
        assert_eq!(docx_field(" TOC \\o \"1-3\" \\h \\z \\u "), None);
        assert_eq!(bookmark_id("_Ref123").as_deref(), Some("123"));
        assert_eq!(bookmark_id("refFigura0").as_deref(), Some("refFigura0"));
        assert_eq!(index_style("table of figures"), Some(false));
        assert_eq!(index_style("Illustration_20_Index_20_Heading"), Some(true));
        assert_eq!(index_style("toc 1"), None);
    }
}
