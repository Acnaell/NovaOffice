//! Legendas, Índice de Ilustrações e Referência Cruzada (Referências → Legendas; ADR 0016).
//!
//! A legenda é um parágrafo com o estilo Legenda: "Figura " + o caractere
//! `SEQ_CHAR` com a marca `seq {label}` + " – descrição". O número da legenda
//! não fica gravado: é a ordem dela entre as do mesmo rótulo (Figura 1, 2, 3…),
//! como o campo SEQ do Word. A referência cruzada é o caractere `XREF_CHAR`
//! com a marca `xref {target, show}`, que aponta para o marcador (`bookmark`)
//! de um parágrafo (uma legenda ou um título). O Índice de Ilustrações são
//! parágrafos comuns marcados com `figureIndex`, como o Sumário.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::format::{is_note_id, Mark, Paragraph};

/// Caractere do número da legenda (uso privado do Unicode, depois do da citação).
pub const SEQ_CHAR: char = '\u{E002}';

/// Caractere da referência cruzada.
pub const XREF_CHAR: char = '\u{E003}';

/// Maior rótulo de legenda, em caracteres.
pub const MAX_LABEL_CHARS: usize = 32;

/// Rótulos que o Nova oferece; o usuário pode criar outros.
pub const CAPTION_LABELS: &[&str] = &["Figura", "Tabela", "Quadro", "Gráfico", "Equação"];

/// Texto de uma referência cujo alvo não existe mais (o mesmo aviso do Word).
pub const MISSING_REF: &str = "Erro! Fonte de referência não encontrada.";

/// Rótulo válido: de 1 a 32 letras, dígitos, espaços ou hífens, sem espaço nas pontas.
pub fn is_caption_label(label: &str) -> bool {
    let n = label.chars().count();
    (1..=MAX_LABEL_CHARS).contains(&n)
        && label.trim() == label
        && label
            .chars()
            .all(|c| c.is_alphanumeric() || c == ' ' || c == '-')
}

/// O que a referência cruzada mostra: o rótulo e o número da legenda ("Figura 3")
/// ou o texto do título, ou a página do alvo ("12").
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RefShow {
    #[default]
    Label,
    Page,
}

impl RefShow {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            RefShow::Label => "label",
            RefShow::Page => "page",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<RefShow> {
        match value {
            "label" => Some(RefShow::Label),
            "page" => Some(RefShow::Page),
            _ => None,
        }
    }
}

/// Valor da marca `xref` no CRDT: `label:<alvo>` ou `page:<alvo>[:<página>]`.
pub(crate) fn encode_xref(target: &str, show: RefShow, page: Option<u16>) -> String {
    match page {
        Some(p) => format!("{}:{target}:{p}", show.as_str()),
        None => format!("{}:{target}", show.as_str()),
    }
}

pub(crate) fn decode_xref(value: &str) -> Option<Mark> {
    let mut parts = value.split(':');
    let show = RefShow::parse(parts.next()?)?;
    let target = parts.next()?.to_string();
    let page = match parts.next() {
        Some(p) => Some(p.parse().ok()?),
        None => None,
    };
    if parts.next().is_some() {
        return None;
    }
    let mark = Mark::CrossRef { target, show, page };
    mark.validate().is_ok().then_some(mark)
}

/// Parágrafo do Índice de Ilustrações de um rótulo: o título ("LISTA DE
/// FIGURAS") ou uma entrada, com a página da última atualização (como no Sumário).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FigureEntry {
    pub label: String,
    #[serde(default)]
    pub title: bool,
    #[serde(default)]
    pub page: u16,
}

impl FigureEntry {
    pub fn is_valid(&self) -> bool {
        is_caption_label(&self.label)
    }

    /// No CRDT: `t:<rótulo>` (título) ou `<página>:<rótulo>`.
    pub(crate) fn encode(&self) -> String {
        if self.title {
            format!("t:{}", self.label)
        } else {
            format!("{}:{}", self.page, self.label)
        }
    }

    pub(crate) fn decode(value: &str) -> Option<FigureEntry> {
        let (head, label) = value.split_once(':')?;
        let entry = FigureEntry {
            label: label.to_string(),
            title: head == "t",
            page: if head == "t" { 0 } else { head.parse().ok()? },
        };
        entry.is_valid().then_some(entry)
    }
}

/// Marcador de parágrafo: o mesmo formato do id de nota.
pub(crate) fn is_bookmark(id: &str) -> bool {
    is_note_id(id)
}

