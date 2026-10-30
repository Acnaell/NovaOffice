//! Aba Design no .docx e no .odt: cor da página, bordas da página e marca d'água.
//!
//! No Word, a cor é o `w:background` do documento (com `w:displayBackgroundShape`
//! no settings.xml), a borda é o `w:pgBorders` do `w:sectPr` e a marca d'água é
//! uma forma VML com `v:textpath` no cabeçalho. No LibreOffice, cor e borda ficam
//! no `style:page-layout-properties` e a marca d'água é um `draw:custom-shape`
//! fontwork no cabeçalho do estilo de página.

use nova_domain_text::{
    BorderStyle, PageBorder, PageSetup, Watermark, WatermarkLayout, MAX_WATERMARK_CHARS,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

/// Distância da borda à beira do papel: 24 pt, o padrão do Word ("Medida a partir da borda da página").
pub const BORDER_SPACE_PT: u32 = 24;

/// Nome que o Word e o LibreOffice dão à forma da marca d'água (e procuram ao abrir).
const WATERMARK_NAME: &str = "PowerPlusWaterMarkObject";

fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == key)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

fn esc(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Cor `#RRGGBB` de um valor de VML/ODF/OOXML: `#rgb`, `#rrggbb`, `RRGGBB` ou um nome comum.
pub fn parse_color(value: &str) -> Option<String> {
    let v = value.trim();
    // O VML às vezes acrescenta o índice da paleta: "#c0c0c0 [3212]".
    let v = v.split_whitespace().next().unwrap_or("");
    let hex = v.strip_prefix('#').unwrap_or(v);
    let named = match v.to_ascii_lowercase().as_str() {
        "black" => Some("000000"),
        "white" => Some("FFFFFF"),
        "silver" => Some("C0C0C0"),
        "gray" | "grey" => Some("808080"),
        "red" => Some("FF0000"),
        "maroon" => Some("800000"),
        "yellow" => Some("FFFF00"),
        "olive" => Some("808000"),
        "lime" => Some("00FF00"),
        "green" => Some("008000"),
        "aqua" | "cyan" => Some("00FFFF"),
        "teal" => Some("008080"),
        "blue" => Some("0000FF"),
        "navy" => Some("000080"),
        "fuchsia" | "magenta" => Some("FF00FF"),
        "purple" => Some("800080"),
        _ => None,
    };
    if let Some(n) = named {
        return Some(format!("#{n}"));
    }
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        6 => Some(format!("#{}", hex.to_ascii_uppercase())),
        3 => Some(format!(
            "#{}",
            hex.chars()
                .flat_map(|c| [c, c])
                .collect::<String>()
                .to_ascii_uppercase()
        )),
        _ => None,
    }
}

/// Tamanho da caixa da marca d'água em pontos. O texto estica até a caixa
/// (`fitshape`), então a proporção da caixa dá a das letras: cerca de 0,55 da
/// altura por caractere. Na diagonal, a caixa ocupa ~65% da diagonal da área de texto.
pub fn watermark_size(w: &Watermark, page: &PageSetup) -> (f64, f64) {
    let text_w = f64::from(
        page.width
            .saturating_sub(page.margin_left + page.margin_right),
    ) / 20.0;
    let text_h = f64::from(
        page.height
            .saturating_sub(page.margin_top + page.margin_bottom),
    ) / 20.0;
    let chars = w.text.chars().count().clamp(1, MAX_WATERMARK_CHARS) as f64;
    let width = match w.layout {
        WatermarkLayout::Diagonal => (text_w.hypot(text_h) * 0.65).min(text_h),
        WatermarkLayout::Horizontal => text_w,
    };
    let height = (width / (chars * 0.55)).min(width / 2.0).min(text_h / 3.0);
    (
        (width * 100.0).round() / 100.0,
        (height * 100.0).round() / 100.0,
    )
}

// ---------------------------------------------------------------- .docx

