//! Aba Design: borda da página e marca d'água. A cor da página fica em
//! `PageSetup::background`, junto do papel e das margens.

use nova_crdt::{AttrMap, AttrValue};
use serde::{Deserialize, Serialize};

use crate::{is_hex_color, DomainError};

/// Traço da borda da página, como em Design › Bordas da Página no Word.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BorderStyle {
    /// Caixa: linha simples.
    #[default]
    Single,
    /// Sombra: linha simples com sombra embaixo e à direita.
    Shadow,
    /// Linha dupla.
    Double,
}

impl BorderStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            BorderStyle::Single => "single",
            BorderStyle::Shadow => "shadow",
            BorderStyle::Double => "double",
        }
    }

    pub fn parse(value: &str) -> Option<BorderStyle> {
        Some(match value {
            "single" => BorderStyle::Single,
            "shadow" => BorderStyle::Shadow,
            "double" => BorderStyle::Double,
            _ => return None,
        })
    }
}

/// Espessuras da lista do Word, em oitavos de ponto (`w:sz` do `w:pgBorders`):
/// ¼, ½, ¾, 1, 1½, 2¼, 3, 4½ e 6 pt.
pub const BORDER_WIDTHS: [u8; 9] = [2, 4, 6, 8, 12, 18, 24, 36, 48];

/// Borda nos quatro lados da página, a 24 pt da borda do papel (o padrão do Word).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBorder {
    pub style: BorderStyle,
    /// `#RRGGBB`.
    pub color: String,
    /// Espessura em oitavos de ponto, de 2 (¼ pt) a 48 (6 pt).
    pub width: u8,
}

impl Default for PageBorder {
    fn default() -> Self {
        PageBorder {
            style: BorderStyle::Single,
            color: "#000000".into(),
            width: 4,
        }
    }
}

impl PageBorder {
    pub fn validate(&self) -> Result<(), DomainError> {
        if is_hex_color(&self.color) && (2..=48).contains(&self.width) {
            Ok(())
        } else {
            Err(DomainError::InvalidAttr(format!(
                "borda da página {self:?}: cor #RRGGBB e espessura de 2 a 48 oitavos de ponto"
            )))
        }
    }

    pub(crate) fn to_settings(border: Option<&PageBorder>) -> Vec<(String, Option<AttrValue>)> {
        vec![
            (
                "pageBorder".into(),
                border.map(|b| AttrValue::Text(b.style.as_str().into())),
            ),
            (
                "pageBorderColor".into(),
                border.map(|b| AttrValue::Text(b.color.clone())),
            ),
            (
                "pageBorderWidth".into(),
                border.map(|b| AttrValue::Number(f64::from(b.width))),
            ),
        ]
    }

    pub(crate) fn from_settings(map: &AttrMap) -> Option<PageBorder> {
        let style = match map.get("pageBorder") {
            Some(AttrValue::Text(v)) => BorderStyle::parse(v)?,
            _ => return None,
        };
        let d = PageBorder::default();
        let border = PageBorder {
            style,
            color: match map.get("pageBorderColor") {
                Some(AttrValue::Text(v)) => v.clone(),
                _ => d.color,
            },
            width: match map.get("pageBorderWidth") {
                Some(AttrValue::Number(n)) if (2.0..=48.0).contains(n) => *n as u8,
                _ => d.width,
            },
        };
        border.validate().ok().map(|_| border)
    }
}

/// Disposição da marca d'água.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WatermarkLayout {
    /// De baixo à esquerda para cima à direita (45°), o padrão do Word.
    #[default]
    Diagonal,
    Horizontal,
}

impl WatermarkLayout {
    pub fn as_str(self) -> &'static str {
        match self {
            WatermarkLayout::Diagonal => "diagonal",
            WatermarkLayout::Horizontal => "horizontal",
        }
    }
}

/// Marca d'água de texto atrás do conteúdo de cada página (Design › Marca
/// d'Água no Word): "CONFIDENCIAL", "RASCUNHO" ou um texto qualquer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watermark {
    pub text: String,
    /// `#RRGGBB`; o Word usa prata (`#C0C0C0`).
    pub color: String,
    /// "Semitransparente" no Word: 50% de opacidade.
    pub semitransparent: bool,
    pub layout: WatermarkLayout,
}

