# NovaOffice

Suíte office modular com núcleo em Rust, documentos em CRDT e front-end React/Tauri.
A arquitetura completa está no documento "LibreOffice: Análise Arquitetural e Proposta NovaOffice".

## Estado atual (MVP, incremento 1)

| Crate | Papel |
| --- | --- |
| `crates/nova-crdt` | Encapsula o Yrs: blocos de texto, offsets UTF-16, sincronização por state vector |
| `crates/nova-domain-text` | Agregado `TextDocument`: comandos, eventos de domínio, validação |
| `crates/nova-app` | `Session` (despacho de comandos em Rust ou JSON, assinantes de eventos) e formato `.nova` |
| `apps/cli` | Binário `nova` para criar, importar, editar, exportar e fundir documentos |

## Preparar o ambiente (Windows)

1. Visual Studio Build Tools com a carga "Desenvolvimento para desktop com C++":
   `winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`
2. Rust: `winget install Rustlang.Rustup` e depois, em um terminal novo, `rustup default stable`
3. Git: `winget install Git.Git`

## Compilar e testar

```powershell
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo run -p nova-cli -- --help
```

## Exemplo com o CLI

```powershell
cargo run -p nova-cli -- import notas.txt notas.nova
cargo run -p nova-cli -- exec notas.nova '{"type":"text.insert","block":0,"offset":0,"text":"Título: "}'
cargo run -p nova-cli -- exec notas.nova '{"type":"block.split","block":0,"offset":8}'
cargo run -p nova-cli -- export notas.nova
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
| `text.insert` | `block`, `offset`, `text` | Insere texto sem quebra de linha |
| `text.delete` | `block`, `offset`, `len` | Apaga `len` unidades UTF-16 |
| `block.split` | `block`, `offset` | Enter: divide o parágrafo |
| `block.mergeNext` | `block` | Junta o parágrafo seguinte a este |
| `block.insert` | `index`, `text` | Insere parágrafo |
| `block.remove` | `block` | Remove parágrafo (nunca o último) |

Offsets são unidades UTF-16, como no JavaScript.

## Próximos incrementos do MVP

- [ ] Formatação de caracteres (negrito, itálico, fontes) como atributos do `YText`
- [ ] Estilos de parágrafo e blocos tipados (título, lista, tabela, imagem)
- [ ] Âncoras estáveis (`StickyIndex`) no lugar de índices de bloco
- [ ] Divisão de bloco que preserve digitação concorrente no fim do parágrafo (hoje converge, mas o texto digitado em paralelo fica no primeiro bloco)
- [ ] Desfazer e refazer por usuário (`UndoManager` do Yrs)
- [ ] Eventos para mudanças remotas
- [ ] `nova-layout`: shaping (HarfBuzz) e paginação
- [ ] `apps/desktop`: Tauri + React chamando `Session::dispatch_json`
- [ ] Planilha: `nova-domain-sheet` e `nova-calc`
- [ ] Plugins de formato: ODT e DOCX primeiro
- [ ] CI no GitHub Actions (fmt, clippy, testes em Windows, macOS e Linux)
