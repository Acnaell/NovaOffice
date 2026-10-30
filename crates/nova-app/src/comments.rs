//! Comentários nos arquivos (ADR 0014).
//!
//! - .docx: `word/comments.xml` (autor, data, iniciais, texto) e
//!   `word/commentsExtended.xml` (resolvido e resposta, pelo `w14:paraId` do
//!   último parágrafo de cada comentário), como o Word 2013+ grava. No texto,
//!   `w:commentRangeStart`/`w:commentRangeEnd` e o `w:commentReference`.
//! - .odt: `office:annotation` no início do trecho e `office:annotation-end`
//!   no fim, com `dc:creator`, `dc:date`, `meta:creator-initials` e, como o
//!   LibreOffice, `loext:resolved` e `loext:parent-name`.

use std::collections::HashMap;

use nova_domain_text::{Comment, MAX_COMMENT_CHARS};
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::docx::{attr, esc};

/// Número do comentário no .docx (`w:id`): a posição na lista de `TextDocument::comments`.
pub(crate) struct DocxIds<'a> {
    list: &'a [(String, Comment)],
}

impl<'a> DocxIds<'a> {
    pub(crate) fn new(list: &'a [(String, Comment)]) -> Self {
        Self { list }
    }

    /// `w:id` dos comentários de um trecho: o comentário e as respostas dele.
    pub(crate) fn thread(&self, root: &str) -> Vec<usize> {
        self.list
            .iter()
            .enumerate()
            .filter(|(_, (id, c))| id == root || c.parent.as_deref() == Some(root))
            .map(|(n, _)| n)
            .collect()
    }

