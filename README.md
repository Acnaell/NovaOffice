# NovaOffice

Suíte office modular com núcleo em Rust, documentos em CRDT e front-end React/Tauri.
A arquitetura completa está no documento "LibreOffice: Análise Arquitetural e Proposta NovaOffice".

## Estado atual (MVP, incremento 2)

| Crate | Papel |
| --- | --- |
| `crates/nova-crdt` | Encapsula o Yrs: parágrafos como mapas (estilo + texto formatado), offsets UTF-16, desfazer local, sincronização por state vector |
| `crates/nova-domain-text` | Agregado `TextDocument`: comandos, eventos de domínio, marcas de caractere, estilos de parágrafo, validação |
| `crates/nova-app` | `Session` (despacho de comandos em Rust ou JSON, assinantes de eventos), formato `.nova` (versão 2) e exportação Markdown |
| `apps/cli` | Binário `nova` para criar, importar, editar, exportar (texto ou Markdown) e fundir documentos |

## Preparar o ambiente (Windows)

1. Visual Studio Build Tools (2022 ou 2026) com a carga "Desenvolvimento para desktop com C++":
   `winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`
2. Rust: `winget install Rustlang.Rustup` e depois, em um terminal novo, `rustup default stable`
3. Git: `winget install Git.Git`

## Compilar e testar

```powershell
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cargo run -p nova-cli -- --help
```

## Exemplo com o CLI

```powershell
cargo run -p nova-cli -- import notas.txt notas.nova
cargo run -p nova-cli -- exec notas.nova '{"type":"text.insert","block":0,"offset":0,"text":"Título: "}'
cargo run -p nova-cli -- exec notas.nova '{"type":"block.split","block":0,"offset":8}'
cargo run -p nova-cli -- exec notas.nova '{"type":"block.setStyle","block":0,"style":"heading1"}'
cargo run -p nova-cli -- exec notas.nova '{"type":"text.applyMark","block":1,"offset":0,"len":5,"mark":{"mark":"bold"}}'
cargo run -p nova-cli -- export notas.nova --format md
```

No Windows PowerShell 5.1, aspas duplas dentro de argumentos são removidas ao chamar executáveis.
Use o PowerShell 7 (`pwsh`), escape as aspas (`'{\"type\":\"block.split\",\"block\":0,\"offset\":8}'`)
ou grave o comando num arquivo e passe `@comando.json`.

Fusão de cópias editadas em separado (o mesmo mecanismo da coedição):

```powershell
Copy-Item notas.nova copia.nova
cargo run -p nova-cli -- exec notas.nova '{"type":"text.insert","block":0,"offset":0,"text":"A "}'
cargo run -p nova-cli -- exec copia.nova '{"type":"block.insert","index":1,"text":"linha da cópia"}'
cargo run -p nova-cli -- merge notas.nova copia.nova final.nova
cargo run -p nova-cli -- export final.nova
```

## Comandos de texto

| `type` | Campos | Efeito |
| --- | --- | --- |
| `text.insert` | `block`, `offset`, `text`, `marks` (opcional) | Insere texto sem quebra de linha. Sem `marks`, herda a formatação à esquerda |
| `text.delete` | `block`, `offset`, `len` | Apaga `len` unidades UTF-16 |
| `text.applyMark` | `block`, `offset`, `len`, `mark` | Aplica uma marca ao intervalo |
| `text.removeMark` | `block`, `offset`, `len`, `kind` | Remove uma marca do intervalo |
| `block.split` | `block`, `offset` | Enter: divide o parágrafo (Enter no fim de um título cria parágrafo normal) |
| `block.mergeNext` | `block` | Junta o parágrafo seguinte a este |
| `block.insert` | `index`, `text`, `style` (opcional) | Insere parágrafo |
| `block.remove` | `block` | Remove parágrafo (nunca o último) |
| `block.setStyle` | `block`, `style` | Muda o estilo do parágrafo |
| `history.undo` | | Desfaz a última edição local |
| `history.redo` | | Refaz |

Offsets são unidades UTF-16, como no JavaScript.

**Marcas** (`mark`): `{"mark":"bold"}`, `italic`, `underline`, `strike`,
`{"mark":"fontFamily","value":"Inter"}`, `{"mark":"fontSize","halfPoints":24}` (12 pt),
`{"mark":"color","value":"#C00000"}`. Para `text.removeMark`, `kind` é o nome da marca (`"bold"`, `"fontSize"`…).

**Estilos** (`style`): `paragraph`, `heading1` a `heading6`, `quote`, `code`.

**Desfazer:** digitação e exclusões em menos de 500 ms formam um passo; cada outro comando é um passo
próprio. Só as edições locais são desfeitas, nunca as de outros colaboradores. O histórico vive na
memória da sessão e não é gravado no `.nova`, então cada `nova exec` começa sem histórico.

## Próximos incrementos do MVP

- [x] Formatação de caracteres (negrito, itálico, sublinhado, tachado, fonte, tamanho, cor)
- [x] Estilos de parágrafo (títulos 1 a 6, citação, código)
- [x] Desfazer e refazer por usuário (`UndoManager` do Yrs)
- [ ] Listas, tabelas e imagens como blocos tipados
- [ ] Âncoras estáveis (`StickyIndex`) no lugar de índices de bloco
- [ ] Divisão de bloco que preserve digitação concorrente no fim do parágrafo (hoje converge, mas o texto digitado em paralelo fica no primeiro bloco)
- [ ] Eventos para mudanças remotas
- [ ] `nova-layout`: shaping (HarfBuzz) e paginação
- [ ] `apps/desktop`: Tauri + React chamando `Session::dispatch_json`
- [ ] Planilha: `nova-domain-sheet` e `nova-calc`
- [ ] Plugins de formato: ODT e DOCX primeiro
- [ ] CI no GitHub Actions (fmt, clippy, testes em Windows, macOS e Linux)