/// `w:background` (filho de `w:document`, antes de `w:body`).
pub fn docx_background(color: &str) -> String {
    format!(
        r#"<w:background w:color="{}"/>"#,
        color.trim_start_matches('#')
    )
}

/// settings.xml mínimo para o Word mostrar a cor da página.
pub const DOCX_SETTINGS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:displayBackgroundShape/></w:settings>"#;

/// `w:pgBorders` nos quatro lados, a 24 pt da beira do papel.
pub fn docx_page_borders(border: &PageBorder) -> String {
    let val = match border.style {
        BorderStyle::Double => "double",
        BorderStyle::Single | BorderStyle::Shadow => "single",
    };
    let shadow = if border.style == BorderStyle::Shadow {
        r#" w:shadow="1""#
    } else {
        ""
    };
    let color = border.color.trim_start_matches('#');
    let mut out = String::from(r#"<w:pgBorders w:offsetFrom="page">"#);
    for side in ["top", "left", "bottom", "right"] {
        out.push_str(&format!(
            r#"<w:{side} w:val="{val}" w:sz="{}" w:space="{BORDER_SPACE_PT}" w:color="{color}"{shadow}/>"#,
            border.width
        ));
    }
    out.push_str("</w:pgBorders>");
    out
}

/// Borda lida de um `w:top`/`w:left`… do `w:pgBorders`; `None` se não há linha.
pub fn docx_read_border(e: &BytesStart) -> Option<PageBorder> {
    let val = attr(e, b"val")?;
    let style = match val.as_str() {
        "nil" | "none" => return None,
        "double"
        | "thinThickSmallGap"
        | "thickThinSmallGap"
        | "thinThickThinSmallGap"
        | "triple" => BorderStyle::Double,
        _ if matches!(attr(e, b"shadow").as_deref(), Some("1" | "true" | "on")) => {
            BorderStyle::Shadow
        }
        _ => BorderStyle::Single,
    };
    let width = attr(e, b"sz")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(4)
        .clamp(2, 48) as u8;
    let color = attr(e, b"color")
        .and_then(|c| parse_color(&c))
        .unwrap_or_else(|| "#000000".into());
    Some(PageBorder {
        style,
        color,
        width,
    })
}

/// Espaço de nomes do VML, para o `w:hdr` que leva a marca d'água.
pub const VML_NAMESPACES: &str = r#" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word""#;

/// A marca d'água como o Word grava: um `w:r` com `w:pict`, o tipo de forma
/// 136 (texto WordArt) e a forma centralizada na margem, atrás do texto.
pub fn docx_watermark(w: &Watermark, page: &PageSetup, id: u32) -> String {
    let (width, height) = watermark_size(w, page);
    let rotation = match w.layout {
        WatermarkLayout::Diagonal => "rotation:315;",
        WatermarkLayout::Horizontal => "",
    };
    let opacity = if w.semitransparent {
        r#"<v:fill opacity=".5"/>"#
    } else {
        ""
    };
    format!(
        concat!(
            r#"<w:r><w:rPr><w:noProof/></w:rPr><w:pict>"#,
            r#"<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e">"#,
            r#"<v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas>"#,
            r#"<v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/>"#,
            r##"<v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>"##,
            r##"<v:shape id="{name}{id}" o:spid="_x0000_s{spid}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:{width}pt;height:{height}pt;{rotation}z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="{color}" stroked="f">"##,
            r#"{opacity}<v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="{text}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>"#
        ),
        name = WATERMARK_NAME,
        id = id,
        spid = 2049 + id,
        width = width,
        height = height,
        rotation = rotation,
        color = w.color.to_ascii_lowercase(),
        opacity = opacity,
        text = esc(&w.text),
    )
}

/// Marca d'água de um cabeçalho do Word: a primeira forma VML com `v:textpath`.
/// O `v:fill` pode vir antes ou depois do texto (o LibreOffice grava depois).
pub fn docx_read_watermark(xml: &str) -> Option<Watermark> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    // Forma aberta: cor, estilo (rotação), semitransparente e texto.
    let mut shape: Option<(Option<String>, String, bool, Option<String>)> = None;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"shape" => {
                    let filled = attr(&e, b"filled").as_deref() != Some("f");
                    let color = filled
                        .then(|| attr(&e, b"fillcolor"))
                        .flatten()
                        .and_then(|c| parse_color(&c));
                    shape = Some((color, attr(&e, b"style").unwrap_or_default(), false, None));
                }
                b"fill" => {
                    if let Some(s) = shape.as_mut() {
                        let opacity = attr(&e, b"opacity")
                            .and_then(|v| parse_opacity(&v))
                            .unwrap_or(1.0);
                        s.2 = opacity < 0.95;
                    }
                }
                b"textpath" => {
                    if let Some(s) = shape.as_mut() {
                        s.3 = attr(&e, b"string").or(s.3.take());
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) if e.local_name().as_ref() == b"shape" => {
                if let Some((color, style, semitransparent, Some(text))) = shape.take() {
                    let rotation = style
                        .split(';')
                        .filter_map(|p| p.split_once(':'))
                        .find(|(k, _)| k.trim() == "rotation")
                        .and_then(|(_, v)| v.trim().trim_end_matches("fd").parse::<f64>().ok())
                        .unwrap_or(0.0);
                    let value = Watermark {
                        text: text
                            .chars()
                            .filter(|c| !c.is_control())
                            .take(MAX_WATERMARK_CHARS)
                            .collect(),
                        color: color.unwrap_or_else(|| "#C0C0C0".into()),
                        semitransparent,
                        layout: if rotation.rem_euclid(180.0) < 1.0 {
                            WatermarkLayout::Horizontal
                        } else {
                            WatermarkLayout::Diagonal
                        },
                    };
                    if value.validate().is_ok() {
                        return Some(value);
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

/// Opacidade do VML: ".5", "50%" ou "32768f" (frações de 65536).
fn parse_opacity(v: &str) -> Option<f64> {
    let v = v.trim();
    if let Some(p) = v.strip_suffix('%') {
        return p.parse::<f64>().ok().map(|n| n / 100.0);
    }
    if let Some(f) = v.strip_suffix('f') {
        return f.parse::<f64>().ok().map(|n| n / 65536.0);
    }
    v.parse().ok()
}

// ---------------------------------------------------------------- .odt

fn cm(twips: u32) -> String {
    format!("{:.3}cm", f64::from(twips) / 1440.0 * 2.54)
}

/// Atributos de cor e borda do `style:page-layout-properties` e as margens a
/// gravar. No LibreOffice a borda fica na margem e o texto começa depois do
/// enchimento (`fo:padding`); para a borda ficar a 24 pt do papel, como no Word,
/// a margem vira 24 pt e o resto vai para o enchimento. A área de texto não muda.
pub fn odt_page_props(page: &PageSetup) -> (String, [u32; 4]) {
    let mut props = String::new();
    let mut margins = [
        page.margin_top,
        page.margin_bottom,
        page.margin_left,
        page.margin_right,
    ];
    if let Some(color) = &page.background {
        let c = color.to_ascii_lowercase();
        props.push_str(&format!(
            r#" fo:background-color="{c}" draw:fill="solid" draw:fill-color="{c}""#
        ));
    }
    if let Some(border) = &page.border {
        // Espessura em twips (1 pt = 20 twips; a largura do Word é em oitavos de ponto).
        let line = u32::from(border.width) * 20 / 8;
        let total = if border.style == BorderStyle::Double {
            line * 3
        } else {
            line
        };
        let pt = |twips: u32| format!("{:.2}pt", f64::from(twips) / 20.0);
        let style = if border.style == BorderStyle::Double {
            "double"
        } else {
            "solid"
        };
        props.push_str(&format!(
            r#" fo:border="{} {style} {}""#,
            pt(total),
            border.color.to_ascii_lowercase()
        ));
        if border.style == BorderStyle::Double {
            props.push_str(&format!(
                r#" style:border-line-width="{0} {0} {0}""#,
                pt(line)
            ));
        }
        if border.style == BorderStyle::Shadow {
            props.push_str(r##" style:shadow="#808080 0.106cm 0.106cm""##);
        }
        let space = BORDER_SPACE_PT * 20;
        let mut padding = [0u32; 4];
        for (m, p) in margins.iter_mut().zip(padding.iter_mut()) {
            if *m >= space + total {
                *p = *m - space - total;
                *m = space;
            } else {
                *p = 0;
                *m = m.saturating_sub(total);
            }
        }
        props.push_str(&format!(
            r#" fo:padding-top="{}" fo:padding-bottom="{}" fo:padding-left="{}" fo:padding-right="{}""#,
            cm(padding[0]),
            cm(padding[1]),
            cm(padding[2]),
            cm(padding[3])
        ));
    }
    (props, margins)
}

/// Cor, borda e o quanto somar às margens (borda + enchimento, em twips) de um
/// `style:page-layout-properties`.
pub fn odt_read_page_props(
    e: &BytesStart,
    length_cm: impl Fn(&str) -> Option<f64>,
) -> (Option<String>, Option<PageBorder>, [u32; 4]) {
    let twips = |v: &str| {
        length_cm(v)
            .map(|cm| (cm / 2.54 * 1440.0).round().max(0.0) as u32)
            .unwrap_or(0)
    };
    let fill = attr(e, b"fill");
    let background = match fill.as_deref() {
        Some("solid") => attr(e, b"fill-color").and_then(|c| parse_color(&c)),
        Some("none") => None,
        _ => attr(e, b"background-color")
            .filter(|c| c != "transparent")
            .and_then(|c| parse_color(&c)),
    };
    // fo:border ou, se os lados forem diferentes, o de cima.
    let side = |k: &[u8]| attr(e, k).filter(|v| v != "none" && !v.is_empty());
    let mut extra = [0u32; 4];
    let mut border = None;
    for (i, key) in [
        b"border-top".as_slice(),
        b"border-bottom",
        b"border-left",
        b"border-right",
    ]
    .iter()
    .enumerate()
    {
        let value = side(key).or_else(|| side(b"border"));
        let pad = attr(e, &[b"padding-", &key[7..]].concat())
            .or_else(|| attr(e, b"padding"))
            .map(|v| twips(&v))
            .unwrap_or(0);
        if let Some(value) = value {
            let mut width = 0;
            let mut style = BorderStyle::Single;
            let mut color = "#000000".to_string();
            for token in value.split_whitespace() {
                if let Some(c) = parse_color(token).filter(|_| token.starts_with('#')) {
                    color = c;
                } else if token == "double" {
                    style = BorderStyle::Double;
                } else if length_cm(token).is_some() {
                    width = twips(token);
                }
            }
            extra[i] = width + pad;
            if border.is_none() {
                if attr(e, b"shadow").is_some_and(|s| s != "none") && style == BorderStyle::Single {
                    style = BorderStyle::Shadow;
                }
                // Linha dupla: a espessura de cada linha (style:border-line-width) ou um terço do total.
                let line = if style == BorderStyle::Double {
                    attr(e, b"border-line-width")
                        .and_then(|v| v.split_whitespace().next().map(twips))
                        .unwrap_or(width / 3)
                } else {
                    width
                };
                border = Some(PageBorder {
                    style,
                    color,
                    width: ((line * 8 + 10) / 20).clamp(2, 48) as u8,
                });
            }
        }
    }
    (background, border, extra)
}

/// Estilos da marca d'água (em `office:automatic-styles` do styles.xml): o
/// gráfico (cor, opacidade, atrás do texto, centrada na área de texto) e o do texto.
pub fn odt_watermark_style(w: &Watermark) -> String {
    let opacity = if w.semitransparent {
        r#" draw:opacity="50%""#
    } else {
        ""
    };
    format!(
        concat!(
            r#"<style:style style:name="Mw1" style:family="graphic"><style:graphic-properties draw:stroke="none" svg:stroke-width="0cm" draw:fill="solid" draw:fill-color="{}"{} draw:textarea-vertical-align="top" draw:auto-grow-height="false" draw:auto-grow-width="false" fo:margin-left="0cm" fo:margin-right="0cm" fo:margin-top="0cm" fo:margin-bottom="0cm" style:run-through="background" style:wrap="run-through" style:number-wrapped-paragraphs="no-limit" style:vertical-pos="middle" style:vertical-rel="page-content" style:horizontal-pos="center" style:horizontal-rel="page-content" draw:wrap-influence-on-position="once-concurrent" style:flow-with-text="false"/></style:style>"#,
            r#"<style:style style:name="Mw2" style:family="paragraph"><style:text-properties fo:font-family="Calibri" fo:font-size="1pt"/></style:style>"#
        ),
        w.color.to_ascii_lowercase(),
        opacity
    )
}

/// A marca d'água como o LibreOffice grava: um `draw:custom-shape` fontwork
/// ancorado no parágrafo do cabeçalho, centrado na área de texto e, na
/// diagonal, girado 45° em volta do centro.
pub fn odt_watermark(w: &Watermark, page: &PageSetup) -> String {
    let (width, height) = watermark_size(w, page);
    let cm_pt = |pt: f64| pt / 72.0 * 2.54;
    let cm_tw = |tw: u32| f64::from(tw) / 1440.0 * 2.54;
    let (wcm, hcm) = (cm_pt(width), cm_pt(height));
    // Centro da área de texto, relativo a ela.
    let cx = cm_tw(
        page.width
            .saturating_sub(page.margin_left + page.margin_right),
    ) / 2.0;
    let cy = cm_tw(
        page.height
            .saturating_sub(page.margin_top + page.margin_bottom),
    ) / 2.0;
    let place = match w.layout {
        // O ODF gira em volta do canto (0,0) e depois desloca: o deslocamento leva o
        // centro da forma girada ao centro da área de texto.
        WatermarkLayout::Diagonal => {
            let a = std::f64::consts::FRAC_PI_4;
            let (sx, sy) = (wcm / 2.0, hcm / 2.0);
            let x = cx - (sx * a.cos() + sy * a.sin());
            let y = cy - (-sx * a.sin() + sy * a.cos());
            format!(r#" draw:transform="rotate ({a}) translate ({x:.3}cm {y:.3}cm)""#)
        }
        WatermarkLayout::Horizontal => format!(
            r#" svg:x="{:.3}cm" svg:y="{:.3}cm""#,
            cx - wcm / 2.0,
            cy - hcm / 2.0
        ),
    };
    format!(
        concat!(
            r#"<draw:custom-shape text:anchor-type="char" draw:z-index="0" draw:name="{name}1" draw:style-name="Mw1" draw:text-style-name="Mw2" svg:width="{w:.3}cm" svg:height="{h:.3}cm"{place}>"#,
            r#"<text:p>{text}</text:p>"#,
            r#"<draw:enhanced-geometry draw:text-path="true" draw:text-path-mode="shape" draw:text-path-scale="path" draw:text-path-same-letter-heights="false" svg:viewBox="0 0 21600 21600" draw:text-areas="0 0 21600 21600" draw:type="fontwork-plain-text" draw:modifiers="10800" draw:enhanced-path="M ?f3 0 L ?f5 0 N M ?f6 21600 L ?f7 21600 N">"#,
            r#"<draw:equation draw:name="f0" draw:formula="$0 -10800"/><draw:equation draw:name="f1" draw:formula="?f0 *2"/><draw:equation draw:name="f2" draw:formula="abs(?f1 )"/><draw:equation draw:name="f3" draw:formula="if(?f1 ,0,?f2 )"/><draw:equation draw:name="f4" draw:formula="21600-?f2 "/><draw:equation draw:name="f5" draw:formula="if(?f1 ,?f4 ,21600)"/><draw:equation draw:name="f6" draw:formula="if(?f1 ,?f2 ,0)"/><draw:equation draw:name="f7" draw:formula="if(?f1 ,21600,?f4 )"/>"#,
            r#"<draw:handle draw:handle-position="$0 21600" draw:handle-range-x-minimum="6629" draw:handle-range-x-maximum="14971"/></draw:enhanced-geometry></draw:custom-shape>"#
        ),
        name = WATERMARK_NAME,
        w = wcm,
        h = hcm,
        place = place,
        text = esc(&w.text),
    )
}

/// Marca d'água do styles.xml: o primeiro `draw:custom-shape` fontwork (ou com o
/// nome da marca d'água) dentro do cabeçalho do primeiro estilo de página mestre.
pub fn odt_read_watermark(xml: &str) -> Option<Watermark> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    // Estilos gráficos: nome → (cor, semitransparente).
    let mut graphics: Vec<(String, Option<String>, bool)> = Vec::new();
    let mut style_name: Option<String> = None;
    let (mut in_master, mut in_header) = (false, false);
    // Forma aberta: (nome do estilo, girada, é fontwork, texto).
    let mut shape: Option<(Option<String>, bool, bool, String, bool)> = None;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"style" if !in_master => {
                    style_name = (attr(&e, b"family").as_deref() == Some("graphic"))
                        .then(|| attr(&e, b"name"))
                        .flatten();
                }
                b"graphic-properties" if style_name.is_some() => {
                    let color = (attr(&e, b"fill").as_deref() != Some("none"))
                        .then(|| attr(&e, b"fill-color"))
                        .flatten()
                        .and_then(|c| parse_color(&c));
                    let semi = attr(&e, b"opacity")
                        .and_then(|v| v.trim_end_matches('%').parse::<f64>().ok())
                        .is_some_and(|v| v < 95.0);
                    graphics.push((style_name.take().unwrap_or_default(), color, semi));
                }
                b"master-page" => in_master = true,
                b"header" | b"header-first" if in_master => in_header = true,
                b"custom-shape" if in_header => {
                    let rotated = attr(&e, b"transform").is_some_and(|t| {
                        t.split("rotate")
                            .nth(1)
                            .and_then(|r| {
                                r.trim()
                                    .trim_start_matches('(')
                                    .split(')')
                                    .next()
                                    .and_then(|n| n.trim().parse::<f64>().ok())
                            })
                            .is_some_and(|r| r.abs() > 0.01)
                    });
                    let named = attr(&e, b"name").is_some_and(|n| n.starts_with(WATERMARK_NAME));
                    shape = Some((
                        attr(&e, b"style-name"),
                        rotated,
                        named,
                        String::new(),
                        false,
                    ));
                }
                b"enhanced-geometry" => {
                    if let Some(s) = shape.as_mut() {
                        s.2 |= attr(&e, b"type").is_some_and(|t| t.starts_with("fontwork"))
                            || attr(&e, b"text-path").as_deref() == Some("true");
                    }
                }
                b"p" => {
                    if let Some(s) = shape.as_mut() {
                        s.4 = true;
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if let Some(s) = shape.as_mut().filter(|s| s.4) {
                    s.3.push_str(&t.unescape().map(|v| v.into_owned()).unwrap_or_default());
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"p" => {
                    if let Some(s) = shape.as_mut() {
                        s.4 = false;
                    }
                }
                b"custom-shape" => {
                    if let Some((style, rotated, fontwork, text, _)) = shape.take() {
                        let (color, semi) = graphics
                            .iter()
                            .find(|g| Some(&g.0) == style.as_ref())
                            .map(|g| (g.1.clone(), g.2))
                            .unwrap_or((None, false));
                        let value = Watermark {
                            text: text.chars().take(MAX_WATERMARK_CHARS).collect(),
                            color: color.unwrap_or_else(|| "#C0C0C0".into()),
                            semitransparent: semi,
                            layout: if rotated {
                                WatermarkLayout::Diagonal
                            } else {
                                WatermarkLayout::Horizontal
                            },
                        };
                        if fontwork && value.validate().is_ok() {
                            return Some(value);
                        }
                    }
                }
                b"header" | b"header-first" => in_header = false,
                b"master-page" => return None,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cores() {
        assert_eq!(parse_color("silver").as_deref(), Some("#C0C0C0"));
        assert_eq!(parse_color("#c0c0c0 [3212]").as_deref(), Some("#C0C0C0"));
        assert_eq!(parse_color("#f00").as_deref(), Some("#FF0000"));
        assert_eq!(parse_color("2F5496").as_deref(), Some("#2F5496"));
        assert_eq!(parse_color("auto"), None);
    }

    /// Cabeçalho de um .docx gravado pelo LibreOffice 26.8 (o `v:fill` vem depois do texto).
    #[test]
    fn marca_dagua_do_docx_do_libreoffice() {
        let xml = r#"<w:hdr xmlns:w="w" xmlns:v="v" xmlns:o="o" xmlns:w10="w10"><w:p><w:r><w:pict><v:shape id="PowerPlusWaterMarkObject" o:spid="shape_0" fillcolor="red" stroked="f" style="position:absolute;margin-left:-45.8pt;width:542.2pt;height:82.1pt;rotation:315;mso-position-horizontal:center" type="_x0000_t136"><v:path textpathok="t"/><v:textpath on="t" fitshape="t" string="CONFIDENCIAL" style="font-family:&quot;Calibri&quot;;font-size:11pt" trim="t"/><v:fill o:detectmouseclick="t" type="solid" color2="aqua" opacity="0.5"/><w10:wrap type="none"/></v:shape></w:pict></w:r><w:r><w:t>Cabeçalho</w:t></w:r></w:p></w:hdr>"#;
        assert_eq!(
            docx_read_watermark(xml),
            Some(Watermark {
                text: "CONFIDENCIAL".into(),
                color: "#FF0000".into(),
                semitransparent: true,
                layout: WatermarkLayout::Diagonal,
            })
        );
    }

    /// styles.xml de um .odt gravado pelo LibreOffice 26.8 a partir de um .docx com marca d'água.
    #[test]
    fn marca_dagua_do_odt_do_libreoffice() {
        let xml = r##"<office:document-styles><office:automatic-styles><style:style style:name="Mgr1" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="#ff0000" draw:opacity="50%" style:run-through="background"/></style:style></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Mpm1"><style:header><text:p text:style-name="Standard"><draw:custom-shape text:anchor-type="char" draw:name="PowerPlusWaterMarkObject1" draw:style-name="Mgr1" svg:width="16.003cm" svg:height="3.516cm" svg:x="0cm" svg:y="10.592cm"><text:p text:style-name="MP1">NÃO COPIE</text:p><draw:enhanced-geometry draw:text-path="true" draw:type="fontwork-plain-text"/></draw:custom-shape>Cabeçalho</text:p></style:header></style:master-page></office:master-styles></office:document-styles>"##;
        assert_eq!(
            odt_read_watermark(xml),
            Some(Watermark {
                text: "NÃO COPIE".into(),
                color: "#FF0000".into(),
                semitransparent: true,
                layout: WatermarkLayout::Horizontal,
            })
        );
    }

    /// Os mesmos números do teste do front-end (design.test.ts): tela, impressão e arquivo iguais.
    #[test]
    fn caixa_da_marca_dagua() {
        let page = PageSetup::default();
        assert_eq!(
            watermark_size(&Watermark::default(), &page),
            (542.29, 82.16)
        );
        let horizontal = Watermark {
            text: "RASCUNHO".into(),
            layout: WatermarkLayout::Horizontal,
            ..Watermark::default()
        };
        assert_eq!(watermark_size(&horizontal, &page), (453.6, 103.09));
    }

    #[test]
    fn opacidade_do_vml() {
        assert_eq!(parse_opacity(".5"), Some(0.5));
        assert_eq!(parse_opacity("50%"), Some(0.5));
        assert_eq!(parse_opacity("32768f"), Some(0.5));
    }
}
