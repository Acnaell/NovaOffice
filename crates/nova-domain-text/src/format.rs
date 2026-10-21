//! Formatação: marcas de caractere e estilos de bloco.

use nova_crdt::{AttrValue, Span as CrdtSpan};
use serde::{Deserialize, Serialize};

use crate::DomainError;

/// Formatação de caractere. Valores seguem as unidades do OOXML onde há
/// equivalente (tamanho em meios-pontos, como `w:sz`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mark", rename_all = "camelCase")]
pub enum Mark {
    Bold,
    Italic,
    Underline,
    Strike,
    FontFamily {
        value: String,
    },
    FontSize {
        #[serde(rename = "halfPoints")]
        half_points: u16,
    },
    /// Cor no formato `#RRGGBB`.
    Color {
        value: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkKind {
    Bold,
    Italic,
    Underline,
    Strike,
    FontFamily,
    FontSize,
    Color,
}

impl MarkKind {
    /// Nome do atributo no CRDT. Mudar isto quebra documentos já gravados.
    pub fn key(self) -> &'static str {
        match self {
            MarkKind::Bold => "bold",
            MarkKind::Italic => "italic",
            MarkKind::Underline => "underline",
            MarkKind::Strike => "strike",
            MarkKind::FontFamily => "fontFamily",
            MarkKind::FontSize => "fontSize",
            MarkKind::Color => "color",
        }
    }
}

impl Mark {
    pub fn kind(&self) -> MarkKind {
        match self {
            Mark::Bold => MarkKind::Bold,
            Mark::Italic => MarkKind::Italic,
            Mark::Underline => MarkKind::Underline,
            Mark::Strike => MarkKind::Strike,
            Mark::FontFamily { .. } => MarkKind::FontFamily,
            Mark::FontSize { .. } => MarkKind::FontSize,
            Mark::Color { .. } => MarkKind::Color,
        }
    }

    pub(crate) fn value(&self) -> AttrValue {
        match self {
            Mark::Bold | Mark::Italic | Mark::Underline | Mark::Strike => AttrValue::Bool(true),
            Mark::FontFamily { value } | Mark::Color { value } => AttrValue::Text(value.clone()),
            Mark::FontSize { half_points } => AttrValue::Number(f64::from(*half_points)),
        }
    }

    pub(crate) fn validate(&self) -> Result<(), DomainError> {
        match self {
            Mark::FontFamily { value } if value.trim().is_empty() => {
                Err(DomainError::InvalidMark("fonte sem nome".into()))
            }
            Mark::FontSize { half_points } if !(2..=3276).contains(half_points) => {
                Err(DomainError::InvalidMark(format!(
                    "tamanho {half_points} fora de 2..=3276 meios-pontos"
                )))
            }
            Mark::Color { value } if !is_hex_color(value) => Err(DomainError::InvalidMark(
                format!("cor {value:?} não está no formato #RRGGBB"),
            )),
            _ => Ok(()),
        }
    }

    /// Lê um atributo do CRDT. Atributos desconhecidos (de versões futuras ou
    /// de plugins) são ignorados em vez de falhar.
    fn from_attr(key: &str, value: &AttrValue) -> Option<Mark> {
        match (key, value) {
            ("bold", AttrValue::Bool(true)) => Some(Mark::Bold),
            ("italic", AttrValue::Bool(true)) => Some(Mark::Italic),
            ("underline", AttrValue::Bool(true)) => Some(Mark::Underline),
            ("strike", AttrValue::Bool(true)) => Some(Mark::Strike),
            ("fontFamily", AttrValue::Text(v)) => Some(Mark::FontFamily { value: v.clone() }),
            ("fontSize", AttrValue::Number(n)) if (2.0..=3276.0).contains(n) => {
                Some(Mark::FontSize {
                    half_points: *n as u16,
                })
            }
            ("color", AttrValue::Text(v)) => Some(Mark::Color { value: v.clone() }),
            _ => None,
        }
    }
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Estilo de parágrafo.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockStyle {
    #[default]
    Paragraph,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    Heading5,
    Heading6,
    Quote,
    Code,
}

impl BlockStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            BlockStyle::Paragraph => "paragraph",
            BlockStyle::Heading1 => "heading1",
            BlockStyle::Heading2 => "heading2",
            BlockStyle::Heading3 => "heading3",
            BlockStyle::Heading4 => "heading4",
            BlockStyle::Heading5 => "heading5",
            BlockStyle::Heading6 => "heading6",
            BlockStyle::Quote => "quote",
            BlockStyle::Code => "code",
        }
    }

    /// Estilos desconhecidos viram parágrafo, para abrir documentos de versões futuras.
    pub fn parse(value: &str) -> BlockStyle {
        match value {
            "heading1" => BlockStyle::Heading1,
            "heading2" => BlockStyle::Heading2,
            "heading3" => BlockStyle::Heading3,
            "heading4" => BlockStyle::Heading4,
            "heading5" => BlockStyle::Heading5,
            "heading6" => BlockStyle::Heading6,
            "quote" => BlockStyle::Quote,
            "code" => BlockStyle::Code,
            _ => BlockStyle::Paragraph,
        }
    }

    /// Nível de título (1 a 6), ou `None` se não for título.
    pub fn heading_level(self) -> Option<u8> {
        match self {
            BlockStyle::Heading1 => Some(1),
            BlockStyle::Heading2 => Some(2),
            BlockStyle::Heading3 => Some(3),
            BlockStyle::Heading4 => Some(4),
            BlockStyle::Heading5 => Some(5),
            BlockStyle::Heading6 => Some(6),
            _ => None,
        }
    }

    pub fn is_heading(self) -> bool {
        self.heading_level().is_some()
    }
}

/// Trecho de um parágrafo com a mesma formatação.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub text: String,
    pub marks: Vec<Mark>,
}

impl Span {
    pub fn has(&self, kind: MarkKind) -> bool {
        self.marks.iter().any(|m| m.kind() == kind)
    }
}

impl From<CrdtSpan> for Span {
    fn from(span: CrdtSpan) -> Self {
        Span {
            text: span.text,
            marks: span
                .attrs
                .iter()
                .filter_map(|(key, value)| Mark::from_attr(key, value))
                .collect(),
        }
    }
}