impl Default for Watermark {
    fn default() -> Self {
        Watermark {
            text: "CONFIDENCIAL".into(),
            color: "#C0C0C0".into(),
            semitransparent: true,
            layout: WatermarkLayout::Diagonal,
        }
    }
}

/// Maior texto de marca d'água, em caracteres.
pub const MAX_WATERMARK_CHARS: usize = 200;

impl Watermark {
    pub fn validate(&self) -> Result<(), DomainError> {
        let len = self.text.trim().chars().count();
        if (1..=MAX_WATERMARK_CHARS).contains(&len)
            && !self.text.chars().any(char::is_control)
            && is_hex_color(&self.color)
        {
            Ok(())
        } else {
            Err(DomainError::InvalidAttr(format!(
                "marca d'água {self:?}: texto de 1 a {MAX_WATERMARK_CHARS} caracteres numa linha e cor #RRGGBB"
            )))
        }
    }

    pub(crate) fn to_settings(value: Option<&Watermark>) -> Vec<(String, Option<AttrValue>)> {
        vec![
            (
                "watermarkText".into(),
                value.map(|w| AttrValue::Text(w.text.clone())),
            ),
            (
                "watermarkColor".into(),
                value.map(|w| AttrValue::Text(w.color.clone())),
            ),
            (
                "watermarkSemitransparent".into(),
                value.map(|w| AttrValue::Bool(w.semitransparent)),
            ),
            (
                "watermarkLayout".into(),
                value.map(|w| AttrValue::Text(w.layout.as_str().into())),
            ),
        ]
    }

    pub(crate) fn from_settings(map: &AttrMap) -> Option<Watermark> {
        let text = match map.get("watermarkText") {
            Some(AttrValue::Text(v)) => v.clone(),
            _ => return None,
        };
        let d = Watermark::default();
        let value = Watermark {
            text,
            color: match map.get("watermarkColor") {
                Some(AttrValue::Text(v)) => v.clone(),
                _ => d.color,
            },
            semitransparent: !matches!(
                map.get("watermarkSemitransparent"),
                Some(AttrValue::Bool(false))
            ),
            layout: match map.get("watermarkLayout") {
                Some(AttrValue::Text(v)) if v == "horizontal" => WatermarkLayout::Horizontal,
                _ => WatermarkLayout::Diagonal,
            },
        };
        value.validate().ok().map(|_| value)
    }
}

#[cfg(test)]
mod tests {
    use crate::{PageSetup, TextCommand, TextDocument, TextEvent};

    use super::*;

    #[test]
    fn cor_e_borda_da_pagina_com_desfazer() {
        let mut doc = TextDocument::new(1);
        let page = PageSetup {
            background: Some("#FFF2CC".into()),
            border: Some(PageBorder {
                style: BorderStyle::Double,
                color: "#2F5496".into(),
                width: 12,
            }),
            ..PageSetup::default()
        };
        doc.execute(TextCommand::SetPage { page: page.clone() })
            .unwrap();
        assert_eq!(doc.page_setup(), page);
        // O estado vai junto para outra réplica (.nova, coedição).
        let copy = TextDocument::load(2, &doc.save()).unwrap();
        assert_eq!(copy.page_setup(), page);
        doc.execute(TextCommand::Undo).unwrap();
        assert_eq!(doc.page_setup(), PageSetup::default());
        doc.execute(TextCommand::Redo).unwrap();
        assert_eq!(doc.page_setup(), page);
        // Sem Cor e sem borda apagam as chaves.
        doc.execute(TextCommand::SetPage {
            page: PageSetup::default(),
        })
        .unwrap();
        assert_eq!(doc.page_setup(), PageSetup::default());
    }

