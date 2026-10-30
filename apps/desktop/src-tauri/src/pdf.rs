//! Exportar para PDF sem a janela de impressão (Arquivo → Exportar → Criar PDF).
//!
//! O PDF sai do próprio WebView, com o CSS de impressão (o mesmo de Imprimir):
//! - Windows: `ICoreWebView2_7::PrintToPdf` do WebView2 (o motor do Chromium);
//! - Linux: `WebKitPrintOperation` do WebKitGTK, imprimindo num arquivo;
//! - macOS: ainda sem suporte; a interface cai na janela de impressão
//!   ("Salvar como PDF").
//!
//! Tamanho do papel e margens vêm do documento (aba Layout).

use nova_domain_text::PageSetup;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

/// Erro quando o sistema não exporta PDF direto: a interface usa a impressão.
#[allow(dead_code)]
pub const UNSUPPORTED: &str = "pdf:unsupported";

/// Twips (1/1440 de polegada) para polegadas.
#[allow(dead_code)]
fn inches(twips: u32) -> f64 {
    f64::from(twips) / 1440.0
}

pub fn export(webview: &tauri::Webview, path: PathBuf, page: PageSetup) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    start(webview, path.clone(), page, tx)?;
    // O WebView avisa quando termina (no fio principal); aqui só esperamos.
    let result = rx
        .recv_timeout(Duration::from_secs(120))
        .map_err(|_| "o PDF demorou demais para ficar pronto".to_string())?;
    result?;
    match std::fs::metadata(&path) {
        Ok(m) if m.len() > 0 => Ok(()),
        _ => Err(format!("o PDF não foi gravado em {}", path.display())),
    }
}

#[cfg(windows)]
fn start(
    webview: &tauri::Webview,
    path: PathBuf,
    page: PageSetup,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let fail = tx.clone();
    webview
        .with_webview(move |wv| {
            let run = || -> windows::core::Result<()> {
                unsafe {
                    let core = wv.controller().CoreWebView2()?;
                    let core: ICoreWebView2_7 = core.cast()?;
                    let env: ICoreWebView2Environment6 = wv.environment().cast()?;
                    let settings = env.CreatePrintSettings()?;
                    let landscape = page.width > page.height;
                    settings.SetOrientation(if landscape {
                        COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                    } else {
                        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                    })?;
                    // No WebView2, largura e altura são as do papel em retrato.
                    let (w, h) = if landscape {
                        (page.height, page.width)
                    } else {
                        (page.width, page.height)
                    };
                    settings.SetPageWidth(inches(w))?;
                    settings.SetPageHeight(inches(h))?;
                    settings.SetMarginTop(inches(page.margin_top))?;
                    settings.SetMarginBottom(inches(page.margin_bottom))?;
                    settings.SetMarginLeft(inches(page.margin_left))?;
                    settings.SetMarginRight(inches(page.margin_right))?;
                    settings.SetShouldPrintBackgrounds(true)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    settings.SetShouldPrintSelectionOnly(false)?;
                    let done = tx.clone();
                    let handler =
                        PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
                            let _ = done.send(match result {
                                Ok(()) if ok => Ok(()),
                                Ok(()) => Err("o WebView2 não conseguiu gravar o PDF".into()),
                                Err(e) => Err(format!("WebView2: {e}")),
                            });
                            Ok(())
                        }));
                    core.PrintToPdf(&HSTRING::from(path.as_os_str()), &settings, &handler)?;
                }
                Ok(())
            };
            if let Err(e) = run() {
                // WebView2 antigo, sem PrintToPdf: a interface usa a impressão.
                let _ = fail.send(Err(if e.code().0 as u32 == 0x8000_4002 {
                    UNSUPPORTED.to_string()
                } else {
                    format!("WebView2: {e}")
                }));
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn start(
    webview: &tauri::Webview,
    path: PathBuf,
    page: PageSetup,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webkit2gtk::PrintOperationExt;

    let uri = gtk::glib::filename_to_uri(&path, None).map_err(|e| e.to_string())?;
    webview
        .with_webview(move |wv| {
            let op = webkit2gtk::PrintOperation::new(&wv.inner());
            let settings = gtk::PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri.as_str()));
            let setup = gtk::PageSetup::new();
            let mm = |twips: u32| f64::from(twips) / 1440.0 * 25.4;
            let paper = gtk::PaperSize::new_custom(
                "nova",
                "Nova",
                mm(page.width.min(page.height)),
                mm(page.width.max(page.height)),
                gtk::Unit::Mm,
            );
            setup.set_paper_size(&paper);
            setup.set_orientation(if page.width > page.height {
                gtk::PageOrientation::Landscape
            } else {
                gtk::PageOrientation::Portrait
            });
            setup.set_top_margin(mm(page.margin_top), gtk::Unit::Mm);
            setup.set_bottom_margin(mm(page.margin_bottom), gtk::Unit::Mm);
            setup.set_left_margin(mm(page.margin_left), gtk::Unit::Mm);
            setup.set_right_margin(mm(page.margin_right), gtk::Unit::Mm);
            op.set_print_settings(&settings);
            op.set_page_setup(&setup);
            let done = tx.clone();
            op.connect_finished(move |_| {
                let _ = done.send(Ok(()));
            });
            let failed = tx.clone();
            op.connect_failed(move |_, e| {
                let _ = failed.send(Err(format!("WebKitGTK: {e}")));
            });
            op.print();
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(any(
    windows,
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
fn start(
    _webview: &tauri::Webview,
    _path: PathBuf,
    _page: PageSetup,
    _tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    Err(UNSUPPORTED.to_string())
}
