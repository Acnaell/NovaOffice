use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use nova_app::{file, Session};
use nova_crdt::ClientId;
use nova_domain_text::TextDocument;

#[derive(Parser)]
#[command(name = "nova", version, about = "Linha de comando da NovaOffice")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Cria um documento de texto vazio
    New { out: PathBuf },
    /// Converte um .txt (UTF-8) em documento .nova, um parágrafo por linha
    Import { input: PathBuf, out: PathBuf },
    /// Exporta um .nova como texto; sem OUT, imprime no terminal
    Export { input: PathBuf, out: Option<PathBuf> },
    /// Executa um comando JSON no documento e grava o resultado
    ///
    /// Exemplo: nova exec doc.nova '{"type":"text.insert","block":0,"offset":0,"text":"Olá"}'
    /// Com @arquivo.json o comando é lido do arquivo.
    Exec { doc: PathBuf, command: String },
    /// Funde duas cópias editadas em separado do mesmo documento
    Merge { a: PathBuf, b: PathBuf, out: PathBuf },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::New { out } => write_doc(&out, &TextDocument::new(client_id())),
        Command::Import { input, out } => {
            let text = fs::read_to_string(&input)
                .with_context(|| format!("lendo {}", input.display()))?;
            write_doc(&out, &TextDocument::from_plain_text(client_id(), &text))
        }
        Command::Export { input, out } => {
            let text = read_doc(&input)?.to_plain_text();
            match out {
                Some(out) => fs::write(&out, text)
                    .with_context(|| format!("gravando {}", out.display())),
                None => {
                    println!("{text}");
                    Ok(())
                }
            }
        }
        Command::Exec { doc, command } => {
            let command = match command.strip_prefix('@') {
                Some(path) => fs::read_to_string(path)
                    .with_context(|| format!("lendo comando de {path}"))?,
                None => command,
            };
            let mut session = Session::new(read_doc(&doc)?);
            let events = session.dispatch_json(&command)?;
            write_doc(&doc, session.document())?;
            println!("{events}");
            Ok(())
        }
        Command::Merge { a, b, out } => {
            let mut merged = read_doc(&a)?;
            merged.apply_remote(&read_doc(&b)?.save())?;
            write_doc(&out, &merged)
        }
    }
}

fn read_doc(path: &Path) -> Result<TextDocument> {
    let bytes = fs::read(path).with_context(|| format!("lendo {}", path.display()))?;
    file::decode(client_id(), &bytes).with_context(|| format!("abrindo {}", path.display()))
}

fn write_doc(path: &Path, doc: &TextDocument) -> Result<()> {
    fs::write(path, file::encode(doc)).with_context(|| format!("gravando {}", path.display()))
}

/// Cada execução do CLI é um cliente CRDT novo. O Yjs usa ids de 32 bits,
/// então o valor fica nessa faixa para manter compatibilidade com o front-end.
fn client_id() -> ClientId {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos()))
        .unwrap_or(0);
    let pid = u64::from(std::process::id());
    ((nanos ^ (pid << 16)) & 0xFFFF_FFFF).max(1)
}