    #[test]
    fn cor_e_borda_invalidas() {
        let mut doc = TextDocument::new(1);
        for page in [
            PageSetup {
                background: Some("amarelo".into()),
                ..PageSetup::default()
            },
            PageSetup {
                background: Some("#FFF".into()),
                ..PageSetup::default()
            },
            PageSetup {
                border: Some(PageBorder {
                    width: 200,
                    ..PageBorder::default()
                }),
                ..PageSetup::default()
            },
        ] {
            assert!(doc.execute(TextCommand::SetPage { page }).is_err());
        }
        assert_eq!(doc.page_setup(), PageSetup::default());
    }

    #[test]
    fn pagina_em_json_sem_os_campos_novos() {
        let mut doc = TextDocument::new(1);
        let json = r##"{"type":"page.set","page":{"width":11906,"height":16838,"marginTop":1417,"marginBottom":1417,"marginLeft":1417,"marginRight":1417,"background":"#DDEBF7","border":{"style":"shadow","color":"#000000","width":4}}}"##;
        doc.execute(serde_json::from_str(json).unwrap()).unwrap();
        let page = doc.page_setup();
        assert_eq!(page.background.as_deref(), Some("#DDEBF7"));
        assert_eq!(page.border.unwrap().style, BorderStyle::Shadow);
        // Comandos antigos (aba Layout, agentes) continuam valendo e tiram a cor.
        let json = r#"{"type":"page.set","page":{"width":11906,"height":16838,"marginTop":1417,"marginBottom":1417,"marginLeft":1417,"marginRight":1417}}"#;
        doc.execute(serde_json::from_str(json).unwrap()).unwrap();
        assert_eq!(doc.page_setup().background, None);
        let out = serde_json::to_string(&PageSetup::default()).unwrap();
        assert!(
            !out.contains("background") && !out.contains("border"),
            "{out}"
        );
    }

    #[test]
    fn marca_dagua_com_desfazer() {
        let mut doc = TextDocument::new(1);
        assert_eq!(doc.watermark(), None);
        let value = Watermark {
            text: "NÃO COPIE".into(),
            color: "#FF0000".into(),
            semitransparent: false,
            layout: WatermarkLayout::Horizontal,
        };
        let events = doc
            .execute(TextCommand::SetWatermark {
                value: Some(value.clone()),
            })
            .unwrap();
        assert_eq!(
            events,
            vec![TextEvent::WatermarkSet {
                value: Some(value.clone())
            }]
        );
        assert_eq!(doc.watermark(), Some(value.clone()));
        assert_eq!(
            TextDocument::load(2, &doc.save()).unwrap().watermark(),
            Some(value.clone())
        );
        doc.execute(TextCommand::SetWatermark { value: None })
            .unwrap();
        assert_eq!(doc.watermark(), None);
        doc.execute(TextCommand::Undo).unwrap();
        assert_eq!(doc.watermark(), Some(value));
        doc.execute(TextCommand::Undo).unwrap();
        assert_eq!(doc.watermark(), None);
    }

    #[test]
    fn marca_dagua_invalida_e_json() {
        let mut doc = TextDocument::new(1);
        for text in [
            "",
            "   ",
            "duas\nlinhas",
            &"x".repeat(MAX_WATERMARK_CHARS + 1),
        ] {
            let value = Watermark {
                text: text.into(),
                ..Watermark::default()
            };
            assert!(doc
                .execute(TextCommand::SetWatermark { value: Some(value) })
                .is_err());
        }
        let json = r##"{"type":"watermark.set","value":{"text":"RASCUNHO","color":"#C0C0C0","semitransparent":true,"layout":"diagonal"}}"##;
        doc.execute(serde_json::from_str(json).unwrap()).unwrap();
        assert_eq!(doc.watermark().unwrap().text, "RASCUNHO");
        doc.execute(serde_json::from_str(r#"{"type":"watermark.set","value":null}"#).unwrap())
            .unwrap();
        assert_eq!(doc.watermark(), None);
    }

    #[test]
    fn abrir_com_marca_dagua_nao_entra_no_desfazer() {
        let mut doc = TextDocument::new(1);
        doc.load_watermark(Watermark::default()).unwrap();
        assert!(!doc.can_undo());
        assert_eq!(doc.watermark(), Some(Watermark::default()));
    }
}