    pub(crate) fn open(&self, root: &str, out: &mut String) {
        for n in self.thread(root) {
            out.push_str(&format!(r#"<w:commentRangeStart w:id="{n}"/>"#));
        }
    }

    pub(crate) fn close(&self, root: &str, out: &mut String) {
        for n in self.thread(root) {
            out.push_str(&format!(
                r#"<w:commentRangeEnd w:id="{n}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{n}"/></w:r>"#
            ));
        }
    }
}

/// `w14:paraId` do comentário de número `n` (precisa ser menor que 0x80000000).
fn para_id(n: usize) -> String {
    format!("{:08X}", 0x1000_0000 + n)
}

/// `word/comments.xml`.
pub(crate) fn docx_comments_xml(list: &[(String, Comment)]) -> String {
    let mut out = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">"#,
    );
    for (n, (_, c)) in list.iter().enumerate() {
        let date = if c.date.is_empty() {
            String::new()
        } else {
            format!(r#" w:date="{}""#, esc(&c.date))
        };
        let initials = if c.initials.is_empty() {
            Comment::initials_of(&c.author)
        } else {
            c.initials.clone()
        };
        out.push_str(&format!(
            r#"<w:comment w:id="{n}" w:author="{}"{date} w:initials="{}">"#,
            esc(&c.author),
            esc(&initials)
        ));
        let lines: Vec<&str> = c.text.split('\u{b}').collect();
        for (i, line) in lines.iter().enumerate() {
            let id = if i + 1 == lines.len() {
                format!(r#" w14:paraId="{}" w14:textId="77777777""#, para_id(n))
            } else {
                String::new()
            };
            out.push_str(&format!(
                r#"<w:p{id}><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>"#
            ));
            if i == 0 {
                out.push_str(
                    r#"<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>"#,
                );
            }
            if !line.is_empty() {
                out.push_str(&format!(
                    r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
                    esc(line)
                ));
            }
            out.push_str("</w:p>");
        }
        out.push_str("</w:comment>");
    }
    out.push_str("</w:comments>");
    out
}

/// `word/commentsExtended.xml`: resolvido e a qual comentário cada resposta responde.
pub(crate) fn docx_comments_ext_xml(list: &[(String, Comment)]) -> String {
    let mut out = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15">"#,
    );
    for (n, (_, c)) in list.iter().enumerate() {
        let parent = c
            .parent
            .as_ref()
            .and_then(|p| list.iter().position(|(id, _)| id == p))
            .map(|p| format!(r#" w15:paraIdParent="{}""#, para_id(p)))
            .unwrap_or_default();
        out.push_str(&format!(
            r#"<w15:commentEx w15:paraId="{}"{parent} w15:done="{}"/>"#,
            para_id(n),
            u8::from(c.done)
        ));
    }
    out.push_str("</w15:commentsEx>");
    out
}

/// Comentários de um .docx pelo `w:id`: (id no Nova, comentário). As respostas já vêm com `parent`.
pub(crate) fn read_docx_comments(
    comments_xml: &str,
    extended_xml: Option<&str>,
) -> HashMap<String, (String, Comment)> {
    // w:id → (comentário, paraId do último parágrafo)
    let mut found: Vec<(String, Comment, Option<String>)> = Vec::new();
    let mut reader = Reader::from_str(comments_xml);
    let mut buf = Vec::new();
    let mut current: Option<(String, Comment, Option<String>, bool)> = None; // .., já tem parágrafo
    let mut in_t = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"comment" => {
                    current = attr(&e, b"id").map(|id| {
                        let author = attr(&e, b"author")
                            .filter(|a| !a.trim().is_empty())
                            .unwrap_or_else(|| "Autor".into());
                        let comment = Comment {
                            author: author.chars().take(255).collect(),
                            initials: attr(&e, b"initials")
                                .unwrap_or_default()
                                .chars()
                                .take(9)
                                .collect(),
                            date: attr(&e, b"date").unwrap_or_default(),
                            text: String::new(),
                            done: false,
                            parent: None,
                        };
                        (id, comment, None, false)
                    });
                }
                b"p" => {
                    if let Some(c) = current.as_mut() {
                        if c.3 {
                            c.1.text.push('\u{b}');
                        }
                        c.3 = true;
                        c.2 = attr(&e, b"paraId");
                    }
                }
                b"t" => in_t = true,
                b"tab" => {
                    if let Some(c) = current.as_mut() {
                        c.1.text.push('\t');
                    }
                }
                b"br" => {
                    if let Some(c) = current.as_mut() {
                        c.1.text.push('\u{b}');
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) if in_t => {
                if let Some(c) = current.as_mut() {
                    c.1.text
                        .push_str(&t.unescape().map(|v| v.into_owned()).unwrap_or_default());
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = false,
                b"comment" => {
                    if let Some((id, mut c, para, _)) = current.take() {
                        c.text = c.text.chars().take(MAX_COMMENT_CHARS).collect();
                        c.text = c.text.replace(['\n', '\r'], " ");
                        found.push((id, c, para));
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    // commentsExtended: paraId → (paraId do pai, resolvido)
    let mut ext: HashMap<String, (Option<String>, bool)> = HashMap::new();
    if let Some(xml) = extended_xml {
        let mut reader = Reader::from_str(xml);
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) | Ok(Event::Empty(e))
                    if e.local_name().as_ref() == b"commentEx" =>
                {
                    if let Some(p) = attr(&e, b"paraId") {
                        let done = attr(&e, b"done").is_some_and(|d| d == "1" || d == "true");
                        ext.insert(p, (attr(&e, b"paraIdParent"), done));
                    }
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
            buf.clear();
        }
    }
    let nova_id = |wid: &str| -> String {
        let clean: String = wid
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .take(30)
            .collect();
        format!("c{clean}")
    };
    let by_para: HashMap<String, String> = found
        .iter()
        .filter_map(|(wid, _, p)| p.clone().map(|p| (p, nova_id(wid))))
        .collect();
    found
        .into_iter()
        .map(|(wid, mut c, para)| {
            if let Some((parent, done)) = para.and_then(|p| ext.get(&p).cloned()) {
                c.done = done;
                c.parent = parent.and_then(|p| by_para.get(&p).cloned());
            }
            let id = nova_id(&wid);
            if c.parent.as_deref() == Some(id.as_str()) || c.validate(&id).is_err() {
                c.parent = None;
                c.date = String::new();
            }
            (wid, (id, c))
        })
        .filter(|(_, (id, c))| c.validate(id).is_ok())
        .collect()
}

/// `office:annotation` de um comentário (no início do trecho; respostas logo depois do fim dele).
pub(crate) fn odt_annotation(id: &str, c: &Comment) -> String {
    let mut out = format!(r#"<office:annotation office:name="{id}""#);
    if c.done {
        out.push_str(r#" loext:resolved="true""#);
    }
    if let Some(parent) = &c.parent {
        out.push_str(&format!(r#" loext:parent-name="{parent}""#));
    }
    out.push_str(&format!("><dc:creator>{}</dc:creator>", esc(&c.author)));
    if !c.date.is_empty() {
        out.push_str(&format!(
            "<dc:date>{}</dc:date>",
            esc(c.date.trim_end_matches('Z'))
        ));
    }
    let initials = if c.initials.is_empty() {
        Comment::initials_of(&c.author)
    } else {
        c.initials.clone()
    };
    if !initials.is_empty() {
        out.push_str(&format!(
            "<meta:creator-initials>{}</meta:creator-initials>",
            esc(&initials)
        ));
    }
    for line in c.text.split('\u{b}') {
        out.push_str(&format!("<text:p>{}</text:p>", esc(line)));
    }
    out.push_str("</office:annotation>");
    out
}

/// Data do .odt (`2026-10-30T14:45:00` ou com frações) no formato guardado pelo Nova.
pub(crate) fn odt_date(raw: &str) -> String {
    let d: String = raw.trim().chars().take(19).collect();
    if d.len() == 19 && d.chars().all(|c| c.is_ascii_digit() || "-:T".contains(c)) {
        format!("{d}Z")
    } else {
        String::new()
    }
}

/// Posição no texto lido: (índice do parágrafo, deslocamento em UTF-16).
pub(crate) type Pos = (usize, u32);

/// Comentário de .odt sendo lido (`office:annotation`).
#[derive(Default)]
pub(crate) struct AnnotationRead {
    pub name: String,
    pub parent: Option<String>,
    pub done: bool,
    pub author: String,
    pub date: String,
    pub initials: String,
    pub text: String,
    /// Profundidade dentro do office:annotation.
    pub depth: u32,
    /// Elemento cujo texto está sendo lido: b'c' autor, b'd' data, b'i' iniciais, b'p' texto.
    pub field: u8,
    /// Já leu um parágrafo (os seguintes começam com quebra de linha).
    pub has_para: bool,
    /// Onde o trecho começa no texto.
    pub start: Pos,
}

impl AnnotationRead {
    pub(crate) fn into_comment(self) -> (String, Comment) {
        let author = self.author.trim();
        let c = Comment {
            author: if author.is_empty() {
                "Autor".into()
            } else {
                author.chars().take(255).collect()
            },
            initials: self.initials.trim().chars().take(9).collect(),
            date: odt_date(&self.date),
            text: self
                .text
                .replace(['\n', '\r'], " ")
                .chars()
                .take(MAX_COMMENT_CHARS)
                .collect(),
            done: self.done,
            parent: self.parent,
        };
        (self.name, c)
    }
}

/// Nome de comentário do .odt (`__Annotation__12_345`) como id do Nova (só letras e dígitos).
pub(crate) fn odt_id(name: &str, taken: &mut HashMap<String, String>) -> String {
    if let Some(id) = taken.get(name) {
        return id.clone();
    }
    let clean: String = name.chars().filter(char::is_ascii_alphanumeric).collect();
    let mut id = if clean.is_empty() || clean.len() > 30 {
        format!("a{}", taken.len() + 1)
    } else {
        clean
    };
    while taken.values().any(|v| *v == id) {
        id.push('x');
    }
    taken.insert(name.to_string(), id.clone());
    id
}

/// Põe a marca `comment {id}` nos trechos lidos: (id, início, fim). Um trecho
/// vazio (comentário sem seleção, comum no LibreOffice) marca o caractere
/// seguinte, ou o anterior no fim do parágrafo.
pub(crate) fn apply_ranges(out: &mut [nova_domain_text::Paragraph], ranges: &[(String, Pos, Pos)]) {
    use nova_domain_text::{Mark, Span};
    let len16 = |s: &str| s.encode_utf16().count() as u32;
    for (id, start, end) in ranges {
        let (mut start, mut end) = (*start, *end);
        if start == end {
            let Some(p) = out.get(start.0) else { continue };
            let total: u32 = p.spans.iter().map(|s| len16(&s.text)).sum();
            if total == 0 {
                continue;
            }
            if start.1 < total {
                end.1 = start.1 + 1;
            } else {
                start.1 = total - 1;
                end.1 = total;
            }
        }
        for (index, p) in out.iter_mut().enumerate() {
            if index < start.0 || index > end.0 {
                continue;
            }
            let from = if index == start.0 { start.1 } else { 0 };
            let to = if index == end.0 { end.1 } else { u32::MAX };
            let mut spans: Vec<Span> = Vec::new();
            let mut at = 0u32;
            for span in std::mem::take(&mut p.spans) {
                let units: Vec<u16> = span.text.encode_utf16().collect();
                let n = units.len() as u32;
                let (a, b) = (from.clamp(at, at + n) - at, to.clamp(at, at + n) - at);
                let piece =
                    |x: u32, y: u32| String::from_utf16_lossy(&units[x as usize..y as usize]);
                if a == b {
                    spans.push(span);
                } else {
                    let mut marked = span.marks.clone();
                    marked.retain(|m| !matches!(m, Mark::Comment { .. }));
                    marked.push(Mark::Comment { id: id.clone() });
                    for (x, y, marks) in [
                        (0, a, span.marks.clone()),
                        (a, b, marked),
                        (b, n, span.marks.clone()),
                    ] {
                        if x < y {
                            spans.push(Span {
                                text: piece(x, y),
                                marks,
                            });
                        }
                    }
                }
                at += n;
            }
            p.spans = spans;
        }
    }
}
