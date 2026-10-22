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
    /// Realce (marca-texto), com os nomes de cor do OOXML (`w:highlight`).
    Highlight {
        value: String,
    },
    /// `superscript` ou `subscript` (`w:vertAlign`); os dois se excluem.
    VertAlign {
        value: String,
    },
}

/// Cores de realce aceitas, as mesmas do Word.
pub const HIGHLIGHT_COLORS: &[&str] = &[
    "yellow",
    "green",
    "cyan",
    "magenta",
    "blue",
    "red",
    "darkBlue",
    "darkCyan",
    "darkGreen",
    "darkMagenta",
    "darkRed",
    "darkYellow",
    "darkGray",
    "lightGray",
    "black",
];

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
    Highlight,
    VertAlign,
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
            MarkKind::Highlight => "highlight",
            MarkKind::VertAlign => "vertAlign",
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
            Mark::Highlight { .. } => MarkKind::Highlight,
            Mark::VertAlign { .. } => MarkKind::VertAlign,
        }
    }

    pub(crate) fn value(&self) -> AttrValue {
        match self {
            Mark::Bold | Mark::Italic | Mark::Underline | Mark::Strike => AttrValue::Bool(true),
            Mark::FontFamily { value }
            | Mark::Color { value }
            | Mark::Highlight { value }
            | Mark::VertAlign { value } => AttrValue::Text(value.clone()),
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
            Mark::Highlight { value } if !HIGHLIGHT_COLORS.contains(&value.as_str()) => Err(
                DomainError::InvalidMark(format!("cor de realce {value:?} desconhecida")),
            ),
            Mark::VertAlign { value } if value != "superscript" && value != "subscript" => {
                Err(DomainError::InvalidMark(format!(
                    "vertAlign {value:?}: use superscript ou subscript"
                )))
            }
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
            ("highlight", AttrValue::Text(v)) => Some(Mark::Highlight { value: v.clone() }),
            ("vertAlign", AttrValue::Text(v)) => Some(Mark::VertAlign { value: v.clone() }),
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

/// Alinhamento de parágrafo.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
    Justify,
}

impl Align {
    fn as_str(self) -> &'static str {
        match self {
            Align::Left => "left",
            Align::Center => "center",
            Align::Right => "right",
            Align::Justify => "justify",
        }
    }

    fn parse(value: &str) -> Align {
        match value {
            "center" => Align::Center,
            "right" => Align::Right,
            "justify" => Align::Justify,
            _ => Align::Left,
        }
    }
}

/// Tipo de lista do parágrafo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ListKind {
    Bullet,
    Number,
}

impl ListKind {
    fn as_str(self) -> &'static str {
        match self {
            ListKind::Bullet => "bullet",
            ListKind::Number => "number",
        }
    }
}

/// Maior nível de recuo (cada nível equivale a 1,27 cm, o padrão do Word).
pub const MAX_INDENT: u8 = 8;

/// Atributos de parágrafo além do estilo. `None` nos espaçamentos significa
/// "o padrão do estilo".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParaAttrs {
    pub align: Align,
    /// Nível de recuo à esquerda, 0 a `MAX_INDENT`; numa lista, é o nível do item.
    pub indent: u8,
    /// Entrelinhas em porcentagem do simples (100 = simples, 150 = 1,5).
    pub line_spacing: Option<u16>,
    /// Espaço antes e depois do parágrafo, em pontos.
    pub space_before: Option<u16>,
    pub space_after: Option<u16>,
    pub list: Option<ListKind>,
}

/// Um atributo de parágrafo a mudar. No JSON: `"attr": "align", "value": "center"`;
/// `null` volta ao padrão.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "attr", content = "value", rename_all = "camelCase")]
pub enum ParaAttr {
    Align(Align),
    Indent(u8),
    LineSpacing(Option<u16>),
    SpaceBefore(Option<u16>),
    SpaceAfter(Option<u16>),
    List(Option<ListKind>),
}

impl ParaAttr {
    pub(crate) fn validate(&self) -> Result<(), DomainError> {
        let invalid = |msg: String| Err(DomainError::InvalidAttr(msg));
        match self {
            ParaAttr::Indent(level) if *level > MAX_INDENT => {
                invalid(format!("recuo {level} acima do máximo {MAX_INDENT}"))
            }
            ParaAttr::LineSpacing(Some(p)) if !(50..=500).contains(p) => {
                invalid(format!("entrelinhas {p}% fora de 50..=500"))
            }
            ParaAttr::SpaceBefore(Some(pt)) | ParaAttr::SpaceAfter(Some(pt)) if *pt > 1584 => {
                invalid(format!("espaçamento {pt} pt acima de 1584"))
            }
            _ => Ok(()),
        }
    }

    /// Chave e valor no CRDT; `None` remove a chave (valor padrão).
    pub(crate) fn to_change(&self) -> (String, Option<AttrValue>) {
        let num = |n: u16| AttrValue::Number(f64::from(n));
        let (key, value) = match self {
            ParaAttr::Align(Align::Left) => ("align", None),
            ParaAttr::Align(a) => ("align", Some(AttrValue::Text(a.as_str().into()))),
            ParaAttr::Indent(0) => ("indent", None),
            ParaAttr::Indent(n) => ("indent", Some(AttrValue::Number(f64::from(*n)))),
            ParaAttr::LineSpacing(v) => ("lineSpacing", v.map(num)),
            ParaAttr::SpaceBefore(v) => ("spaceBefore", v.map(num)),
            ParaAttr::SpaceAfter(v) => ("spaceAfter", v.map(num)),
            ParaAttr::List(v) => ("list", v.map(|k| AttrValue::Text(k.as_str().into()))),
        };
        (key.to_string(), value)
    }
}

impl ParaAttrs {
    /// Lê os atributos do CRDT; valores inválidos ou desconhecidos viram o padrão.
    pub(crate) fn from_attr_map(map: &nova_crdt::AttrMap) -> ParaAttrs {
        let number = |key: &str| match map.get(key) {
            Some(AttrValue::Number(n)) if *n >= 0.0 && *n <= f64::from(u16::MAX) => Some(*n as u16),
            _ => None,
        };
        ParaAttrs {
            align: match map.get("align") {
                Some(AttrValue::Text(v)) => Align::parse(v),
                _ => Align::Left,
            },
            indent: number("indent").map_or(0, |n| n.min(u16::from(MAX_INDENT)) as u8),
            line_spacing: number("lineSpacing"),
            space_before: number("spaceBefore"),
            space_after: number("spaceAfter"),
            list: match map.get("list") {
                Some(AttrValue::Text(v)) if v == "bullet" => Some(ListKind::Bullet),
                Some(AttrValue::Text(v)) if v == "number" => Some(ListKind::Number),
                _ => None,
            },
        }
    }
}
