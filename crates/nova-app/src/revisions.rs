//! Alterações controladas nos arquivos (ADR 0015).
//!
//! - .docx: `w:ins` e `w:del` (com `w:delText`) em volta das execuções;
//!   `w:trackRevisions` nas configurações liga o controle.
//! - .odt: as regiões (`text:changed-region`) ficam em `text:tracked-changes`, no
//!   começo do texto. Inserções vão entre `text:change-start` e `text:change-end`;
//!   o texto excluído fica só na região, com um `text:change` no lugar.

use std::collections::HashMap;

use nova_domain_text::{Mark, Paragraph, Span};
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::comments::Pos;
use crate::docx::attr;

/// Região de alteração de um .odt.
#[derive(Debug, Default)]
pub(crate) struct Region {
    pub insert: bool,
    pub author: String,
    pub date: String,
    /// Texto excluído (para as exclusões).
    pub text: String,
}

impl Region {
    pub(crate) fn mark(&self) -> Mark {
        let author: String = self
            .author
            .replace(['|', '\n', '\r'], " ")
            .trim()
            .chars()
            .take(255)
            .collect();
        let author = if author.is_empty() {
            "Autor".to_string()
        } else {
            author
        };
        let date = crate::comments::odt_date(&self.date);
        if self.insert {
            Mark::Insert { author, date }
        } else {
            Mark::Delete { author, date }
        }
    }
}

/// `text:tracked-changes` de um content.xml: se o controle está ligado e as regiões pelo id.
/// Mudanças só de formatação ficam de fora.
pub(crate) fn odt_regions(xml: &str) -> (bool, HashMap<String, Region>) {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut tracking = false;
    let mut regions = HashMap::new();
    let (mut inside, mut field) = (false, 0u8);
    let mut current: Option<(String, Region, bool)> = None; // id, região, é texto/inserção válida
    let mut paras = 0;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"tracked-changes" => {
                    inside = true;
                    // No ODF, text:track-changes vale "true" quando não aparece.
                    tracking = attr(&e, b"track-changes").as_deref() != Some("false");
                }
                b"changed-region" if inside => {
                    let id = attr(&e, b"id").unwrap_or_default();
                    current = Some((id, Region::default(), false));
                    paras = 0;
                }
                b"insertion" | b"deletion" if inside => {
                    if let Some(c) = current.as_mut() {
                        c.1.insert = e.local_name().as_ref() == b"insertion";
                        c.2 = true;
                    }
                }
                b"creator" if inside => field = b'c',
                b"date" if inside => field = b'd',
                b"p" | b"h" if inside => {
                    if let Some(c) = current.as_mut() {
                        if paras > 0 && !c.1.text.is_empty() {
                            c.1.text.push(' ');
                        }
                        paras += 1;
                    }
                    field = b'p';
                }
                b"tab" if inside && field == b'p' => {
                    if let Some(c) = current.as_mut() {
                        c.1.text.push('\t');
                    }
                }
                b"s" if inside && field == b'p' => {
                    if let Some(c) = current.as_mut() {
                        let n: usize = attr(&e, b"c").and_then(|v| v.parse().ok()).unwrap_or(1);
                        c.1.text.push_str(&" ".repeat(n.min(100)));
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) if inside && field != 0 => {
                let raw = t.unescape().map(|v| v.into_owned()).unwrap_or_default();
                if let Some(c) = current.as_mut() {
                    match field {
                        b'c' => c.1.author.push_str(&raw),
                        b'd' => c.1.date.push_str(&raw),
                        _ => c.1.text.push_str(&raw.replace(['\n', '\r'], " ")),
                    }
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"tracked-changes" => return (tracking, regions),
                b"changed-region" if inside => {
                    if let Some((id, region, valid)) = current.take() {
                        if valid && !id.is_empty() {
                            regions.insert(id, region);
                        }
                    }
                }
                b"creator" | b"date" => field = 0,
                b"p" | b"h" if inside => field = 0,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    (tracking, regions)
}

/// Põe as marcas nos trechos lidos: (marca, início, fim), com posições em
/// (parágrafo, UTF-16). Uma marca do mesmo tipo que já estava no trecho é trocada.
pub(crate) fn mark_ranges(out: &mut [Paragraph], ranges: &[(Mark, Pos, Pos)]) {
    for (mark, start, end) in ranges {
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
                if a == b {
                    spans.push(span);
                } else {
                    let piece =
                        |x: u32, y: u32| String::from_utf16_lossy(&units[x as usize..y as usize]);
                    let mut marked = span.marks.clone();
                    marked.retain(|m| m.kind() != mark.kind());
                    marked.push(mark.clone());
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