/// Números das legendas e textos dos alvos, calculados a partir dos parágrafos.
#[derive(Debug, Default, Clone)]
pub struct CaptionFields {
    /// Número de cada `SEQ_CHAR`, na ordem do documento.
    pub numbers: Vec<u32>,
    /// Alvo de cada marcador: o texto da referência e o parágrafo.
    pub targets: HashMap<String, (String, usize)>,
}

impl CaptionFields {
    pub fn new(paragraphs: &[Paragraph]) -> CaptionFields {
        let mut counters: HashMap<&str, u32> = HashMap::new();
        let mut out = CaptionFields::default();
        for (index, p) in paragraphs.iter().enumerate() {
            let first = out.numbers.len();
            for span in &p.spans {
                let label = span.marks.iter().find_map(|m| match m {
                    Mark::Seq { label } => Some(label.as_str()),
                    _ => None,
                });
                for ch in span.text.chars() {
                    if ch == SEQ_CHAR {
                        let n = match label {
                            Some(label) => {
                                let n = counters.entry(label).or_default();
                                *n += 1;
                                *n
                            }
                            None => 0,
                        };
                        out.numbers.push(n);
                    }
                }
            }
            let Some(id) = p.attrs.bookmark.as_ref() else {
                continue;
            };
            if out.targets.contains_key(id) {
                continue;
            }
            // Legenda: o texto até o número ("Figura 3"); título: o texto inteiro.
            let mut text = String::new();
            let mut k = first;
            for ch in p.spans.iter().flat_map(|s| s.text.chars()) {
                match ch {
                    SEQ_CHAR => {
                        text.push_str(&out.numbers.get(k).copied().unwrap_or(0).to_string());
                        k += 1;
                        if k == first + 1 {
                            break;
                        }
                    }
                    '\u{b}' | '\t' => text.push(' '),
                    c if is_field_char(c) => {}
                    c => text.push(c),
                }
            }
            out.targets
                .insert(id.clone(), (text.trim().to_string(), index));
        }
        out
    }

    /// Texto de uma referência cruzada: "Figura 3", o título ou a página gravada.
    pub fn xref_text(&self, target: &str, show: RefShow, page: Option<u16>) -> String {
        match (self.targets.get(target), show) {
            (None, _) => MISSING_REF.to_string(),
            (Some((text, _)), RefShow::Label) => text.clone(),
            (Some(_), RefShow::Page) => page.map_or_else(|| "?".into(), |p| p.to_string()),
        }
    }
}

/// Caracteres de uso privado que o Nova usa para chamadas e campos.
fn is_field_char(c: char) -> bool {
    ('\u{E000}'..='\u{E0FF}').contains(&c)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::{BlockStyle, ParaAttrs, Span};

    fn caption(label: &str, text: &str, bookmark: Option<&str>) -> Paragraph {
        Paragraph {
            style: BlockStyle::Caption,
            attrs: ParaAttrs {
                bookmark: bookmark.map(str::to_string),
                ..ParaAttrs::default()
            },
            spans: vec![
                Span {
                    text: format!("{label} "),
                    marks: vec![],
                },
                Span {
                    text: SEQ_CHAR.to_string(),
                    marks: vec![Mark::Seq {
                        label: label.into(),
                    }],
                },
                Span {
                    text: format!(" – {text}"),
                    marks: vec![],
                },
            ],
        }
    }

    #[test]
    fn numera_por_rotulo_e_acha_o_alvo() {
        let ps = vec![
            caption("Figura", "Mapa", None),
            caption("Tabela", "Dados", Some("t1")),
            caption("Figura", "Gráfico", Some("f2")),
        ];
        let f = CaptionFields::new(&ps);
        assert_eq!(f.numbers, vec![1, 1, 2]);
        assert_eq!(f.xref_text("f2", RefShow::Label, None), "Figura 2");
        assert_eq!(f.xref_text("t1", RefShow::Label, None), "Tabela 1");
        assert_eq!(f.xref_text("t1", RefShow::Page, Some(4)), "4");
        assert_eq!(f.xref_text("zz", RefShow::Label, None), MISSING_REF);
    }

    #[test]
    fn rotulos_e_entradas() {
        assert!(is_caption_label("Figura"));
        assert!(is_caption_label("Mapa de Risco"));
        assert!(!is_caption_label(" Figura"));
        assert!(!is_caption_label("a:b"));
        assert!(!is_caption_label(""));
        let e = FigureEntry {
            label: "Figura".into(),
            title: false,
            page: 12,
        };
        assert_eq!(FigureEntry::decode(&e.encode()), Some(e));
        assert_eq!(
            decode_xref("page:f2:7"),
            Some(Mark::CrossRef {
                target: "f2".into(),
                show: RefShow::Page,
                page: Some(7)
            })
        );
        assert_eq!(decode_xref("label:f-2"), None);
    }
}
