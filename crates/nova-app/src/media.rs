//! Imagens embutidas: id pelo conteúdo, tipo pelo cabeçalho do arquivo,
//! tamanho em pixels e tamanho inicial na página.

use base64::Engine;
use nova_domain_text::{ImageRef, TextDocument, MAX_IMAGE_PT};

/// Largura útil da página A4 com margens de 2,5 cm, em pontos: a imagem entra
/// no máximo com essa largura, como no Word.
pub const TEXT_WIDTH_PT: u16 = 482;

/// Id do arquivo: hash FNV-1a de 64 bits do conteúdo, em hexadecimal. O mesmo
/// arquivo inserido duas vezes fica guardado uma vez só.
pub fn media_id(data: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in data {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("m{hash:016x}{:x}", data.len())
}

/// Tipo pelo cabeçalho (a extensão do arquivo pode mentir).
pub fn sniff_mime(data: &[u8]) -> Option<&'static str> {
    match data {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'B', b'M', ..] => Some("image/bmp"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

pub fn extension(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpeg",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/webp" => "webp",
        _ => "png",
    }
}

/// Tamanho inicial em pontos: 96 pixels por polegada (como o Word), limitado
/// à largura do texto, mantendo a proporção.
pub fn initial_size(data: &[u8]) -> (u16, u16) {
    let (w, h) = imagesize::blob_size(data)
        .map(|s| (s.width as f64, s.height as f64))
        .unwrap_or((400.0, 300.0));
    fit(w * 0.75, h * 0.75, f64::from(TEXT_WIDTH_PT))
}

/// Ajusta (largura, altura) em pontos para caber em `max_width`, mantendo a proporção.
pub fn fit(width: f64, height: f64, max_width: f64) -> (u16, u16) {
    let (w, h) = (width.max(1.0), height.max(1.0));
    let scale = (max_width / w).min(f64::from(MAX_IMAGE_PT) / h).min(1.0);
    let clamp = |v: f64| (v * scale).round().clamp(1.0, f64::from(MAX_IMAGE_PT)) as u16;
    (clamp(w), clamp(h))
}

/// Guarda a imagem no documento e devolve a referência para o parágrafo.
pub fn embed(doc: &TextDocument, data: &[u8], size: Option<(u16, u16)>) -> Option<ImageRef> {
    let mime = sniff_mime(data)?;
    let id = media_id(data);
    doc.put_media(&id, mime, data).ok()?;
    let (width, height) = size.unwrap_or_else(|| initial_size(data));
    Some(ImageRef { id, width, height })
}

/// `data:image/png;base64,…`, para HTML e Markdown.
pub fn data_url(mime: &str, data: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    )
}

/// Bytes de um `data:…;base64,…`.
pub fn from_data_url(url: &str) -> Option<Vec<u8>> {
    let (head, body) = url.strip_prefix("data:")?.split_once(',')?;
    head.ends_with(";base64").then_some(())?;
    base64::engine::general_purpose::STANDARD
        .decode(body.trim())
        .ok()
}

pub fn to_base64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

pub fn from_base64(text: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::STANDARD.decode(text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PNG 1×1 transparente.
    pub const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn tipo_tamanho_e_id() {
        assert_eq!(sniff_mime(PNG), Some("image/png"));
        assert_eq!(sniff_mime(b"<svg"), None);
        assert_eq!(initial_size(PNG), (1, 1));
        assert_eq!(fit(1200.0, 600.0, 482.0), (482, 241));
        assert_eq!(media_id(PNG), media_id(PNG));
        assert_ne!(media_id(PNG), media_id(&PNG[..60]));
        assert_eq!(from_data_url(&data_url("image/png", PNG)).unwrap(), PNG);
        let doc = TextDocument::new(1);
        let image = embed(&doc, PNG, None).unwrap();
        assert_eq!(doc.media(&image.id).unwrap().1, PNG);
    }
}
